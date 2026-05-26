import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ReplyChannel = "email" | "sms" | "whatsapp" | "note";

export interface SuggestRepliesInput {
  channel: ReplyChannel;
  client: {
    name: string;
    industry?: string | null;
    country?: string | null;
    rating?: string | null;
    scoreBand?: string | null;
  };
  /** Most recent timeline activity to ground the suggestion. */
  recentActivity?: Array<{ kind: string; subject?: string | null; body?: string | null }>;
  /** What the user has already typed in the composer; helps the model
   *  continue the same tone instead of restarting. */
  draft?: string;
  /** Optional intent hint ("introduce yourself", "follow up on quote"). */
  intent?: string;
  /** Sender display name so signatures aren't generic. */
  senderName?: string | null;
}

const channelStyle: Record<ReplyChannel, string> = {
  email:
    "professional but warm. 80-200 words. Plain text only. End with a short signature line if a sender name is provided.",
  sms:
    "very short — under 320 characters total. Conversational, no greeting like 'Dear ___'. No signature.",
  whatsapp:
    "casual and friendly. 1-3 short paragraphs. No formal greeting; treat it like texting a contact you know.",
  note:
    "third-person, neutral. 1-2 sentences. Like an internal log entry, not addressed to anyone.",
};

const buildPrompt = (input: SuggestRepliesInput): string => {
  const lines: string[] = [];
  lines.push(
    `You are a CRM rep drafting an outbound ${input.channel} message to a client.`,
  );
  lines.push(`Style: ${channelStyle[input.channel]}`);
  lines.push("");
  lines.push("Client:");
  lines.push(`- Name: ${input.client.name}`);
  if (input.client.industry) lines.push(`- Industry: ${input.client.industry}`);
  if (input.client.country) lines.push(`- Country: ${input.client.country}`);
  if (input.client.scoreBand) lines.push(`- Lead band: ${input.client.scoreBand}`);
  if (input.senderName) lines.push(`Sender: ${input.senderName}`);

  if (input.recentActivity && input.recentActivity.length > 0) {
    lines.push("");
    lines.push("Recent activity on this account (most recent first):");
    for (const a of input.recentActivity.slice(0, 5)) {
      const subject = a.subject ? `${a.subject}: ` : "";
      const body = (a.body ?? "").slice(0, 200);
      lines.push(`- (${a.kind}) ${subject}${body}`);
    }
  }

  if (input.draft && input.draft.trim()) {
    lines.push("");
    lines.push("The rep has already started writing. Continue or rewrite their thought, don't ignore it:");
    lines.push(input.draft.trim());
  }

  if (input.intent && input.intent.trim()) {
    lines.push("");
    lines.push(`Intent: ${input.intent.trim()}`);
  }

  lines.push("");
  lines.push(
    "Produce 3 distinct draft replies. Number them 1., 2., 3.. Do not include any preamble, explanation, or trailing commentary — only the three drafts.",
  );

  return lines.join("\n");
};

const parseNumbered = (text: string): string[] => {
  // Match `1.`, `1)`, `(1)`, or `1:` at line starts.
  const parts = text
    .split(/\n\s*(?:\(?\d+\)?[.):]\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  // The first element may be the preamble that came before "1." — drop it if
  // it doesn't look like a draft (no whitespace beyond a few words).
  if (parts.length > 3) parts.shift();
  return parts.slice(0, 3);
};

export const suggestReplies = async (
  input: SuggestRepliesInput,
): Promise<string[]> => {
  const prompt = buildPrompt(input);
  const { data, error } = await supabase.functions.invoke("ai-chat", {
    body: { prompt, model: "gpt-4o-mini", temperature: 0.7, max_tokens: 700 },
  });
  if (error) {
    logger.error("ai-chat invoke failed:", error);
    throw new Error(error instanceof Error ? error.message : "AI request failed");
  }
  const payload = data as { content?: string; error?: string };
  if (!payload || typeof payload.content !== "string") {
    throw new Error(payload?.error ?? "AI did not return any content");
  }
  const drafts = parseNumbered(payload.content);
  if (drafts.length === 0) {
    return [payload.content.trim()];
  }
  return drafts;
};
