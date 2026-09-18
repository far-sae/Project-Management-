import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { encryptSecret } from '../_lib/crypto';

// Stores the encrypted SMTP password for a sending account.
// `email_account_secrets` denies all access to `authenticated` (migration
// 152), so the browser cannot write it directly — it posts the plaintext
// password over TLS to this route, which encrypts it here with the
// server-only `INTEGRATION_TOKEN_KEY` and writes the ciphertext with the
// service-role client. The key is never shipped to a browser, so reading the
// deployed JS bundle no longer hands anyone the key to every stored SMTP
// password and OAuth token. The plaintext is never logged.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = String((req.body ?? {}).accountId ?? '');
  const password = String((req.body ?? {}).password ?? '');
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!password) return res.status(400).json({ error: 'password is required' });

  const { data: account } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Only the organization's owner or an admin may set the SMTP password used
  // to send from its sending identity; a plain member must not be able to.
  // is_org_admin_or_owner() is no use here: it reads auth.uid(), which is
  // null under the service-role client, so the membership test is done in
  // the open, the same way verify.ts checks it for test sends.
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

  let secretEncrypted: string;
  try {
    secretEncrypted = await encryptSecret(password, env('INTEGRATION_TOKEN_KEY'));
  } catch {
    // Never echo the exception: a crypto failure message could carry the
    // plaintext or the key. The cause is always a missing or malformed key.
    return res.status(500).json({ error: 'Server is not configured to store secrets' });
  }

  const { error } = await db
    .from('email_account_secrets')
    .upsert({ account_id: accountId, secret_encrypted: secretEncrypted }, { onConflict: 'account_id' });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
