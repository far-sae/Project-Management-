const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!body || !timestamp || !signature || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  return `v0=${toHex(signed)}` === signature;
}
