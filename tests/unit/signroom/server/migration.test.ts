// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * supabase/migrations/184_signroom.sql, read as text. The owner runs it by hand
 * in the Supabase SQL editor, so this checks what can be checked without a
 * database: what it creates, that it can be run twice, that the browser gets no
 * access, and that nothing left out of this port crept in.
 */
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/184_signroom.sql"), "utf8");
/** The statements only: comments say what was left out, so they are not searched. */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const TABLES = [
  "sr_workspaces", "sr_clients", "sr_invoices", "sr_payments", "sr_invoice_events", "sr_tokens", "sr_sessions",
  "sr_template_files", "sr_agreements", "sr_agreement_templates", "sr_sign_tokens", "sr_uploads", "sr_sign_sessions",
  "sr_deliveries", "sr_jobs", "sr_evidence_keys", "sr_attempts",
];

/** Every database function and table the store calls, read from the store's own source. */
const store = readFileSync(resolve(process.cwd(), "api/_signroom/store.ts"), "utf8");
const rateLimit = readFileSync(resolve(process.cwd(), "api/_signroom/host/rateLimit.ts"), "utf8");

describe("migration 184", () => {
  it("is the first of the two Signroom migrations (186 adds to it and is run after it)", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations"));
    expect(files.filter((f) => /signroom/i.test(f)).sort()).toEqual(["184_signroom.sql", "186_signroom_more.sql"]);
    const highest = Math.max(...files.map((f) => Number(/^(\d+)_/.exec(f)?.[1] ?? 0)));
    expect(highest).toBeGreaterThanOrEqual(184);
  });

  it("creates exactly the tables this port needs, each only if missing", () => {
    const created = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/create table (?!if not exists)/);
  });

  it("turns row level security on for every table and adds no policy at all", () => {
    for (const t of TABLES) expect(code, t).toContain(`alter table public.${t} enable row level security;`);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/disable row level security/i);
  });

  it("takes every table away from the browser roles and gives it to the service role only", () => {
    const revoke = /revoke all on\s+([\s\S]*?)\s+from public, anon, authenticated;/.exec(code)![1];
    const grant = /grant all on\s+([\s\S]*?)\s+to service_role;/.exec(code)![1];
    const names = (s: string) => [...s.matchAll(/public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(names(revoke)).toEqual([...TABLES].sort());
    expect(names(grant)).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });

  it("can be run twice: functions are replaced, triggers dropped first, indexes and columns guarded", () => {
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(code).not.toMatch(/add column (?!if not exists)/i);
    const triggers = [...code.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    expect(triggers.length).toBeGreaterThanOrEqual(6);
    for (const t of triggers) {
      const drop = code.indexOf(`drop trigger if exists ${t} on`);
      expect(drop, t).toBeGreaterThanOrEqual(0);
      expect(drop, t).toBeLessThan(code.indexOf(`create trigger ${t}`));
    }
    expect(code).toMatch(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/);
  });

  it("keeps every rule that protects records", () => {
    for (const sentence of [
      "An issued invoice cannot be changed.",
      "Payments cannot be deleted.",
      "Payments cannot be changed.",
      "Invoice events cannot be changed or deleted.",
      "Agreements cannot be deleted.",
      "Evidence history is append-only.",
      "Sender-signed document is immutable.",
      "Completed artifacts are immutable.",
      "The final evidence snapshot is immutable.",
      "Sent and finished agreements cannot change.",
      "Templates cannot change.",
      "Evidence keys are never changed or deleted.",
      "The linked deal cannot change.",
    ])
      expect(code, sentence).toContain(`raise exception '${sentence}'`);
    for (const trigger of [
      "sr_invoices_freeze before update on public.sr_invoices",
      "sr_payments_append_only before update or delete on public.sr_payments",
      "sr_invoice_events_append_only before update or delete on public.sr_invoice_events",
      "sr_agreements_guard before update or delete on public.sr_agreements",
      "sr_agreement_templates_immutable before update or delete on public.sr_agreement_templates",
      "sr_evidence_keys_immutable before update or delete on public.sr_evidence_keys",
      "sr_evidence_keys_no_truncate before truncate on public.sr_evidence_keys",
    ])
      expect(code, trigger).toContain(`create trigger ${trigger}`);
  });

  it("the agreements guard accepts the deal at insert and refuses any later change, before the draft exemption", () => {
    const guard = code.slice(code.indexOf("create or replace function public.sr_agreements_guard()"), code.indexOf("drop trigger if exists sr_agreements_guard"));
    const dealCheck = guard.indexOf("The linked deal cannot change.");
    const draftExit = guard.indexOf("if old.status = 'Draft' then");
    expect(dealCheck).toBeGreaterThan(0);
    expect(dealCheck).toBeLessThan(draftExit);
    // The guard runs on update and delete only: an insert is never checked, so the column is accepted there.
    expect(code).toContain("create trigger sr_agreements_guard before update or delete on public.sr_agreements");
    // Neither per-status allow-list names the column.
    for (const list of guard.matchAll(/v_free := array\[([^\]]*)\]/g)) expect(list[1]).not.toContain("crm_deal_id");
    // Only the foreign key's own set-null (one trigger level deeper) is let through.
    expect(guard).toContain("v_deal_removed := pg_trigger_depth() > 1 and old.crm_deal_id is not null and new.crm_deal_id is null;");
    const freeze = code.slice(code.indexOf("create or replace function public.sr_invoices_freeze()"), code.indexOf("drop trigger if exists sr_invoices_freeze"));
    expect(freeze.indexOf("The linked deal cannot change.")).toBeLessThan(freeze.indexOf("if old.status = 'Draft' then"));
  });

  it("ties documents to the CRM and the workspace as the server expects", () => {
    expect(code).toMatch(/create table if not exists public\.sr_workspaces \(\s*id uuid primary key,/);
    expect(code).toMatch(/owner uuid references auth\.users \(id\) on delete set null,/);
    expect(code).not.toMatch(/owner uuid not null unique/);
    expect(code).toContain("crm_company_id uuid references public.crm_companies (id) on delete set null");
    expect(code).toContain("create unique index if not exists sr_clients_workspace_company on public.sr_clients (workspace_id, crm_company_id) where crm_company_id is not null;");
    expect(code.match(/crm_deal_id uuid references public\.crm_deals \(id\) on delete set null/g)!.length).toBeGreaterThanOrEqual(2);
    // No foreign key to TaskCalendar's workspaces: deleting a workspace must not delete signed records.
    expect(code).not.toMatch(/references public\.workspaces/);
  });

  it("names evidence keys for this product and keeps the rate-limit log", () => {
    expect(code).toContain("check (key_id ~ '^taskcalendar-ed25519-v[0-9]+$')");
    expect(code).toMatch(/create table if not exists public\.sr_attempts \(\s*id bigint generated always as identity primary key,\s*tool text not null,\s*key text not null,\s*created_at timestamptz not null default now\(\)\s*\);/);
    expect(rateLimit).toContain('ATTEMPTS_TABLE = "sr_attempts"');
  });

  it("creates the private storage bucket and no storage policy", () => {
    expect(code).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit\)\s*values \('signroom', 'signroom', false, 31457280\)/);
    expect(code).not.toMatch(/storage\.objects/);
  });

  it("defines every database function the store calls, for the service role only", () => {
    const called = [...store.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(
      new Set([
        "sr_set_client_account", "sr_take_invoice_number", "sr_issue_invoice", "sr_record_payment", "sr_claim_jobs",
        "sr_agreements_due", "sr_deletions_due", "sr_finalising_stranded", "sr_completion_mail_refused", "sr_blob_in_use",
      ]),
    );
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    for (const fn of called) expect(defined, fn).toContain(fn);
    for (const fn of defined) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(code, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    // Every function pins its search path.
    expect(code.match(/create or replace function/g)!.length).toBe(code.match(/set search_path = public, pg_temp/g)!.length);
  });

  it("every Signroom table the store reads or writes exists in this migration or in 186", () => {
    const used = new Set([...store.matchAll(/\.from\("(sr_\w+)"\)/g)].map((m) => m[1]));
    // What 186_signroom_more.sql adds (checked in migration186.test.ts).
    const LATER = ["sr_projects", "sr_ai_usage", "sr_email_oauth", "sr_email_oauth_states"];
    for (const t of used) expect([...TABLES, ...LATER], t).toContain(t);
    // TaskCalendar's own tables, read only.
    const foreign = new Set([...store.matchAll(/\.from\("((?!sr_)\w+)"\)/g)].map((m) => m[1]));
    expect(foreign).toEqual(new Set(["workspaces", "organizations", "crm_companies", "crm_contacts", "crm_deals"]));
    for (const t of foreign) expect(store).not.toMatch(new RegExp(`\\.from\\("${t}"\\)\\s*\\.(insert|update|upsert|delete)\\(`));
  });

  it("leaves out everything outside this port", () => {
    for (const gone of [
      "sr_members", "sr_team_invites", "sr_projects", "sr_email_oauth", "acct_", "admin_tool_usage", "admin_stats_totals", "ai_usage",
      "profiles", "pg_cron", "pg_net", "cron.schedule", "vault.", "net.http_post", "tool_attempts", "legacy_id", "project_id",
      "sr_list_members", "sr_remove_member", "sr_accept_team_invite", "sr_members_keep_creator",
    ])
      expect(code, gone).not.toContain(gone);
    expect(code).not.toMatch(/securovix\.com/i);
    expect(code).not.toMatch(/create extension/i);
  });
});
