import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { AppError } from "../_signroom/errors.js";
import { costMicroUsd } from "./cost.js";
import { AI_FAILED_MESSAGE, AI_INCOMPLETE_MESSAGE, AI_OFF_MESSAGE, AI_REFUSED_MESSAGE } from "./messages.js";
import type { AutoStore, UsageFeature } from "./store.js";

/**
 * Every call the automation makes to Claude goes through here. Two kinds:
 * a structured call (the agent step and the assistant: the reply is JSON in a
 * fixed shape) and a web look-up (plain text, a separate call because web
 * citations cannot be combined with a fixed shape).
 *
 * The rules are the same for both: one model, adaptive thinking, an explicit
 * effort, the server-side fallback switched on, one attempt, a deadline, and
 * a usage row for every reply. A log line carries a status or an error name
 * and never any text.
 */

/** The model asked for. The API may answer with another one when this one declines; usage records the one that answered. */
export const AI_MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 } as const;
/** How often a paused web look-up is sent back to be continued. */
export const MAX_RESUMES = 3;

type ParseParams = Parameters<Anthropic["beta"]["messages"]["parse"]>[0];
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Reply = Anthropic.Beta.Messages.BetaMessage;
type CallOptions = { signal?: AbortSignal };

/** The part of the Anthropic client the automation uses (tests pass a fake). */
export type AutoClaude = {
  beta: {
    messages: {
      parse(params: ParseParams, options?: CallOptions): Promise<Reply & { parsed_output?: unknown }>;
      create(params: CreateParams, options?: CallOptions): Promise<Reply>;
    };
  };
};

/** The client's own timeout: longer than any deadline below, which is what really bounds a call. */
export const CLIENT_TIMEOUT_MS = 200_000;

/** One attempt per call: SDK retries could outlast the function's 300 seconds. Null when the key is not set. */
export function claudeClient(apiKey: string | undefined): AutoClaude | null {
  return apiKey ? new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: 0 }) : null;
}

/** Why an AI call gave nothing. `off`: no key. `failed`: the API or the network. `refused` / `incomplete`: the reply itself. */
export class AiError extends Error {
  constructor(public kind: "off" | "failed" | "refused" | "incomplete") {
    super(kind);
    this.name = "AiError";
  }
}

/** The same failure as the sentence and status a route answers with. */
export function aiAppError(e: AiError): AppError {
  if (e.kind === "off") return new AppError(AI_OFF_MESSAGE, 503);
  if (e.kind === "failed") return new AppError(AI_FAILED_MESSAGE, 503);
  return new AppError(e.kind === "refused" ? AI_REFUSED_MESSAGE : AI_INCOMPLETE_MESSAGE, 400);
}

export type AiDeps = { store: AutoStore; claude: AutoClaude | null };

/** Whose call it is, for the usage row. */
export type AiTag = { workspaceId: string; feature: UsageFeature; runId?: string | null; agentId?: string | null; userId?: string | null };

/** One auto_usage row per reply. A failed write is logged by name and never fails the call. */
async function recordUsage(store: AutoStore, tag: AiTag, message: Reply): Promise<void> {
  try {
    const u = message.usage;
    const tokens = {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
      webSearches: u?.server_tool_use?.web_search_requests ?? 0,
    };
    await store.insertUsage({
      workspaceId: tag.workspaceId,
      runId: tag.runId ?? null,
      agentId: tag.agentId ?? null,
      userId: tag.userId ?? null,
      feature: tag.feature,
      model: message.model,
      ...tokens,
      costMicroUsd: costMicroUsd(message.model, tokens),
    });
  } catch (e) {
    console.error("[automation] ai usage not recorded", e instanceof Error ? e.name : "unknown");
  }
}

/** The status or the error's name only: Anthropic's text can echo the request. */
function logFailure(what: string, e: unknown): void {
  console.error(`[automation] ${what} failed`, e instanceof Anthropic.APIError ? (e.status ?? e.name) : e instanceof Error ? e.name : "unknown");
}

export type StructuredRequest<S extends z.ZodType> = {
  tag: AiTag;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schema: S;
  /** What the reply is checked against once it is here, when that is looser than the shape asked for. */
  accept?: z.ZodType;
  effort: "low" | "medium";
  maxTokens: number;
  deadlineMs: number;
};

/**
 * One call whose reply is JSON in the given shape. Every reply is recorded
 * before it is judged. The parsed reply is checked against the schema again
 * here, so a caller only ever sees a value of the right shape.
 */
export async function askStructured<S extends z.ZodType>(deps: AiDeps, req: StructuredRequest<S>): Promise<z.infer<S>> {
  const claude = deps.claude;
  if (!claude) throw new AiError("off");
  let message: Reply & { parsed_output?: unknown };
  try {
    message = await claude.beta.messages.parse(
      {
        model: AI_MODEL,
        max_tokens: req.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: req.system,
        messages: req.messages,
      },
      { signal: AbortSignal.timeout(req.deadlineMs) },
    );
  } catch (e) {
    logFailure("ai call", e);
    throw new AiError("failed");
  }
  await recordUsage(deps.store, req.tag, message);
  if (message.stop_reason === "refusal") throw new AiError("refused");
  if (message.stop_reason === "max_tokens") throw new AiError("incomplete");
  const parsed = (req.accept ?? req.schema).safeParse(message.parsed_output ?? null);
  if (!parsed.success) throw new AiError("incomplete");
  return parsed.data as z.infer<S>;
}

export type LookUpRequest = { tag: AiTag; system: string; question: string; maxTokens: number; deadlineMs: number };

/**
 * A web look-up: Claude searches public pages and answers in plain text. A
 * turn the server paused is sent back as it is (at most MAX_RESUMES times) so
 * it carries on where it stopped. Returns the text, or "" when the model
 * declined or found nothing to say.
 */
export async function lookUpWeb(deps: AiDeps, req: LookUpRequest): Promise<string> {
  const claude = deps.claude;
  if (!claude) throw new AiError("off");
  const signal = AbortSignal.timeout(req.deadlineMs);
  const question: Anthropic.Beta.Messages.BetaMessageParam = { role: "user", content: req.question };
  let messages: Anthropic.Beta.Messages.BetaMessageParam[] = [question];
  for (let sent = 0; ; sent++) {
    let message: Reply;
    try {
      message = await claude.beta.messages.create(
        {
          model: AI_MODEL,
          max_tokens: req.maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: req.system,
          tools: [WEB_SEARCH_TOOL],
          messages,
        },
        { signal },
      );
    } catch (e) {
      logFailure("web look-up", e);
      throw new AiError("failed");
    }
    await recordUsage(deps.store, req.tag, message);
    if (message.stop_reason === "pause_turn" && sent < MAX_RESUMES) {
      // The reply ends on a server tool call: sending it back lets the server carry on. No extra user message.
      messages = [question, { role: "assistant", content: message.content as Anthropic.Beta.Messages.BetaContentBlockParam[] }];
      continue;
    }
    if (message.stop_reason === "refusal") return "";
    return message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
  }
}
