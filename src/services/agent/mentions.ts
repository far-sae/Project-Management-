export type MentionMember = { userId: string; name: string };

export const extractMentions = (text: string, members: MentionMember[]): MentionMember[] => {
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const matches: Array<{ start: number; end: number; member: MentionMember }> = [];

  for (const member of sorted) {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\w@])@${escaped}(?![\\w-])`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const start = match.index + match[1].length;
      const end = start + member.name.length + 1;
      const overlapsLongerMention = matches.some((item) => start < item.end && end > item.start);
      if (!overlapsLongerMention) matches.push({ start, end, member });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  const found = new Map<string, MentionMember>();
  for (const match of matches) found.set(match.member.userId, match.member);
  return [...found.values()];
};
