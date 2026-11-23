import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from '../_lib/crypto';
import { env, serviceClient } from '../_lib/context';
import type { SocialAccountRow } from '../_social/publishers';
import { runWorker, type ContentRow, type RunResult, type WorkerDeps, type WorkerStore } from '../_social/worker';

/**
 * Sends the social posts that are due (see _social/worker.ts).
 *
 * Two callers:
 *  - Vercel's cron, every five minutes, with the worker secret;
 *  - a signed-in person, right after pressing "Post" in the composer, so the
 *    post goes out now instead of at the next five-minute run. They can only
 *    start the run: which posts are due, and whose they are, is decided by the
 *    database, exactly as for the cron.
 */
export const config = { maxDuration: 300 };

/** How many posts one run takes. A video upload can take a minute or more. */
export const CRON_LIMIT = 10;
export const PERSON_LIMIT = 8;

export type PublishHandlerDeps = {
  /** True when the request carries the worker secret. */
  isWorker: (req: VercelRequest) => boolean;
  /** True when the request carries a signed-in person's token. */
  isSignedIn: (req: VercelRequest) => Promise<boolean>;
  run: (limit: number) => Promise<RunResult>;
};

const bearerOf = (req: VercelRequest): string => String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

export function publishHandler(d: PublishHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (!['GET', 'POST'].includes(req.method ?? '')) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const worker = d.isWorker(req);
    if (!worker && !(req.method === 'POST' && (await d.isSignedIn(req)))) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const result = await d.run(worker ? CRON_LIMIT : PERSON_LIMIT);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(result);
    } catch (e) {
      console.error('[social] the run failed', e instanceof Error ? e.name : 'unknown');
      res.status(500).json({ error: 'The posts could not be sent. Please try again.' });
    }
  };
}

/** The worker's database, on the service key. */
export function supabaseStore(db: SupabaseClient, key: () => string): WorkerStore {
  return {
    async claim(limit) {
      const { data, error } = await db.rpc('claim_social_posts', { p_limit: limit });
      if (error) throw new Error('claim failed');
      return (data ?? []) as ContentRow[];
    },
    async account(id) {
      const { data } = await db.from('social_accounts').select('id, provider, external_account_id').eq('id', id).maybeSingle();
      return (data as SocialAccountRow | null) ?? null;
    },
    async secret(accountId) {
      const { data } = await db.from('social_account_secrets').select('secret_encrypted').eq('account_id', accountId).maybeSingle();
      if (!data?.secret_encrypted) return null;
      return decryptSecret(String(data.secret_encrypted), key());
    },
    async saveSecret(accountId, plain) {
      const encrypted = await encryptSecret(plain, key());
      await db.from('social_account_secrets').upsert({ account_id: accountId, secret_encrypted: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
    },
    async markPublished(row, externalId) {
      await db.from('social_content').update({ status: 'published', published_at: new Date().toISOString(), external_post_id: externalId, last_error: null }).eq('id', row.id);
      await db.from('social_content_metrics').upsert({ content_id: row.id, organization_id: row.organization_id, workspace_id: row.workspace_id }, { onConflict: 'content_id' });
    },
    async markFailed(id, message) {
      await db.from('social_content').update({ status: 'failed', last_error: message }).eq('id', id);
    },
    async release(id) {
      await db.from('social_content').update({ status: 'scheduled' }).eq('id', id).eq('status', 'publishing');
    },
    async markAccount(accountId, problem) {
      await db.from('social_accounts').update(problem ? { status: 'error', last_error: problem } : { status: 'connected', last_error: null }).eq('id', accountId);
    },
  };
}

const realDeps = (): WorkerDeps => ({
  fetch,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env: process.env,
  now: () => Date.now(),
});

export default publishHandler({
  isWorker: (req) => {
    const expected = process.env.SOCIAL_WORKER_SECRET ?? process.env.CRON_SECRET;
    return Boolean(expected) && bearerOf(req) === expected;
  },
  isSignedIn: async (req) => {
    const bearer = bearerOf(req);
    if (!bearer) return false;
    const { data, error } = await serviceClient().auth.getUser(bearer);
    return !error && Boolean(data.user);
  },
  run: (limit) => runWorker(supabaseStore(serviceClient(), () => env('INTEGRATION_TOKEN_KEY')), realDeps(), limit),
});
