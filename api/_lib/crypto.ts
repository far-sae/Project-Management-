// AES-256-GCM, wire format base64url(iv(12) || ciphertext || tag(16)).
// Byte-compatible with supabase/functions/_shared/crypto.ts on purpose: the
// edge functions and the Vercel worker read each other's ciphertext. A test
// in tests/unit/emailHelpers.test.ts pins that compatibility.
// Uses only Web Crypto, so it runs in the browser, in Node 18+, and in Deno.

const IV_LEN = 12;

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.byteLength !== 32) {
    throw new Error(`email/crypto: key must be 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return b64encode(out);
}

export async function decryptSecret(packed: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = b64decode(packed);
  if (bytes.byteLength <= IV_LEN) throw new Error('email/crypto: ciphertext too short');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_LEN) },
    key,
    bytes.slice(IV_LEN),
  );
  return new TextDecoder().decode(plaintext);
}
