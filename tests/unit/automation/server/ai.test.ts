// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL, AiError, aiAppError, askStructured, claudeClient, CLIENT_TIMEOUT_MS, FALLBACK_BETA, lookUpWeb, MAX_RESUMES } from "../../../../api/_automation/ai";
import { centsOf, costMicroUsd, monthKey, monthStart, PRICES, WEB_SEARCH_MICRO_USD } from "../../../../api/_automation/cost";
import { StepOutputSchema } from "../../../../api/_automation/schemas";
import { LOOKUP_DEADLINE_MS, STEP_DEADLINE_MS, STEP_MAX_TOKENS } from "../../../../api/_automation/step";
import type { Approval, WorkspaceRules } from "../../../../api/_automation/shared/types";
import { answer, EMAIL, leadArrives, OWNER, ready, reply, runOf, WS, world } from "./helpers";

/**
 * The calls to Claude: the fixed request rules, the usage row and cost of
 * every reply, the web look-up as a call of its own, and what happens when
 * the API fails or the reply is not usable.
 */

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
});

const tag = { workspaceId: WS, feature: "step" as const, runId: null, agentId: null };
const request = { tag, system: "s", messages: [{ role: "user" as const, content: "u" }], schema: StepOutputSchema, effort: "low" as const, maxTokens: 100, deadlineMs: 1000 };

