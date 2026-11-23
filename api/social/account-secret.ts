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
  const accessToken = String((req.body ?? {}).accessToken ?? '').trim();
  // YouTube, TikTok and X keys run out within hours. Their second, lasting key renews the first by itself.
  const refreshToken = String((req.body ?? {}).refreshToken ?? '').trim();
  if (!accountId || !accessToken) return res.status(400).json({ error: 'accountId and accessToken are required' });
  if (accessToken.length > 4000 || refreshToken.length > 4000) return res.status(400).json({ error: 'That key is too long.' });

  const { data: account } = await db.from('social_accounts').select('organization_id').eq('id', accountId).maybeSingle();
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { data: org } = await db.from('organizations').select('owner_id, members').eq('organization_id', account.organization_id).maybeSingle();
  const members = Array.isArray(org?.members) ? org.members as Array<Record<string, unknown>> : [];
  const admin = org?.owner_id === auth.user.id || members.some((member) =>
    String(member.userId ?? member.user_id ?? '') === auth.user.id && ['owner', 'admin'].includes(String(member.role)),
  );
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  let encrypted: string;
  try { encrypted = await encryptSecret(refreshToken ? JSON.stringify({ accessToken, refreshToken }) : accessToken, env('INTEGRATION_TOKEN_KEY')); }
  catch { return res.status(500).json({ error: 'Server is not configured to store integration secrets' }); }
  const { error } = await db.from('social_account_secrets').upsert({ account_id: accountId, secret_encrypted: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
  if (error) {
    console.error('[social] the account key could not be stored', error.code ?? 'unknown');
    return res.status(500).json({ error: 'The account could not be connected. Please try again.' });
  }
  const { error: statusError } = await db.from('social_accounts').update({ status: 'connected', credential_ref: `social_account_secrets:${accountId}`, last_error: null }).eq('id', accountId);
  if (statusError) {
    console.error('[social] the account could not be marked connected', statusError.code ?? 'unknown');
    return res.status(500).json({ error: 'The account could not be connected. Please try again.' });
  }
  return res.status(200).json({ ok: true });
}
