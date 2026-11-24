-- ============================================================================
-- CRM set-up: every database file from 188 on, in one file.
--
-- How to use it: open the Supabase SQL editor, paste this whole file, press Run.
-- Every part is safe to run more than once, so running this file again does no
-- harm, also when you have already run some of the parts on their own.
--
-- It is built from the files in supabase/migrations by
-- scripts/build-crm-setup-sql.mjs. Do not edit it by hand.
--
-- What is inside:
--   188_crm_calls.sql
--   189_email_warmup.sql
--   190_email_on_lead_timeline.sql
--   191_documents_on_deal_timeline.sql
--   192_crm_lead_forms.sql
--   193_crm_merge_leads.sql
--   194_crm_follow_up_kinds.sql
--   195_crm_erase_person.sql
--   196_crm_lead_form_sharing.sql
--   197_crm_recycle_bin_and_changes.sql
--   198_crm_own_records_only.sql
--   199_crm_deal_quote.sql
--   200_crm_custom_field_types.sql
--   201_crm_rules.sql
--   202_crm_shared_views.sql
--   203_social_composer.sql
--   204_merge_workspace.sql
--   205_delete_workspace_with_data.sql
--   206_social_campaign_can_be_made.sql
--   207_social_autopilot.sql
--   208_social_autopilot_second_try.sql
--   209_crm_note_history.sql
-- ============================================================================

-- ▼▼▼ 188_crm_calls.sql ▼▼▼

-- ============================================================================
-- 188: Calls placed from the CRM.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the Call window says "run supabase/migrations/188_crm_calls.sql".
--
-- What it adds, in plain words:
--   * One table, crm_calls: one row for every call an owner or admin places
--     from a lead or a company. It keeps who called, which number was rung and
--     from which of your numbers, how the call ended, how long it lasted, the
--     phone provider's ids for the call and its recording, and the caller's
--     own outcome and note.
--   * Nothing is added to the existing CRM tables. A finished call also leaves
--     an ordinary "call" entry on the lead's or company's timeline
--     (crm_activities), written by the server.
--
-- Who can read it: nobody from the browser. The table has row level security
-- on and no policy, so only the server (the service role) reads and writes it.
-- Recordings stay with the phone provider and are fetched by the server for an
-- owner or admin who asks to hear one.
-- ============================================================================

create table if not exists public.crm_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  to_number text not null,
  from_number text not null,
  country text not null check (country in ('US', 'GB')),
  status text not null default 'starting'
    check (status in ('starting', 'ringing', 'completed', 'no_answer', 'busy', 'failed', 'canceled')),
  twilio_call_sid text,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  recording_sid text,
  recording_seconds integer not null default 0 check (recording_seconds >= 0),
  outcome text check (outcome is null or outcome in ('connected', 'no_answer', 'voicemail', 'busy', 'wrong_number')),
  note text not null default '',
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_calls_user_created on public.crm_calls(user_id, created_at desc);
create index if not exists idx_crm_calls_org_created on public.crm_calls(organization_id, created_at desc);
create index if not exists idx_crm_calls_contact on public.crm_calls(contact_id) where contact_id is not null;
create index if not exists idx_crm_calls_company on public.crm_calls(company_id) where company_id is not null;

alter table public.crm_calls enable row level security;

revoke all on public.crm_calls from public, anon, authenticated;
grant all on public.crm_calls to service_role;

-- ▲▲▲ 188_crm_calls.sql ▲▲▲

-- ▼▼▼ 189_email_warmup.sql ▼▼▼

-- ============================================================================
-- 189: Mailbox warm-up through a warm-up service (MailReach).
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then Email, Settings says "run supabase/migrations/189_email_warmup.sql".
--
-- What it adds, in plain words:
--   * One table, email_warmup_keys: one row per organisation, holding that
--     organisation's own API key for the warm-up service. The key is stored
--     encrypted (with the same server key as the mailbox passwords), together
--     with who saved it and when.
--   * Nothing else. Which mailbox is warming, its reputation score and how
--     much of its warm-up mail lands in spam are read from the warm-up service
--     when the page asks; none of it is copied here.
--
-- Who can read it: nobody from the browser. The table has row level security
-- on and no policy, so only the server (the service role) reads and writes it.
-- ============================================================================

create table if not exists public.email_warmup_keys (
  organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
  key_encrypted text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.email_warmup_keys enable row level security;

revoke all on public.email_warmup_keys from public, anon, authenticated;
grant all on public.email_warmup_keys to service_role;

-- ▲▲▲ 189_email_warmup.sql ▲▲▲

-- ▼▼▼ 190_email_on_lead_timeline.sql ▼▼▼

-- ============================================================================
-- 190: Bulk email shows on the lead's timeline.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor, after
-- the email migrations (152 to 168). If those have not been run, this file
-- does nothing and can be run again later.
--
-- What it adds, in plain words:
--   * One trigger on email_messages (the outbox of the Email area). When a
--     campaign or sequence email to a lead is SENT, when the lead REPLIES, or
--     when the email BOUNCES, one line is written on that lead's timeline
--     (crm_activities, type "email"):
--         Sent “<subject>”
--         Replied to “<subject>”
--         The email “<subject>” bounced
--     A sent email also stamps the lead's "last contacted" date. A reply also
--     moves a lead that was still New (or only "attempted") to Contacted.
--   * Nothing else: no new table and no new column.
--
-- Until now the Email area and the CRM kept two separate histories: the lead's
-- page showed nothing of what the lead had been sent, or that it had answered.
--
-- It can never make an email fail: everything the trigger does is inside one
-- block that catches every error, and it only writes when the message belongs
-- to a lead (email_messages.contact_id) that is in a workspace.
--
-- The automation: a "Sent" or "bounced" line is marked as written by the
-- system, so the AI agents do not mistake it for the lead getting in touch. A
-- "Replied" line is not marked, so they do see a real reply.
-- ============================================================================

create or replace function public.email_note_on_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_org uuid;
  v_workspace uuid;
  v_subject text;
  v_sent boolean;
  v_replied boolean;
  v_bounced boolean;
begin
  begin
    if new.contact_id is null then
      return null;
    end if;

    -- Read through jsonb, so a database that has not added the reply and
    -- bounce columns yet (migration 157) still records what was sent.
    v_sent := (v_new ->> 'status') = 'sent' and coalesce(v_old ->> 'status', '') <> 'sent';
    v_replied := (v_new ->> 'replied_at') is not null and (v_old ->> 'replied_at') is null;
    v_bounced := (v_new ->> 'bounced_at') is not null and (v_old ->> 'bounced_at') is null;
    if not (v_sent or v_replied or v_bounced) then
      return null;
    end if;

    select c.organization_id, c.workspace_id into v_org, v_workspace
    from public.crm_contacts c
    where c.id = new.contact_id;
    -- A timeline line needs the lead's workspace.
    if v_org is null or v_workspace is null then
      return null;
    end if;

    select left(regexp_replace(coalesce(c.subject, ''), '\{\{[^}]*\}\}', '…', 'g'), 200) into v_subject
    from public.email_campaigns c
    where c.id = new.campaign_id;
    v_subject := coalesce(nullif(btrim(v_subject), ''), 'an email');

    if v_sent then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'Sent “' || v_subject || '”', new.contact_id,
        jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'out', 'emailMessageId', new.id::text)
      );
      update public.crm_contacts set last_contacted_at = now() where id = new.contact_id;
    end if;

    if v_replied then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'Replied to “' || v_subject || '”', new.contact_id,
        jsonb_build_object('source', 'email', 'direction', 'in', 'emailMessageId', new.id::text)
      );
      update public.crm_contacts
      set lead_status = 'connected'
      where id = new.contact_id and lead_status in ('new', 'open', 'attempted_to_contact');
    end if;

    if v_bounced then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'The email “' || v_subject || '” bounced', new.contact_id,
        jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'bounce', 'emailMessageId', new.id::text)
      );
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function public.email_note_on_lead() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.email_messages') is not null and to_regclass('public.crm_activities') is not null then
    drop trigger if exists trg_email_messages_lead_timeline on public.email_messages;
    create trigger trg_email_messages_lead_timeline
      after insert or update on public.email_messages
      for each row execute function public.email_note_on_lead();
  end if;
end $$;

-- ▲▲▲ 190_email_on_lead_timeline.sql ▲▲▲

-- ▼▼▼ 191_documents_on_deal_timeline.sql ▼▼▼

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

-- ▲▲▲ 191_documents_on_deal_timeline.sql ▲▲▲

-- ▼▼▼ 192_crm_lead_forms.sql ▼▼▼

-- ============================================================================
-- 192: Web forms that create leads.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the "Web form" window on the Leads page says
-- "run supabase/migrations/192_crm_lead_forms.sql".
--
-- What it adds, in plain words:
--   * crm_lead_forms: one row per form a workspace has made. It keeps the
--     form's name, whether it is switched on, which extra questions it asks
--     (phone, company, message), its wording (heading, introduction, button,
--     thank-you sentence), the source written on the leads it creates, and who
--     those leads are given to.
--   * crm_lead_form_submissions: one row each time somebody sends a form: which
--     form, when, the lead it became, and a one-way fingerprint of the sender's
--     network address. It is the form's history and what the spam limit counts.
--     The address itself is never stored.
--   * Nothing is added to the existing CRM tables. A lead from a form is an
--     ordinary lead.
--
-- Who can read what:
--   * crm_lead_forms follows the CRM's own rule: people who can use the CRM of
--     that workspace can read its forms, and everyone but viewers can change
--     them.
--   * crm_lead_form_submissions has row level security on and no policy: only
--     the server (the service role) reads and writes it.
--   * The public never reads either table. A visitor's browser talks to the
--     server only, which hands out a form's wording and nothing else.
-- ============================================================================

create table if not exists public.crm_lead_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  enabled boolean not null default true,
  ask_phone boolean not null default true,
  ask_company boolean not null default true,
  ask_message boolean not null default true,
  heading text not null default '' check (char_length(heading) <= 160),
  intro text not null default '' check (char_length(intro) <= 600),
  button_label text not null default 'Send' check (char_length(button_label) between 1 and 40),
  thank_you text not null default 'Thank you. We will be in touch soon.' check (char_length(thank_you) between 1 and 400),
  source text not null default 'Website form' check (char_length(source) between 1 and 80),
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_lead_forms_workspace on public.crm_lead_forms(workspace_id, created_at desc);