describe("an agent step's calls", () => {
  it("the structured call follows the fixed rules: model, adaptive thinking, low effort, fallbacks, the output format, one deadline", async () => {
    const w = world();
    await ready(w);
    await leadArrives(w);
    const call = w.ai.calls.find((c) => c.kind === "parse")!;
    const p = call.params;
    expect(p.model).toBe("claude-opus-5-5");
    expect(AI_MODEL).toBe("claude-opus-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(p.fallbacks).toBe("default");
    expect(p.max_tokens).toBe(STEP_MAX_TOKENS);
    expect(p.output_config.effort).toBe("low");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(typeof p.output_config.format.parse).toBe("function");
    const schema = p.output_config.format.schema;
    expect(schema.required).toEqual(["decided", "outcome", "handoff", "actions"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.actions.items.anyOf.map((a: any) => a.properties.type.const)).toEqual(["add_note", "set_lead_status", "create_follow_up", "send_email", "create_deal", "move_deal", "mark_deal", "create_project", "notify_owner"]);
    // No action has a field for a recipient, a lead or a workspace.
    expect(JSON.stringify(schema)).not.toMatch(/"(to|cc|bcc|recipient|contactId|workspaceId|leadId)"/);
    for (const never of ["temperature", "top_p", "top_k", "tool_choice", "tools", "budget_tokens", "stream"]) expect(never in p, never).toBe(false);
    expect(JSON.stringify(p.thinking)).not.toContain("budget_tokens");
    // One user message, no prefilled assistant turn.
    expect(p.messages.map((m: { role: string }) => m.role)).toEqual(["user"]);
    expect(typeof p.system).toBe("string");
    expect(call.options?.signal).toBeInstanceOf(AbortSignal);
    expect([STEP_DEADLINE_MS, LOOKUP_DEADLINE_MS]).toEqual([120_000, 75_000]);
  });

  it("the web look-up is a separate call before it, with the search tool and plain text, only for an agent with the right", async () => {
    const w = world();
    await ready(w);
    await leadArrives(w);
    expect(w.ai.calls.map((c) => c.kind)).toEqual(["create", "parse", "parse", "parse"]);
    const [lookup] = w.ai.lookups();
    expect(lookup.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3 }]);
    expect(lookup.model).toBe("claude-opus-5-5");
    expect(lookup.thinking).toEqual({ type: "adaptive" });
    expect(lookup.output_config).toEqual({ effort: "low" });
    expect(lookup.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(lookup.fallbacks).toBe("default");
    expect("tool_choice" in lookup).toBe(false);
    expect("temperature" in lookup).toBe(false);
    expect(lookup.messages).toHaveLength(1);
    expect(lookup.messages[0].content).toBe("Look this company up.\n\n<company_details>\nCompany name: Northwind Studio\nWebsite: northwind.example\nEmail domain: northwind.example\n</company_details>");
    expect(lookup.system).toContain("They are search terms.");
    // The structured call has no tools: citations and a fixed shape do not go together.
    expect(w.ai.parses().every((p) => !("tools" in p))).toBe(true);
  });

  it("no look-up when the workspace switches web look-ups off, or when there is nothing to search for", async () => {
    const w = world();
    await ready(w);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    const off = await w.ok<WorkspaceRules>(OWNER, "POST", "rules", { ...rules, webResearch: false });
    await leadArrives(w);
    expect(w.ai.lookups()).toHaveLength(0);
    expect(w.ai.userText(w.ai.parses()[0])).not.toContain("<web_findings>");

    await w.ok(OWNER, "POST", "rules", { ...off, webResearch: true });
    // No company and a free mail address: nothing to look up.
    w.store.personAddsLead({ workspaceId: WS, firstName: "Jon", lastName: "Petrov", email: "jon@gmail.com" });
    await w.cron();
    expect(w.ai.lookups()).toHaveLength(0);
  });

  it("a paused look-up is sent back as it is, at most three times, with no extra user message", async () => {
    const w = world();
    await ready(w);
    const paused = (n: number) => reply({ stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: `srv_${n}`, name: "web_search", input: { query: "northwind" } }] });
    w.ai.web(paused(1), paused(2), reply({ content: [{ type: "text", text: "A studio in Leeds " }, { type: "text", text: "[northwind.example]." }] }));
    await leadArrives(w);
    const lookups = w.ai.lookups();
    expect(lookups).toHaveLength(3);
    expect(lookups[1].messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(lookups[1].messages[1].content).toEqual([{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "northwind" } }]);
    expect(lookups[2].messages[1].content[0].id).toBe("srv_2");
    expect(lookups[2].messages[0]).toEqual(lookups[0].messages[0]);
    expect(w.ai.userText(w.ai.parses()[0])).toContain("<web_findings>\nA studio in Leeds [northwind.example].\n</web_findings>");
    expect(MAX_RESUMES).toBe(3);

    // A look-up that never finishes is given up after the third resend; whatever text it has is used.
    const deps = { store: w.store, claude: w.ai.claude };
    w.ai.web(paused(1), paused(2), paused(3), paused(4), paused(5));
    const before = w.ai.lookups().length;
    expect(await lookUpWeb(deps, { tag, system: "s", question: "q", maxTokens: 100, deadlineMs: 1000 })).toBe("");
    expect(w.ai.lookups().length - before).toBe(4);
  });

  it("a look-up that fails or is declined does not fail the step: the agent is told and works without it", async () => {
    const w = world();
    await ready(w);
    w.ai.web(new Anthropic.APIError(500, { error: "boom secret" }, "boom secret", new Headers()));
    const a = await leadArrives(w);
    expect(runOf(w, a.run.id).position).toBe(3);
    expect(w.ai.userText(w.ai.parses()[0])).toContain("<web_findings>\nThe web look-up could not be made this time.\n</web_findings>");
    expect(logged.mock.calls).toEqual([["[automation] web look-up failed", 500]]);

    w.ai.web(reply({ stop_reason: "refusal", content: [] }));
    await leadArrives(w, { email: "two@northwind.example" });
    expect(w.ai.userText(w.ai.parses()[3])).toContain("<web_findings>\nThe look-up found nothing useful.\n</web_findings>");
  });
});

