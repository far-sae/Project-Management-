// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { setupSentence, TABLES_MISSING_MESSAGE } from "../../../../api/_automation/messages";

/**
 * supabase/migrations/187_automation.sql, read as text (the owner runs it by
 * hand): what it adds, that it can be run twice, that the browser gets no
 * access, that its CRM triggers can never make a CRM write fail, and that the
 * server names this file while it is not run.
 */
const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const raw = read("supabase/migrations/187_automation.sql");
const code = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = code.replace(/\s+/g, " ");

const TABLES = ["auto_rules", "auto_agents", "auto_automations", "auto_runs", "auto_run_steps", "auto_approvals", "auto_events", "auto_usage", "auto_marks"];
const FUNCTIONS = ["auto_note_contact", "auto_note_deal", "auto_note_activity"];

describe("migration 187", () => {
  it("says in plain words what it adds, that it is safe to repeat and that a CRM write can never fail because of it", () => {
    const head = raw.slice(0, raw.indexOf("create table")).toLowerCase().replace(/--/g, " ").replace(/\s+/g, " ");
    for (const word of ["safe to run more than once", "crm automation", "no policy", "service role", "can never make a crm write fail", "own writes"]) expect(head, word).toContain(word);
  });

  it("creates exactly its nine tables, each only if missing", () => {
    const created = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/create table (?!if not exists)/);
  });

  it("can be run twice", () => {
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(code).not.toMatch(/add column (?!if not exists)/i);
    const made = [...flat.matchAll(/create trigger (\w+) /g)].map((m) => m[1]);
    expect(made.sort()).toEqual(["auto_crm_activities", "auto_crm_contacts", "auto_crm_deals"]);
    for (const t of made) expect(flat, t).toMatch(new RegExp(`drop trigger if exists ${t} on public\\.\\w+; create trigger ${t} `));
    expect(flat.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("only adds: no CRM table is altered, nothing is dropped but its own triggers, and no data is touched", () => {
    for (const bad of ["drop table", "drop column", "drop function", "truncate", "update public", "create policy", "disable row level security", "create extension", "alter table public.crm_", "alter table public.sr_"])
      expect(flat.toLowerCase(), bad).not.toContain(bad);
    expect(code).not.toMatch(/references public\.sr_/);
    expect(code).not.toMatch(/\bsr_\w+/);
    expect([...flat.matchAll(/drop trigger if exists (\w+)/g)].every((m) => m[1].startsWith("auto_"))).toBe(true);
  });

  it("turns row level security on for every table and gives them to the service role only", () => {
    for (const t of TABLES) expect(code, t).toContain(`alter table public.${t} enable row level security;`);
    const names = (s: string) => [...s.matchAll(/public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(names(/revoke all on\s+((?:public\.\w+,?\s*)+)from public, anon, authenticated;/.exec(code)![1])).toEqual([...TABLES].sort());
    expect(names(/grant all on\s+((?:public\.\w+,?\s*)+)to service_role;/.exec(code)![1])).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });

  it("every table belongs to a workspace and goes with it", () => {
    expect(flat).toContain("create table if not exists public.auto_rules ( workspace_id uuid primary key references public.workspaces (workspace_id) on delete cascade");
    for (const t of TABLES.filter((t) => t !== "auto_rules"))
      expect(flat, t).toMatch(new RegExp(`create table if not exists public\\.${t} \\([^;]*workspace_id uuid not null references public\\.workspaces \\(workspace_id\\) on delete cascade`));
  });

  it("a lead has at most one run of an automation, and a run at most one record per step", () => {
    expect(flat).toContain("create unique index if not exists auto_runs_one_per_lead on public.auto_runs (automation_id, contact_id);");
    expect(flat).toContain("create unique index if not exists auto_run_steps_one_per_step on public.auto_run_steps (run_id, n);");
    expect(flat).toContain("locked_until timestamptz");
  });

  it("the three trigger functions swallow every error, run as their owner on a fixed search path, and write only for an enabled workspace", () => {
    expect([...code.matchAll(/create or replace function public\.(\w+)\(\)/g)].map((m) => m[1]).sort()).toEqual([...FUNCTIONS].sort());
    for (const f of FUNCTIONS) {
      const from = code.indexOf(`create or replace function public.${f}()`);
      const fn = code.slice(from, code.indexOf("$$;", from));
      expect(fn, f).toContain("returns trigger");
      expect(fn, f).toContain("security definer");
      expect(fn, f).toContain("set search_path = public, pg_temp");
      expect(fn, f).toMatch(/exception\s+when others then\s+null;/);
      expect(fn, f).toMatch(/from public\.auto_rules r\s+where r\.workspace_id = new\.workspace_id and r\.enabled/);
      expect(fn, f).not.toMatch(/raise /i);
      // An AFTER trigger: its return value is ignored, so it can never change or cancel the CRM row.
      expect(fn.replace(/\s+/g, " ").trim().endsWith("return null; end;"), f).toBe(true);
      expect(code).toContain(`revoke all on function public.${f}() from public, anon, authenticated;`);
    }
    expect(flat).toContain("create trigger auto_crm_contacts after insert or update of lead_status on public.crm_contacts for each row execute function public.auto_note_contact();");
    expect(flat).toContain("create trigger auto_crm_deals after insert or update of stage_id, status on public.crm_deals for each row execute function public.auto_note_deal();");
    expect(flat).toContain("create trigger auto_crm_activities after insert on public.crm_activities for each row execute function public.auto_note_activity();");
    expect(code).not.toMatch(/create trigger \w+\s+before/i);
  });

  it("the server's own writes are told apart: a mark for lead and deal changes, metadata.automation for activities", () => {
    const contact = code.slice(code.indexOf("create or replace function public.auto_note_contact()"), code.indexOf("create or replace function public.auto_note_deal()"));
    expect(contact).toMatch(/delete from public\.auto_marks m\s+where m\.entity_id = new\.id and m\.expires_at > now\(\)/);
    const activity = code.slice(code.indexOf("create or replace function public.auto_note_activity()"));
    expect(activity).toContain("new.type not in ('call', 'email', 'meeting')");
    expect(activity).toContain("coalesce(new.metadata ->> 'automation', '') = 'true'");
    expect(activity).toContain("new.contact_id is null");
  });

  it("every table and column the store writes is in this file", () => {
    const store = read("api/_automation/supabaseStore.ts");
    for (const t of TABLES) expect(store, t).toContain(`"${t}"`);
    // The auto_ rows the store inserts: every key it writes is a column here.
    const written = [...store.matchAll(/sb\s*\.from\("(auto_\w+)"\)\s*\.insert\((\{[^}]*\}|row)/g)];
    expect(written.length).toBeGreaterThanOrEqual(6);
    const rows = [...store.matchAll(/const row = \{([^}]*)\};\s+(?:const made = await|return \w+\(must\(await) sb\.from\("(auto_\w+)"\)/g)];
    expect(rows.map((m) => m[2]).sort()).toEqual(["auto_agents", "auto_agents", "auto_approvals", "auto_automations", "auto_rules", "auto_run_steps", "auto_runs"]);
    for (const [, body, table] of rows) {
      const from = flat.indexOf(`create table if not exists public.${table} (`);
      const definition = flat.slice(from, flat.indexOf(");", from));
      for (const [, column] of body.matchAll(/(\w+):/g)) expect(definition, `${table}.${column}`).toMatch(new RegExp(`[ (]${column} `));
    }
    for (const column of ["workspace_id", "run_id", "agent_id", "user_id", "feature", "model", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "web_searches", "cost_micro_usd"]) {
      expect(store, column).toContain(`${column}: u.`);
      expect(flat, column).toMatch(new RegExp(`create table if not exists public\\.auto_usage \\([^;]*\\b${column} `));
    }
    for (const column of ["entity_id", "expires_at", "locked_until", "nudged_at", "budget_notified_month", "processed_at", "step_n", "waiting_on", "wake_at", "reply_seen_at"]) expect(flat, column).toMatch(new RegExp(`\\b${column} `));
  });

  it("sums the AI spend in the database, for the service role only", () => {
    expect(flat).toContain("create or replace function public.auto_spent_micro_usd(p_workspace uuid, p_since timestamptz, p_run uuid default null) returns bigint");
    expect(code).toContain("revoke all on function public.auto_spent_micro_usd(uuid, timestamptz, uuid) from public, anon, authenticated;");
    expect(code).toContain("grant execute on function public.auto_spent_micro_usd(uuid, timestamptz, uuid) to service_role;");
    expect(read("api/_automation/supabaseStore.ts")).toContain('sb.rpc("auto_spent_micro_usd", { p_workspace: workspaceId, p_since: since, p_run: runId })');
  });

  it("a workspace has each starting agent once and no two automations of one name", () => {
    expect(flat).toContain("create unique index if not exists auto_agents_one_per_kind on public.auto_agents (workspace_id, kind) where kind <> 'custom';");
    expect(flat).toContain("create unique index if not exists auto_automations_name on public.auto_automations (workspace_id, lower(name));");
  });
});

describe("which file the server names when the database is behind", () => {
  it("names 187 for its own tables, in either wording Supabase uses, and nothing for any other error", () => {
    for (const message of [
      "Could not find the table 'public.auto_rules' in the schema cache",
      'relation "public.auto_runs" does not exist',
      "Could not find the 'locked_until' column of 'auto_runs' in the schema cache",
      'relation "public.auto_events" does not exist',
    ])
      expect(setupSentence(message), message).toBe(TABLES_MISSING_MESSAGE);
    expect(TABLES_MISSING_MESSAGE).toBe("Automation is not set up yet: run supabase/migrations/187_automation.sql in the Supabase SQL editor.");
    for (const message of ["connection reset", "duplicate key value violates unique constraint", 'relation "public.crm_deals" does not exist', 'relation "public.sr_workspaces" does not exist', ""])
      expect(setupSentence(message), message).toBeNull();
  });
});
