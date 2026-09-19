// Pure helpers for phase 4, open tracking. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React, so the
// worker, the browser and the Vercel route share one definition of each.
//
// What these are careful about is not the mechanism — a 1x1 image is not
// complicated — but what the resulting number means. See
// docs/superpowers/specs/2026-09-19-email-open-tracking-design.md.

/**
 * The tracking pixel's URL for one message.
 *
 * Same shape and same secret as the unsubscribe link: the token is an HMAC of
 * the message id, so a URL cannot be forged against another message to inflate
 * somebody's numbers, and it needs no session to verify.
 */
export function openPixelUrl(baseUrl: string, messageId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/email/open?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(token)}`;
}

/**
 * Mail clients that fetch images on the recipient's behalf, whether or not the
 * recipient ever looked at the message.
 *
 * Apple's is the one that matters: Mail Privacy Protection has been on by
 * default since 2021 across roughly half the consumer market, and it
 * pre-fetches every image in every message on delivery. Without this check a
 * campaign to a list of iPhone users reads as near-universally opened.
 */
const PROXY_AGENTS = /(GoogleImageProxy|AppleMailProxy|YahooMailProxy|Barracuda|Proofpoint|Mimecast)/i;

/**
 * How soon after sending a fetch is assumed to be a machine.
 *
 * Nobody opens a message ten seconds after it was sent. Security scanners and
 * proxies do, routinely, because they fetch every URL in a message as it
 * arrives.
 */
export const PREFETCH_WINDOW_MS = 10_000;

/**
 * True when this fetch looks like a machine rather than a person.
 *
 * It is a heuristic, it is wrong sometimes in both directions, and the screen
 * says so rather than presenting the result as fact. What it is for is
 * narrower than "detect bots": it stops one specific, enormous and entirely
 * predictable source of false opens from making every campaign look like a
 * triumph.
 *
 * `sentAt` null means the message has no send time recorded, which no sent
 * message should — treated as "cannot tell from timing", so only the user
 * agent decides.
 */
export function isPrefetch(
  userAgent: string | null | undefined,
  sentAt: Date | null,
  now: Date,
): boolean {
  if (userAgent && PROXY_AGENTS.test(userAgent)) return true;
  if (!sentAt) return false;

  const gap = now.getTime() - sentAt.getTime();
  // A negative gap is a clock disagreeing with itself, not a fast reader.
  return gap >= 0 && gap < PREFETCH_WINDOW_MS;
}

/**
 * Puts the pixel in the message body.
 *
 * Immediately before `</body>` where there is one, because a trailing element
 * after the closing tag is invalid HTML that some clients drop — which would
 * silently record nothing. Appended at the end otherwise, which is what the
 * message-building path produces for a plain HTML fragment.
 *
 * `width="1" height="1"` with an empty alt and `display:block`, so no client
 * shows a broken-image placeholder or an alt caption if the fetch fails.
 * `aria-hidden` so a screen reader does not announce it.
 *
 * Never injected twice: a message rebuilt after a transient failure must not
 * carry two pixels, which would count every open as two.
 */
export function injectTrackingPixel(html: string, url: string): string {
  if (html.includes(url)) return html;

  const pixel =
    `<img src="${url}" width="1" height="1" alt="" aria-hidden="true" ` +
    `style="display:block;width:1px;height:1px;border:0;outline:none" />`;

  const closing = html.lastIndexOf('</body>');
  if (closing === -1) return `${html}\n${pixel}`;
  return `${html.slice(0, closing)}${pixel}${html.slice(closing)}`;
}

/**
 * The 42 bytes of a 1x1 fully transparent GIF, base64.
 *
 * Inlined rather than read from a file because the route that serves it runs
 * on Vercel's filesystem-less runtime, and because the one thing that endpoint
 * must never do is fail to return an image.
 */
export const TRANSPARENT_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
