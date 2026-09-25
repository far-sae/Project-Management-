const normalizeReaction = (value: string) => value.replace(/^:+|:+$/g, '').toLowerCase();

const keywordMatches = (keyword: string | undefined, text: string) => {
  if (!keyword) return true;
  const regex = keyword.match(/^\/(.+)\/([a-z]*)$/i);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2]).test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
};

export function matchesSlackTrigger(config: any, payload: any, options: { botUserId?: string } = {}): boolean {
  if (!Array.isArray(config.channels) || config.channels.length === 0) return false;
  if (!config.channels.includes(payload.channel_id)) return false;
  const text = payload.text ?? '';
  if (config.mention_only) {
    if (!options.botUserId || !text.includes(`<@${options.botUserId}>`)) return false;
  }
  return keywordMatches(config.keyword, text);
}

export function matchesSlackReaction(config: any, payload: any): boolean {
  if (!Array.isArray(config.reactions) || config.reactions.length === 0) return false;
  if (Array.isArray(config.channels) && config.channels.length > 0 && !config.channels.includes(payload.channel_id)) {
    return false;
  }
  const allowed = config.reactions.map(normalizeReaction);
  return allowed.includes(normalizeReaction(payload.reaction ?? ''));
}
