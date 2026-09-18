import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, serviceClient, secretEquals } from '../_lib/context';
import { decryptSecret } from '../_lib/crypto';
import { buildMessage } from '../_lib/message';
import { signUnsubscribeToken, unsubscribeUrl } from '../_lib/unsubscribe';

const BATCH = 25;
const MAX_ATTEMPTS = 3;

// Everything the tick needs before it is allowed to claim a single row. A
// worker that claims a batch and only then discovers INTEGRATION_TOKEN_KEY is
// missing has already taken those rows out of the queue.
const REQUIRED_ENV = [
  'EMAIL_WORKER_SECRET',
  'INTEGRATION_TOKEN_KEY',
  'EMAIL_UNSUBSCRIBE_SECRET',
  'PUBLIC_SITE_URL',
] as const;

interface ClaimedRow {
  message_id: string;
  campaign_id: string;
  organization_id: string;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  attempts: number;
}

function isPermanentSmtpError(err: any): boolean {
  return /^5\d\d/.test(String(err?.responseCode ?? ''));
}

function short(err: any): string {
  return String(err?.message ?? err).slice(0, 500);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // -- Configuration, read before anything is claimed ------------------
  const cfg: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_ENV) {
    try {
      cfg[name] = env(name);
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    // Names, never values. Nothing has been claimed and nothing has been sent.
    return res.status(500).json({ error: `Missing required env var: ${missing.join(', ')}` });
  }

  const provided = String(req.headers['x-worker-secret'] ?? '');
  if (!provided || !secretEquals(provided, cfg.EMAIL_WORKER_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const site = cfg.PUBLIC_SITE_URL.replace(/\/+$/, '');
  const db = serviceClient();

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  // Delivered by SMTP, but the row could not be written back. Counted so the
  // failure is visible instead of looking like a stalled batch.
  let unconfirmed = 0;
  let accountsDisabled = 0;
  let updateErrors = 0;

  /** Every status write goes through here so no returned error is discarded. */
  const writeStatus = async (
    messageId: string,
    patch: Record<string, unknown>,
  ): Promise<string | null> => {
    const { error } = await db.from('email_messages').update(patch).eq('id', messageId);
    if (!error) return null;
    console.error(`email/tick: status update failed for message ${messageId}: ${error.message}`);
    updateErrors++;
    return error.message;
  };

  /** Nothing was sent for this row: retry it, or give up once it is spent. */
  const failRow = async (row: ClaimedRow, message: string, permanent: boolean) => {
    const isPermanent = permanent || row.attempts >= MAX_ATTEMPTS;
    await writeStatus(row.message_id, {
      status: isPermanent ? 'failed' : 'queued',
      claimed_at: null,
      last_error: message.slice(0, 500),
    });
    if (isPermanent) failed++;
    else requeued++;
  };

  /**
   * A dead credential is the account's fault, not the recipients'. Put the
   * rows back exactly as they were found -- claim_email_batch() already
   * incremented attempts, so undo that too -- rather than burning the outbox
   * to 'failed' because the SMTP password was rotated.
   */
  const returnRowsToQueue = async (batch: ClaimedRow[], message: string) => {
    for (const row of batch) {
      await writeStatus(row.message_id, {
        status: 'queued',
        claimed_at: null,
        attempts: Math.max(0, row.attempts - 1),
        last_error: message.slice(0, 500),
      });
      requeued++;
    }
  };

  const disableAccount = async (accountId: string, message: string) => {
    const { error } = await db
      .from('email_accounts')
      .update({ status: 'error', last_error: message.slice(0, 500) })
      .eq('id', accountId);
    if (error) {
      console.error(`email/tick: could not flag account ${accountId} as error: ${error.message}`);
      updateErrors++;
    }
    accountsDisabled++;
  };

  const summary = () => ({ sent, failed, requeued, unconfirmed, accountsDisabled, updateErrors });

  /**
   * Recompute every in-flight campaign's counters from real row counts and
   * close the ones with nothing left outstanding (migration 155). This runs
   * at the end of EVERY tick, including the tick that claimed nothing — a
   * campaign whose last recipients were all suppressed never gets another
   * claim, so that is the only tick that can ever close it.
   */
  const finalizeCampaigns = async () => {
    const { error } = await db.rpc('finalize_email_campaigns');
    if (error) {
      console.error(`email/tick: finalize_email_campaigns failed: ${error.message}`);
      updateErrors++;
    }
  };

  // -- Claim -----------------------------------------------------------
  const { data: claimed, error: claimError } = await db.rpc('claim_email_batch', {
    p_limit: BATCH,
  });
  if (claimError) {
    await finalizeCampaigns();
    return res.status(500).json({ error: claimError.message });
  }
  if (!claimed || claimed.length === 0) {
    await finalizeCampaigns();
    return res.status(200).json({ ...summary(), claimed: 0 });
  }

  const rows = claimed as ClaimedRow[];

  // Group by campaign so one campaign's account and body are fetched once.
  const campaignIds = [...new Set(rows.map((m) => m.campaign_id))];
  const { data: campaigns, error: campaignError } = await db
    .from('email_campaigns')
    .select('*')
    .in('id', campaignIds);
  if (campaignError) {
    // No bodies means nothing in this batch can be built. Hand every row back
    // rather than leaving the whole batch stranded in 'sending'.
    await returnRowsToQueue(rows, campaignError.message);
    await finalizeCampaigns();
    return res
      .status(500)
      .json({ error: campaignError.message, ...summary(), claimed: rows.length });
  }
  const byCampaign = new Map((campaigns ?? []).map((c: any) => [c.id, c]));

  // Then by account: the account holds the credential, so it is the unit that
  // gets flagged and skipped when that credential turns out to be dead.
  const byAccount = new Map<string, ClaimedRow[]>();
  const orphans: ClaimedRow[] = [];
  for (const row of rows) {
    const campaign = byCampaign.get(row.campaign_id);
    if (!campaign) {
      orphans.push(row);
      continue;
    }
    const list = byAccount.get(campaign.account_id);
    if (list) list.push(row);
    else byAccount.set(campaign.account_id, [row]);
  }

  for (const row of orphans) {
    // The campaign is gone; no retry will ever find it.
    await failRow(row, 'Campaign not found', true);
  }

  for (const [accountId, accountRows] of byAccount) {
    let account: any;
    let transport: Transporter;
    try {
      const { data: accountRow, error: accountError } = await db
        .from('email_accounts')
        .select('*')
        .eq('id', accountId)
        .single();
      if (accountError || !accountRow) {
        throw new Error(accountError?.message ?? 'Sending account not found');
      }
      const { data: secretRow, error: secretError } = await db
        .from('email_account_secrets')
        .select('secret_encrypted')
        .eq('account_id', accountId)
        .single();
      if (secretError || !secretRow) {
        throw new Error(secretError?.message ?? 'Sending account has no stored password');
      }
      const password = await decryptSecret(secretRow.secret_encrypted, cfg.INTEGRATION_TOKEN_KEY);
      account = accountRow;
      transport = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure,
        auth: { user: account.smtp_username, pass: password },
      });
    } catch (err: any) {
      // Account missing, no stored secret, or a secret that will not decrypt:
      // the credential is broken, so flag it and hand the rows back untouched.
      const message = short(err);
      await disableAccount(accountId, message);
      await returnRowsToQueue(accountRows, message);
      continue;
    }

    try {
      for (let i = 0; i < accountRows.length; i++) {
        const row = accountRows[i];
        const campaign = byCampaign.get(row.campaign_id);

        let built;
        try {
          let unsub: string | undefined;
          if (campaign.kind === 'bulk') {
            const token = await signUnsubscribeToken(row.message_id, cfg.EMAIL_UNSUBSCRIBE_SECRET);
            unsub = unsubscribeUrl(site, row.message_id, token);
          }
          built = buildMessage({
            kind: campaign.kind,
            subject: campaign.subject,
            bodyHtml: campaign.body_html,
            mergeData: row.merge_data ?? {},
            unsubscribeUrl: unsub,
          });
        } catch (err: any) {
          // Nothing has been handed to SMTP yet, so requeueing is safe.
          await failRow(row, short(err), false);
          continue;
        }

        let info: { messageId?: string };
        try {
          // ONLY the send sits inside this try. Once it resolves the message
          // is delivered and nothing below may route the row back to 'queued'.
          info = await transport.sendMail({
            // Objects, not `"name" <addr>` strings: a CSV-sourced name holding
            // a quote would otherwise inject a second recipient that the
            // suppression check never saw.
            from: { name: String(account.from_name ?? ''), address: String(account.from_email) },
            replyTo: account.reply_to ?? undefined,
            to: { name: String(row.to_name ?? ''), address: String(row.to_email) },
            subject: built.subject,
            html: built.html,
            text: built.text,
            headers: built.headers,
          });
        } catch (err: any) {
          const message = short(err);
          if (isPermanentSmtpError(err)) {
            // A 5xx is the server refusing this sender outright -- the rest of
            // this account's batch would only collect the same rejection.
            await disableAccount(accountId, message);
            await returnRowsToQueue(accountRows.slice(i), message);
            break;
          }
          await failRow(row, message, false);
          continue;
        }

        // -- Delivered. From here, never back to 'queued'. ---------------
        const providerMessageId = info?.messageId ?? null;
        const patch = {
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
          last_error: null,
        };
        let writeError = await writeStatus(row.message_id, patch);
        if (writeError) writeError = await writeStatus(row.message_id, patch);
        if (!writeError) {
          sent++;
          continue;
        }
        // Still unwritable. Leave the row 'sending' -- never 'queued' -- and
        // record the provider id, which is proof of delivery: the stuck-row
        // recovery reads it and settles the row as 'sent' rather than mailing
        // this recipient a second time.
        await writeStatus(row.message_id, {
          provider_message_id: providerMessageId,
          last_error: `delivered, but the status write-back failed: ${writeError}`.slice(0, 500),
        });
        unconfirmed++;
      }
    } finally {
      // Release the SMTP connection rather than leaving sockets open in a warm
      // lambda between invocations.
      try {
        transport.close();
      } catch {
        // A transport that never connected has nothing to close.
      }
    }
  }

  await finalizeCampaigns();

  return res.status(200).json({ ...summary(), claimed: rows.length });
}
