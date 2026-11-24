import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { env, serviceClient } from '../_lib/context';
import { encryptSecret } from '../_lib/crypto';
import { connectHandler, type ConnectStore } from '../_social/connect';
import { SERVICE_REF } from '../_social/service';
import { writeSecret } from '../_social/tokens';

/** True when the person is the owner or an admin of the organisation. */
async function isOrgAdmin(db: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  const { data: org } = await db.from('organizations').select('owner_id, members').eq('organization_id', organizationId).maybeSingle();
  if (!org) return false;
  const members = Array.isArray(org.members) ? org.members as Array<Record<string, unknown>> : [];
  return org.owner_id === userId || members.some((member) =>
    String(member.userId ?? member.user_id ?? '') === userId && ['owner', 'admin'].includes(String(member.role)),
  );
}

/** Where "Connect" keeps what it found: the same two tables a key pasted by hand goes to. */
export function connectStore(db: SupabaseClient, key: () => string): ConnectStore {
  return {
    isAdmin: (organizationId, userId) => isOrgAdmin(db, organizationId, userId),
    async workspaceOrg(workspaceId) {
      const { data } = await db.from('workspaces').select('organization_id').eq('workspace_id', workspaceId).maybeSingle();
      return data?.organization_id ? String(data.organization_id) : null;
    },
    async saveAccount(account) {
      // The same account connected again takes the place of the old row: its posts keep pointing at it.
      const { data, error } = await db.from('social_accounts').upsert({
        organization_id: account.organizationId, workspace_id: account.workspaceId, provider: account.provider,
        external_account_id: account.externalId, display_name: account.name.slice(0, 200), status: 'connected',
        last_error: null, connected_by: account.userId, updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,provider,external_account_id' }).select('id').single();
      if (error || !data) throw new Error('account not stored');
      const id = String(data.id);
      const encrypted = await encryptSecret(writeSecret(account.secret), key());
      const stored = await db.from('social_account_secrets').upsert({ account_id: id, secret_encrypted: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
      if (stored.error) throw new Error('key not stored');
      await db.from('social_accounts').update({ credential_ref: `social_account_secrets:${id}` }).eq('id', id);
    },
    async serviceIdsOf(workspaceId) {
      const { data } = await db.from('social_accounts').select('credential_ref').eq('workspace_id', workspaceId).like('credential_ref', `${SERVICE_REF}%`);
      return ((data ?? []) as Array<{ credential_ref: string | null }>).map((row) => String(row.credential_ref ?? '').slice(SERVICE_REF.length)).filter(Boolean);
    },
    async account(workspaceId, accountId) {
      // An id that is not an id finds nothing, instead of an error from the database.
      if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
      const { data } = await db.from('social_accounts').select('id, display_name, credential_ref').eq('workspace_id', workspaceId).eq('id', accountId).maybeSingle();
      if (!data) return null;
      const ref = String(data.credential_ref ?? '');
      return { id: String(data.id), name: String(data.display_name ?? ''), serviceId: ref.startsWith(SERVICE_REF) ? ref.slice(SERVICE_REF.length) || null : null };
    },
    async removeAccount(accountId) {
      // Its keys go with it (the database removes them); its posts stay and lose their account.
      const { error } = await db.from('social_accounts').delete().eq('id', accountId);
      if (error) throw new Error('account not removed');
    },
    async saveServiceAccount(account) {
      // The posting service keeps this account's keys. Our row carries only the service's id of it.
      const { error } = await db.from('social_accounts').upsert({
        organization_id: account.organizationId, workspace_id: account.workspaceId, provider: account.provider,
        external_account_id: account.serviceId, display_name: account.name.slice(0, 200), status: 'connected',
        last_error: null, connected_by: account.userId, credential_ref: `${SERVICE_REF}${account.serviceId}`,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,provider,external_account_id' });
      if (error) throw new Error('account not stored');
    },
  };
}

/** /api/social/connect/<route> arrives here as ?connect=<route> (see vercel.json). */
const connect = (req: VercelRequest, res: VercelResponse, route: string) => {
  const db = serviceClient();
  return connectHandler({
    fetch, env: process.env, now: () => Date.now(),
    nonce: () => randomBytes(18).toString('base64url'),
    store: connectStore(db, () => env('INTEGRATION_TOKEN_KEY')),
    userOf: async (request) => {
      const bearer = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!bearer) return null;
      const { data, error } = await db.auth.getUser(bearer);
      return error || !data.user ? null : data.user.id;
    },
  })(req, res, route);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String((Array.isArray(req.query.connect) ? req.query.connect[0] : req.query.connect) ?? '');
  if (route) {
    try {
      return await connect(req, res, route);
    } catch (e) {
      // A browser arriving back from a platform must land on a page, never on an error screen.
      console.error('[social] connect failed', e instanceof Error ? e.name : 'unknown');
      if (route === 'callback') return res.redirect(302, '/social?connect=failed');
      return res.status(500).json({ error: 'The account could not be connected. Please try again.' });
    }
  }
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
  if (!(await isOrgAdmin(db, String(account.organization_id), auth.user.id))) return res.status(403).json({ error: 'Forbidden' });

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
