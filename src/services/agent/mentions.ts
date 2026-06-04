export interface MentionMember { userId: string; name: string; }

/** Find @mentions in text and resolve to members. Tries longest member names
 *  first so "@Sam Lee" beats "@Sam". Case-insensitive; de-dupes by userId.
 *
 *  After a longer match consumes a span of the text, overlapping shorter
 *  names don't double-match the same @-token. */
export const extractMentions = (text: string, members: MentionMember[]): MentionMember[] => {
  const byLongest = [...members].sort((a, b) => b.name.length - a.name.length);
  // Work on a mutable copy so we can "erase" already-matched spans.
  let remaining = text.toLowerCase();
  const hit = new Map<string, MentionMember>();
  for (const m of byLongest) {
    const needle = `@${m.name.toLowerCase()}`;
    const idx = remaining.indexOf(needle);
    if (idx !== -1) {
      hit.set(m.userId, m);
      // Replace the matched span with spaces so a shorter prefix can't match it.
      remaining = remaining.slice(0, idx) + ' '.repeat(needle.length) + remaining.slice(idx + needle.length);
    }
  }
  // Preserve members[] order in the result.
  return members.filter((m) => hit.has(m.userId)).map((m) => hit.get(m.userId)!);
};