create table if not exists public.crm_lead_form_submissions (
  id bigint generated always as identity primary key,
  form_id uuid not null references public.crm_lead_forms(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  sender_hash text not null,
  -- 'lead' a new lead was added; 'again' the email already belonged to a lead; 'refused' it was not accepted
  result text not null default 'lead' check (result in ('lead', 'again', 'refused')),
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_lead_form_submissions_form on public.crm_lead_form_submissions(form_id, created_at desc);
create index if not exists idx_crm_lead_form_submissions_sender on public.crm_lead_form_submissions(sender_hash, created_at desc);

alter table public.crm_lead_forms enable row level security;
alter table public.crm_lead_form_submissions enable row level security;

grant select, insert, update, delete on public.crm_lead_forms to authenticated;
grant all on public.crm_lead_forms to service_role;
revoke all on public.crm_lead_forms from public, anon;

revoke all on public.crm_lead_form_submissions from public, anon, authenticated;
grant all on public.crm_lead_form_submissions to service_role;

drop policy if exists "crm_lead_forms_workspace_select" on public.crm_lead_forms;
create policy "crm_lead_forms_workspace_select" on public.crm_lead_forms
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_lead_forms_workspace_write" on public.crm_lead_forms;
create policy "crm_lead_forms_workspace_write" on public.crm_lead_forms
  for all to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

-- ▲▲▲ 192_crm_lead_forms.sql ▲▲▲

-- ▼▼▼ 193_crm_merge_leads.sql ▼▼▼

-- ============================================================================
-- 193: Merging two leads that are the same person.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then "Merge" in the Duplicates window says
-- "run supabase/migrations/193_crm_merge_leads.sql".
--
-- What it adds, in plain words:
--   * One function, crm_merge_contacts(keep, drop). It makes one lead out of
--     two: everything that belonged to the lead being dropped (its deals,
--     follow-ups, notes, timeline, calls, emails, tags, automation runs and
--     anything else that points at a lead) is moved to the lead being kept,
--     the kept lead's empty fields are filled from the other one, one line
--     "Merged with ..." is written on its timeline, and the other lead is
--     deleted. It all happens together or not at all.
--   * No new table and no new column.
--
-- Who may use it: a person who can change that workspace's CRM (the same rule
-- as editing a lead; viewers cannot). Both leads must be in the same
-- workspace.
--
-- It finds the tables to move by asking the database which ones point at a
-- lead, so tables added later (calls, emails, web forms) are covered without
-- changing this file.
-- ============================================================================

create or replace function public.crm_merge_contacts(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.crm_contacts%rowtype;
  d public.crm_contacts%rowtype;
  r record;
  v_name text;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different leads to merge.' using errcode = '22023';
  end if;

  -- Locked in id order, so two people merging the same pair the other way round cannot block each other for ever.
  perform 1 from public.crm_contacts where id in (p_keep, p_drop) order by id for update;
  select * into k from public.crm_contacts where id = p_keep;
  select * into d from public.crm_contacts where id = p_drop;
  if k.id is null or d.id is null then
    raise exception 'One of the leads no longer exists.' using errcode = 'P0002';
  end if;
  if k.organization_id <> d.organization_id or k.workspace_id is distinct from d.workspace_id then
    raise exception 'Both leads must be in the same workspace.' using errcode = '22023';
  end if;
  if not public.can_access_crm_scope(k.organization_id, k.workspace_id) or public.is_org_viewer(k.organization_id) then
    raise exception 'You may not change leads in this workspace.' using errcode = '42501';
  end if;

  -- The tags of both, without doubles.
  insert into public.crm_contact_tags (contact_id, tag_id)
  select p_keep, t.tag_id from public.crm_contact_tags t where t.contact_id = p_drop
  on conflict do nothing;
  delete from public.crm_contact_tags where contact_id = p_drop;

  -- Everything else that points at the lead being dropped now points at the one kept.
  for r in
    select c.relname as table_name, a.attname as column_name
    from pg_constraint f
    join pg_class c on c.oid = f.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = f.conrelid and a.attnum = f.conkey[1]
    where f.contype = 'f'
      and f.confrelid = 'public.crm_contacts'::regclass
      and array_length(f.conkey, 1) = 1
      and n.nspname = 'public'
      and c.relname <> 'crm_contact_tags'
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
        using p_keep, p_drop;
    exception
      -- The kept lead already has the same row there (one row per lead is allowed): the other one goes with the dropped lead.
      when unique_violation then
        null;
    end;
  end loop;

  -- What the kept lead does not know yet, it learns from the other one. What it knows, it keeps.
  update public.crm_contacts set
    last_name = coalesce(nullif(btrim(last_name), ''), d.last_name),
    email = coalesce(nullif(btrim(email), ''), d.email),
    phone = coalesce(nullif(btrim(phone), ''), d.phone),
    job_title = coalesce(nullif(btrim(job_title), ''), d.job_title),
    company_id = coalesce(company_id, d.company_id),
    owner_id = coalesce(owner_id, d.owner_id),
    source = coalesce(nullif(btrim(source), ''), d.source),
    notes = case
      when nullif(btrim(coalesce(d.notes, '')), '') is null then notes
      when nullif(btrim(coalesce(notes, '')), '') is null then d.notes
      when notes = d.notes then notes
      else notes || E'\n\n' || d.notes
    end,
    last_contacted_at = greatest(last_contacted_at, d.last_contacted_at)
  where id = p_keep;

  -- Columns that later migrations added: only where this database has them.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_contacts' and column_name = 'custom_fields') then
    execute 'update public.crm_contacts k set custom_fields = coalesce(o.custom_fields, ''{}''::jsonb) || coalesce(k.custom_fields, ''{}''::jsonb) from public.crm_contacts o where k.id = $1 and o.id = $2'
      using p_keep, p_drop;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_contacts' and column_name = 'category') then
    execute 'update public.crm_contacts k set category = coalesce(nullif(btrim(k.category), ''''), o.category) from public.crm_contacts o where k.id = $1 and o.id = $2'
      using p_keep, p_drop;
  end if;

  v_name := btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''));
  insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
  values (
    k.organization_id, k.workspace_id, auth.uid(), 'note',
    'Merged with ' || coalesce(nullif(v_name, ''), 'another lead') || coalesce(' (' || nullif(btrim(d.email), '') || ')', '') || '. Its deals, follow-ups and history are now here.',
    p_keep,
    jsonb_build_object('automation', 'true', 'source', 'merge', 'mergedContactId', p_drop::text)
  );

  delete from public.crm_contacts where id = p_drop;
end;
$$;

revoke all on function public.crm_merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_contacts(uuid, uuid) to authenticated, service_role;

-- ▲▲▲ 193_crm_merge_leads.sql ▲▲▲

-- ▼▼▼ 194_crm_follow_up_kinds.sql ▼▼▼

-- Follow-ups: what kind of thing each one is (to-do, call, email, meeting), and
-- follow-ups that repeat (every day, week or month).
--
-- Only two columns are added to public.crm_tasks. Follow-ups that exist already
-- become plain to-dos that do not repeat, which is what they were.
--
-- Safe to run more than once.

alter table public.crm_tasks add column if not exists kind text not null default 'todo';
alter table public.crm_tasks add column if not exists repeat_every text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_kind_check') then
    alter table public.crm_tasks
      add constraint crm_tasks_kind_check check (kind in ('todo', 'call', 'email', 'meeting'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_repeat_every_check') then
    alter table public.crm_tasks
      add constraint crm_tasks_repeat_every_check
      check (repeat_every is null or repeat_every in ('daily', 'weekly', 'monthly'));
  end if;
end $$;

comment on column public.crm_tasks.kind is 'What the follow-up is: todo, call, email or meeting.';
comment on column public.crm_tasks.repeat_every is 'daily, weekly or monthly: when it is completed the next one is made. Null = does not repeat.';

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 194_crm_follow_up_kinds.sql ▲▲▲

-- ▼▼▼ 195_crm_erase_person.sql ▼▼▼

-- Privacy: erasing one person.
--
-- When somebody asks for their data to be removed, deleting the lead is not
-- enough: the emails sent to them, the replies and bounces seen from them,
-- their follow-ups and their calls stay behind with their address or number.
-- public.crm_erase_person(lead) removes all of it in one step, or nothing.
--
-- What it removes
--   * the lead itself, and with it the notes, timeline, tags and automation
--     history that belong to it (the database removes those with the lead);
--   * the follow-ups about the lead;
--   * every email sent to the lead or to the same address in the organisation,
--     the record of replies and bounces from that address, and the lead's place
--     in any sequence;
--   * the calls made to the lead.
--
-- What it keeps
--   * deals, agreements and invoices: they are business records. They only lose
--     their link to the lead;
--   * the email address on the do-not-email list (it is added when not there),
--     so the person is never emailed again by a later import or campaign.
--
-- Who may run it: the organisation's owner only.
--
-- Call recordings live at the phone provider, where the database cannot reach.
-- The app deletes them first (DELETE /api/voice/contacts/<id>/calls). If a
-- recording is still on record here, this function stops and changes nothing.
--
-- Safe to run more than once.

create or replace function public.crm_erase_person(p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c public.crm_contacts%rowtype;
  v_email text;
  n integer;
  v_done jsonb := '{}'::jsonb;
begin
  if p_contact is null then
    raise exception 'Choose a lead.' using errcode = '22023';
  end if;

  select * into c from public.crm_contacts where id = p_contact for update;
  if not found then
    raise exception 'This lead was not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.organizations o
    where o.organization_id = c.organization_id and o.owner_id = auth.uid()
  ) then
    raise exception 'Only the owner can erase a person.' using errcode = '42501';
  end if;

  v_email := nullif(lower(btrim(coalesce(c.email, ''))), '');

  -- Nothing of this person goes to the recycle bin (migration 197): erased means no copy is kept.
  perform set_config('crm.skip_trash', 'on', true);

  -- Calls. Tables from later migrations are touched only where they exist.
  if to_regclass('public.crm_calls') is not null then
    execute 'select count(*) from public.crm_calls where contact_id = $1 and recording_sid is not null' into n using p_contact;
    if n > 0 then
      raise exception 'This person still has call recordings. Delete the recordings first, then erase the person.' using errcode = '23503';
    end if;
    execute 'delete from public.crm_calls where contact_id = $1' using p_contact;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('calls', n);
  end if;

  delete from public.crm_tasks where contact_id = p_contact;
  get diagnostics n = row_count;
  v_done := v_done || jsonb_build_object('followUps', n);

  if to_regclass('public.email_sequence_enrollments') is not null then
    execute 'delete from public.email_sequence_enrollments where contact_id = $1 or (organization_id = $2 and $3::text is not null and lower(to_email) = $3)'
      using p_contact, c.organization_id, v_email;
  end if;

  if to_regclass('public.email_messages') is not null then
    execute 'delete from public.email_messages where contact_id = $1 or (organization_id = $2 and $3::text is not null and lower(to_email) = $3)'
      using p_contact, c.organization_id, v_email;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('emails', n);
  end if;

  if v_email is not null and to_regclass('public.email_inbox_events') is not null then
    execute 'delete from public.email_inbox_events where organization_id = $1 and lower(address) = $2' using c.organization_id, v_email;
  end if;

  -- Kept on purpose: the address alone, so nothing is ever sent to it again.
  if v_email is not null and to_regclass('public.email_suppressions') is not null then
    execute 'insert into public.email_suppressions (organization_id, email, reason) values ($1, $2, ''manual'') on conflict (organization_id, email) do nothing'
      using c.organization_id, v_email;
  end if;

  -- The change log and the recycle bin (migration 197) hold this person's details too.
  if to_regclass('public.crm_changes') is not null then
    execute 'delete from public.crm_changes where record_id = $1' using p_contact;
  end if;
  if to_regclass('public.crm_trash') is not null then
    execute 'delete from public.crm_trash where record_id = $1' using p_contact;
  end if;

  -- Last: the lead. Its notes, timeline, tags and automation history go with it.
  delete from public.crm_contacts where id = p_contact;

  return v_done || jsonb_build_object('keptOnDoNotEmailList', v_email is not null);
end;
$$;

revoke all on function public.crm_erase_person(uuid) from public, anon;
grant execute on function public.crm_erase_person(uuid) to authenticated, service_role;

comment on function public.crm_erase_person(uuid) is
  'Erases one person: the lead, its follow-ups, emails, replies, sequence places and calls. Owner only. Keeps deals and the address on the do-not-email list.';

-- Tell the API about the new function straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 195_crm_erase_person.sql ▲▲▲

-- ▼▼▼ 196_crm_lead_form_sharing.sql ▼▼▼

-- Web forms: share the leads between several people, in turn.
--
-- A form gave every lead to one owner, or to nobody. It can now list several
-- people: the first lead goes to the first of them, the next lead to the next,
-- and round again. A person who has left the organisation is passed over.
--
-- Only two columns are added to public.crm_lead_forms. Forms that exist already
-- keep giving their leads to their one owner, as before.
--
-- Safe to run more than once.

alter table public.crm_lead_forms add column if not exists share_with uuid[] not null default '{}';
alter table public.crm_lead_forms add column if not exists share_next integer not null default 0;

comment on column public.crm_lead_forms.share_with is 'The people who take this form''s leads in turn. Empty = every lead goes to owner_id.';
comment on column public.crm_lead_forms.share_next is 'How many leads have been shared out, which says whose turn is next.';

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 196_crm_lead_form_sharing.sql ▲▲▲

-- ▼▼▼ 197_crm_recycle_bin_and_changes.sql ▼▼▼

-- CRM: a recycle bin and a change log.
--
-- 1. Recycle bin. A deleted lead, company or deal was gone for good, with its
--    notes and timeline. A copy is now kept for 30 days in public.crm_trash,
--    with the notes, timeline entries and tags that went with it, and
--    public.crm_restore(id) puts it all back.
--
-- 2. Change log. Nothing recorded who changed what. Every change to a lead, a
--    company or a deal now writes one row in public.crm_changes: which fields,
--    from what, to what, by whom. Kept for 180 days.
--
-- Both are read by the organisation's owner and admins only. Neither can stop
-- a delete or a change: if keeping the copy or the log line fails, the delete
-- or the change still happens.
--
-- An erased person (public.crm_erase_person, migration 195) is never kept:
-- that function says so and the bin steps aside.
--
-- Safe to run more than once.

-- ── 1. Recycle bin ──────────────────────────────────────────────────────────

-- No foreign key to the organisation on purpose: when a whole organisation is
-- deleted its leads go with it, and a copy pointing at a row that is being
-- removed would stop that delete.
create table if not exists public.crm_trash (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('lead', 'company', 'deal')),
  record_id uuid not null,
  name text not null default '',
  record jsonb not null,
  children jsonb not null default '{}'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_crm_trash_org on public.crm_trash (organization_id, deleted_at desc);
create index if not exists idx_crm_trash_age on public.crm_trash (deleted_at);

alter table public.crm_trash enable row level security;
revoke all on public.crm_trash from anon, authenticated;
grant select on public.crm_trash to authenticated;
grant all on public.crm_trash to service_role;

drop policy if exists "crm_trash_read" on public.crm_trash;
create policy "crm_trash_read" on public.crm_trash
  for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.crm_keep_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j jsonb := to_jsonb(old);
  v_kind text;
  v_column text;
  v_children jsonb := '{}'::jsonb;
begin
  begin
    -- An erased person leaves no copy behind.
    if current_setting('crm.skip_trash', true) = 'on' then
      return old;
    end if;
    -- The organisation itself is being deleted: there is nobody to keep it for.
    if not exists (select 1 from public.organizations o where o.organization_id = (j->>'organization_id')::uuid) then
      return old;
    end if;

    if tg_table_name = 'crm_contacts' then
      v_kind := 'lead';
      v_column := 'contact_id';
    elsif tg_table_name = 'crm_companies' then
      v_kind := 'company';
      v_column := 'company_id';
    else
      v_kind := 'deal';
      v_column := 'deal_id';
    end if;

    -- What the database removes together with it, so it can come back too.
    execute format(
      'select jsonb_build_object(
         ''activities'', coalesce((select jsonb_agg(to_jsonb(a)) from public.crm_activities a where a.%1$I = $1), ''[]''::jsonb),
         ''notes'', coalesce((select jsonb_agg(to_jsonb(n)) from public.crm_notes n where n.%1$I = $1), ''[]''::jsonb))',
      v_column)
      into v_children using (j->>'id')::uuid;
    if v_kind = 'lead' then
      v_children := v_children || jsonb_build_object(
        'tags', coalesce((select jsonb_agg(to_jsonb(t)) from public.crm_contact_tags t where t.contact_id = (j->>'id')::uuid), '[]'::jsonb));
    end if;

    insert into public.crm_trash (organization_id, workspace_id, kind, record_id, name, record, children, deleted_by)
    values (
      (j->>'organization_id')::uuid,
      (j->>'workspace_id')::uuid,
      v_kind,
      (j->>'id')::uuid,
      coalesce(
        nullif(btrim(coalesce(j->>'first_name', '') || ' ' || coalesce(j->>'last_name', '')), ''),
        nullif(btrim(coalesce(j->>'name', '')), ''),
        'No name'),
      j,
      v_children,
      auth.uid());

    delete from public.crm_trash where deleted_at < now() - interval '30 days';
  exception when others then
    -- Keeping a copy must never be the reason a delete fails.
    null;
  end;
  return old;
end;
$$;

revoke all on function public.crm_keep_deleted() from public, anon, authenticated;

drop trigger if exists trg_crm_contacts_keep_deleted on public.crm_contacts;
create trigger trg_crm_contacts_keep_deleted
  before delete on public.crm_contacts
  for each row execute function public.crm_keep_deleted();

drop trigger if exists trg_crm_companies_keep_deleted on public.crm_companies;
create trigger trg_crm_companies_keep_deleted
  before delete on public.crm_companies
  for each row execute function public.crm_keep_deleted();

drop trigger if exists trg_crm_deals_keep_deleted on public.crm_deals;
create trigger trg_crm_deals_keep_deleted
  before delete on public.crm_deals
  for each row execute function public.crm_keep_deleted();

-- Puts one thing from the bin back, with its notes, timeline and tags.
-- Returns the id of the restored lead, company or deal.
create or replace function public.crm_restore(p_trash uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t public.crm_trash%rowtype;
  r jsonb;
  v_stage uuid;
  child jsonb;
begin
  if p_trash is null then
    raise exception 'Choose what to restore.' using errcode = '22023';
  end if;

  select * into t from public.crm_trash where id = p_trash for update;
  if not found then
    raise exception 'This is no longer in the recycle bin.' using errcode = 'P0002';
  end if;
  if not public.is_org_admin_or_owner(t.organization_id) then
    raise exception 'Only the owner and admins can restore.' using errcode = '42501';
  end if;

  r := t.record;

  -- What it was linked to may have been deleted since. Those links are dropped; the record still comes back.
  if r->>'workspace_id' is not null and not exists (select 1 from public.workspaces w where w.workspace_id = (r->>'workspace_id')::uuid) then
    raise exception 'The workspace this belonged to was deleted, so it cannot be restored.' using errcode = '23503';
  end if;
  if r->>'company_id' is not null and not exists (select 1 from public.crm_companies x where x.id = (r->>'company_id')::uuid) then
    r := r || jsonb_build_object('company_id', null);
  end if;
  if r->>'contact_id' is not null and not exists (select 1 from public.crm_contacts x where x.id = (r->>'contact_id')::uuid) then
    r := r || jsonb_build_object('contact_id', null);
  end if;
  if r->>'owner_id' is not null and not exists (select 1 from auth.users u where u.id = (r->>'owner_id')::uuid) then
    r := r || jsonb_build_object('owner_id', null);
  end if;
  if r->>'project_id' is not null and not exists (select 1 from public.projects p where p.project_id = (r->>'project_id')::uuid) then
    r := r || jsonb_build_object('project_id', null);
  end if;
  if t.kind = 'deal' and not exists (select 1 from public.crm_deal_stages s where s.id = (r->>'stage_id')::uuid) then
    -- Its stage was deleted: it comes back in the first stage of its pipeline.
    select s.id into v_stage
      from public.crm_deal_stages s
     where s.organization_id = t.organization_id and s.workspace_id is not distinct from t.workspace_id
     order by s.sort_order
     limit 1;
    if v_stage is null then
      raise exception 'Add a pipeline stage first, then restore this deal.' using errcode = '23503';
    end if;
    r := r || jsonb_build_object('stage_id', v_stage);
  end if;

  begin
    if t.kind = 'lead' then
      insert into public.crm_contacts select * from jsonb_populate_record(null::public.crm_contacts, r);
    elsif t.kind = 'company' then
      insert into public.crm_companies select * from jsonb_populate_record(null::public.crm_companies, r);
    else
      insert into public.crm_deals select * from jsonb_populate_record(null::public.crm_deals, r);
    end if;
  exception
    when unique_violation then
      raise exception 'This is already back in the CRM.' using errcode = '23505';
    when foreign_key_violation then
      raise exception 'It cannot be restored because something it was linked to was deleted too.' using errcode = '23503';
    when not_null_violation then
      raise exception 'It cannot be restored: the CRM has changed since it was deleted.' using errcode = '23502';
  end;

  -- Its timeline, notes and tags, one at a time: one that no longer fits is left out, the rest come back.
  for child in select * from jsonb_array_elements(coalesce(t.children->'activities', '[]'::jsonb)) loop
    begin
      insert into public.crm_activities select * from jsonb_populate_record(null::public.crm_activities, child) on conflict (id) do nothing;
    exception when others then
      null;
    end;
  end loop;
  for child in select * from jsonb_array_elements(coalesce(t.children->'notes', '[]'::jsonb)) loop
    begin
      insert into public.crm_notes select * from jsonb_populate_record(null::public.crm_notes, child) on conflict (id) do nothing;
    exception when others then
      null;
    end;
  end loop;
  for child in select * from jsonb_array_elements(coalesce(t.children->'tags', '[]'::jsonb)) loop
    begin
      insert into public.crm_contact_tags select * from jsonb_populate_record(null::public.crm_contact_tags, child) on conflict do nothing;
    exception when others then
      null;
    end;
  end loop;

  -- Putting old things back is not news: the automation must not treat a restored
  -- lead as a new one, or an old call as a fresh reply. Everything this step
  -- wrote for the automation is marked as already dealt with.
  begin
    if to_regclass('public.auto_events') is not null then
      execute 'update public.auto_events set own = true, processed_at = now()
                where processed_at is null and created_at = now() and workspace_id is not distinct from $1'
        using t.workspace_id;
    end if;
  exception when others then
    null;
  end;

  delete from public.crm_trash where id = p_trash;
  return t.record_id;
end;
$$;

revoke all on function public.crm_restore(uuid) from public, anon;
grant execute on function public.crm_restore(uuid) to authenticated, service_role;

-- ── 2. Change log ───────────────────────────────────────────────────────────

create table if not exists public.crm_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('lead', 'company', 'deal')),
  record_id uuid not null,
  name text not null default '',
  changes jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_crm_changes_org on public.crm_changes (organization_id, changed_at desc);
create index if not exists idx_crm_changes_record on public.crm_changes (record_id, changed_at desc);

alter table public.crm_changes enable row level security;
revoke all on public.crm_changes from anon, authenticated;
grant select on public.crm_changes to authenticated;
grant all on public.crm_changes to service_role;

drop policy if exists "crm_changes_read" on public.crm_changes;
create policy "crm_changes_read" on public.crm_changes
  for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.crm_log_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j jsonb := to_jsonb(new);
  v_changes jsonb;
begin
  begin
    -- The fields that are different, without the ones that change by themselves.
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_changes
      from jsonb_each(j) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'last_contacted_at', 'sort_order');
    if v_changes is null then
      return new;
    end if;

    insert into public.crm_changes (organization_id, workspace_id, kind, record_id, name, changes, changed_by)
    values (
      (j->>'organization_id')::uuid,
      (j->>'workspace_id')::uuid,
      case tg_table_name when 'crm_contacts' then 'lead' when 'crm_companies' then 'company' else 'deal' end,
      (j->>'id')::uuid,
      coalesce(
        nullif(btrim(coalesce(j->>'first_name', '') || ' ' || coalesce(j->>'last_name', '')), ''),
        nullif(btrim(coalesce(j->>'name', '')), ''),
        'No name'),
      v_changes,
      auth.uid());

    -- Old lines are cleared now and then, not on every change.
    if random() < 0.01 then
      delete from public.crm_changes where changed_at < now() - interval '180 days';
    end if;
  exception when others then
    -- Writing the log must never be the reason a change fails.
    null;
  end;
  return new;
end;
$$;

revoke all on function public.crm_log_change() from public, anon, authenticated;

drop trigger if exists trg_crm_contacts_log_change on public.crm_contacts;
create trigger trg_crm_contacts_log_change
  after update on public.crm_contacts
  for each row execute function public.crm_log_change();

drop trigger if exists trg_crm_companies_log_change on public.crm_companies;
create trigger trg_crm_companies_log_change
  after update on public.crm_companies
  for each row execute function public.crm_log_change();

drop trigger if exists trg_crm_deals_log_change on public.crm_deals;
create trigger trg_crm_deals_log_change
  after update on public.crm_deals
  for each row execute function public.crm_log_change();

-- Tell the API about the new tables and the function straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 197_crm_recycle_bin_and_changes.sql ▲▲▲

-- ▼▼▼ 198_crm_own_records_only.sql ▼▼▼

-- CRM: "each person sees only their own leads and deals", per workspace.
--
-- Everybody who can open a workspace's CRM saw every lead and deal in it. A
-- workspace can now be switched to "own only": a member then sees the leads
-- and deals they own, the follow-ups given to them, and the timeline of those.
-- The organisation's owner and admins still see everything.
--
-- How it is done: one small table holds the switch, and one extra rule on each
-- of four tables narrows what is shown. The rules are RESTRICTIVE: they can
-- only hide rows, never show a row the existing rules do not already allow.
-- While the switch is off (the default) they hide nothing.
--
-- Not covered: companies stay visible to everybody in the workspace, and the
-- server (web forms, automation, email) is not affected.
--
-- Safe to run more than once.

create table if not exists public.crm_visibility (
  workspace_id uuid primary key references public.workspaces (workspace_id) on delete cascade,
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  own_only boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.crm_visibility enable row level security;
revoke all on public.crm_visibility from anon, authenticated;
grant select, insert, update on public.crm_visibility to authenticated;
grant all on public.crm_visibility to service_role;

drop policy if exists "crm_visibility_read" on public.crm_visibility;
create policy "crm_visibility_read" on public.crm_visibility
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "crm_visibility_insert" on public.crm_visibility;
create policy "crm_visibility_insert" on public.crm_visibility
  for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "crm_visibility_update" on public.crm_visibility;
create policy "crm_visibility_update" on public.crm_visibility
  for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- True when the person asking may see every lead and deal of the workspace:
-- the switch is off, or they are the owner or an admin.
create or replace function public.crm_sees_all(p_org uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select v.own_only from public.crm_visibility v where v.workspace_id = p_workspace), false)
      or public.is_org_admin_or_owner(p_org);
$$;

revoke all on function public.crm_sees_all(uuid, uuid) from public, anon;
grant execute on function public.crm_sees_all(uuid, uuid) to authenticated, service_role;

drop policy if exists "crm_contacts_own_only" on public.crm_contacts;
create policy "crm_contacts_own_only" on public.crm_contacts
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or owner_id = auth.uid());

drop policy if exists "crm_deals_own_only" on public.crm_deals;
create policy "crm_deals_own_only" on public.crm_deals
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or owner_id = auth.uid());

drop policy if exists "crm_tasks_own_only" on public.crm_tasks;
create policy "crm_tasks_own_only" on public.crm_tasks
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or assigned_to = auth.uid() or owner_id = auth.uid());

-- A timeline entry is shown to the person who wrote it, and to the owner of the
-- lead or the deal it is about.
drop policy if exists "crm_activities_own_only" on public.crm_activities;
create policy "crm_activities_own_only" on public.crm_activities
  as restrictive for select to authenticated
  using (
    public.crm_sees_all(organization_id, workspace_id)
    or user_id = auth.uid()
    or exists (select 1 from public.crm_contacts c where c.id = crm_activities.contact_id and c.owner_id = auth.uid())
    or exists (select 1 from public.crm_deals d where d.id = crm_activities.deal_id and d.owner_id = auth.uid())
  );

-- Tell the API about the new table and function straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 198_crm_own_records_only.sql ▲▲▲

-- ▼▼▼ 199_crm_deal_quote.sql ▼▼▼

-- Deals: a quote with lines.
--
-- A deal had one number, its value. It can now hold the lines of a quote: what
-- is offered, how many, at what price each. The deal page adds them up, can set
-- the deal value to the total, and opens the quote as a page to print or save
-- as a PDF.
--
-- One column is added to public.crm_deals. Deals that exist already simply have
-- no lines.
--
-- Safe to run more than once.

alter table public.crm_deals add column if not exists line_items jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_deals_line_items_is_list') then
    alter table public.crm_deals
      add constraint crm_deals_line_items_is_list check (jsonb_typeof(line_items) = 'array');
  end if;
end $$;

comment on column public.crm_deals.line_items is 'The lines of the deal''s quote: [{description, quantity, unitPrice}]. Empty = no quote.';

-- Tell the API about the new column straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 199_crm_deal_quote.sql ▲▲▲

-- ▼▼▼ 200_crm_custom_field_types.sql ▼▼▼

-- Leads: custom fields with a type.
--
-- A custom field on a lead was a name and a line of text. A workspace can now
-- say what kind of thing a field is: text, a number, a date, or one of a list
-- of choices. The lead form then shows the right kind of box and checks what is
-- typed. The values themselves stay where they were (crm_contacts.custom_fields),
-- so nothing that is already written changes.
--
-- One table is added, with the CRM's own access rule: people who can open the
-- workspace's CRM read it, and everybody but viewers can change it.
--
-- Safe to run more than once.

create table if not exists public.crm_field_defs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null default 'text' check (kind in ('text', 'number', 'date', 'choice')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  created_at timestamptz not null default now()
);

-- One field of a name per workspace, whatever the capitals.
create unique index if not exists crm_field_defs_name on public.crm_field_defs (workspace_id, lower(btrim(name)));

alter table public.crm_field_defs enable row level security;
revoke all on public.crm_field_defs from anon, authenticated;
grant select, insert, update, delete on public.crm_field_defs to authenticated;
grant all on public.crm_field_defs to service_role;

drop policy if exists "crm_field_defs_read" on public.crm_field_defs;
create policy "crm_field_defs_read" on public.crm_field_defs
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_field_defs_write" on public.crm_field_defs;
create policy "crm_field_defs_write" on public.crm_field_defs
  for all to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 200_crm_custom_field_types.sql ▲▲▲

-- ▼▼▼ 201_crm_rules.sql ▼▼▼

-- CRM: simple rules. "When this happens, do that."
--
-- A workspace can set up rules such as:
--   * when a lead comes in, add a follow-up "Call within a day" for its owner;
--   * when a lead comes in from "Website form", give it to Dana;
--   * when a deal reaches "Negotiation", tell the owner;
--   * when a deal is won, add a follow-up "Send the welcome pack".
--
-- The rules run inside the database, on the change itself, so they work the
-- same for a lead typed in by hand, one from an import, and one from a web
-- form. A rule that fails never stops the change that set it off: the lead is
-- still added, the deal is still moved.
--
-- What can set a rule off (event):
--   lead_created, deal_created, deal_stage (a deal enters one stage), deal_won, deal_lost
-- What a rule can do (action):
--   follow_up (add a follow-up), notify (send a notice to the bell), assign (give the lead or deal to a person)
--
-- Safe to run more than once.

create table if not exists public.crm_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  enabled boolean not null default true,
  event text not null check (event in ('lead_created', 'deal_created', 'deal_stage', 'deal_won', 'deal_lost')),
  -- For deal_stage: the stage the deal must enter.
  stage_id uuid references public.crm_deal_stages (id) on delete cascade,
  -- For lead_created: only leads whose source holds this text. Empty = every lead.
  source_contains text not null default '',
  action text not null check (action in ('follow_up', 'notify', 'assign')),
  -- Who the follow-up or the notice is for, or who gets the record. Null = the record's own owner.
  person_id uuid references auth.users (id) on delete set null,
  -- The follow-up's title or the notice's words. {name} becomes the lead's or the deal's name.
  body text not null default '' check (char_length(body) <= 300),
  due_days integer not null default 1 check (due_days between 0 and 365),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (event <> 'deal_stage' or stage_id is not null),
  check (action <> 'assign' or person_id is not null),
  check (action = 'assign' or char_length(btrim(body)) > 0),
  -- Giving a record to somebody only makes sense at the moment it is made.
  check (action <> 'assign' or event in ('lead_created', 'deal_created'))
);

create index if not exists idx_crm_rules_workspace on public.crm_rules (workspace_id, event) where enabled;

alter table public.crm_rules enable row level security;
revoke all on public.crm_rules from anon, authenticated;
grant select, insert, update, delete on public.crm_rules to authenticated;
grant all on public.crm_rules to service_role;

drop policy if exists "crm_rules_read" on public.crm_rules;
create policy "crm_rules_read" on public.crm_rules
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

-- Rules act for everybody in the workspace, so the owner and admins make them.
drop policy if exists "crm_rules_write" on public.crm_rules;
create policy "crm_rules_write" on public.crm_rules
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- Runs the rules of one event for one lead or deal.
create or replace function public.crm_run_rules(
  p_event text,
  p_org uuid,
  p_workspace uuid,
  p_contact uuid,
  p_deal uuid,
  p_name text,
  p_owner uuid,
  p_stage uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.crm_rules%rowtype;
  v_text text;
  v_person uuid;
  v_link text;
begin
  if p_workspace is null then
    return;
  end if;
  v_link := case when p_deal is not null then '/crm/deals/' || p_deal::text else '/crm/contacts/' || p_contact::text end;

  for r in
    select * from public.crm_rules x
     where x.workspace_id = p_workspace
       and x.enabled
       and x.event = p_event
       and (x.event <> 'deal_stage' or x.stage_id = p_stage)
       and (x.event <> 'lead_created' or btrim(x.source_contains) = '' or position(lower(btrim(x.source_contains)) in lower(coalesce(p_source, ''))) > 0)
     order by x.created_at
  loop
    -- Each rule on its own: one that fails does not stop the next.
    begin
      v_text := replace(r.body, '{name}', coalesce(nullif(btrim(p_name), ''), 'this record'));
      v_person := coalesce(r.person_id, p_owner);

      if r.action = 'assign' then
        if p_deal is not null then
          update public.crm_deals set owner_id = r.person_id where id = p_deal and owner_id is distinct from r.person_id;
        else
          update public.crm_contacts set owner_id = r.person_id where id = p_contact and owner_id is distinct from r.person_id;
        end if;
        -- Later rules for the same event see the new owner.
        p_owner := r.person_id;

      elsif r.action = 'follow_up' then
        insert into public.crm_tasks (organization_id, workspace_id, owner_id, assigned_to, contact_id, deal_id, title, due_date, priority, status)
        values (p_org, p_workspace, v_person, v_person, p_contact, p_deal, left(v_text, 300), now() + make_interval(days => r.due_days), 'medium', 'pending');

      elsif r.action = 'notify' then
        -- With nobody to tell (no owner, no person chosen), the organisation's owner is told.
        if v_person is null then
          select o.owner_id into v_person from public.organizations o where o.organization_id = p_org;
        end if;
        if v_person is not null then
          insert into public.notifications (user_id, type, title, message, read, link)
          values (v_person, 'crm_rule', 'CRM rule', left(v_text, 300), false, v_link);
        end if;
      end if;
    exception when others then
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.crm_run_rules(text, uuid, uuid, uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.crm_rules_on_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    perform public.crm_run_rules(
      'lead_created', new.organization_id, new.workspace_id, new.id, null,
      btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), new.owner_id, null, new.source);
  exception when others then
    -- A rule must never be the reason a lead is not added.
    null;
  end;
  return new;
end;
$$;

create or replace function public.crm_rules_on_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.crm_run_rules('deal_created', new.organization_id, new.workspace_id, new.contact_id, new.id, new.name, new.owner_id, new.stage_id, new.source);
      perform public.crm_run_rules('deal_stage', new.organization_id, new.workspace_id, new.contact_id, new.id, new.name, new.owner_id, new.stage_id, new.source);
    else
      if new.stage_id is distinct from old.stage_id then
        perform public.crm_run_rules('deal_stage', new.organization_id, new.workspace_id, new.contact_id, new.id, new.name, new.owner_id, new.stage_id, new.source);
      end if;
      if new.status is distinct from old.status and new.status::text = 'won' then
        perform public.crm_run_rules('deal_won', new.organization_id, new.workspace_id, new.contact_id, new.id, new.name, new.owner_id, new.stage_id, new.source);
      elsif new.status is distinct from old.status and new.status::text = 'lost' then
        perform public.crm_run_rules('deal_lost', new.organization_id, new.workspace_id, new.contact_id, new.id, new.name, new.owner_id, new.stage_id, new.source);
      end if;
    end if;
  exception when others then
    -- A rule must never be the reason a deal is not saved.
    null;
  end;
  return new;
end;
$$;

revoke all on function public.crm_rules_on_contact() from public, anon, authenticated;
revoke all on function public.crm_rules_on_deal() from public, anon, authenticated;

drop trigger if exists trg_crm_contacts_rules on public.crm_contacts;
create trigger trg_crm_contacts_rules
  after insert on public.crm_contacts
  for each row execute function public.crm_rules_on_contact();

drop trigger if exists trg_crm_deals_rules on public.crm_deals;
create trigger trg_crm_deals_rules
  after insert or update on public.crm_deals
  for each row execute function public.crm_rules_on_deal();

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 201_crm_rules.sql ▲▲▲

-- ▼▼▼ 202_crm_shared_views.sql ▼▼▼

-- Leads: saved views the whole team can use.
--
-- A saved view (a name for a search, filters and sorting) was kept in one
-- person's browser. A view can now be shared: it is kept here, and everybody
-- who can open the workspace's CRM finds it in their list.
--
-- One table is added. Views kept in a browser stay where they are.
--
-- Who can do what: everybody in the workspace's CRM reads the shared views;
-- everybody but viewers can add one; the person who made a view, or the owner
-- or an admin, can remove it.
--
-- Safe to run more than once.

create table if not exists public.crm_saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One shared view of a name per workspace, whatever the capitals.
create unique index if not exists crm_saved_views_name on public.crm_saved_views (workspace_id, lower(btrim(name)));

alter table public.crm_saved_views enable row level security;
revoke all on public.crm_saved_views from anon, authenticated;
grant select, insert, delete on public.crm_saved_views to authenticated;
grant all on public.crm_saved_views to service_role;

drop policy if exists "crm_saved_views_read" on public.crm_saved_views;
create policy "crm_saved_views_read" on public.crm_saved_views
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_saved_views_add" on public.crm_saved_views;
create policy "crm_saved_views_add" on public.crm_saved_views
  for insert to authenticated
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists "crm_saved_views_remove" on public.crm_saved_views;
create policy "crm_saved_views_remove" on public.crm_saved_views
  for delete to authenticated
  using (
    public.can_access_crm_scope(organization_id, workspace_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 202_crm_shared_views.sql ▲▲▲

-- ▼▼▼ 203_social_composer.sql ▼▼▼

-- Post to every platform from one place.
--
-- One press in the composer makes one row in social_content for each account
-- the post goes to. This file adds what those rows need:
--   post_group_id  the rows of one press belong together
--   options        what that platform needs (a YouTube title, who can see a TikTok, ...)
--   media          the picture or video of the post, uploaded once
-- and a public place to keep the uploaded file, because Instagram, Facebook
-- and the other platforms fetch it by its address.
--
-- Safe to run more than once. It changes nothing when the social tables
-- (167_workspace_social_marketing.sql) have not been made yet.

set search_path = public;

do $$
begin
  if to_regclass('public.social_content') is null then
    raise notice 'social_content is not there yet: run 167_workspace_social_marketing.sql first, then this file again.';
    return;
  end if;

  execute 'alter table public.social_content add column if not exists post_group_id uuid';
  execute $col$alter table public.social_content add column if not exists options jsonb not null default '{}'::jsonb$col$;
  execute $col$alter table public.social_content add column if not exists media jsonb not null default '[]'::jsonb$col$;

  execute 'create index if not exists social_content_group_idx on public.social_content(post_group_id) where post_group_id is not null';

  -- Claim the posts that are due. A post that has said "publishing" for twenty
  -- minutes was cut off half-way (the server stopped): it is marked as failed
  -- with a sentence the person can act on, instead of staying stuck for ever.
  execute $fn$
    create or replace function public.claim_social_posts(p_limit int default 25)
    returns setof public.social_content
    language plpgsql security definer set search_path = public as $body$
    begin
      update public.social_content
         set status = 'failed', last_error = 'Posting took too long and was stopped. Try again.'
       where status = 'publishing' and updated_at < now() - interval '20 minutes';

      return query
      with due as (
        select id from public.social_content
        where status = 'scheduled' and scheduled_at <= now()
        order by scheduled_at for update skip locked limit greatest(1, least(p_limit, 100))
      ), claimed as (
        update public.social_content c set status = 'publishing', updated_at = now()
        from due where c.id = due.id returning c.*
      ) select * from claimed;
    end $body$
  $fn$;
  execute 'revoke execute on function public.claim_social_posts(int) from public, anon, authenticated';
  execute 'grant execute on function public.claim_social_posts(int) to service_role';
end $$;

-- ---------------------------------------------------------------------------
-- social-media Storage bucket. Public on purpose: a platform fetches the file
-- by its address when the post is made, and what is in here is meant to be
-- published. A file's address holds a random part, so it cannot be guessed.
-- Path: <workspace_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('social-media', 'social-media', true, 1073741824)   -- 1 GB per file
  on conflict (id) do update set public = true;

drop policy if exists "social_media_read"   on storage.objects;
drop policy if exists "social_media_write"  on storage.objects;
drop policy if exists "social_media_delete" on storage.objects;

-- The first part of the path is the workspace. A path that does not start with
-- a workspace id simply matches nobody.
create policy "social_media_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "social_media_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "social_media_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

notify pgrst, 'reload schema';

-- ▲▲▲ 203_social_composer.sql ▲▲▲

-- ▼▼▼ 204_merge_workspace.sql ▼▼▼

-- Put one workspace into another, then remove it.
--
-- For an organisation that still has the old "General" workspace next to the
-- workspace it really uses: everything in the first is moved into the second
-- (projects, leads, companies, deals, follow-ups, emails, people, ...), and the
-- first is then removed.
--
-- It is all or nothing. The whole merge runs as one step: when any part of it
-- cannot be done, an error says why and NOTHING is changed. Nothing is ever
-- deleted to make room, with these exceptions, which hold no records of work:
--   * a tag or a deal stage with the same name in both workspaces becomes one
--     (the leads and deals that used the first now use the second);
--   * settings that exist once for each workspace keep the target's own.
-- Agreements and invoices are legal records with their own numbering. A
-- workspace that holds any is not merged: the function refuses.
--
-- Only the organisation's owner and admins may run it.
-- Safe to run more than once.

set search_path = public;

create or replace function public.merge_workspace(p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_org_into uuid;
  v_from_name text;
  v_from_default boolean;
  v_suffix text;
  v_table text;
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_progress boolean;
  v_last_error text;
  v_count bigint;
  v_moved bigint := 0;
  v_only_key boolean;
  v_what text;
  v_came_stages uuid[] := '{}';
  v_renamed_tags uuid[] := '{}';
  r record;
  v_target uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'Choose two different workspaces.' using errcode = 'P0001';
  end if;

  -- Both rows are held until the merge is over, so nothing else changes them half-way.
  select organization_id, name, coalesce(is_default, false)
    into v_org, v_from_name, v_from_default
    from public.workspaces where workspace_id = p_from for update;
  if not found then
    raise exception 'That workspace no longer exists.' using errcode = 'P0002';
  end if;
  select organization_id into v_org_into
    from public.workspaces where workspace_id = p_into for update;
  if not found then
    raise exception 'The workspace to move into no longer exists.' using errcode = 'P0002';
  end if;
  if v_org is distinct from v_org_into then
    raise exception 'Both workspaces must belong to the same organisation.' using errcode = 'P0001';
  end if;
  if not public.is_org_admin_or_owner(v_org) then
    raise exception 'Only the owner and admins can merge workspaces.' using errcode = '42501';
  end if;

  v_suffix := ' (' || coalesce(nullif(btrim(v_from_name), ''), 'merged') || ')';

  -- ── Agreements and invoices stay where they are ───────────────────────────
  -- The documents area keeps its records by workspace in tables of its own.
  -- They are not moved, so a workspace that holds any is not merged.
  foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_from;
      if v_count > 0 then
        raise exception 'This workspace has agreements, invoices or billing plans. They are legal records and keep their own numbers, so the workspace cannot be put into another one.'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- ── The tables to move: every table that says which workspace a row is in ─
  select coalesce(array_agg(c.table_name::text order by c.table_name::text), '{}')
    into v_tables
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.udt_name = 'uuid'
     and t.table_type = 'BASE TABLE'
     and c.table_name <> 'workspaces'
     and c.table_name not like 'sr\_%' escape '\';

  -- ── Names that must be different within one workspace ─────────────────────
  -- A row of the first workspace whose name the second already uses gets the
  -- first workspace's name in brackets, so both can live side by side. Tags
  -- are made one again further down; the others keep the brackets, so nothing
  -- is lost and a person can tidy them later.
  if to_regclass('public.crm_tags') is not null then
    with clash as (
      update public.crm_tags a set name = a.name || v_suffix
       where a.workspace_id = p_from
         and exists (select 1 from public.crm_tags b where b.workspace_id = p_into and lower(b.name) = lower(a.name))
      returning a.id
    ) select coalesce(array_agg(id), '{}') into v_renamed_tags from clash;
  end if;
  if to_regclass('public.client_categories') is not null then
    update public.client_categories a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.client_categories b where b.workspace_id = p_into and lower(b.name) = lower(a.name));
  end if;
  if to_regclass('public.crm_field_defs') is not null then
    update public.crm_field_defs a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.crm_field_defs b where b.workspace_id = p_into and lower(btrim(b.name)) = lower(btrim(a.name)));
  end if;
  if to_regclass('public.crm_saved_views') is not null then
    update public.crm_saved_views a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.crm_saved_views b where b.workspace_id = p_into and lower(btrim(b.name)) = lower(btrim(a.name)));
  end if;
  if to_regclass('public.auto_automations') is not null then
    update public.auto_automations a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.auto_automations b where b.workspace_id = p_into and lower(b.name) = lower(a.name));
  end if;
  -- A workspace has one agent of each ready-made kind. One that comes over
  -- while the target has its own of that kind is kept as an agent of its own.
  if to_regclass('public.auto_agents') is not null then
    update public.auto_agents a set kind = 'custom'
     where a.workspace_id = p_from and a.kind <> 'custom'
       and exists (select 1 from public.auto_agents b where b.workspace_id = p_into and b.kind = a.kind);
  end if;

  -- The deal stages that come over, to make same-named ones one again afterwards.
  if to_regclass('public.crm_deal_stages') is not null then
    select coalesce(array_agg(id), '{}') into v_came_stages from public.crm_deal_stages where workspace_id = p_from;
    -- They go after the target's own stages, in the order they had.
    update public.crm_deal_stages s
       set sort_order = s.sort_order + 1 + coalesce((select max(sort_order) from public.crm_deal_stages where workspace_id = p_into), 0)
     where s.workspace_id = p_from;
  end if;

  -- ── Move ──────────────────────────────────────────────────────────────────
  -- Some tables check that a row and what it belongs to are in the same
  -- workspace (a deal and its company, a follow-up and its lead). Such a table
  -- can only move after the other one has. So: try every table; the ones that
  -- are refused are tried again in the next round, until all have moved or a
  -- round moves none.
  v_pending := v_tables;
  loop
    exit when coalesce(array_length(v_pending, 1), 0) = 0;
    v_next := '{}';
    v_progress := false;
    foreach v_table in array v_pending loop
      begin
        -- A table with one row for each workspace holds that workspace's settings: the target keeps its own.
        select count(*) = 1 and bool_and(a.attname = 'workspace_id') into v_only_key
          from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
         where i.indrelid = format('public.%I', v_table)::regclass and i.indisprimary;
        if coalesce(v_only_key, false) then
          execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_into;
          if v_count > 0 then
            execute format('delete from public.%I where workspace_id = $1', v_table) using p_from;
          else
            execute format('update public.%I set workspace_id = $1 where workspace_id = $2', v_table) using p_into, p_from;
          end if;
        else
          execute format('update public.%I set workspace_id = $1 where workspace_id = $2', v_table) using p_into, p_from;
          get diagnostics v_count = row_count;
          v_moved := v_moved + v_count;
        end if;
        v_progress := true;
      exception
        when unique_violation then
          -- The same thing exists in both workspaces. Nothing is thrown away to make room: stop, and say what.
          v_what := case v_table
            when 'social_accounts' then 'social account'
            when 'crm_tags' then 'tag'
            when 'crm_field_defs' then 'custom field'
            when 'crm_saved_views' then 'saved view'
            when 'client_categories' then 'category'
            when 'auto_automations' then 'automation'
            when 'auto_agents' then 'agent'
            else 'record' end;
          raise exception 'Both workspaces have the same % (in %). Remove or rename it in one of them, then merge again. Nothing was changed.', v_what, replace(v_table, '_', ' ')
            using errcode = 'P0001';
        when others then
          v_next := v_next || v_table;
          v_last_error := v_table || ': ' || sqlerrm;
      end;
    end loop;
    if coalesce(array_length(v_next, 1), 0) > 0 and not v_progress then
      raise exception 'This workspace could not be merged. Nothing was changed.'
        using errcode = 'P0001', detail = coalesce(v_last_error, '');
    end if;
    v_pending := v_next;
  end loop;

  -- ── Same-named tags and deal stages become one ────────────────────────────
  -- Everything is in the target workspace now, so a lead or a deal can be
  -- pointed at the target's own tag or stage.
  if to_regclass('public.crm_tags') is not null and to_regclass('public.crm_contact_tags') is not null then
    for r in select id, name from public.crm_tags where id = any (v_renamed_tags) loop
      select t.id into v_target from public.crm_tags t
       where t.workspace_id = p_into and t.id <> r.id
         and lower(t.name) = lower(left(r.name, length(r.name) - length(v_suffix)))
       limit 1;
      if v_target is not null then
        insert into public.crm_contact_tags (contact_id, tag_id)
          select contact_id, v_target from public.crm_contact_tags where tag_id = r.id
          on conflict do nothing;
        delete from public.crm_tags where id = r.id;
      end if;
    end loop;
  end if;

  if to_regclass('public.crm_deal_stages') is not null and coalesce(array_length(v_came_stages, 1), 0) > 0 then
    -- A deal goes to the stage of the same name. That is not a move through
    -- the pipeline, so the rules that run "when a deal reaches a stage" and the
    -- change log are switched off for these few statements, and on again after.
    -- (If anything fails, the whole merge is undone, this included.)
    execute 'alter table public.crm_deals disable trigger user';
    for r in select id, name, status from public.crm_deal_stages where id = any (v_came_stages) loop
      select s.id into v_target from public.crm_deal_stages s
       where s.workspace_id = p_into and not (s.id = any (v_came_stages))
         and lower(btrim(s.name)) = lower(btrim(r.name)) and s.status = r.status
       order by s.sort_order limit 1;
      if v_target is not null then
        update public.crm_deals set stage_id = v_target where stage_id = r.id;
        if to_regclass('public.crm_rules') is not null then
          update public.crm_rules set stage_id = v_target where stage_id = r.id;
        end if;
        delete from public.crm_deal_stages where id = r.id;
      end if;
    end loop;
    execute 'alter table public.crm_deals enable trigger user';
  end if;

  -- ── Nothing may be left behind ────────────────────────────────────────────
  -- Removing the workspace removes whatever still points at it. So it is only
  -- removed when nothing does.
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_from;
    if v_count > 0 then
      raise exception 'This workspace could not be merged. Nothing was changed.'
        using errcode = 'P0001', detail = v_table || ' still has rows';
    end if;
  end loop;

  -- The organisation's main workspace is the one every plan includes: the target takes that over.
  if v_from_default then
    update public.workspaces set is_default = false where workspace_id = p_from;
    update public.workspaces set is_default = true, updated_at = now() where workspace_id = p_into;
  end if;
  delete from public.workspaces where workspace_id = p_from;

  return jsonb_build_object('moved', v_moved, 'from', v_from_name);
end;
$$;

revoke all on function public.merge_workspace(uuid, uuid) from public;
grant execute on function public.merge_workspace(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ▲▲▲ 204_merge_workspace.sql ▲▲▲

-- ▼▼▼ 205_delete_workspace_with_data.sql ▼▼▼

-- Delete a workspace together with everything in it.
--
-- For an organisation that wants an old workspace (the ready-made "General")
-- gone, with what is inside it: its projects and their tasks, leads, companies,
-- deals, follow-ups, emails, social posts and everything else that belongs to
-- that workspace. To KEEP the data and only lose the workspace, use
-- merge_workspace (204) instead.
--
-- Two steps, so nobody deletes by accident:
--   delete_workspace_with_data(workspace)                only counts: what would go
--   delete_workspace_with_data(workspace, true)          deletes it
--   delete_workspace_with_data(workspace, true, true)    deletes it, and its legal records too
--
-- Legal records are the documents of the workspace: invoices (with their
-- payments and receipts), agreements, billing plans and agreement templates.
-- The count names them apart ("documents"), and they are only deleted when the
-- third value is true: the owner has seen how many there are and said so. The
-- documents area itself only lets an agreement or a template go together with
-- its workspace, so this is the one way they can be removed.
--
-- It is all or nothing: when any part cannot be deleted, an error says so and
-- NOTHING is changed.
--
-- It refuses when:
--   * it is the organisation's only workspace (there must be one left);
--   * the workspace holds legal records and the third value is not true. The
--     message says how many of each there are;
--   * an agreement is out for signature right now, or is under a legal hold:
--     that is never deleted, whatever is asked;
--   * the workspace has recorded calls: the recordings are kept at the phone
--     provider, where the database cannot reach. Delete those calls on the
--     Calls page first, which removes the recordings too.
--
-- Only the organisation's owner may run it.
-- Safe to run more than once.

set search_path = public;

drop function if exists public.delete_workspace_with_data(uuid, boolean);

create or replace function public.delete_workspace_with_data(p_workspace uuid, p_confirm boolean default false, p_documents boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_default boolean;
  v_other uuid;
  v_table text;
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_progress boolean;
  v_last_error text;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_has_tasks boolean;
  v_documents text;
  v_docs jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  if p_workspace is null then
    raise exception 'Choose a workspace.' using errcode = 'P0001';
  end if;

  -- The row is held until this is over, so nothing else changes it half-way.
  select organization_id, name, coalesce(is_default, false)
    into v_org, v_name, v_default
    from public.workspaces where workspace_id = p_workspace for update;
  if not found then
    raise exception 'That workspace no longer exists.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.organizations o where o.organization_id = v_org and o.owner_id = v_uid) then
    raise exception 'Only the owner can delete a workspace with everything in it.' using errcode = '42501';
  end if;

  -- One workspace must be left. When the main one goes, the oldest other becomes the main one.
  select w.workspace_id into v_other
    from public.workspaces w
   where w.organization_id = v_org and w.workspace_id <> p_workspace
   order by w.created_at, w.workspace_id
   limit 1;
  if v_other is null then
    raise exception 'This is your only workspace. Make another one first, then delete this one.' using errcode = 'P0001';
  end if;

  -- ── Legal records ─────────────────────────────────────────────────────────
  -- Counted apart from everything else, and named in plain words.
  v_documents := '';
  foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
      if v_count > 0 then
        v_docs := v_docs || jsonb_build_object(
          case v_table when 'sr_invoices' then 'invoices' when 'sr_agreements' then 'agreements' when 'sr_projects' then 'billing_plans' else 'agreement_templates' end,
          v_count);
        v_documents := v_documents || case when v_documents = '' then '' else ', ' end || v_count::text || ' ' || case v_table
          when 'sr_invoices' then case when v_count = 1 then 'invoice' else 'invoices' end
          when 'sr_agreements' then case when v_count = 1 then 'agreement' else 'agreements' end
          when 'sr_projects' then case when v_count = 1 then 'billing plan' else 'billing plans' end
          else case when v_count = 1 then 'agreement template' else 'agreement templates' end end;
      end if;
    end if;
  end loop;

  -- Never deleted, whatever is asked: an agreement people are signing right now, and one under a legal hold.
  if to_regclass('public.sr_agreements') is not null then
    select count(*) into v_count from public.sr_agreements where workspace_id = p_workspace and status in ('Awaiting signatures', 'Finalising');
    if v_count > 0 then
      raise exception 'An agreement of this workspace is out for signature right now. Cancel it or let it finish first, then delete the workspace.'
        using errcode = 'P0001';
    end if;
    select count(*) into v_count from public.sr_agreements where workspace_id = p_workspace and legal_hold;
    if v_count > 0 then
      raise exception 'An agreement of this workspace is under a legal hold. Release the hold first, then delete the workspace.'
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.crm_calls') is not null then
    select count(*) into v_count from public.crm_calls where workspace_id = p_workspace and recording_sid is not null;
    if v_count > 0 then
      raise exception 'This workspace has recorded calls. Delete those calls on the Calls page first (that removes the recordings too), then delete the workspace.'
        using errcode = 'P0001';
    end if;
  end if;

  -- ── Every table that says which workspace a row is in ─────────────────────
  select coalesce(array_agg(c.table_name::text order by c.table_name::text), '{}')
    into v_tables
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.udt_name = 'uuid'
     and t.table_type = 'BASE TABLE'
     and c.table_name <> 'workspaces'
     and c.table_name not like 'sr\_%' escape '\';

  -- ── Count ─────────────────────────────────────────────────────────────────
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
    if v_count > 0 then
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    end if;
  end loop;

  -- Tasks belong to a project, not to a workspace: they go with their project.
  v_has_tasks := to_regclass('public.tasks') is not null and to_regclass('public.projects') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'project_id');
  if v_has_tasks then
    execute 'select count(*) from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
      into v_count using p_workspace;
    if v_count > 0 then
      v_counts := v_counts || jsonb_build_object('tasks', v_count);
    end if;
  end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object('deleted', false, 'name', v_name, 'counts', v_counts, 'documents', v_docs);
  end if;

  if v_documents <> '' and not coalesce(p_documents, false) then
    raise exception 'This workspace has legal records: %. They are only deleted when you say so: tick the box for them and try again.', v_documents
      using errcode = 'P0001';
  end if;

  -- ── Delete ────────────────────────────────────────────────────────────────
  -- Nothing of this workspace goes to the CRM's recycle bin (197): deleted here means no copy is kept.
  perform set_config('crm.skip_trash', 'on', true);

  -- The legal records, when the owner said so. The documents area lets an
  -- agreement or a template go only together with its workspace, so its own
  -- row for this workspace (same id) is removed: everything of it goes with
  -- that, and nothing of any other workspace.
  if v_documents <> '' and to_regclass('public.sr_workspaces') is not null then
    delete from public.sr_workspaces where id = p_workspace;
    foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
      if to_regclass(format('public.%I', v_table)) is not null then
        execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
        if v_count > 0 then
          raise exception 'This workspace could not be deleted. Nothing was changed.'
            using errcode = 'P0001', detail = v_table || ' still has rows';
        end if;
      end if;
    end loop;
  end if;

  -- The tasks of the workspace's projects, and what hangs on those tasks, the way the app removes a project.
  if v_has_tasks then
    if to_regclass('public.comments') is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comments' and column_name = 'task_id') then
      execute 'delete from public.comments c where c.task_id::text in (select t.task_id::text from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1))'
        using p_workspace;
    end if;
    if to_regclass('public.global_comments') is not null then
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'global_comments' and column_name = 'task_id') then
        execute 'delete from public.global_comments c where c.task_id::text in (select t.task_id::text from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1))'
          using p_workspace;
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'global_comments' and column_name = 'project_id') then
        execute 'delete from public.global_comments c where c.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
          using p_workspace;
      end if;
    end if;
    execute 'delete from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
      using p_workspace;
  end if;

  -- Some rows can only go after the rows that point at them (a company after
  -- its leads). So: try every table; the ones that are refused are tried again
  -- in the next round, until all are empty or a round empties none.
  v_pending := v_tables;
  loop
    exit when coalesce(array_length(v_pending, 1), 0) = 0;
    v_next := '{}';
    v_progress := false;
    foreach v_table in array v_pending loop
      begin
        execute format('delete from public.%I where workspace_id = $1', v_table) using p_workspace;
        v_progress := true;
      exception when others then
        v_next := v_next || v_table;
        v_last_error := v_table || ': ' || sqlerrm;
      end;
    end loop;
    if coalesce(array_length(v_next, 1), 0) > 0 and not v_progress then
      raise exception 'This workspace could not be deleted. Nothing was changed.'
        using errcode = 'P0001', detail = coalesce(v_last_error, '');
    end if;
    v_pending := v_next;
  end loop;

  -- Deleting one thing can write another (a deleted deal leaves a line on a
  -- timeline). So sweep once more, then make sure nothing of it is left.
  foreach v_table in array v_tables loop
    execute format('delete from public.%I where workspace_id = $1', v_table) using p_workspace;
  end loop;
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
    if v_count > 0 then
      raise exception 'This workspace could not be deleted. Nothing was changed.'
        using errcode = 'P0001', detail = v_table || ' still has rows';
    end if;
  end loop;

  -- The organisation's main workspace is the one every plan includes: another one takes that over.
  if v_default then
    update public.workspaces set is_default = false where workspace_id = p_workspace;
    update public.workspaces set is_default = true, updated_at = now() where workspace_id = v_other;
  end if;
  delete from public.workspaces where workspace_id = p_workspace;

  -- The documents area keeps a row of its own for each workspace (same id), with
  -- the customers and settings of that workspace. No invoice or agreement is
  -- left in it (see above), so it goes too. Never the reason the delete fails.
  if to_regclass('public.sr_workspaces') is not null then
    begin
      delete from public.sr_workspaces where id = p_workspace;
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('deleted', true, 'name', v_name, 'counts', v_counts, 'documents', v_docs);
end;
$$;

revoke all on function public.delete_workspace_with_data(uuid, boolean, boolean) from public;
grant execute on function public.delete_workspace_with_data(uuid, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ▲▲▲ 205_delete_workspace_with_data.sql ▲▲▲

-- ▼▼▼ 206_social_campaign_can_be_made.sql ▼▼▼

-- A social media campaign can be made again.
--
-- What was wrong: one check guards both a campaign and a post (it makes sure
-- that the workspace, the project, the lead and so on belong together). For a
-- post it also looks at the post's campaign and account. A campaign has no
-- such fields, and the database stopped with
--   record "new" has no field "campaign_id"
-- on every new campaign, so none could ever be saved.
--
-- The fix: the check reads those two fields only when the row has them. All
-- the rules stay as they were.
--
-- Safe to run more than once.

create or replace function public.social_validate_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  -- The row as a list of named values: a field that this table does not have is simply not in it.
  r jsonb := to_jsonb(new);
  v_campaign uuid := nullif(r ->> 'campaign_id', '')::uuid;
  v_account uuid := nullif(r ->> 'account_id', '')::uuid;
begin
  if not exists (select 1 from public.workspaces w where w.workspace_id = new.workspace_id and w.organization_id = new.organization_id) then
    raise exception 'Workspace does not belong to organization' using errcode = '23514';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.project_id = new.project_id
      and p.workspace_id = new.workspace_id and p.organization_id = new.organization_id
  ) then raise exception 'Project must belong to the same workspace' using errcode = '23514'; end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t join public.projects p on p.project_id = t.project_id
    where t.task_id = new.task_id and p.workspace_id = new.workspace_id
  ) then raise exception 'Task must belong to the same workspace' using errcode = '23514'; end if;
  if new.crm_contact_id is not null and not exists (
    select 1 from public.crm_contacts c where c.id = new.crm_contact_id and c.workspace_id = new.workspace_id
  ) then raise exception 'CRM contact must belong to the same workspace' using errcode = '23514'; end if;
  if new.crm_company_id is not null and not exists (
    select 1 from public.crm_companies c where c.id = new.crm_company_id and c.workspace_id = new.workspace_id
  ) then raise exception 'CRM company must belong to the same workspace' using errcode = '23514'; end if;
  if v_campaign is not null and not exists (
    select 1 from public.social_campaigns c where c.id = v_campaign and c.workspace_id = new.workspace_id
  ) then raise exception 'Campaign must belong to the same workspace' using errcode = '23514'; end if;
  if v_account is not null and not exists (
    select 1 from public.social_accounts a where a.id = v_account and a.workspace_id = new.workspace_id
  ) then raise exception 'Social account must belong to the same workspace' using errcode = '23514'; end if;
  return new;
end $$;

-- ▲▲▲ 206_social_campaign_can_be_made.sql ▲▲▲

-- ▼▼▼ 207_social_autopilot.sql ▼▼▼

-- Social media autopilot.
--
-- A workspace can let the autopilot run its social media. It works in a loop:
--   1. it reads the workspace's own pages (every post, also the ones not made
--      here) with their numbers, and keeps a record of them day by day;
--   2. it studies those records: what works, what does not, and why;
--   3. it looks up what is going well on the platforms right now;
--   4. it plans the next week: a campaign and its posts, each with a text,
--      tags, a picture or a video (with or without a voice) and a time;
--   5. it makes the pictures and videos, and posts (or asks first);
--   6. it watches how each post does, and the next study learns from it.
--
-- What this file adds:
--   social_autopilot         one row for each workspace: the switch and the brief
--   social_feed_posts        every post on the workspace's pages, with its latest numbers
--   social_feed_snapshots    the numbers of a post, one row for each day (the record)
--   social_autopilot_notes   what the autopilot found and did: studies, trends, plans, problems
--   social_media_jobs        a picture or video being made
--   social_content.origin    who made a post: a person or the autopilot
--   social_content.idea      why the autopilot made it, and what it tries out
--   social_campaigns.origin  who made a campaign
--
-- People of the workspace can read all of it. Only the owner and admins can
-- change the switch and the brief. Everything else is written by the server.
--
-- Safe to run more than once. It changes nothing when the social tables
-- (167_workspace_social_marketing.sql) have not been made yet.

set search_path = public;

do $do$
declare
  t text;
begin
  if to_regclass('public.social_content') is null then
    raise notice 'social_content is not there yet: run 167_workspace_social_marketing.sql first, then this file again.';
    return;
  end if;

  execute $q$
    create table if not exists public.social_autopilot (
      workspace_id uuid primary key references public.workspaces(workspace_id) on delete cascade,
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      -- off: does nothing.  ask: makes posts and waits for a yes.  auto: makes posts and sends them.
      mode text not null default 'off' check (mode in ('off', 'ask', 'auto')),
      brief text not null default '',
      audience text not null default '',
      tone text not null default '',
      language text not null default 'English',
      posts_per_week integer not null default 4 check (posts_per_week between 1 and 14),
      formats jsonb not null default '["image","video"]'::jsonb,
      voice text not null default 'mixed' check (voice in ('with', 'without', 'mixed')),
      -- The accounts it posts to. Empty: every connected account of the workspace.
      account_ids jsonb not null default '[]'::jsonb,
      -- TikTok asks the poster who may see a video: the owner chooses it once, here.
      tiktok_privacy text not null default '',
      -- The most it may spend in a calendar month on writing, pictures and videos, in US cents.
      budget_cents integer not null default 3000 check (budget_cents between 0 and 100000),
      timezone text not null default 'Europe/London',
      -- What it has learned so far, in its own words. Every plan starts from it.
      playbook text not null default '',
      collected_at timestamptz,
      studied_at timestamptz,
      trends_at timestamptz,
      planned_at timestamptz,
      -- Set while a step runs, so two runs never work on one workspace at once.
      busy_since timestamptz,
      -- When a run last worked on this workspace: the one that waited longest goes first.
      worked_at timestamptz,
      updated_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $q$;

  execute $q$
    create table if not exists public.social_feed_posts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      account_id uuid not null references public.social_accounts(id) on delete cascade,
      platform text not null,
      platform_post_id text not null,
      url text not null default '',
      caption text not null default '',
      -- 'video', 'image' or '' when the platform does not say.
      kind text not null default '',
      posted_at timestamptz,
      -- Our own post, when this one was made here.
      content_id uuid references public.social_content(id) on delete set null,
      views bigint not null default 0,
      likes bigint not null default 0,
      comments bigint not null default 0,
      shares bigint not null default 0,
      saves bigint not null default 0,
      reach bigint not null default 0,
      measured_at timestamptz,
      first_seen_at timestamptz not null default now(),
      unique (account_id, platform_post_id)
    )
  $q$;
  execute 'create index if not exists social_feed_posts_ws_idx on public.social_feed_posts(workspace_id, posted_at desc)';

  execute $q$
    create table if not exists public.social_feed_snapshots (
      feed_post_id uuid not null references public.social_feed_posts(id) on delete cascade,
      taken_on date not null,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      views bigint not null default 0,
      likes bigint not null default 0,
      comments bigint not null default 0,
      shares bigint not null default 0,
      saves bigint not null default 0,
      reach bigint not null default 0,
      primary key (feed_post_id, taken_on)
    )
  $q$;
  execute 'create index if not exists social_feed_snapshots_ws_idx on public.social_feed_snapshots(workspace_id, taken_on)';

  execute $q$
    create table if not exists public.social_autopilot_notes (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      kind text not null check (kind in ('study', 'trends', 'plan', 'problem')),
      title text not null default '',
      body text not null default '',
      data jsonb not null default '{}'::jsonb,
      -- What the writing cost, in millionths of a US dollar.
      cost_micro_usd bigint not null default 0,
      created_at timestamptz not null default now()
    )
  $q$;
  execute 'create index if not exists social_autopilot_notes_ws_idx on public.social_autopilot_notes(workspace_id, created_at desc)';

  execute $q$
    create table if not exists public.social_media_jobs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      -- The posts of one idea (one for each account) share this file.
      post_group_id uuid not null,
      kind text not null check (kind in ('image', 'video')),
      prompt text not null default '',
      with_voice boolean not null default false,
      status text not null default 'waiting' check (status in ('waiting', 'running', 'done', 'failed')),
      task_id text,
      -- What the maker charged: one credit is one US cent.
      credits integer not null default 0,
      url text,
      error text,
      attempts integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $q$;
  execute 'create index if not exists social_media_jobs_ws_idx on public.social_media_jobs(workspace_id, status)';
  execute 'create index if not exists social_media_jobs_group_idx on public.social_media_jobs(post_group_id)';

  execute $q$alter table public.social_content add column if not exists origin text not null default 'person'$q$;
  execute $q$alter table public.social_content add column if not exists idea jsonb not null default '{}'::jsonb$q$;
  execute $q$alter table public.social_campaigns add column if not exists origin text not null default 'person'$q$;

  -- Reading: the people of the workspace. Writing: the server, except the
  -- switch and the brief, which the owner and admins may change.
  foreach t in array array['social_autopilot', 'social_feed_posts', 'social_feed_snapshots', 'social_autopilot_notes', 'social_media_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_workspace(workspace_id))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  execute 'grant insert, update on public.social_autopilot to authenticated';
  execute 'drop policy if exists social_autopilot_insert on public.social_autopilot';
  execute $q$
    create policy social_autopilot_insert on public.social_autopilot for insert to authenticated
      with check (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id)
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
  execute 'drop policy if exists social_autopilot_update on public.social_autopilot';
  execute $q$
    create policy social_autopilot_update on public.social_autopilot for update to authenticated
      using (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id))
      with check (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id)
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
end
$do$;

-- ▲▲▲ 207_social_autopilot.sql ▲▲▲

-- ▼▼▼ 208_social_autopilot_second_try.sql ▼▼▼

-- Social media autopilot: a second try for a post that did weakly.
--
-- A platform does not let a post be changed through the posting service once
-- it is out. So when one of the autopilot's posts does clearly worse than the
-- usual post of the same page, the autopilot makes a better version (another
-- opening, another picture or video) and posts that, once. The owner can
-- switch this off, and can also ask for a second try of any of its posts.
--
--   social_autopilot.retry_weak    the switch for this (on by default)
--   social_autopilot.reviewed_at   when it last looked for a weak post (once a day)
--
-- The same file adds two more things the owner can give the autopilot:
--
--   social_autopilot.website       the business's own website. The autopilot
--                                  reads it (once a month) to learn what the
--                                  business sells, so nobody has to type it.
--   social_autopilot.site_notes    what it learned there
--   social_autopilot.site_at       when it last read the website
--   social_autopilot.post_days     the weekdays it may post on (0 is Sunday).
--                                  Empty: any day.
--   social_autopilot.post_times    the times it may post at ("18:00").
--                                  Empty: it chooses from the numbers.
--
-- Safe to run more than once. It changes nothing when the autopilot's table
-- (207_social_autopilot.sql) has not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.social_autopilot') is null then
    raise notice 'social_autopilot is not there yet: run 207_social_autopilot.sql first, then this file again.';
    return;
  end if;
  execute 'alter table public.social_autopilot add column if not exists retry_weak boolean not null default true';
  execute 'alter table public.social_autopilot add column if not exists reviewed_at timestamptz';
  execute $q$alter table public.social_autopilot add column if not exists website text not null default ''$q$;
  execute $q$alter table public.social_autopilot add column if not exists site_notes text not null default ''$q$;
  execute 'alter table public.social_autopilot add column if not exists site_at timestamptz';
  execute $q$alter table public.social_autopilot add column if not exists post_days jsonb not null default '[]'::jsonb$q$;
  execute $q$alter table public.social_autopilot add column if not exists post_times jsonb not null default '[]'::jsonb$q$;
end
$do$;

-- ▲▲▲ 208_social_autopilot_second_try.sql ▲▲▲

-- ▼▼▼ 209_crm_note_history.sql ▼▼▼

-- CRM notes: the earlier versions of a note are kept.
--
-- A note on a lead, a company or a deal can be changed. Until now the old
-- words were gone the moment it was saved. From now on, each time a note's
-- text changes, the text it had before is kept in public.crm_note_history,
-- with who changed it and when. The note's page shows "History".
--
-- Who can read it: the same people who can read the note (the people of the
-- organisation). Nobody writes to it by hand: the database does, on the
-- change itself. The history goes with its note when the note is deleted.
--
-- Keeping the old words can never be the reason a note is not saved: when
-- that fails, the note is still changed.
--
-- Safe to run more than once.

create table if not exists public.crm_note_history (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.crm_notes (id) on delete cascade,
  organization_id uuid not null,
  workspace_id uuid,
  -- The words the note had before the change.
  body text not null,
  -- When those words were written (the note's own time before the change).
  written_at timestamptz,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_crm_note_history_note on public.crm_note_history (note_id, changed_at desc);

alter table public.crm_note_history enable row level security;
revoke all on public.crm_note_history from public, anon, authenticated;
grant select on public.crm_note_history to authenticated;
grant all on public.crm_note_history to service_role;

drop policy if exists "crm_note_history_read" on public.crm_note_history;
create policy "crm_note_history_read" on public.crm_note_history
  for select to authenticated
  using (public.is_org_member(organization_id));

create or replace function public.crm_keep_note_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    if new.body is distinct from old.body then
      insert into public.crm_note_history (note_id, organization_id, workspace_id, body, written_at, changed_by)
      values (old.id, old.organization_id, old.workspace_id, old.body, old.updated_at, auth.uid());
    end if;
  exception when others then
    -- Keeping the old words must never be the reason a note is not saved.
    null;
  end;
  return new;
end;
$$;

revoke all on function public.crm_keep_note_version() from public, anon, authenticated;

drop trigger if exists trg_crm_notes_keep_version on public.crm_notes;
create trigger trg_crm_notes_keep_version
  before update on public.crm_notes
  for each row execute function public.crm_keep_note_version();

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';

-- ▲▲▲ 209_crm_note_history.sql ▲▲▲
