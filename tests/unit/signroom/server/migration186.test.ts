// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MORE_MISSING_MESSAGE, setupSentence, TABLES_MISSING_MESSAGE } from "../../../../api/_signroom/setupMessages";

/**
 * supabase/migrations/186_signroom_more.sql, read as text (the owner runs it by
 * hand, after 184): what it adds, that it can be run twice, that the browser
 * gets no access, and that the server names the right file while it is not run.
 */
const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const raw = read("supabase/migrations/186_signroom_more.sql");
const code = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = code.replace(/\s+/g, " ");
const first = read("supabase/migrations/184_signroom.sql");

const TABLES = ["sr_projects", "sr_ai_usage", "sr_mailboxes", "sr_email_oauth", "sr_email_oauth_states"];

describe("migration 186", () => {
  it("says in plain words what it adds and that it is run after 184", () => {
    const head = raw.slice(0, raw.indexOf("create table")).toLowerCase().replace(/--/g, " ").replace(/\s+/g, " ");
    expect(head).toContain("run this after 184_signroom.sql");
    expect(head).toContain("safe to run more than once");
    for (const word of ["billing plan", "draft with ai", "renamed and deleted", "own smtp mailbox", "google or", "encrypted by the server", "no policy"]) expect(head, word).toContain(word);
    expect(head).not.toMatch(/securovix/);
  });

  it("creates exactly its five tables, each only if missing, and none that 184 already made", () => {
    const created = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/create table (?!if not exists)/);
    for (const t of TABLES) expect(first, t).not.toContain(`public.${t} `);
  });

  it("can be run twice", () => {
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(code).not.toMatch(/add column (?!if not exists)/i);
    expect(code).not.toMatch(/create trigger/i);
    expect(flat.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("only adds: nothing is dropped, and nothing of 184 is touched but the template rule and the one new invoice column", () => {
    for (const bad of ["drop table", "drop column", "drop trigger", "drop function", "truncate", "delete from", "update public", "create policy", "disable row level security", "create extension", "insert into"])
      expect(flat.toLowerCase(), bad).not.toContain(bad);
    expect([...code.matchAll(/alter table public\.(\w+) add column/g)].map((m) => m[1])).toEqual(["sr_invoices"]);
    expect([...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])).toEqual(["sr_agreement_templates_immutable"]);
  });

  it("turns row level security on for every new table and gives them to the service role only", () => {
    for (const t of TABLES) expect(code, t).toContain(`alter table public.${t} enable row level security;`);
    const names = (s: string) => [...s.matchAll(/public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(names(/revoke all on\s+((?:public\.\w+,?\s*)+)from public, anon, authenticated;/.exec(code)![1])).toEqual([...TABLES].sort());
    expect(names(/grant all on\s+((?:public\.\w+,?\s*)+)to service_role;/.exec(code)![1])).toEqual([...TABLES].sort());
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });

  it("every new table belongs to a Signroom workspace and goes with it", () => {
    for (const t of ["sr_projects", "sr_ai_usage", "sr_email_oauth_states"])
      expect(flat, t).toMatch(new RegExp(`create table if not exists public\\.${t} \\([^;]*workspace_id uuid not null references public\\.sr_workspaces \\(id\\) on delete cascade`));
    for (const t of ["sr_mailboxes", "sr_email_oauth"])
      expect(flat, t).toContain(`create table if not exists public.${t} ( workspace_id uuid primary key references public.sr_workspaces (id) on delete cascade`);
    // As in 184: no foreign key to TaskCalendar's own workspaces table.
    expect(code).not.toMatch(/references public\.workspaces/);
  });

  it("billing plans: the table as the store writes it, and the invoice link with no delete action", () => {
    for (const col of [
      "client_id uuid not null references public.sr_clients (id)",
      "created_by uuid references auth.users (id) on delete set null",
      "name text not null check (char_length(name) between 1 and 160)",
      "billing_type text not null check (billing_type in ('One-off', 'Monthly', 'Custom'))",
      "currency text not null check (currency in ('GBP', 'USD', 'EUR', 'CAD', 'AUD', 'NZD', 'INR', 'AED'))",
      "start_month text not null check (start_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')",
      "status text not null default 'Active' check (status in ('Active', 'On hold', 'Completed'))",
      "monthly_entries jsonb not null default '{}'::jsonb",
      "archived boolean not null default false",
      "revision int not null default 1",
    ])
      expect(flat, col).toContain(col);
    expect(flat).toContain("alter table public.sr_invoices add column if not exists project_id uuid references public.sr_projects (id);");
    // 184's freeze compares every column of an issued invoice, so the link is frozen with it.
    expect(first).toContain("if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then");
    const store = read("api/_signroom/store.ts");
    for (const col of ["workspace_id", "client_id", "created_by", "name", "billing_type", "billing_label", "currency", "monthly_fee_minor", "contract_value_minor", "annual_target_minor", "start_month", "end_month", "status", "notes", "monthly_entries", "archived"]) {
      expect(store, col).toContain(`set("${col}"`);
      expect(flat, col).toMatch(new RegExp(`\\b${col} `));
    }
  });

  it("the usage table has the columns the store inserts", () => {
    for (const col of ["workspace_id", "user_id", "feature", "model", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "created_at"]) {
      expect(flat, col).toMatch(new RegExp(`create table if not exists public\\.sr_ai_usage \\([^;]*\\b${col} `));
    }
    expect(flat).toContain("user_id uuid references auth.users (id) on delete set null");
  });

  it("templates: a delete passes, a rename passes, any other change is still refused", () => {
    const fn = code.slice(code.indexOf("create or replace function public.sr_agreement_templates_immutable()"), code.indexOf("revoke all on function"));
    expect(fn).toMatch(/if tg_op = 'DELETE' then\s+return old;/);
    expect(fn).toContain("if (to_jsonb(new) - 'name') is distinct from (to_jsonb(old) - 'name') then");
    expect(fn).toContain("raise exception 'Only the name of a template can change.'");
    expect(fn).toContain("set search_path = public, pg_temp");
    // The old sentence is how the server tells that 186 has not been run: 186 must not raise it.
    expect(code).not.toContain("Templates cannot change.");
    expect(first).toContain("raise exception 'Templates cannot change.'");
    // 184 made the trigger and never linked agreements to templates by a foreign key.
    expect(first).toContain("create trigger sr_agreement_templates_immutable before update or delete on public.sr_agreement_templates");
    expect(first).toMatch(/\n\s*template_version_id uuid,\n/);
    expect(code).toContain("revoke all on function public.sr_agreement_templates_immutable() from public, anon, authenticated;");
    expect(code).toContain("grant execute on function public.sr_agreement_templates_immutable() to service_role;");
  });

  it("the mailbox and the sign-in tables keep secrets only as ciphertext or digests", () => {
    for (const col of [
      "provider text not null check (provider in ('gmail', 'outlook', 'ionos', 'yahoo', 'zoho', 'godaddy', 'hostinger', 'custom'))",
      "host text not null check (char_length(host) between 1 and 253 and host ~ '^[a-z0-9.-]+$')",
      "port int not null check (port in (465, 587, 2525))",
      "security text not null check (security in ('tls', 'starttls'))",
      "password_enc text not null check (password_enc ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$')",
      "last_error text check (last_error is null or char_length(last_error) <= 300)",
      "secrets_enc text not null check (secrets_enc like 'v1:%')",
      "status text not null default 'configured' check (status in ('configured', 'authenticated', 'verified', 'reconnect'))",
      "tenant text not null default '' check ((provider = 'google' and tenant = '') or (provider = 'microsoft' and tenant ~ '^[A-Za-z0-9.-]{1,100}$'))",
      "challenge_digest text check (challenge_digest ~ '^[0-9a-f]{64}$')",
      "challenge_attempts integer not null default 0 check (challenge_attempts between 0 and 5)",
      "digest text primary key check (digest ~ '^[0-9a-f]{64}$')",
      "browser_digest text not null check (browser_digest ~ '^[0-9a-f]{64}$')",
      "user_id uuid not null references auth.users (id) on delete cascade",
      "verifier_enc text not null check (verifier_enc like 'v1:%')",
      "redirect_uri text not null check (char_length(redirect_uri) <= 300 and (redirect_uri like 'https://%' or redirect_uri like 'http://localhost:%' or redirect_uri like 'http://localhost/%'))",
    ])
      expect(flat, col).toContain(col);
    expect(flat).toContain("create unique index if not exists sr_email_oauth_id on public.sr_email_oauth (id);");
    expect(flat.toLowerCase()).not.toMatch(/\b(password|client_secret|access_token|refresh_token) text/);
  });

  it("every table the mailbox store and the store's new methods use is in this file", () => {
    const sources = read("api/_signroom/store.ts") + read("api/_signroom/mailbox/store.ts");
    expect(read("api/_signroom/mailbox/store.ts")).toContain('MAILBOX_TABLE = "sr_mailboxes"');
    for (const t of TABLES.filter((t) => t !== "sr_mailboxes")) expect(sources, t).toContain(`.from("${t}")`);
  });
});

describe("which file the server names when the database is behind", () => {
  it("names 186 for what 186 adds, in either wording Supabase uses", () => {
    for (const message of [
      "Could not find the table 'public.sr_projects' in the schema cache",
      'relation "public.sr_projects" does not exist',
      "Could not find the table 'public.sr_ai_usage' in the schema cache",
      "Could not find the table 'public.sr_mailboxes' in the schema cache",
      'relation "public.sr_email_oauth" does not exist',
      "Could not find the table 'public.sr_email_oauth_states' in the schema cache",
      "Could not find the 'project_id' column of 'sr_invoices' in the schema cache",
      "column sr_invoices.project_id does not exist",
      "Templates cannot change.",
    ])
      expect(setupSentence(message), message).toBe(MORE_MISSING_MESSAGE);
    expect(MORE_MISSING_MESSAGE).toMatch(/186_signroom_more\.sql/);
    expect(MORE_MISSING_MESSAGE).not.toMatch(/securovix|signroom(?!_more)/i);
  });

  it("keeps naming 184 for 184's own tables and functions, and nothing for any other error", () => {
    for (const message of [
      "Could not find the table 'public.sr_workspaces' in the schema cache",
      'relation "public.sr_invoices" does not exist',
      "Could not find the function public.sr_take_invoice_number(p_workspace, p_year) in the schema cache",
      'relation "public.sr_deliveries" does not exist',
    ])
      expect(setupSentence(message), message).toBe(TABLES_MISSING_MESSAGE);
    for (const message of ["connection reset", "duplicate key value violates unique constraint", "Only the name of a template can change.", 'relation "public.crm_deals" does not exist', ""])
      expect(setupSentence(message), message).toBeNull();
  });
});
