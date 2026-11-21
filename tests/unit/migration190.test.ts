// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * supabase/migrations/190_email_on_lead_timeline.sql, read as text (the owner
 * runs it by hand): that it can be run twice, that it can never make an email
 * fail, and that what it writes is what the lead's timeline and the
 * automation expect.
 */
const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/190_email_on_lead_timeline.sql"), "utf8");
const code = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = code.replace(/\s+/g, " ");

describe("migration 190", () => {
  it("says in plain words what it adds and that it is safe to repeat", () => {
    const head = raw.slice(0, raw.indexOf("create or replace function")).toLowerCase();
    for (const word of ["safe to run more than once", "lead's timeline", "can never make an email fail", "no new table"]) expect(head, word).toContain(word);
  });

  it("can be run twice, and does nothing where the email tables are missing", () => {
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/add column/i);
    expect(flat).toContain("drop trigger if exists trg_email_messages_lead_timeline on public.email_messages; create trigger trg_email_messages_lead_timeline");
    expect(flat).toContain("if to_regclass('public.email_messages') is not null and to_regclass('public.crm_activities') is not null then");
  });

  it("can never make the email write fail", () => {
    // An AFTER trigger whose whole body sits in one block that swallows every error.
    expect(flat).toContain("after insert or update on public.email_messages for each row execute function public.email_note_on_lead()");
    expect(flat).toMatch(/begin begin if new\.contact_id is null then return null; end if;/);
    expect(flat).toMatch(/exception when others then null; end; return null; end;/);
    expect(flat).toContain("security definer set search_path = public, pg_temp");
    expect(flat).toContain("revoke all on function public.email_note_on_lead() from public, anon, authenticated");
  });

  it("writes one line each for sent, replied and bounced, only on the change", () => {
    expect(flat).toContain("v_sent := (v_new ->> 'status') = 'sent' and coalesce(v_old ->> 'status', '') <> 'sent'");
    expect(flat).toContain("v_replied := (v_new ->> 'replied_at') is not null and (v_old ->> 'replied_at') is null");
    expect(flat).toContain("v_bounced := (v_new ->> 'bounced_at') is not null and (v_old ->> 'bounced_at') is null");
    expect((flat.match(/insert into public\.crm_activities/g) ?? []).length).toBe(3);
    for (const text of ["'Sent “' || v_subject || '”'", "'Replied to “' || v_subject || '”'", "'The email “' || v_subject || '” bounced'"]) expect(flat, text).toContain(text);
    // Only for a lead that is in a workspace: the timeline needs one.
    expect(flat).toContain("if v_org is null or v_workspace is null then return null; end if;");
  });

  it("marks what the system sent, so the AI agents only take a real reply as the lead getting in touch", () => {
    const inserts = flat.split("insert into public.crm_activities").slice(1);
    const [sent, replied, bounced] = inserts;
    expect(sent).toContain("jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'out'");
    expect(bounced).toContain("jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'bounce'");
    expect(replied.slice(0, replied.indexOf("update public.crm_contacts"))).not.toContain("'automation'");
    expect(replied).toContain("'direction', 'in'");
    // The mark is the one the automation's own trigger looks for (migration 187).
    const automation = readFileSync(resolve(process.cwd(), "supabase/migrations/187_automation.sql"), "utf8");
    expect(automation).toContain("coalesce(new.metadata ->> 'automation', '') = 'true'");
  });

  it("stamps the last contact on a send and moves a quiet lead to Contacted on a reply", () => {
    expect(flat).toContain("update public.crm_contacts set last_contacted_at = now() where id = new.contact_id");
    expect(flat).toContain("update public.crm_contacts set lead_status = 'connected' where id = new.contact_id and lead_status in ('new', 'open', 'attempted_to_contact')");
  });

  it("keeps merge placeholders out of the timeline line", () => {
    expect(code).toContain("regexp_replace(coalesce(c.subject, ''), '\\{\\{[^}]*\\}\\}', '…', 'g')");
  });
});
