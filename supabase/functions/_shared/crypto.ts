// AES-256-GCM encrypt/decrypt using Web Crypto.
// Pure web-standard so this can be unit-tested in Node via Vitest
// AND imported by Deno Edge Functions at runtime.
//
// Wire format (base64url):  iv(12) || ciphertext || tag(16)

const IV_LEN = 12;

function b64encode(bytes: Uint8Array): string {
  // base64url (url-safe, no padding)
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
    throw new Error(`crypto: key must be 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function generateKey(): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return b64encode(raw);
}

export async function encrypt(plaintext: string, keyB64: string): Promise<string> {
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

export async function decrypt(packedB64: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const packed = b64decode(packedB64);
  if (packed.byteLength <= IV_LEN) {
    throw new Error('crypto: ciphertext too short');
  }
  const iv = packed.slice(0, IV_LEN);
  const ciphertext = packed.slice(IV_LEN);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
