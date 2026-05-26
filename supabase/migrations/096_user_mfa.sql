-- 096_user_mfa.sql
-- Per-user TOTP MFA enrolment. The shared secret is stored encrypted at
-- rest; the column intentionally has no plaintext fallback so a leaked
-- backup is useless without the app key.
--
-- We don't gate the user's whole session via this migration alone — the
-- frontend reads `mfa_enabled` and forces a TOTP verify dialog before any
-- privileged action. Per-tenant policies layer on top later.

create table if not exists public.user_mfa (
  user_id            uuid primary key,
  mfa_enabled        boolean not null default false,
  totp_secret_enc    text,                  -- base64 AES-GCM ciphertext
  totp_secret_iv     text,                  -- base64 IV
  recovery_codes_enc text,                  -- jsonb of one-time hashed codes
  enrolled_at        timestamptz,
  last_verified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.user_mfa enable row level security;

grant select, insert, update, delete on table public.user_mfa to authenticated;

drop policy if exists "self_view_mfa"    on public.user_mfa;
drop policy if exists "self_insert_mfa"  on public.user_mfa;
drop policy if exists "self_update_mfa"  on public.user_mfa;
drop policy if exists "self_delete_mfa"  on public.user_mfa;

-- A user can only ever see / modify their own MFA row.
create policy "self_view_mfa"
  on public.user_mfa for select to authenticated
  using (user_id = auth.uid());
create policy "self_insert_mfa"
  on public.user_mfa for insert to authenticated
  with check (user_id = auth.uid());
create policy "self_update_mfa"
  on public.user_mfa for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "self_delete_mfa"
  on public.user_mfa for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.user_mfa_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_mfa_set_updated_at on public.user_mfa;
create trigger user_mfa_set_updated_at
  before update on public.user_mfa
  for each row execute function public.user_mfa_set_updated_at();
