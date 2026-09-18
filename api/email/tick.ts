import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, serviceClient, secretEquals, siteUrl } from '../_lib/context';
import { decryptSecret } from '../../src/lib/email/crypto';
import { buildMessage } from '../../src/lib/email/message';
import { signUnsubscribeToken, unsubscribeUrl } from '../../src/lib/email/unsubscribe';

const BATCH = 25;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provided = String(req.headers['x-worker-secret'] ?? '');
  if (!provided || !secretEquals(provided, env('EMAIL_WORKER_SECRET'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = serviceClient();
  const { data: claimed, error: claimError } = await db.rpc('claim_email_batch', {
    p_limit: BATCH,
  });
  if (claimError) return res.status(500).json({ error: claimError.message });
  if (!claimed || claimed.length === 0) return res.status(200).json({ sent: 0, failed: 0 });

  let sent = 0;
  let failed = 0;

  // Group by campaign so one campaign's account and body are fetched once.
  const campaignIds = [...new Set(claimed.map((m: any) => m.campaign_id))];
  const { data: campaigns } = await db
    .from('email_campaigns')
    .select('*')
    .in('id', campaignIds);
  const byCampaign = new Map((campaigns ?? []).map((c: any) => [c.id, c]));

  const transports = new Map<string, Transporter>();
  const accounts = new Map<string, any>();

  for (const row of claimed as any[]) {
    const campaign = byCampaign.get(row.campaign_id);
    try {
      if (!campaign) throw new Error('Campaign not found');

      if (!transports.has(campaign.account_id)) {
        const { data: account } = await db
          .from('email_accounts')
          .select('*')
          .eq('id', campaign.account_id)
          .single();
        if (!account) throw new Error('Sending account not found');
        const { data: secretRow } = await db
          .from('email_account_secrets')
          .select('secret_encrypted')
          .eq('account_id', account.id)
          .single();
        if (!secretRow) throw new Error('Sending account has no stored password');
        const password = await decryptSecret(
          secretRow.secret_encrypted,
          env('INTEGRATION_TOKEN_KEY'),
        );
        accounts.set(campaign.account_id, account);
        transports.set(
          campaign.account_id,
          nodemailer.createTransport({
            host: account.smtp_host,
            port: account.smtp_port,
            secure: account.smtp_secure,
            auth: { user: account.smtp_username, pass: password },
          }),
        );
      }

      const account = accounts.get(campaign.account_id);
      const transport = transports.get(campaign.account_id)!;

      let unsub: string | undefined;
      if (campaign.kind === 'bulk') {
        const token = await signUnsubscribeToken(row.message_id, env('EMAIL_UNSUBSCRIBE_SECRET'));
        unsub = unsubscribeUrl(siteUrl(), row.message_id, token);
      }

      const built = buildMessage({
        kind: campaign.kind,
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        mergeData: row.merge_data ?? {},
        unsubscribeUrl: unsub,
      });

      const info = await transport.sendMail({
        from: `"${account.from_name}" <${account.from_email}>`,
        replyTo: account.reply_to ?? undefined,
        to: row.to_name ? `"${row.to_name}" <${row.to_email}>` : row.to_email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        headers: built.headers,
      });

      await db
        .from('email_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: info.messageId ?? null,
          last_error: null,
        })
        .eq('id', row.message_id);
      sent++;
    } catch (err: any) {
      const message = String(err?.message ?? err);
      // A 5xx from the server (bad credentials, rejected sender) will not fix
      // itself; fail immediately rather than burning the retry budget.
      const permanent = /^5\d\d/.test(String(err?.responseCode ?? '')) || row.attempts >= 3;
      await db
        .from('email_messages')
        .update({
          status: permanent ? 'failed' : 'queued',
          claimed_at: null,
          last_error: message.slice(0, 500),
        })
        .eq('id', row.message_id);
      if (permanent) failed++;
    }
  }

  // The batch is sent; release the SMTP connections rather than leaving
  // sockets open in a warm lambda between invocations.
  for (const transport of transports.values()) {
    try {
      transport.close();
    } catch {
      // A transport that never connected has nothing to close.
    }
  }

  // Roll the per-campaign counters up and close finished campaigns.
  for (const id of campaignIds) {
    const { count: remaining } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .in('status', ['queued', 'sending']);
    const { count: sentCount } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'sent');
    const { count: failedCount } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'failed');
    await db
      .from('email_campaigns')
      .update({
        sent_count: sentCount ?? 0,
        failed_count: failedCount ?? 0,
        status: (remaining ?? 0) === 0 ? 'sent' : 'sending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  return res.status(200).json({ sent, failed, claimed: claimed.length });
}
