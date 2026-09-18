// One-click unsubscribe (RFC 8058). The token is an HMAC-SHA256 of the
// message id, so the link needs no session and cannot be forged or replayed
// against another recipient.

function b64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(messageId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(messageId));
  return b64url(new Uint8Array(sig));
}

export async function signUnsubscribeToken(
  messageId: string,
  secret: string,
): Promise<string> {
  return hmac(messageId, secret);
}

export async function verifyUnsubscribeToken(
  messageId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmac(messageId, secret);
  if (expected.length !== token.length) return false;
  // Constant-time compare so a timing signal cannot leak the token.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function unsubscribeUrl(baseUrl: string, messageId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/email/unsubscribe?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(token)}`;
}

export function ensureUnsubscribeLink(html: string, url: string): string {
  if (html.includes(url)) return html;
  return (
    html +
    `\n<p style="margin-top:24px;font-size:12px;color:#6b7280">` +
    `<a href="${url}" style="color:#6b7280">Unsubscribe</a></p>`
  );
}
