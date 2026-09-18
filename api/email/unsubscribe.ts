import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { escapeHtml } from '../_lib/substitute';
import { verifyUnsubscribeToken } from '../_lib/unsubscribe';

function page(title: string, body: string): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="robots" content="noindex">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<div style="font:16px system-ui;max-width:32rem;margin:15vh auto;text-align:center">` +
    body +
    `</div>`
  );
}

// Public and token-authenticated. POST is the RFC 8058 one-click path that
// Gmail and Yahoo call directly; GET is the human-visible link, and it only
// ever renders a confirmation. It must not write: corporate link scanners
// fetch every URL in inbound mail, and a GET that wrote the suppression
// unsubscribed those recipients the moment the message was delivered.
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

  const address = escapeHtml(String(message.to_email));

  if (req.method === 'GET') {
    // Same URL, same query parameters, submitted as a POST. `confirm` marks
    // the submission as coming from this form; a mail provider's one-click
    // POST never sends it and is handled exactly as before.
    const action =
      `/api/email/unsubscribe?m=${encodeURIComponent(messageId)}` +
      `&t=${encodeURIComponent(token)}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(
      page(
        'Unsubscribe',
        `<h1 style="font-size:20px">Unsubscribe ${address}?</h1>` +
          `<p style="color:#6b7280">You will stop receiving messages from this sender. ` +
          `Nothing changes until you confirm.</p>` +
          `<form method="post" action="${escapeHtml(action)}">` +
          `<input type="hidden" name="confirm" value="1">` +
          `<button type="submit" style="font:inherit;padding:10px 20px;border:0;border-radius:6px;` +
          `background:#111827;color:#fff;cursor:pointer">Confirm unsubscribe</button>` +
          `</form>`,
      ),
    );
  }

  const { error } = await db.from('email_suppressions').upsert(
    {
      organization_id: message.organization_id,
      email: String(message.to_email).trim().toLowerCase(),
      reason: 'unsubscribed',
      campaign_id: message.campaign_id,
    },
    { onConflict: 'organization_id,email' },
  );
  if (error) return res.status(500).json({ error: error.message });

  // Only this route's own confirmation form sends `confirm`, so a human who
  // clicked the button gets a page instead of raw JSON while the one-click
  // POST from Gmail or Yahoo still gets exactly the response it did before.
  if (String((req.body ?? {}).confirm ?? '') === '1') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(
      page(
        'Unsubscribed',
        `<h1 style="font-size:20px">You are unsubscribed</h1>` +
          `<p style="color:#6b7280">We removed ${address} from this list. ` +
          `You will not receive further messages.</p>`,
      ),
    );
  }

  return res.status(200).json({ ok: true });
}
