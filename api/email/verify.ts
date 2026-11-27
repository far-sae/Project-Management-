import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { serviceClient } from '../_lib/context';
import { decryptSecret } from '../_lib/crypto';
import { checkMailbox, NO_PASSWORD_MESSAGE } from '../_lib/mailboxCheck';
import { buildTestEmail, readTestDraft } from '../_lib/testEmail';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = String((req.body ?? {}).accountId ?? '');
  // The recipient is never caller-supplied. A test send always goes to the
  // address on the caller's own verified JWT, so this route cannot be used to
  // mail a third party from the organization's sending identity.
  const to = String(userData.user.email ?? '');
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!to) return res.status(400).json({ error: 'Your account has no email address' });

  const { data: account } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Only the organization's owner or an admin may send from its SMTP identity;
  // a plain member must not be able to spend the account's reputation.
  // is_org_admin_or_owner() is no use here: it reads auth.uid(), which is null
  // under the service-role client, so the membership test is done in the open.
  const callerId = userData.user.id;
  const { data: org } = await db
    .from('organizations')
    .select('owner_id, members')
    .eq('organization_id', account.organization_id)
    .maybeSingle();
  const rawMembers = (org as any)?.members;
  const members: any[] = Array.isArray(rawMembers) ? rawMembers : [];
  const isAdmin = members.some(
    (m: any) =>
      String(m?.userId ?? m?.user_id ?? '') === callerId &&
      (m?.role === 'owner' || m?.role === 'admin'),
  );
  if (!org || (org.owner_id !== callerId && !isAdmin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // A failure is stored and shown as a sentence a person can act on (see
  // _lib/mailboxCheck.ts). What the mail server said in its own words goes
  // nowhere: it told nobody what to do, and it can hold more than it should.
  const fail = async (message: string, status = 400) => {
    await db.from('email_accounts').update({ status: 'error', last_error: message }).eq('id', accountId);
    return res.status(status).json({ ok: false, error: message });
  };

  const { data: secretRow } = await db
    .from('email_account_secrets')
    .select('secret_encrypted')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!secretRow) return fail(NO_PASSWORD_MESSAGE);

  const serverKey = (process.env.INTEGRATION_TOKEN_KEY ?? '').trim();
  let password: string;
  try {
    if (!serverKey) throw new Error('no key');
    password = await decryptSecret(secretRow.secret_encrypted, serverKey);
  } catch {
    // Names a setting, so the page shows it only to the people who run the site (publicText).
    return res.status(503).json({
      ok: false,
      error: 'Mailbox passwords cannot be read: INTEGRATION_TOKEN_KEY is missing or was changed in Vercel\'s environment variables.',
    });
  }

  const mail = {
    // Objects, not `"name" <addr>` strings: a from_name holding a quote
    // would otherwise inject a second address into the header.
    from: { name: String(account.from_name ?? ''), address: String(account.from_email) },
    to: { name: '', address: to },
    // The email being written when the compose form sent one, else the plain line.
    ...buildTestEmail(readTestDraft(req.body)),
  };

  const result = await checkMailbox(
    {
      smtpHost: String(account.smtp_host ?? ''),
      smtpPort: Number(account.smtp_port) || 587,
      smtpSecure: account.smtp_secure === true,
      username: String(account.smtp_username ?? ''),
      imapHost: typeof account.imap_host === 'string' ? account.imap_host : null,
    },
    password,
    async ({ host, port, secure, user, pass }) => {
      // A transport for each try, closed whichever way the try goes: an
      // unclosed one leaks a socket in a warm function.
      let transport: Transporter | null = null;
      try {
        transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
        await transport.sendMail(mail);
      } catch (err) {
        // The code only, for the server's log: the words can hold an address.
        const e = err as { code?: unknown; responseCode?: unknown } | null;
        console.error('[email] mailbox check failed', String(e?.code ?? 'unknown'), Number(e?.responseCode) || 0);
        throw err;
      } finally {
        try {
          transport?.close();
        } catch {
          // A transport that never connected has nothing to close.
        }
      }
    },
  );

  if (!result.ok) return fail(result.message);

  // A send that actually worked settles every automatic doubt about this
  // mailbox at once: the credential error, the failure streak
  // record_mailbox_failure() has been counting, and the pause it imposed at
  // three. What the check put right on the way (the IONOS server of the
  // right region, the encryption that fits the port) is saved with it, so
  // the sender uses the settings that are known to work.
  await db
    .from('email_accounts')
    .update({
      status: 'active',
      last_error: null,
      last_verified_at: new Date().toISOString(),
      consecutive_failures: 0,
      paused_reason: null,
      is_active: true,
      ...(result.changed.smtpHost ? { smtp_host: result.changed.smtpHost } : {}),
      ...(result.changed.imapHost ? { imap_host: result.changed.imapHost } : {}),
      ...(result.changed.smtpSecure !== undefined ? { smtp_secure: result.changed.smtpSecure } : {}),
    })
    .eq('id', accountId);
  return res.status(200).json({ ok: true, ...(result.changed.smtpHost ? { server: result.changed.smtpHost } : {}) });
}
