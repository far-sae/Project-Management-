// Pure helpers for phase 4, open tracking. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React, so the
// worker, the browser and the Vercel route share one definition of each.
//
// What these are careful about is not the mechanism — a 1x1 image is not
// complicated — but what the resulting number means. See
// docs/superpowers/specs/2026-09-19-email-open-tracking-design.md.

/**
 * What the pixel's token is an HMAC OF, rather than the bare message id.
 *
 * The same secret signs both this and the unsubscribe link, and for a while
 * they signed the identical string — which made a pixel URL a working
 * unsubscribe token. That matters because of where a pixel URL goes: it is
 * fetched automatically, with no user action, so the full URL lands in the
 * recipient's gateway inspection log, their egress proxy log, Gmail's image
 * proxy and our own access log. The unsubscribe link goes to none of those,
 * because nobody clicks it. Anyone with read access to any of those logs could
 * POST that token to the unsubscribe route and suppress the address
 * organisation-wide, permanently, with no session and no confirmation.
 *
 * Worse for a sequence step, which carried a pixel and no unsubscribe link at
 * all: the token had no other way to reach the wire.
 *
 * Prefixing the signed message separates the two domains. Same secret, no new
 * environment variable, and an open token verifies as an open token only.
 */
const OPEN_TOKEN_SCOPE = 'open:';

/**
 * The message the pixel's token signs, for a caller that holds the signing
 * function. Kept here rather than inlined at the call site so the two ends of
 * this can never drift.
 */
export function openTokenSubject(messageId: string): string {
  return `${OPEN_TOKEN_SCOPE}${messageId}`;
}

/**
 * The tracking pixel's URL for one message.
 *
 * The token is an HMAC over `openTokenSubject(messageId)` under the same
 * secret the unsubscribe link uses, so the URL cannot be forged against
 * another message to inflate somebody's numbers, it needs no session to
 * verify, and it is not interchangeable with an unsubscribe token.
 */
export function openPixelUrl(baseUrl: string, messageId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/email/open?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(token)}`;
}

/**
 * Mail clients that fetch images on the recipient's behalf, whether or not the
 * recipient ever looked at the message.
 *
 * Apple is NOT in this list, and that is the important thing to know about
 * it. Mail Privacy Protection does not identify itself in the user agent: its
 * fetches arrive with an ordinary Safari/WebKit string from Apple's relay
 * ranges, and the industry tells them apart by IP, which this phase
 * deliberately does not read. An earlier revision listed `AppleMailProxy`,
 * which is not a string Apple sends — so the arm of this check aimed at the
 * single largest source of false opens never fired at all.
 *
 * What catches Apple instead is the timing window below. It is the reason that
 * window is minutes rather than seconds.
 */
const PROXY_AGENTS = /(GoogleImageProxy|YahooMailProxy|Barracuda|Proofpoint|Mimecast|MailScanner|Symantec)/i;

/**
 * How soon after sending a fetch is assumed to be a machine.
 *
 * Five minutes, not ten seconds. Ten seconds catches a scanner and misses
 * Apple, whose Mail Privacy Protection queues its pre-fetches and typically
 * runs them within a few minutes of delivery — and Apple is most of the
 * problem, being on by default since 2021 across roughly half the consumer
 * market.
 *
 * A person really can open a message inside five minutes, and one who does is
 * counted as automatic. That is the direction to be wrong in: a misfiled real
 * open is one missing from a number already described as a floor, while a
 * missed pre-fetch is a fabricated open in the number somebody makes decisions
 * on. And nothing is discarded either way — a fetch classified automatic is
 * still recorded and still shown, just not added to the headline.
 */
export const PREFETCH_WINDOW_MS = 5 * 60 * 1000;

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