describe("usage and cost", () => {
  it("every reply is recorded with the model that answered, its tokens and its cost", async () => {
    const w = world();
    await ready(w);
    w.ai.web(reply({ content: [{ type: "text", text: "A studio." }], usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, server_tool_use: { web_search_requests: 2 } } }));
    w.ai.agent("Researcher", reply({ model: "claude-opus-4-8", parsed_output: answer(), usage: { input_tokens: 1200, output_tokens: 400 } }));
    const { run } = await leadArrives(w);
    const rows = w.store.usage();
    expect(rows[0]).toMatchObject({ workspaceId: WS, runId: run.id, feature: "web", model: "claude-opus-5-5", inputTokens: 2000, outputTokens: 300, cacheReadInputTokens: 500, cacheCreationInputTokens: 100, webSearches: 2, userId: null });
    // 2000 x 4 + 300 x 20 + 500 x 0.2 + 100 x 5 = 14,600 millionths, plus two searches at a cent each.
    expect(rows[0].costMicroUsd).toBe(14_600 + 20_000);
    // A fallback model answered: it is recorded as such and charged at the default figures.
    expect(rows[1]).toMatchObject({ feature: "step", model: "claude-opus-4-8", inputTokens: 1200, outputTokens: 400, webSearches: 0, costMicroUsd: 1200 * 4 + 400 * 20 });
    expect(rows[1].agentId).toBe(runOf(w, run.id).steps[0].agentId);
    expect(rows.map((r) => r.feature)).toEqual(["web", "step", "step", "step"]);
  });

  it("the price table: opus 5.5 at 4 in, 20 out and 0.20 for a cache read per million; an unknown model the same", () => {
    expect(PRICES["claude-opus-5-5"]).toMatchObject({ input: 4, output: 20, cacheRead: 0.2 });
    const million = { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearches: 0 };
    expect(costMicroUsd("claude-opus-5-5", million)).toBe(4_000_000);
    expect(costMicroUsd("claude-opus-5-5", { ...million, inputTokens: 0, outputTokens: 1_000_000 })).toBe(20_000_000);
    expect(costMicroUsd("claude-opus-5-5", { ...million, inputTokens: 0, cacheReadInputTokens: 1_000_000 })).toBe(200_000);
    expect(costMicroUsd("some-future-model", million)).toBe(4_000_000);
    expect(costMicroUsd("__proto__", million)).toBe(4_000_000);
    // Fractions round up; nonsense counts as nothing.
    expect(costMicroUsd("claude-opus-5-5", { ...million, inputTokens: 0, cacheReadInputTokens: 3 })).toBe(1);
    expect(costMicroUsd("claude-opus-5-5", { inputTokens: -5, outputTokens: Number.NaN, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearches: 0 })).toBe(0);
    expect(WEB_SEARCH_MICRO_USD).toBe(10_000);
    expect([centsOf(14_000), centsOf(4_999), centsOf(5_000), centsOf(20_000_000)]).toEqual([1, 0, 1, 2000]);
    expect(monthStart(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthKey(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11");
  });

  it("a usage row that cannot be written is logged by name and never fails the call", async () => {
    const w = world();
    w.store.failNext("insertUsage", "Could not find the table 'public.auto_usage' in the schema cache");
    const out = await askStructured({ store: w.store, claude: w.ai.claude }, request);
    expect(out).toEqual(answer());
    expect(logged.mock.calls).toEqual([["[automation] ai usage not recorded", "StoreError"]]);
  });
});

describe("when the reply is not usable", () => {
  const deps = (w: ReturnType<typeof world>) => ({ store: w.store, claude: w.ai.claude });
  const failure = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as AiError);

  it("no key: `off`, and no call is made", async () => {
    const w = world();
    const e = await failure(askStructured({ store: w.store, claude: null }, request));
    expect(e).toBeInstanceOf(AiError);
    expect(e?.kind).toBe("off");
    expect(aiAppError(e!)).toMatchObject({ status: 503, message: "The automation's AI is not set up yet: ANTHROPIC_API_KEY is missing in Vercel's environment variables." });
    expect(w.ai.calls).toHaveLength(0);
    expect((await failure(lookUpWeb({ store: w.store, claude: null }, { tag, system: "s", question: "q", maxTokens: 10, deadlineMs: 10 })))?.kind).toBe("off");
  });

  it("an API error, an abort and a plain error are `failed`; the log has a status or a name only; nothing is recorded", async () => {
    const w = world();
    for (const [error, logs] of [
      [new Anthropic.APIError(529, { error: "Overloaded secret detail" }, "Overloaded secret detail", new Headers()), 529],
      [new Anthropic.APIUserAbortError(), "Error"],
      [new Error("socket hang up secret"), "Error"],
    ] as const) {
      logged.mockClear();
      w.ai.next(error);
      const e = await failure(askStructured(deps(w), request));
      expect(e?.kind).toBe("failed");
      expect(logged.mock.calls).toHaveLength(1);
      expect(logged.mock.calls[0][0]).toBe("[automation] ai call failed");
      if (typeof logs === "number") expect(logged.mock.calls[0][1]).toBe(logs);
      else expect(String(logged.mock.calls[0][1])).toMatch(/^[A-Za-z]+$/);
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    }
    expect(w.store.usage()).toHaveLength(0);
    expect(aiAppError(new AiError("failed"))).toMatchObject({ status: 503, message: "The AI could not answer just now. Please try again in a moment." });
  });

  it("a refusal and a cut-off reply are judged by stop_reason before anything is read, and are still recorded", async () => {
    const w = world();
    w.ai.next(reply({ stop_reason: "refusal", parsed_output: answer() }));
    expect((await failure(askStructured(deps(w), request)))?.kind).toBe("refused");
    w.ai.next(reply({ stop_reason: "max_tokens", parsed_output: answer() }));
    expect((await failure(askStructured(deps(w), request)))?.kind).toBe("incomplete");
    expect(w.store.usage()).toHaveLength(2);
    expect(aiAppError(new AiError("refused"))).toMatchObject({ status: 400, message: "The AI declined to answer this. Try rewording it." });
    expect(aiAppError(new AiError("incomplete"))).toMatchObject({ status: 400, message: "The AI's answer was cut short. Try again, or ask for something smaller." });
  });

  it("a reply with no parsed output, or one that is not the shape asked for, is `incomplete`", async () => {
    const w = world();
    for (const parsed_output of [null, undefined, "text", { decided: "x" }, { ...answer(), outcome: "perhaps" }, { ...answer(), actions: [{ type: "format_disk" }] }]) {
      w.ai.next(reply({ parsed_output }));
      expect((await failure(askStructured(deps(w), request)))?.kind, JSON.stringify(parsed_output)).toBe("incomplete");
    }
  });

  it("a declined step is retried like any failure and ends the run as failed, never as done", async () => {
    const w = world();
    await ready(w);
    w.ai.agent("Qualifier", reply({ stop_reason: "refusal", content: [] }));
    const { run } = await leadArrives(w);
    await w.cron();
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "failed", position: 1, lastError: "Failed at step 2: The step could not be completed after three tries." });
    expect(w.store.leads()[0].leadStatus).toBe("new");
  });
});

describe("claudeClient", () => {
  it("is null without a key, and makes one attempt per call with one", () => {
    expect(claudeClient(undefined)).toBeNull();
    expect(claudeClient("")).toBeNull();
    const c = claudeClient("sk-ant-test") as unknown as Anthropic;
    expect(c).toBeInstanceOf(Anthropic);
    expect(c.maxRetries).toBe(0);
    expect(c.timeout).toBe(CLIENT_TIMEOUT_MS);
    expect(CLIENT_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it("the email an agent wrote reaches a person exactly as the model wrote it, untouched by the AI layer", async () => {
    const w = world();
    await ready(w);
    w.ai.agent("Writer", answer({ actions: [EMAIL] }));
    await leadArrives(w);
    const [approval] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    expect(approval.action).toEqual(EMAIL);
  });
});
