// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * supabase/migrations/191_documents_on_deal_timeline.sql, read as text (the
 * owner runs it by hand): that it can be run twice, that it can never make a
 * signature or a payment fail, and that its words match the documents' own
 * states.
 */
const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const raw = read("supabase/migrations/191_documents_on_deal_timeline.sql");
const code = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = code.replace(/\s+/g, " ");

describe("migration 191", () => {
  it("says in plain words what it adds and that it is safe to repeat", () => {
    const head = raw.slice(0, raw.indexOf("create or replace function")).toLowerCase();
    for (const word of ["safe to run more than once", "deal's timeline", "can never make a signature or a payment fail", "no new table", "stage is not moved for you"]) {
      expect(head.replace(/--/g, " ").replace(/\s+/g, " "), word).toContain(word);
    }
  });

  it("can be run twice, and does nothing where the documents tables are missing", () => {
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/add column/i);
    for (const [trigger, table] of [["trg_sr_agreements_deal_timeline", "sr_agreements"], ["trg_sr_invoices_deal_timeline", "sr_invoices"]]) {
      expect(flat, trigger).toContain(`drop trigger if exists ${trigger} on public.${table}; create trigger ${trigger} after insert or update on public.${table}`);
      expect(flat, table).toContain(`if to_regclass('public.${table}') is not null and to_regclass('public.crm_activities') is not null then`);
    }
  });

  it("can never make the document write fail", () => {
    // Both are AFTER triggers whose whole body sits in one block that swallows every error.
    expect((flat.match(/exception when others then null; end; return null; end;/g) ?? []).length).toBe(2);
    expect((flat.match(/begin begin if new\.crm_deal_id is null then return null; end if;/g) ?? []).length).toBe(2);
    for (const fn of ["sr_note_on_deal(uuid, text, text, uuid)", "sr_agreement_note_on_deal()", "sr_invoice_note_on_deal()"]) {
      expect(flat, fn).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
    }
  });

  it("writes only when the state really changed, for a document that belongs to a deal", () => {
    expect((flat.match(/if tg_op = 'UPDATE' and new\.status is not distinct from old\.status then return null; end if;/g) ?? []).length).toBe(2);
    expect(flat).toContain("if v_org is null or v_workspace is null then return; end if;");
    // One line, on the deal and on its lead and company, marked as the system's own.
    expect(flat).toContain("insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, deal_id, contact_id, company_id, metadata)");
    expect(flat).toContain("'deal_updated', left(p_line, 300), p_deal, v_contact, v_company");
    expect(flat).toContain("jsonb_build_object('automation', 'true', 'source', 'documents'");
  });

  it("uses the states the documents really have", () => {
    const documents = read("supabase/migrations/184_signroom.sql");
    const agreementStates = /status in \('Draft','Awaiting signatures','Finalising','Completed','Declined','Cancelled','Expired'\)/.test(documents);
    const invoiceStates = /status in \('Draft', 'Issued', 'Part paid', 'Paid', 'Voided'\)/.test(documents);
    expect(agreementStates && invoiceStates).toBe(true);
    for (const state of ["'Awaiting signatures'", "'Completed'", "'Declined'", "'Issued'", "'Part paid'", "'Paid'"]) expect(flat, state).toContain(`when ${state} then`);
    for (const text of ["was sent for signature", "was signed by everyone", "was declined", "was issued", "A payment was recorded on invoice", "was paid in full"]) expect(flat, text).toContain(text);
  });

  it("writes a kind of line the timeline already knows, and one the AI agents do not take for a reply", () => {
    // 'deal_updated' is one of the CRM's activity types, and not a call, an email or a meeting.
    expect(read("supabase/migrations/144_crm_hub_schema.sql")).toContain("'deal_updated'");
    expect(read("supabase/migrations/187_automation.sql")).toContain("if new.type not in ('call', 'email', 'meeting') then");
  });
});
