/**
 * Shared set-up for the automation-server tests: a workspace inside an
 * organisation, the automation store in memory, the documents server's mail
 * deps over its own fake store (so emails go through the real sendMail), a
 * fake Claude and a clock the test moves. Nothing here touches the network.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AutoClaude } from "../../../../api/_automation/ai";
import type { SignedInUser } from "../../../../api/_automation/context";
import type { AutoDeps } from "../../../../api/_automation/deps";
import { fakeStore, type FakeAutoStore } from "../../../../api/_automation/fakeStore";
import { route, type RouteRequest, type RouteResult } from "../../../../api/_automation/router";
import type { Automation, Overview } from "../../../../api/_automation/shared/types";
import type { Lead, StoredRun } from "../../../../api/_automation/store";
import { fakeStore as documentsFakeStore } from "../../../../api/_signroom/fakeStore";
import type { MailDeps } from "../../../../api/_signroom/mail";

export const WS = "0a000000-0000-4000-8000-000000000001";
export const WS2 = "0a000000-0000-4000-8000-000000000002";
/** A workspace of another organisation. */
export const WS_OTHER = "0a000000-0000-4000-8000-000000000009";
export const ORG = "0b000000-0000-4000-8000-000000000001";
export const ORG_OTHER = "0b000000-0000-4000-8000-000000000009";

/** Organisation admin of ORG, working in WS: an "Owner". */
export const OWNER: SignedInUser = { id: "0c000000-0000-4000-8000-000000000001", email: "sam@studio.example", workspaceId: WS };
/** Organisation member of ORG: a "Member". */
export const MEMBER: SignedInUser = { id: "0c000000-0000-4000-8000-000000000002", email: "mia@studio.example", workspaceId: WS };
export const MEMBER2: SignedInUser = { id: "0c000000-0000-4000-8000-000000000003", email: "noor@studio.example", workspaceId: WS };
export const VIEWER: SignedInUser = { id: "0c000000-0000-4000-8000-000000000004", email: "vic@studio.example", workspaceId: WS };
export const OUTSIDER: SignedInUser = { id: "0c000000-0000-4000-8000-000000000005", email: "out@elsewhere.example", workspaceId: WS };
/** Organisation admin of the other organisation, working in its workspace. */
export const OTHER_OWNER: SignedInUser = { id: "0c000000-0000-4000-8000-000000000009", email: "olga@other.example", workspaceId: WS_OTHER };

/** Wednesday 18 November 2026, 10:00 in London: inside the default send window. */
export const START = "2026-11-18T10:00:00.000Z";
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

type Reply = Anthropic.Beta.Messages.BetaMessage & { parsed_output?: unknown };
type AnyParams = Record<string, any>;

/** What an agent step answers with, in the shape the model must use. */
export type StepAnswer = { decided: string; outcome: "continue" | "stop"; handoff: string; actions: Array<Record<string, unknown>> };

export const answer = (over: Partial<StepAnswer> = {}): StepAnswer => ({ decided: "Nothing needed doing.", outcome: "continue", handoff: "Nothing to add.", actions: [], ...over });

export function reply(over: Record<string, unknown> = {}): Reply {
  return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1000, output_tokens: 500 }, ...over } as unknown as Reply;
}

/**
 * A fake Claude. Structured calls are answered by agent name (the name the
 * system prompt opens with), then from a queue, then with "nothing to do".
 * Each answer may be a plain object (it becomes parsed_output), a whole reply
 * (has stop_reason), an Error (thrown), or a function of the params.
 */
export function fakeClaude() {
  const calls: Array<{ kind: "parse" | "create"; params: AnyParams; options?: { signal?: AbortSignal } }> = [];
  const byAgent = new Map<string, unknown[]>();
  const queue: unknown[] = [];
  const web: unknown[] = [];

  const resolve = (item: unknown, params: AnyParams): Reply => {
    const value = typeof item === "function" ? (item as (p: AnyParams) => unknown)(params) : item;
    if (value instanceof Error) throw value;
    if (value && typeof value === "object" && "stop_reason" in value) return value as Reply;
    return reply({ parsed_output: value, content: [{ type: "text", text: JSON.stringify(value) }] });
  };

  const claude: AutoClaude = {
    beta: {
      messages: {
        async parse(params, options) {
          const p = params as AnyParams;
          calls.push({ kind: "parse", params: p, options });
          const name = /^You are ([^,]+),/.exec(String(p.system))?.[1] ?? "";
          const mine = byAgent.get(name);
          if (mine && mine.length > 0) return resolve(mine.length > 1 ? mine.shift() : mine[0], p);
          if (queue.length > 0) return resolve(queue.shift(), p);
          return resolve(answer(), p);
        },
        async create(params, options) {
          const p = params as AnyParams;
          calls.push({ kind: "create", params: p, options });
          return resolve(web.length > 0 ? web.shift() : reply({ content: [{ type: "text", text: "Northwind Studio is a design studio of about 20 people [northwind.example]." }] }), p);
        },
      },
    },
  };

  return {
    claude,
    calls,
    /** Every structured call (agent steps and the assistant), oldest first. */
    parses: () => calls.filter((c) => c.kind === "parse").map((c) => c.params),
    lookups: () => calls.filter((c) => c.kind === "create").map((c) => c.params),
    /** What this agent answers: with several, one per call and the last one from then on. */
    agent(name: string, ...answers: unknown[]) {
      byAgent.set(name, answers);
    },
    next(...answers: unknown[]) {
      queue.push(...answers);
    },
    web(...answers: unknown[]) {
      web.push(...answers);
    },
    /** The user message of a structured call, as text. */
    userText(params: AnyParams): string {
      const last = params.messages[params.messages.length - 1];
      return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    },
  };
}

