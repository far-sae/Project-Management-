import type { VercelRequest, VercelResponse } from '@vercel/node';
import { decryptSecret } from '../_lib/crypto';
import { env, serviceClient } from '../_lib/context';

type Account = { id: string; provider: string; external_account_id: string | null };
type Content = { id: string; organization_id: string; workspace_id: string; account_id: string | null; title: string; body: string; media_urls: string[] | null };

const readJson = async (response: Response): Promise<Record<string, any>> => {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(value?.error?.message ?? value?.detail ?? `Provider returned ${response.status}`));
  return value as Record<string, any>;
};

const publish = async (account: Account, content: Content, token: string): Promise<string> => {
  const text = content.body.trim() || content.title;
  if (account.provider === 'linkedin') {
    if (!account.external_account_id) throw new Error('LinkedIn author URN is missing');
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': process.env.LINKEDIN_API_VERSION ?? '202607' },
      body: JSON.stringify({ author: account.external_account_id, commentary: text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
    });
    await readJson(response);
    return response.headers.get('x-restli-id') ?? `linkedin:${Date.now()}`;
  }
  if (account.provider === 'x') {
    const result = await readJson(await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }));
    return String(result.data?.id ?? `x:${Date.now()}`);
  }
  if (account.provider === 'facebook') {
    if (!account.external_account_id) throw new Error('Facebook Page ID is missing');
    const version = process.env.META_GRAPH_VERSION ?? 'v24.0';
    const result = await readJson(await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(account.external_account_id)}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, access_token: token }) }));
    return String(result.id ?? `facebook:${Date.now()}`);
  }
  if (account.provider === 'instagram') {
    if (!account.external_account_id) throw new Error('Instagram Business Account ID is missing');
    const imageUrl = content.media_urls?.[0];
    if (!imageUrl) throw new Error('Instagram publishing requires a public image URL');
    const version = process.env.META_GRAPH_VERSION ?? 'v24.0';
    const container = await readJson(await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(account.external_account_id)}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: imageUrl, caption: text, access_token: token }) }));
    const result = await readJson(await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(account.external_account_id)}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: token }) }));
    return String(result.id ?? `instagram:${Date.now()}`);
  }
  throw new Error(`Publishing for ${account.provider} is not configured`);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' });
  const provided = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const expected = process.env.SOCIAL_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!expected || provided !== expected) return res.status(401).json({ error: 'Unauthorized' });
  const db = serviceClient();
  const { data: claimed, error: claimError } = await db.rpc('claim_social_posts', { p_limit: 25 });
  if (claimError) return res.status(500).json({ error: claimError.message });
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const content of (claimed ?? []) as Content[]) {
    try {
      if (!content.account_id) throw new Error('No social account selected');
      const [{ data: account }, { data: secret }] = await Promise.all([
        db.from('social_accounts').select('id, provider, external_account_id').eq('id', content.account_id).single(),
        db.from('social_account_secrets').select('secret_encrypted').eq('account_id', content.account_id).single(),
      ]);
      if (!account || !secret) throw new Error('Connected account credentials are missing');
      const token = await decryptSecret(String(secret.secret_encrypted), env('INTEGRATION_TOKEN_KEY'));
      const externalId = await publish(account as Account, content, token);
      await db.from('social_content').update({ status: 'published', published_at: new Date().toISOString(), external_post_id: externalId, last_error: null }).eq('id', content.id);
      await db.from('social_content_metrics').upsert({ content_id: content.id, organization_id: content.organization_id, workspace_id: content.workspace_id }, { onConflict: 'content_id' });
      results.push({ id: content.id, status: 'published' });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Publishing failed';
      await db.from('social_content').update({ status: 'failed', last_error: message }).eq('id', content.id);
      results.push({ id: content.id, status: 'failed', error: message });
    }
  }
  return res.status(200).json({ claimed: results.length, results });
}
