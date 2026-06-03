// supabase/functions/_shared/agent/commands.ts
// Plain-text equivalents of the old slash commands, matched cheaply (no LLM)
// before the natural-language pipeline. Keeps the bot usable with no "/".

export type UtilityCommand =
  | { kind: "help" }
  | { kind: "orgs" }
  | { kind: "cancel" }
  | { kind: "unlink" }
  | { kind: "switchorg"; name: string }
  | { kind: "none" };

/** True when the text is exactly a 6-digit link code (used to link a chat
 *  without "/start"). Whitespace is trimmed. */
export const isLinkCode = (text: string): boolean => /^\d{6}$/.test(text.trim());

/** Map a plain-text message to a utility command, or { kind: "none" } so the
 *  caller falls through to the natural-language parser. Org name keeps its
 *  original casing. */
export const matchUtilityCommand = (raw: string): UtilityCommand => {
  const t = raw.trim();
  const low = t.toLowerCase();
  if (/^(help|what can you do\??|commands)$/.test(low)) return { kind: "help" };
  if (/^(my )?orgs$/.test(low) || low === "list orgs") return { kind: "orgs" };
  if (/^(cancel|never ?mind|stop)$/.test(low)) return { kind: "cancel" };
  if (/^(unlink|disconnect)$/.test(low)) return { kind: "unlink" };
  const m = t.match(/^(?:switch|use)(?: to)?\s+(.+)$/i);
  if (m) return { kind: "switchorg", name: m[1].trim() };
  return { kind: "none" };
};
