-- Make every workspace-owned email object enforce workspace access in RLS.
-- Organization-wide suppressions intentionally remain global: an unsubscribe
-- must stop mail from every workspace in the same legal sender organization.

set search_path = public;

create or replace function public.can_access_email_scope(p_org uuid, p_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_workspace is null
    then public.is_org_admin_or_owner(p_org)
    else public.can_access_workspace(p_workspace)
  end;
$$;
grant execute on function public.can_access_email_scope(uuid, uuid) to authenticated;

drop policy if exists "email_accounts_read" on public.email_accounts;
drop policy if exists "email_accounts_write" on public.email_accounts;
create policy "email_accounts_read" on public.email_accounts for select to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id));
create policy "email_accounts_write" on public.email_accounts for all to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id) and public.is_org_admin_or_owner(organization_id))
  with check (public.can_access_email_scope(organization_id, workspace_id) and public.is_org_admin_or_owner(organization_id));

drop policy if exists "email_campaigns_rw" on public.email_campaigns;
create policy "email_campaigns_workspace_rw" on public.email_campaigns for all to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id))
  with check (public.can_access_email_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists email_sequences_read on public.email_sequences;
drop policy if exists email_sequences_write on public.email_sequences;
create policy email_sequences_read on public.email_sequences for select to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id));
create policy email_sequences_write on public.email_sequences for all to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id))
  with check (public.can_access_email_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists email_groups_read on public.email_groups;
drop policy if exists email_groups_write on public.email_groups;
create policy email_groups_read on public.email_groups for select to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id));
create policy email_groups_write on public.email_groups for all to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id))
  with check (public.can_access_email_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists email_templates_read on public.email_templates;
drop policy if exists email_templates_write on public.email_templates;
create policy email_templates_read on public.email_templates for select to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id));
create policy email_templates_write on public.email_templates for all to authenticated
  using (public.can_access_email_scope(organization_id, workspace_id))
  with check (public.can_access_email_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists email_sequence_steps_read on public.email_sequence_steps;
drop policy if exists email_sequence_steps_write on public.email_sequence_steps;
create policy email_sequence_steps_read on public.email_sequence_steps for select to authenticated using (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id))
);
create policy email_sequence_steps_write on public.email_sequence_steps for all to authenticated using (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id))
) with check (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id) and not public.is_org_viewer(s.organization_id))
);

drop policy if exists email_enrollments_read on public.email_sequence_enrollments;
drop policy if exists email_enrollments_write on public.email_sequence_enrollments;
create policy email_enrollments_read on public.email_sequence_enrollments for select to authenticated using (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id))
);
create policy email_enrollments_write on public.email_sequence_enrollments for all to authenticated using (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id))
) with check (
  exists (select 1 from public.email_sequences s where s.id = sequence_id and public.can_access_email_scope(s.organization_id, s.workspace_id) and not public.is_org_viewer(s.organization_id))
);

drop policy if exists "email_messages_read" on public.email_messages;
drop policy if exists "email_messages_insert" on public.email_messages;
create policy "email_messages_read" on public.email_messages for select to authenticated using (
  exists (select 1 from public.email_campaigns c where c.id = campaign_id and public.can_access_email_scope(c.organization_id, c.workspace_id))
);
create policy "email_messages_insert" on public.email_messages for insert to authenticated with check (
  exists (select 1 from public.email_campaigns c where c.id = campaign_id and public.can_access_email_scope(c.organization_id, c.workspace_id) and not public.is_org_viewer(c.organization_id))
);

-- Recreate the health view with workspace_id so clients can filter before any
-- mailbox details leave PostgREST. Calculations stay identical to migration 156.
create or replace view public.mailbox_status as
select a.id, a.organization_id, a.label, a.from_email, a.status,
  a.is_active, a.paused_reason, a.consecutive_failures, a.last_sent_at,
  a.daily_limit, a.warmup_enabled, a.warmup_started_on, a.warmup_start_volume, a.warmup_increment,
  greatest(case when not a.warmup_enabled then a.daily_limit
    when a.warmup_started_on is null then a.warmup_start_volume
    else least(a.daily_limit, a.warmup_start_volume + a.warmup_increment * (d.today - a.warmup_started_on)) end, 0) as effective_limit,
  (select count(*)::integer from public.email_messages m where m.sent_account_id = a.id and
    ((m.status = 'sent' and m.sent_at >= d.day_start) or (m.status = 'sending' and m.claimed_at >= d.day_start))) as sent_today,
  -- Appended (rather than inserted in the middle) so CREATE OR REPLACE VIEW is
  -- valid against the existing migration-156 column order.
  a.workspace_id
from public.email_accounts a
left join public.email_settings s on s.organization_id = a.organization_id
cross join lateral (select public.email_safe_timezone(s.send_timezone) as name) tz
cross join lateral (select (now() at time zone tz.name)::date as today,
  (date_trunc('day', now() at time zone tz.name) at time zone tz.name) as day_start) d;
alter view public.mailbox_status set (security_invoker = on);
grant select on public.mailbox_status to authenticated, service_role;

-- The legacy worker claims pooled mail by organization. Pin a campaign to an
-- active mailbox in its own workspace at activation time, which preserves the
-- pool workflow while making a cross-workspace claim impossible. Explicitly
-- selected mailboxes are validated by the same trigger.
create or replace function public.email_pin_workspace_mailbox()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status not in ('scheduled', 'sending') then return new; end if;
  if new.workspace_id is null then
    raise exception 'A workspace is required before sending a campaign' using errcode = '23514';
  end if;
  if new.account_id is not null and not exists (
    select 1 from public.email_accounts a where a.id = new.account_id
      and a.organization_id = new.organization_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'Sending mailbox must belong to the campaign workspace' using errcode = '23514';
  end if;
  if new.account_id is null then
    select a.id into new.account_id from public.email_accounts a
    where a.organization_id = new.organization_id and a.workspace_id = new.workspace_id
      and a.status = 'active' and coalesce(a.is_active, true)
    order by coalesce(a.last_sent_at, '-infinity'::timestamptz), a.created_at limit 1;
    if new.account_id is null then
      raise exception 'No active sending mailbox is connected to this workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists email_pin_workspace_mailbox_trg on public.email_campaigns;
create trigger email_pin_workspace_mailbox_trg before insert or update of status, account_id, workspace_id
  on public.email_campaigns for each row execute function public.email_pin_workspace_mailbox();
