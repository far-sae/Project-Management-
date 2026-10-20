import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { encryptSecret } from '../_lib/crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return res.status(401).json({ error: 'Unauthorized' });
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth.user) return res.status(401).json({ error: 'Unauthorized' });
  const accountId = String((req.body ?? {}).accountId ?? '');
  const accessToken = String((req.body ?? {}).accessToken ?? '');
  if (!accountId || !accessToken) return res.status(400).json({ error: 'accountId and accessToken are required' });

  const { data: account } = await db.from('social_accounts').select('organization_id').eq('id', accountId).maybeSingle();
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { data: org } = await db.from('organizations').select('owner_id, members').eq('organization_id', account.organization_id).maybeSingle();
  const members = Array.isArray(org?.members) ? org.members as Array<Record<string, unknown>> : [];
  const admin = org?.owner_id === auth.user.id || members.some((member) =>
    String(member.userId ?? member.user_id ?? '') === auth.user.id && ['owner', 'admin'].includes(String(member.role)),
  );
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  let encrypted: string;
  try { encrypted = await encryptSecret(accessToken, env('INTEGRATION_TOKEN_KEY')); }
  catch { return res.status(500).json({ error: 'Server is not configured to store integration secrets' }); }
  const { error } = await db.from('social_account_secrets').upsert({ account_id: accountId, secret_encrypted: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
  if (error) return res.status(500).json({ error: error.message });
  const { error: statusError } = await db.from('social_accounts').update({ status: 'connected', credential_ref: `social_account_secrets:${accountId}`, last_error: null }).eq('id', accountId);
  if (statusError) return res.status(500).json({ error: statusError.message });
  return res.status(200).json({ ok: true });
}
