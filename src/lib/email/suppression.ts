export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function dedupeRecipients<T extends { email: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const key = normalizeEmail(r.email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function filterSuppressed<T extends { email: string }>(
  list: T[],
  suppressed: string[],
): { sendable: T[]; suppressed: T[] } {
  const blocked = new Set(suppressed.map(normalizeEmail));
  const sendable: T[] = [];
  const skipped: T[] = [];
  for (const r of list) {
    (blocked.has(normalizeEmail(r.email)) ? skipped : sendable).push(r);
  }
  return { sendable, suppressed: skipped };
}
