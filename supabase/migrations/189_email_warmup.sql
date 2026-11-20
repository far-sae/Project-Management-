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
