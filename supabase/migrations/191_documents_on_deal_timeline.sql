-- ============================================================================
-- 191: Agreements and invoices show on the deal's timeline.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor, after
-- the documents migrations (184 and 186). If those have not been run, this
-- file does nothing and can be run again later.
--
-- What it adds, in plain words:
--   * Two triggers, one on agreements (sr_agreements) and one on invoices
--     (sr_invoices). When a document that was made for a deal changes state,
--     one line is written on that deal's timeline, and so on the timeline of
--     the deal's lead and company (crm_activities, type "deal_updated"):
--         Agreement “<title>” was sent for signature
--         Agreement “<title>” was signed by everyone
--         Agreement “<title>” was declined
--         Invoice <number> was issued
--         A payment was recorded on invoice <number>
--         Invoice <number> was paid in full
--   * Nothing else: no new table and no new column, and the deal's stage is
--     not moved for you.
--
-- Until now signing an agreement or paying an invoice left no trace on the
-- deal: someone had to remember to look in two places.
--
-- It can never make a signature or a payment fail: everything each trigger
-- does is inside one block that catches every error. It reads and writes
-- nothing of the document itself, and it only acts for a document that is
-- linked to a deal (crm_deal_id).
-- ============================================================================

-- Writes one line on the deal a document belongs to. Never raises.
create or replace function public.sr_note_on_deal(p_deal uuid, p_line text, p_kind text, p_document uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_workspace uuid;
  v_contact uuid;
  v_company uuid;
begin
  if p_deal is null or p_line is null then
    return;
  end if;
  select d.organization_id, d.workspace_id, d.contact_id, d.company_id
    into v_org, v_workspace, v_contact, v_company
  from public.crm_deals d
  where d.id = p_deal;
  -- A timeline line needs the deal's workspace.
  if v_org is null or v_workspace is null then
    return;
  end if;
  insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, deal_id, contact_id, company_id, metadata)
  values (
    v_org, v_workspace, null, 'deal_updated', left(p_line, 300), p_deal, v_contact, v_company,
    jsonb_build_object('automation', 'true', 'source', 'documents', 'kind', p_kind, 'documentId', p_document::text)
  );
end;
$$;

create or replace function public.sr_agreement_note_on_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_line text;
begin
  begin
    if new.crm_deal_id is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_title := coalesce(nullif(btrim(left(new.title, 160)), ''), 'Untitled');
    v_line := case new.status
      when 'Awaiting signatures' then 'Agreement “' || v_title || '” was sent for signature'
      when 'Completed' then 'Agreement “' || v_title || '” was signed by everyone'
      when 'Declined' then 'Agreement “' || v_title || '” was declined'
      else null
    end;
    if v_line is not null then
      perform public.sr_note_on_deal(new.crm_deal_id, v_line, 'agreement', new.id);
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

create or replace function public.sr_invoice_note_on_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number text;
  v_line text;
begin
  begin
    if new.crm_deal_id is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_number := coalesce(nullif(btrim(left(new.number, 60)), ''), '(no number yet)');
    v_line := case new.status
      when 'Issued' then 'Invoice ' || v_number || ' was issued'
      when 'Part paid' then 'A payment was recorded on invoice ' || v_number
      when 'Paid' then 'Invoice ' || v_number || ' was paid in full'
      else null
    end;
    if v_line is not null then
      perform public.sr_note_on_deal(new.crm_deal_id, v_line, 'invoice', new.id);
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function public.sr_note_on_deal(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.sr_agreement_note_on_deal() from public, anon, authenticated;
revoke all on function public.sr_invoice_note_on_deal() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.sr_agreements') is not null and to_regclass('public.crm_activities') is not null then
    drop trigger if exists trg_sr_agreements_deal_timeline on public.sr_agreements;
    create trigger trg_sr_agreements_deal_timeline
      after insert or update on public.sr_agreements
      for each row execute function public.sr_agreement_note_on_deal();
  end if;
  if to_regclass('public.sr_invoices') is not null and to_regclass('public.crm_activities') is not null then
    drop trigger if exists trg_sr_invoices_deal_timeline on public.sr_invoices;
    create trigger trg_sr_invoices_deal_timeline
      after insert or update on public.sr_invoices
      for each row execute function public.sr_invoice_note_on_deal();
  end if;
end $$;
