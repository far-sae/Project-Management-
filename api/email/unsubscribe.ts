import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { verifyUnsubscribeToken } from '../_lib/unsubscribe';

// Public and token-authenticated. POST is the RFC 8058 one-click path that
// Gmail and Yahoo call directly; GET is the human-visible link.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const messageId = String(req.query.m ?? '');
  const token = String(req.query.t ?? '');
  if (!messageId || !token) return res.status(400).json({ error: 'Invalid link' });

  const ok = await verifyUnsubscribeToken(messageId, token, env('EMAIL_UNSUBSCRIBE_SECRET'));
  if (!ok) return res.status(403).json({ error: 'Invalid link' });

  const db = serviceClient();
  const { data: message } = await db
    .from('email_messages')
    .select('id, organization_id, to_email, campaign_id')
    .eq('id', messageId)
    .single();
  if (!message) return res.status(404).json({ error: 'Not found' });

  await db.from('email_suppressions').upsert(
    {
      organization_id: message.organization_id,
      email: String(message.to_email).trim().toLowerCase(),
      reason: 'unsubscribed',
      campaign_id: message.campaign_id,
    },
    { onConflict: 'organization_id,email' },
  );

  if (req.method === 'POST') return res.status(200).json({ ok: true });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>` +
      `<div style="font:16px system-ui;max-width:32rem;margin:15vh auto;text-align:center">` +
      `<h1 style="font-size:20px">You are unsubscribed</h1>` +
      `<p style="color:#6b7280">We removed ${String(message.to_email).replace(/[<>&]/g, '')} from this list. You will not receive further messages.</p>` +
      `</div>`,
  );
}
