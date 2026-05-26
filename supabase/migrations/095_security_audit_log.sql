-- 095_security_audit_log.sql
-- Append-only security audit log scoped per organization. Records sensitive
-- events (role changes, MFA enroll/disable, login from new device, integration
-- credential changes, bulk deletes). Visible to org owner/admin only.

create table if not exists public.security_audit_log (
  event_id         uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  actor_user_id    uuid,
  actor_name       text,
  action           text not null,        -- 'role_changed' | 'mfa_enabled' | 'login' | ...
  target_type      text,                 -- 'user' | 'client' | 'integration' | ...
  target_id        text,
  target_label     text,
  metadata         jsonb not null default '{}'::jsonb,
  ip               text,
  user_agent       text,
  occurred_at      timestamptz not null default now()
);

create index if not exists idx_security_audit_org_time
  on public.security_audit_log (organization_id, occurred_at desc);

create index if not exists idx_security_audit_action
  on public.security_audit_log (organization_id, action, occurred_at desc);

alter table public.security_audit_log enable row level security;

grant select on table public.security_audit_log to anon;
grant select, insert on table public.security_audit_log to authenticated;

drop policy if exists "anon_no_audit_log"      on public.security_audit_log;
drop policy if exists "admin_view_audit_log"   on public.security_audit_log;
drop policy if exists "members_insert_audit_log" on public.security_audit_log;

create policy "anon_no_audit_log"
  on public.security_audit_log for select to anon using (false);

-- Only org owner/admin can read the audit log. Members can't see each
-- other's sensitive activity.
create policy "admin_view_audit_log"
  on public.security_audit_log for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- Any member can append. We never want a member's action to silently fail
-- to log — the audit trail is more important than the action itself.
create policy "members_insert_audit_log"
  on public.security_audit_log for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (actor_user_id = auth.uid() or actor_user_id is null)
  );
