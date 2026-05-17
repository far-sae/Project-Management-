// Pure trigger-match helpers for Slack-driven recipes.
// Both matchers take (recipe config, event payload) and return whether
// the recipe should fire — no I/O, fully testable under vitest.

// ───────────────────────── slack_message_received ─────────────────────────
export interface SlackMatchRecipeConfig {
  channels?: string[];
  keyword?: string;
  mention_only?: boolean;
  // bot_user_id is injected by the worker from integration metadata at
  // match time, NOT stored in the recipe — orgs reinstalling Slack get
  // a new bot user id and we don't want stale recipe configs.
}

export interface SlackMatchEventPayload {
  channel_id?: string;
  text?: string;
}

export interface SlackMatchOptions {
  /**
   * The bot user id for the org receiving the event, injected by the
   * worker. Used only when `mention_only` is true.
   */
  botUserId?: string | null;
}

export const matchesSlackTrigger = (
  cfg: SlackMatchRecipeConfig,
  payload: SlackMatchEventPayload,
  opts: SlackMatchOptions = {},
): boolean => {
  const channels = cfg.channels ?? [];
  if (channels.length === 0) return false;
  const channelId = payload.channel_id ?? "";
  if (!channels.includes(channelId)) return false;

  const text = (payload.text ?? "").toString();

  if (cfg.mention_only) {
    if (!opts.botUserId) return false;
    // Slack mentions look like "<@U012ABCDE>" (optionally "|displayname").
    if (!text.includes(`<@${opts.botUserId}`)) return false;
  }

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

// ───────────────────────── slack_reaction_added ─────────────────────────
export interface SlackReactionRecipeConfig {
  /** Reaction names to match (without colons). e.g. ["white_check_mark", "pushpin"] */
  reactions?: string[];
  /** Optional channel whitelist; empty means "any channel the bot is in". */
  channels?: string[];
}

export interface SlackReactionEventPayload {
  reaction?: string;
  channel_id?: string;
}

export const matchesSlackReaction = (
  cfg: SlackReactionRecipeConfig,
  payload: SlackReactionEventPayload,
): boolean => {
  const reactions = (cfg.reactions ?? []).map((r) =>
    r.replace(/^:|:$/g, "").trim().toLowerCase(),
  ).filter(Boolean);
  if (reactions.length === 0) return false; // never fires without explicit list
  const reaction = (payload.reaction ?? "").trim().toLowerCase();
  if (!reactions.includes(reaction)) return false;

  const channels = cfg.channels ?? [];
  if (channels.length > 0) {
    const channelId = payload.channel_id ?? "";
    if (!channels.includes(channelId)) return false;
  }
  return true;
};
