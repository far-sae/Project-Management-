import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { verifyUnsubscribeToken } from '../_lib/unsubscribe';
import { isPrefetch, openTokenSubject, TRANSPARENT_GIF_BASE64 } from '../_lib/openTracking';

const GIF = Buffer.from(TRANSPARENT_GIF_BASE64, 'base64');

/**
 * Sends the pixel, and nothing else, ever.
 *
 * Every path through this handler ends here with 200 and the same 42 bytes: a
 * forged token, an unknown message, a database that is down, an exception
 * nobody predicted. That is deliberate and it is the most important rule in
 * this file. This URL sits inside a message in somebody's customer's mailbox,
 * and a response that is not an image is a broken-image icon in that message —
 * a visible defect in the customer's own mail, caused by our bookkeeping,
 * shown to the person they are trying to impress.
 *
 * `no-store` because a cached pixel is an open that is never reported again;
 * Gmail's proxy caches aggressively and this is the only lever we have.
 */
function pixel(res: VercelResponse): void {
  // Once, ever. Every exit in the handler goes through here, and on a socket
  // the client aborted, the first send throws, the catch swallows it, and the
  // fallthrough would call this again -- setHeader after a failed send raises
  // ERR_HTTP_HEADERS_SENT with nothing left to catch it, so an aborted fetch
  // is logged as a 500. Nobody sees it (the connection is already gone), but
  // "every path returns the image" should be structurally true rather than
  // true by inspection.
  if (res.headersSent || res.writableEnded) return;
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(GIF.length));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  // It is an image, not a document, and nothing should index or embed it.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).send(GIF);
}

/**
 * The open-tracking pixel.
 *
 * Public and token-authenticated, like the unsubscribe route and under the
 * same secret: the token is an HMAC of the message id, so the URL cannot be
 * forged against another message to inflate somebody's numbers.
 *
 * Unlike the unsubscribe route, a GET here DOES write — and that is safe for
 * the opposite reason. An unsubscribe is destructive and irreversible, so a
 * corporate link scanner fetching every URL in inbound mail must not trigger
 * one. An open is a count, and a scanner fetching it is exactly the event this
 * route exists to record and classify: `isPrefetch` is what tells it apart
 * from a person, and the screen shows the two separately.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // HEAD is what some proxies send first. It gets the headers and no body,
  // which Vercel handles from the same response, and it is not an open.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return pixel(res);
  }

  try {
    const messageId = String(req.query.m ?? '');
    const token = String(req.query.t ?? '');
    if (!messageId || !token) return pixel(res);

    // Over the SCOPED subject, not the bare message id. The two used to be the
    // same string, which made a pixel URL -- fetched automatically, and so
    // logged by every gateway and proxy it passes -- a working unsubscribe
    // token for that recipient. Same secret, same HMAC, different domain.
    const ok = await verifyUnsubscribeToken(
      openTokenSubject(messageId),
      token,
      env('EMAIL_UNSUBSCRIBE_SECRET'),
    );
    if (!ok) return pixel(res);

    // A HEAD request is a client asking about the image, not rendering it.
    if (req.method === 'HEAD') return pixel(res);

    const db = serviceClient();

    // sent_at is read for one purpose: a fetch within ten seconds of the send
    // is a machine. Nothing else about the message is read, and nothing about
    // the REQUEST is read beyond the user agent, which is used for the same
    // decision and then discarded. No IP address is touched at any point.
    const { data: message } = await db
      .from('email_messages')
      .select('id, sent_at')
      .eq('id', messageId)
      .maybeSingle();
    if (!message) return pixel(res);

    const sentAt = message.sent_at ? new Date(String(message.sent_at)) : null;
    const prefetch = isPrefetch(
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
      new Date(),
    );

    // The organization's switch is checked inside record_email_open(), not
    // here: a message sent while tracking was on is in somebody's mailbox for
    // ever, and switching tracking off has to stop recording those too.
    const { error } = await db.rpc('record_email_open', {
      p_message: messageId,
      p_prefetch: prefetch,
    });
    if (error) {
      // Logged on our side, invisible on theirs.
      console.error('open: could not record', error.message);
    }
  } catch (err) {
    console.error('open: unexpected failure', (err as Error)?.message ?? err);
  }

  return pixel(res);
}
