// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { agreementAction, createAgreement } from "../../../../api/_signroom/agreements";
import { DRAFT_OFF_MESSAGE, type DraftClaude } from "../../../../api/_signroom/aiDraft";
import { readKey } from "../../../../api/_signroom/mailbox/crypto";
import { route, type RouteDeps } from "../../../../api/_signroom/router";
import type { Agreement, ClientProject, ProjectList } from "../../../../api/_signroom/shared/types";
import { supabaseStore } from "../../../../api/_signroom/store";
import { mailSetup, newClient, OWNER } from "./agreementFixtures";
import { ORG2, withMemberRole, WS, WS2 } from "./helpers";

/** The new routes through the router: Draft with AI, billing plans, the year's overview. */
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
type User = typeof OWNER;
const BODY = ("# Service agreement\n\n" + "Clause text. ".repeat(20)).slice(0, 200);
const REQS = "A website redesign for a florist, paid monthly over six months.";
const PLAN = { name: "Retainer", billingType: "Monthly", billingLabel: "", currency: "GBP", monthlyFee: "100", contractValue: "1200", annualTarget: "0", startMonth: "2026-01", endMonth: "2026-12", status: "Active", notes: "" };

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

function fakeClaude(model = "claude-opus-5-5") {
  const calls: unknown[] = [];
  const claude: DraftClaude = {
    beta: { messages: { stream: (params) => (calls.push(params), { finalMessage: async () => ({ model, stop_reason: "end_turn", content: [{ type: "text", text: BODY }], usage: { input_tokens: 10, output_tokens: 20 } }) as never }) } },
  };
  return { claude, calls };
}

async function setup() {
  const m = mailSetup();
  withMemberRole(m.store, member.id);
  m.store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
  m.store.setOrgMember(WS2, other.id, "admin");
  const client = await newClient(m.store);
  const draft = await createAgreement(m.store, OWNER, { clientId: client.id, type: "Service agreement", title: "T" });
  const agreement = (await agreementAction(m.store, OWNER, draft.id, "save", { ...draft, content: "# Draft" })) as Agreement;
  const ai = fakeClaude();
  const deps: RouteDeps = { mail: m.deps, draft: { claude: ai.claude } };
  const call = (user: User | null, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}, d: RouteDeps = deps) =>
    route(d, { method, path: path.split("/"), query, body, user, origin: "https://app.example.com" });
  return { ...m, client, agreement, ai, deps, call };
}

