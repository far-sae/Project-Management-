import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, serviceClient } from '../_lib/context';
import { decryptSecret } from '../_lib/crypto';

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

  // Held outside the try so the finally below can close it whichever way the
  // send goes; an unclosed transport leaks a socket in a warm lambda.
  let transport: Transporter | null = null;
  try {
    const { data: secretRow } = await db
      .from('email_account_secrets')
      .select('secret_encrypted')
      .eq('account_id', accountId)
      .single();
    if (!secretRow) throw new Error('No stored password for this account');
    const password = await decryptSecret(secretRow.secret_encrypted, env('INTEGRATION_TOKEN_KEY'));

    transport = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: { user: account.smtp_username, pass: password },
    });

    await transport.sendMail({
      // Objects, not `"name" <addr>` strings: a from_name holding a quote
      // would otherwise inject a second address into the header.
      from: { name: String(account.from_name ?? ''), address: String(account.from_email) },
      to: { name: '', address: to },
      subject: 'TaskCalendar test email',
      text: 'This is a test message. Your sending account works.',
    });

    // A send that actually worked settles every automatic doubt about this
    // mailbox at once: the credential error, the failure streak
    // record_mailbox_failure() has been counting, and the pause it imposed at
    // three. Clearing only `status` left a mailbox that had been paused
    // automatically still out of rotation with nothing on screen explaining
    // why the test it just passed changed nothing.
    await db
      .from('email_accounts')
      .update({
        status: 'active',
        last_error: null,
        last_verified_at: new Date().toISOString(),
        consecutive_failures: 0,
        paused_reason: null,
        is_active: true,
      })
      .eq('id', accountId);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    await db
      .from('email_accounts')
      .update({ status: 'error', last_error: message })
      .eq('id', accountId);
    return res.status(400).json({ ok: false, error: message });
  } finally {
    try {
      transport?.close();
    } catch {
      // A transport that never connected has nothing to close.
    }
  }
}
