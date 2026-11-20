import { AppError } from "../_signroom/errors.js";
import { AiError, aiAppError, askStructured } from "./ai.js";
import { currentWorkspace, rulesOf, type SignedInUser } from "./context.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { AI_INCOMPLETE_MESSAGE, AI_OFF_MESSAGE } from "./messages.js";
import { assistantMessages, assistantSystem } from "./prompts.js";
import { AssistantOutputSchema, type AssistantOutput } from "./schemas.js";
import { LIMITS } from "./shared/types.js";
import type { AssistantMessage, AssistantReply, AutomationDraft } from "./shared/types.js";
import type { StoredAgent } from "./store.js";
import { automationDraft, clean, oneLine } from "./validate.js";

/**
 * The assistant: the person says in plain words what should happen to a new
 * lead and Claude answers with a draft automation. Nothing is saved here; the
 * draft goes back to the screen for the person to check, test and save.
 */

export const ASSISTANT_PER_HOUR = 40;
export const ASSISTANT_DEADLINE_MS = 170_000;
export const ASSISTANT_MAX_TOKENS = 16_000;
export const MESSAGES_MESSAGE = `Write a message of up to ${LIMITS.assistantMessage} characters.`;
export const ASSISTANT_LIMIT_MESSAGE = `You have asked the assistant ${ASSISTANT_PER_HOUR} times this hour. Try again in a little while.`;

function messagesOf(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError(MESSAGES_MESSAGE);
  // A long conversation keeps its latest turns: the draft carries what the earlier ones decided.
  const out = value.slice(-LIMITS.assistantMessages).map((raw): AssistantMessage => {
    const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const text = clean(m.text, LIMITS.assistantMessage + 1);
    if ((m.role !== "user" && m.role !== "assistant") || !text || text.length > LIMITS.assistantMessage) throw new AppError(MESSAGES_MESSAGE);
    return { role: m.role, text };
  });
  if (out[out.length - 1].role !== "user") throw new AppError(MESSAGES_MESSAGE);
  return out;
}

/**
 * The model's draft as a draft the server would accept on save. An agent id
 * is kept only when it is one of this workspace's agents; waits are whole
 * days inside the limit. A draft that still does not fit is "cut short".
 */
function draftOf(raw: NonNullable<AssistantOutput["draft"]>, agents: StoredAgent[]): AutomationDraft {
  const ids = new Set(agents.map((a) => a.id));
  const steps = raw.steps.slice(0, LIMITS.steps).map((s) => ({
    ...s,
    agent: { ...s.agent, id: s.agent.id && ids.has(s.agent.id) ? s.agent.id : null },
    starts: s.starts.type === "no_reply_days" ? { type: "no_reply_days", days: Math.min(LIMITS.waitDays, Math.max(1, Math.round(Number(s.starts.days) || 1))) } : s.starts,
  }));
  try {
    return automationDraft({ ...raw, name: oneLine(raw.name, LIMITS.automationName), steps });
  } catch (e) {
    if (e instanceof AppError) throw new AppError(AI_INCOMPLETE_MESSAGE);
    throw e;
  }
}

export async function ask(deps: AutoDeps, user: SignedInUser, body: Record<string, unknown>): Promise<AssistantReply> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const messages = messagesOf(body.messages);
  const draft = body.draft === null || body.draft === undefined ? null : automationDraft(body.draft);
  const rules = await rulesOf(store, ctx.workspaceId);
  if (!deps.claude) throw new AppError(AI_OFF_MESSAGE, 503);
  const since = new Date(nowOf(deps).getTime() - 60 * 60_000).toISOString();
  if ((await store.countUsage(ctx.workspaceId, { feature: "assistant", userId: ctx.userId, since })) >= ASSISTANT_PER_HOUR) throw new AppError(ASSISTANT_LIMIT_MESSAGE, 429);

  const agents = await store.listAgents(ctx.workspaceId);
  let output: AssistantOutput;
  try {
    output = await askStructured(
      { store, claude: deps.claude },
      {
        tag: { workspaceId: ctx.workspaceId, feature: "assistant", userId: ctx.userId },
        system: assistantSystem(ctx.name, rules.autonomy),
        messages: assistantMessages(messages, draft, agents.map(({ id, name, job, rights, askFirst }) => ({ id, name, job, rights, askFirst }))),
        schema: AssistantOutputSchema,
        effort: "medium",
        maxTokens: ASSISTANT_MAX_TOKENS,
        deadlineMs: ASSISTANT_DEADLINE_MS,
      },
    );
  } catch (e) {
    if (e instanceof AiError) throw aiAppError(e);
    throw e;
  }
  return {
    reply: clean(output.reply, 4000) || "Done.",
    assumptions: output.assumptions.map((a) => oneLine(a, 300)).filter(Boolean).slice(0, 8),
    draft: output.draft ? draftOf(output.draft, agents) : null,
  };
}
