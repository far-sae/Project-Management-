-- 088_whatsapp_link_codes.sql
-- One-time link codes for the WhatsApp bot. Mirrors telegram_link_codes
-- (migration 082) one-to-one. Kept as a sibling table rather than a
-- generic "agent_link_codes(provider, ...)" so reads stay tight and the
-- existing telegram code path isn't disturbed.

create table if not exists public.whatsapp_link_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid not null references public.organizations(organization_id) on delete cascade,
  code_hash    text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create unique index if not exists whatsapp_link_codes_active_hash
  on public.whatsapp_link_codes(code_hash)
  where consumed_at is null;

create index if not exists whatsapp_link_codes_user_idx
  on public.whatsapp_link_codes(user_id, created_at desc);

alter table public.whatsapp_link_codes enable row level security;

drop policy if exists "users read own whatsapp link codes" on public.whatsapp_link_codes;
create policy "users read own whatsapp link codes"
  on public.whatsapp_link_codes for select
  using (auth.uid() = user_id);

-- Mirror the telegram-unlink policy so the Settings card can remove a
-- whatsapp integrations row from the client. WhatsApp has no provider-side
-- token to revoke (we don't store a long-lived token from Meta on this row;
-- the system phone number is set per-deployment), so a direct DELETE is fine.
drop policy if exists "users delete own whatsapp integration" on public.integrations;
create policy "users delete own whatsapp integration"
  on public.integrations for delete
  using (provider = 'whatsapp' and auth.uid() = user_id);
