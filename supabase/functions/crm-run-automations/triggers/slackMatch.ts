// Pure trigger-match helper for slack_message_received recipes.
// Decides whether a given recipe should fire on a given Slack event,
// based on the recipe's channel whitelist + optional keyword filter.

export interface SlackMatchRecipeConfig {
  channels?: string[];
  keyword?: string;
}

export interface SlackMatchEventPayload {
  channel_id?: string;
  text?: string;
}

export const matchesSlackTrigger = (
  cfg: SlackMatchRecipeConfig,
  payload: SlackMatchEventPayload,
): boolean => {
  const channels = cfg.channels ?? [];
  if (channels.length === 0) return false;          // recipe never fires
  const channelId = payload.channel_id ?? "";
  if (!channels.includes(channelId)) return false;
  const text = (payload.text ?? "").toString();
  const keyword = (cfg.keyword ?? "").trim();
  if (!keyword) return true;
  const regexMatch = keyword.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
};