export type World = ReturnType<typeof world>;

/** Everything a test needs, wired together. `key: false` is a server with no ANTHROPIC_API_KEY. */
export function world(opts: { key?: boolean; mail?: boolean } = {}) {
  const store: FakeAutoStore = fakeStore();
  let now = new Date(START);
  store.setNow(START);

  store.seedWorkspace({ id: WS, organizationId: ORG, name: "Studio" });
  store.seedWorkspace({ id: WS2, organizationId: ORG, name: "Retainers" });
  store.seedWorkspace({ id: WS_OTHER, organizationId: ORG_OTHER, name: "Elsewhere" });
  store.setOrgMember(WS, OWNER.id, "admin", { name: "Sam" });
  store.setOrgMember(WS, MEMBER.id, "member", { name: "Mia" });
  store.setOrgMember(WS, MEMBER2.id, "member", { name: "Noor" });
  store.setOrgMember(WS, VIEWER.id, "viewer", { name: "Vic" });
  store.setOrgMember(WS_OTHER, OTHER_OWNER.id, "admin", { name: "Olga" });
  store.seedStages(WS);
  store.seedStages(WS_OTHER);

  const mailStore = documentsFakeStore();
  const resend = { calls: [] as Array<{ url: string; body: Record<string, any> }>, status: 200, fail: null as Error | null };
  const mail: MailDeps = {
    store: mailStore,
    sb: {} as never,
    fetch: (async (url: string, init: RequestInit) => {
      if (resend.fail) throw resend.fail;
      resend.calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: resend.status });
    }) as never,
    resendKey: "re_test",
    from: "documents@app.example.com",
    spend: async () => ({ ok: true }),
    peek: async () => ({ ok: true }),
  };

  const ai = fakeClaude();
  const kept: Promise<unknown>[] = [];
  const deps: AutoDeps = {
    store,
    mail: opts.mail === false ? null : mail,
    claude: opts.key === false ? null : ai.claude,
    // The link a lead opens to stop all email, as the real server signs it (the signature is not the point here).
    unsubscribeUrl: async (contactId) => `https://app.example.com/api/email/unsubscribe?c=${contactId}&t=signed`,
    now: () => now,
    keepAlive: (work) => void kept.push(work),
  };

  const call = (user: SignedInUser | null, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}): Promise<RouteResult> =>
    route(deps, { method, path: path.split("/").filter(Boolean), query, body, user } as RouteRequest);

  return {
    store,
    deps,
    ai,
    mail,
    mailStore,
    resend,
    kept,
    now: () => now,
    /** Moves the clock forward. */
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
      store.setNow(now.toISOString());
    },
    setNow(iso: string) {
      now = new Date(iso);
      store.setNow(iso);
    },
    call,
    /** A call that must succeed: its JSON. */
    async ok<T>(user: SignedInUser | null, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}): Promise<T> {
      const out = await call(user, method, path, body, query);
      if (out.status !== 200) throw new Error(`${method} ${path} answered ${out.status}: ${JSON.stringify(out.json)}`);
      return out.json as T;
    },
    /** Waits for the work that goes on after a reply. */
    async background() {
      while (kept.length > 0) await kept.shift();
    },
    /** The scheduled run, as the cron calls it. */
    cron: () => route(deps, { method: "POST", path: ["ops", "run"], query: {}, body: {}, user: null, cron: true }),
  };
}

export const errorOf = (r: RouteResult): string => (r.json as { error?: string } | undefined)?.error ?? "";

/** Sets the workspace up and turns its automation on. */
export async function ready(w: World, user: SignedInUser = OWNER): Promise<{ overview: Overview; automation: Automation }> {
  const overview = await w.ok<Overview>(user, "POST", "setup");
  const automation = await w.ok<Automation>(user, "POST", `automations/${overview.automation?.id}/turn-on`);
  return { overview, automation };
}

/** A person adds a lead (with a company) and the cron runs once. */
export async function leadArrives(w: World, over: Partial<Lead> = {}): Promise<{ lead: Lead; run: StoredRun }> {
  const company = w.store.seedCompany({ workspaceId: over.workspaceId ?? WS, name: "Northwind Studio", website: "northwind.example" });
  const lead = w.store.personAddsLead({ workspaceId: WS, firstName: "Elena", lastName: "Rossi", email: "elena@northwind.example", jobTitle: "Marketing director", companyId: company.id, ownerId: MEMBER.id, ...over });
  await w.cron();
  const run = w.store.runs().find((r) => r.contactId === lead.id);
  if (!run) throw new Error("no run was started");
  return { lead, run };
}

export const runOf = (w: World, id: string): StoredRun => {
  const run = w.store.runs().find((r) => r.id === id);
  if (!run) throw new Error("run not found");
  return run;
};

/** The email a Writer proposes in most tests. */
export const EMAIL = {
  type: "send_email",
  subject: "Your website redesign",
  body: "Hi Elena,\n\nI saw that Northwind Studio is redesigning its website this year. We help studios with exactly that.\n\nWould a short call on Thursday suit you?\n\nSam",
};
