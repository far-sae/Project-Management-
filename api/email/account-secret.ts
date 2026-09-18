import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serviceClient } from '../_lib/context';

// Stores the encrypted SMTP password for a sending account.
// `email_account_secrets` denies all access to `authenticated` (migration
// 152), so the browser cannot write it directly — it encrypts the password
// client-side and posts the ciphertext here, and this route writes it with
// the service-role client. The plaintext password never reaches this route.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = String((req.body ?? {}).accountId ?? '');
  const secretEncrypted = String((req.body ?? {}).secretEncrypted ?? '');
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!secretEncrypted) return res.status(400).json({ error: 'secretEncrypted is required' });

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

  const { error } = await db
    .from('email_account_secrets')
    .upsert({ account_id: accountId, secret_encrypted: secretEncrypted }, { onConflict: 'account_id' });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
