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
