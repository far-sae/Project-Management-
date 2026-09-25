export async function hashLookupKey(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isCacheFresh(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() <= 30 * 24 * 60 * 60 * 1000;
}
