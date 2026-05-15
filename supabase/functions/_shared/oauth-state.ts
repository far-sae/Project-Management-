// HMAC-SHA256 signed OAuth state tokens.
// Wire format (base64url): payloadJsonB64 + "." + signatureB64

export interface OAuthStatePayload {
  userId: string;
  orgId: string | null;
  provider: string;
  nonce: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payloadJson));
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<OAuthStatePayload> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('oauth-state: malformed token');
  }
  const [payloadB64, sigB64] = parts;
  const key = await importHmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) {
    throw new Error('oauth-state: invalid signature');
  }
  const json = new TextDecoder().decode(b64urlDecode(payloadB64));
  return JSON.parse(json) as OAuthStatePayload;
}
