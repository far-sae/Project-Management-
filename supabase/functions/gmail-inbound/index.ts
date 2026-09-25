const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractRunIdFromTo(to: string): string | null {
  const match = to.match(/reply\+([^@\s>]+)@/i);
  if (!match || !UUID.test(match[1])) return null;
  return match[1].toLowerCase();
}
