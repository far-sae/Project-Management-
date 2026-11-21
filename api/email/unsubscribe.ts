import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { escapeHtml } from '../_lib/substitute';
import { verifyContactUnsubscribeToken, verifyUnsubscribeToken } from '../_lib/unsubscribe';

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
  // An email written by the CRM's agents has no message row: its link names the lead instead.
  const contactId = String(req.query.c ?? '');
  const token = String(req.query.t ?? '');
  if ((!messageId && !contactId) || !token) return res.status(400).json({ error: 'Invalid link' });

  const secret = env('EMAIL_UNSUBSCRIBE_SECRET');
  const ok = messageId
    ? await verifyUnsubscribeToken(messageId, token, secret)
    : await verifyContactUnsubscribeToken(contactId, token, secret);
  if (!ok) return res.status(403).json({ error: 'Invalid link' });

  const db = serviceClient();
  let message: { organization_id: string; to_email: string; campaign_id: string | null } | null = null;
  if (messageId) {
    const { data } = await db
      .from('email_messages')
      .select('id, organization_id, to_email, campaign_id')
      .eq('id', messageId)
      .single();
    message = data ?? null;
  } else {
    const { data } = await db.from('crm_contacts').select('organization_id, email').eq('id', contactId).maybeSingle();
    message = data && data.email ? { organization_id: data.organization_id, to_email: String(data.email), campaign_id: null } : null;
  }
  if (!message) return res.status(404).json({ error: 'Not found' });

  const address = escapeHtml(String(message.to_email));

  if (req.method === 'GET') {
    // Same URL, same query parameters, submitted as a POST. `confirm` marks
    // the submission as coming from this form; a mail provider's one-click
    // POST never sends it and is handled exactly as before.
    const action =
      `/api/email/unsubscribe?${messageId ? `m=${encodeURIComponent(messageId)}` : `c=${encodeURIComponent(contactId)}`}` +
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
  if (error) {
    console.error('[email] an unsubscribe could not be saved', error.code ?? 'unknown');
    return res.status(500).json({ error: 'We could not take you off the list just now. Please try the link again.' });
  }

  // ...and it ends any sequence this organization is running at that address.
  //
  // The suppression alone already stops the MAIL: claim_sequence_enrollments()
  // refuses a suppressed address and claim_email_batch() sweeps anything
  // already queued for one. What it does not do is end the enrollment, and the
  // difference shows up in two places that matter. An admin who pauses or
  // archives the sequence that afternoon leaves those people 'active' for
  // ever, because the claim only looks at active sequences and so never
  // reaches the check that would have stopped them. And the enrollment record
  // -- which is what a deletion request or a complaint is answered with --
  // never says they unsubscribed.
  //
  // Reported and not fatal: the suppression is written, so no further mail can
  // go out either way, and failing the request here would tell somebody who
  // has just unsubscribed that it did not work.
  const { error: stopError } = await db.rpc('stop_enrollments_for_address', {
    p_org: message.organization_id,
    p_address: String(message.to_email).trim().toLowerCase(),
    p_reason: 'unsubscribed',
  });
  if (stopError) {
    console.error('unsubscribe: could not stop sequence enrollments', stopError.message);
  }

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