describe("POST agreements/:id/ai-draft", () => {
  it("answers the draft, the model that wrote it and reviewRequired, and saves nothing", async () => {
    const t = await setup();
    const out = await t.call(OWNER, "POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: REQS });
    expect(out).toEqual({ status: 200, json: { content: BODY, model: "claude-opus-5-5", reviewRequired: true } });
    expect(t.ai.calls).toHaveLength(1);
    expect((await t.store.getAgreement(WS, t.agreement.id))!.content).toBe("# Draft");
    expect(t.store.aiUsage()).toEqual([expect.objectContaining({ workspaceId: WS, userId: "u1", feature: "ai-draft", model: "claude-opus-5-5", inputTokens: 10, outputTokens: 20 })]);
  });

  it("without ANTHROPIC_API_KEY it is a 503 that names the setting, whether the deps carry no client or none at all", async () => {
    const t = await setup();
    const expected = { status: 503, json: { error: "Draft with AI is not set up yet: ANTHROPIC_API_KEY is missing in Vercel's environment variables." } };
    expect(DRAFT_OFF_MESSAGE).toBe(expected.json.error);
    expect(await t.call(OWNER, "POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: REQS }, {}, { mail: t.deps.mail, draft: { claude: null } })).toEqual(expected);
    expect(await t.call(OWNER, "POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: REQS }, {}, { mail: t.deps.mail })).toEqual(expected);
  });

  it("the limits follow the signed-in person: 12 an hour, then 429", async () => {
    const t = await setup();
    for (let n = 0; n < 12; n++) expect((await t.call(OWNER, "POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: REQS })).status).toBe(200);
    expect(await t.call(OWNER, "POST", `agreements/${t.agreement.id}/ai-draft`, { requirements: REQS })).toEqual({
      status: 429,
      json: { error: "You've drafted with AI 12 times this hour. Try again in 42 minutes." },
    });
    expect(t.ai.calls).toHaveLength(12);
  });

  it("a Member who is not the sender, another workspace, a signed-out caller and a GET never reach the model", async () => {
    const t = await setup();
    const path = `agreements/${t.agreement.id}/ai-draft`;
    expect((await t.call(member, "POST", path, { requirements: REQS })).status).toBe(404);
    expect((await t.call(other, "POST", path, { requirements: REQS })).status).toBe(404);
    expect((await t.call(null, "POST", path, { requirements: REQS })).status).toBe(401);
    expect(await t.call(OWNER, "GET", path)).toEqual({ status: 404, json: { error: "Not found." } });
    expect((await t.call(OWNER, "POST", path, { requirements: "too short" })).status).toBe(400);
    expect(t.ai.calls).toHaveLength(0);
    expect(t.store.aiUsage()).toHaveLength(0);
  });
});

describe("client-projects and accounts-overview (billing plans)", () => {
  it("POST creates, GET lists a year, PATCH edits, and the overview lists the year's rows", async () => {
    const t = await setup();
    const made = await t.call(OWNER, "POST", `client-projects/${t.client.id}`, PLAN);
    expect(made.status).toBe(200);
    const plan = made.json as ClientProject;
    expect(plan).toMatchObject({ name: "Retainer", monthlyFeeMinor: 10000, revision: 1, clientId: t.client.id, workspaceId: WS });
    const list = (await t.call(OWNER, "GET", `client-projects/${t.client.id}`, {}, { year: "2026" })).json as ProjectList;
    expect(list).toMatchObject({ year: 2026, clientName: "Bloom & Co." });
    expect(list.projects.map((p) => p.id)).toEqual([plan.id]);
    const edited = await t.call(OWNER, "PATCH", `client-projects/${t.client.id}/${plan.id}`, { revision: 1, action: "month", month: "2026-02", paid: "100", expected: "100" });
    expect((edited.json as ClientProject).monthlyEntries?.["2026-02"]).toMatchObject({ paidMinor: 10000 });
    const overview = await t.call(OWNER, "GET", "accounts-overview", {}, { year: "2026" });
    expect(overview.status).toBe(200);
    const rows = (overview.json as { year: number; rows: { source: string; period: string; status: string }[] }).rows;
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.period === "2026-02")).toMatchObject({ source: "Project plan", status: "paid" });
  });

  it("wrong methods are 405 with the plan's own sentences", async () => {
    const t = await setup();
    expect(await t.call(OWNER, "DELETE", `client-projects/${t.client.id}`)).toEqual({ status: 405, json: { error: "Method not allowed." } });
    expect(await t.call(OWNER, "PATCH", `client-projects/${t.client.id}`, PLAN)).toEqual({ status: 405, json: { error: "Use POST to create a billing plan or PATCH with a billing plan ID." } });
    expect(await t.call(OWNER, "POST", "accounts-overview")).toEqual({ status: 405, json: { error: "Method not allowed." } });
    expect((await t.call(OWNER, "GET", "client-projects")).status).toBe(404);
    expect((await t.call(OWNER, "GET", `client-projects/${t.client.id}/x/y`)).status).toBe(404);
    expect((await t.call(OWNER, "GET", "accounts-overview/2026")).status).toBe(404);
  });

  it("another workspace cannot read or change a plan; a Member sees only their own; signed out is 401", async () => {
    const t = await setup();
    const plan = (await t.call(OWNER, "POST", `client-projects/${t.client.id}`, PLAN)).json as ClientProject;
    expect(await t.call(other, "GET", `client-projects/${t.client.id}`, {}, { year: "2026" })).toEqual({ status: 404, json: { error: "Client not found." } });
    expect((await t.call(other, "PATCH", `client-projects/${t.client.id}/${plan.id}`, { revision: 1, action: "archive" })).status).toBe(404);
    expect(((await t.call(other, "GET", "accounts-overview", {}, { year: "2026" })).json as { rows: unknown[] }).rows).toEqual([]);
    expect(((await t.call(member, "GET", `client-projects/${t.client.id}`, {}, { year: "2026" })).json as ProjectList).projects).toEqual([]);
    expect(await t.call(member, "PATCH", `client-projects/${t.client.id}/${plan.id}`, { revision: 1, action: "archive" })).toEqual({ status: 404, json: { error: "Billing plan not found." } });
    expect((await t.call(null, "GET", "accounts-overview")).status).toBe(401);
    expect((await t.store.getProject(WS, plan.id))!.archived).toBe(false);
  });

  it("no sentence a person reads says project, Signroom or Securovix", async () => {
    const t = await setup();
    const plan = (await t.call(OWNER, "POST", `client-projects/${t.client.id}`, PLAN)).json as ClientProject;
    const answers = [
      await t.call(OWNER, "POST", `client-projects/${t.client.id}`, { ...PLAN, name: "" }),
      await t.call(OWNER, "POST", `client-projects/${t.client.id}`, { ...PLAN, billingType: "Custom" }),
      await t.call(OWNER, "PATCH", `client-projects/${t.client.id}/${plan.id}`, { ...PLAN, revision: 9 }),
      await t.call(OWNER, "PATCH", `client-projects/${t.client.id}/not-an-id`, { revision: 1 }),
    ];
    for (const a of answers) {
      expect(a.status).toBeGreaterThanOrEqual(400);
      expect((a.json as { error: string }).error).not.toMatch(/project|signroom|securovix/i);
    }
  });
});

// ---- the Supabase store: what the new methods ask the database for -----------------------------

type Op = [string, ...unknown[]];
function recordingSb(answer: unknown, error: { message: string; code?: string } | null = null) {
  const calls: { table: string; ops: Op[] }[] = [];
  const sb = {
    from(table: string) {
      const call = { table, ops: [] as Op[] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "order", "limit", "gt", "lt"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
      const done = () => Promise.resolve(error ? { data: null, error } : { data: answer, error: null });
      b.maybeSingle = done;
      b.single = done;
      b.then = (ok: (v: unknown) => unknown) => done().then(ok);
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}
const H = (c: string) => c.repeat(64);

describe("supabaseStore: the rows migration 186 adds", () => {
  it("writes one sr_ai_usage row with the token counts", async () => {
    const { sb, calls } = recordingSb(null);
    await supabaseStore(sb).insertAiUsage({ workspaceId: "w1", userId: "u1", feature: "ai-draft", model: "claude-opus-5-5", inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 });
    expect(calls).toEqual([{ table: "sr_ai_usage", ops: [["insert", { workspace_id: "w1", user_id: "u1", feature: "ai-draft", model: "claude-opus-5-5", input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }]] }]);
    await expect(supabaseStore(recordingSb(null, { message: "Could not find the table 'public.sr_ai_usage' in the schema cache" }).sb).insertAiUsage({ workspaceId: "w1", userId: "u1", feature: "f", model: "m", inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })).rejects.toMatchObject({ name: "StoreError" });
  });

  it("renames every version of a template inside the workspace, and a taken name is a 409", async () => {
    const { sb, calls } = recordingSb(null);
    await supabaseStore(sb).renameAgreementTemplate("w1", "Old", "New");
    expect(calls[0]).toEqual({ table: "sr_agreement_templates", ops: [["update", { name: "New" }], ["eq", "workspace_id", "w1"], ["eq", "name", "Old"]] });
    await expect(supabaseStore(recordingSb(null, { message: "duplicate key", code: "23505" }).sb).renameAgreementTemplate("w1", "Old", "New")).rejects.toMatchObject({ name: "AppError", status: 409, message: "A template with that name already exists." });
    await expect(supabaseStore(recordingSb(null, { message: "Templates cannot change.", code: "P0001" }).sb).renameAgreementTemplate("w1", "Old", "New")).rejects.toMatchObject({ name: "StoreError", message: "Templates cannot change." });
  });

  it("deletes one template version, only inside the workspace", async () => {
    const { sb, calls } = recordingSb(null);
    await supabaseStore(sb).deleteAgreementTemplate("w1", "t1");
    expect(calls[0]).toEqual({ table: "sr_agreement_templates", ops: [["delete"], ["eq", "workspace_id", "w1"], ["eq", "id", "t1"]] });
  });

  it("the mailbox row is read, replaced, marked and deleted by workspace id; a mark matches the row exactly as it was checked", async () => {
    const row = { workspace_id: "w1", provider: "gmail" as const, host: "smtp.gmail.com", port: 465 as const, security: "tls" as const, username: "u", from_email: "u@acme.test", password_enc: "v1:a:b", verified_at: null, last_error: null };
    const read = recordingSb(row);
    expect(await supabaseStore(read.sb).getMailbox("w1")).toEqual(row);
    expect(read.calls[0].table).toBe("sr_mailboxes");
    expect(read.calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    const up = recordingSb(null);
    await supabaseStore(up.sb).upsertMailbox({ ...row, updated_at: "2026-11-19T00:00:00Z" });
    expect(up.calls[0].ops[0]).toEqual(["upsert", { ...row, updated_at: "2026-11-19T00:00:00Z" }, { onConflict: "workspace_id" }]);
    const mark = recordingSb([{ workspace_id: "w1" }]);
    expect(await supabaseStore(mark.sb).markMailbox(row, { verified_at: "2026-11-19T00:00:00Z", last_error: null })).toBe(true);
    for (const k of ["workspace_id", "provider", "host", "port", "security", "username", "from_email", "password_enc"] as const) expect(mark.calls[0].ops).toContainEqual(["eq", k, row[k]]);
    expect(await supabaseStore(recordingSb([]).sb).markMailbox(row, { verified_at: null, last_error: "x" })).toBe(false);
    const del = recordingSb(null);
    await supabaseStore(del.sb).deleteMailbox("w1");
    expect(del.calls[0].ops).toEqual([["delete"], ["eq", "workspace_id", "w1"]]);
    await expect(supabaseStore(recordingSb(null, { message: 'relation "public.sr_mailboxes" does not exist' }).sb).getMailbox("w1")).rejects.toMatchObject({ name: "StoreError" });
  });

  it("the Google or Microsoft row maps both ways and is keyed by the workspace", async () => {
    const stored = { workspace_id: "w1", id: "c1", revision: 2, provider: "microsoft", email: "a@b.co", client_id: "cid", tenant: "common", secrets_enc: "v1:x", status: "verified", verified_at: "2026-11-19T00:00:00Z", last_test_at: null, last_error: null, challenge_digest: H("a"), challenge_expires: "2026-11-19T00:10:00.000Z", challenge_attempts: 2 };
    const read = recordingSb(stored);
    expect(await supabaseStore(read.sb).getEmailOAuth("w1")).toEqual({
      workspaceId: "w1", id: "c1", revision: 2, provider: "microsoft", email: "a@b.co", clientId: "cid", tenant: "common", secretsEnc: "v1:x", status: "verified",
      verifiedAt: "2026-11-19T00:00:00Z", challenge: { digest: H("a"), expires: Date.parse("2026-11-19T00:10:00.000Z"), attempts: 2 },
    });
    expect(read.calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);

    const replace = recordingSb(null);
    await supabaseStore(replace.sb).replaceEmailOAuth({ workspaceId: "w1", id: "c1", revision: 1, provider: "google", email: "a@b.co", clientId: "cid", tenant: "", secretsEnc: "v1:x", status: "configured" });
    expect(replace.calls.map((c) => c.table)).toEqual(["sr_email_oauth", "sr_email_oauth_states"]);
    expect(replace.calls[0].ops[0][1]).toMatchObject({ workspace_id: "w1", id: "c1", client_id: "cid", secrets_enc: "v1:x", status: "configured", challenge_digest: null, challenge_attempts: 0 });
    expect(replace.calls[0].ops[0][2]).toEqual({ onConflict: "workspace_id" });
    expect(replace.calls[1].ops).toEqual([["delete"], ["eq", "workspace_id", "w1"]]);

    const update = recordingSb([{ workspace_id: "w1" }]);
    expect(await supabaseStore(update.sb).updateEmailOAuth("w1", { id: "c1", revision: 2, attempts: 1, status: "authenticated" }, { status: "verified", challenge: null, lastError: null })).toBe(true);
    expect(update.calls[0].ops[0][1]).toMatchObject({ status: "verified", challenge_digest: null, challenge_expires: null, challenge_attempts: 0, last_error: null });
    expect(update.calls[0].ops).toEqual(expect.arrayContaining([["eq", "workspace_id", "w1"], ["eq", "id", "c1"], ["eq", "revision", 2], ["eq", "challenge_attempts", 1], ["eq", "status", "authenticated"]]));
    expect(await supabaseStore(recordingSb([]).sb).updateEmailOAuth("w1", { id: "c1", revision: 2 }, { status: "verified" })).toBe(false);

    const del = recordingSb(null);
    await supabaseStore(del.sb).deleteEmailOAuth("w1");
    expect(del.calls.map((c) => [c.table, c.ops])).toEqual([["sr_email_oauth", [["delete"], ["eq", "workspace_id", "w1"]]], ["sr_email_oauth_states", [["delete"], ["eq", "workspace_id", "w1"]]]]);
  });

  it("a pending sign-in is stored by digest, taken once by digest, browser digest and expiry, and purged by time", async () => {
    const st = { digest: H("a"), browserDigest: H("b"), workspaceId: "w1", userId: "u1", connectionId: "c1", revision: 2, verifierEnc: "v1:v", redirectUri: "https://app.example.com/api/signroom/email-connection/callback", expires: Date.parse("2026-11-19T00:10:00.000Z") };
    const ins = recordingSb(null);
    await supabaseStore(ins.sb).insertOAuthState(st);
    expect(ins.calls[0].ops).toEqual([["delete"], ["eq", "workspace_id", "w1"]]);
    expect(ins.calls[1].ops[0]).toEqual(["insert", { digest: H("a"), browser_digest: H("b"), workspace_id: "w1", user_id: "u1", connection_id: "c1", revision: 2, verifier_enc: "v1:v", redirect_uri: st.redirectUri, expires_at: "2026-11-19T00:10:00.000Z" }]);
    const row = { digest: H("a"), browser_digest: H("b"), workspace_id: "w1", user_id: "u1", connection_id: "c1", revision: 2, verifier_enc: "v1:v", redirect_uri: st.redirectUri, expires_at: "2026-11-19T00:10:00.000Z" };
    const take = recordingSb([row]);
    expect(await supabaseStore(take.sb).takeOAuthState(H("a"), H("b"), 1000)).toEqual(st);
    expect(take.calls[0].ops).toEqual([["delete"], ["eq", "digest", H("a")], ["eq", "browser_digest", H("b")], ["gt", "expires_at", new Date(1000).toISOString()], ["select", "*"]]);
    expect(await supabaseStore(recordingSb([]).sb).takeOAuthState(H("a"), H("b"), 1000)).toBeNull();
    const purge = recordingSb(null);
    await supabaseStore(purge.sb).purgeOAuthStates(5000);
    expect(purge.calls[0]).toEqual({ table: "sr_email_oauth_states", ops: [["delete"], ["lt", "expires_at", new Date(5000).toISOString()]] });
  });
});

describe("signroom:secrets mail", () => {
  const script = fileURLToPath(new URL("../../../../scripts/signroom-secrets.mjs", import.meta.url));
  it("prints only a SIGNROOM_MAIL_KEY the server's key reader accepts, fresh each time", () => {
    const run = () => execFileSync(process.execPath, [script, "mail"], { encoding: "utf8", stdio: "pipe" }).trim();
    const a = run();
    expect(a).toMatch(/^SIGNROOM_MAIL_KEY=[A-Za-z0-9+/]{43}=$/);
    expect(readKey(a.slice("SIGNROOM_MAIL_KEY=".length))).toHaveLength(32);
    expect(run()).not.toBe(a);
    expect(readKey(undefined)).toBeNull();
    expect(readKey("not-a-key")).toBeNull();
  });
});
