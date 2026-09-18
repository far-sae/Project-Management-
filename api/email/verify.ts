import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { env, serviceClient } from '../_lib/context';
import { decryptSecret } from '../../src/lib/email/crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = String((req.body ?? {}).accountId ?? '');
  const to = String((req.body ?? {}).to ?? userData.user.email ?? '');
  if (!accountId || !to) return res.status(400).json({ error: 'accountId and to are required' });

  const { data: account } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // The caller must belong to the account's organization.
  const { data: profile } = await db
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile || profile.organization_id !== account.organization_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { data: secretRow } = await db
      .from('email_account_secrets')
      .select('secret_encrypted')
      .eq('account_id', accountId)
      .single();
    if (!secretRow) throw new Error('No stored password for this account');
    const password = await decryptSecret(secretRow.secret_encrypted, env('INTEGRATION_TOKEN_KEY'));

    const transport = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: { user: account.smtp_username, pass: password },
    });

    await transport.sendMail({
      from: `"${account.from_name}" <${account.from_email}>`,
      to,
      subject: 'TaskCalendar test email',
      text: 'This is a test message. Your sending account works.',
    });

    await db
      .from('email_accounts')
      .update({ status: 'active', last_error: null, last_verified_at: new Date().toISOString() })
      .eq('id', accountId);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    await db
      .from('email_accounts')
      .update({ status: 'error', last_error: message })
      .eq('id', accountId);
    return res.status(400).json({ ok: false, error: message });
  }
}
