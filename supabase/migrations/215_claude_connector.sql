-- Email from Claude: a person connects TaskCalendar to the Claude app, and
-- Claude can then prepare and send email campaigns for them through the Email
-- area, with the same mailboxes, limits and do-not-email list.
--
-- This file adds what that connection needs to remember. Nothing is added to
-- the Email area's own tables.
--
--   mcp_connections   one row for each time a person pressed "Allow" for
--                     Claude: who, in which organisation, since when, when it
--                     was last used, and when it was cut
--   mcp_auth_codes    the one-time code Claude gets right after "Allow". It
--                     works once, for five minutes
--   mcp_tokens        the passes Claude then uses (one hour each) and the
--                     pass for getting the next one
--   mcp_actions       what Claude did: one line for each campaign it
--                     prepared, sent, paused or tested, and each template it
--                     saved. The Email settings page shows these lines. It is
--                     also how the server knows which drafts are Claude's
--                     own, the only ones it may start or delete
--
-- Codes and passes are never stored as themselves, only as a fingerprint
-- (SHA-256), so reading this table gives nobody a way in.
--
-- Who can read it: nobody from the browser. Every table has row level
-- security on and no policy, so only the server (the service role) reads and
-- writes them, for the signed-in person who asks.
--
-- What Claude may do is decided on every call from what the person may do at
-- that moment: the owner and admins, or a member who was given the Email page
-- (org_member_access, 213 and 214). Taking that away, or pressing
-- "Disconnect", stops Claude at once.
--
-- Safe to run more than once.

set search_path = public;

create table if not exists public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null,
  client_name text not null default 'Claude',
  -- A fingerprint of the client the connection was made for: its passes work for that client only.
  client_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_mcp_connections_org on public.mcp_connections(organization_id, created_at desc);

create table if not exists public.mcp_auth_codes (
  code_hash text primary key,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null,
  client_hash text not null,
  client_name text not null default 'Claude',
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_auth_codes_expires on public.mcp_auth_codes(expires_at);

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  connection_id uuid not null references public.mcp_connections(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_tokens_connection on public.mcp_tokens(connection_id, expires_at);

create table if not exists public.mcp_actions (
  id bigint generated always as identity primary key,
  -- Kept when the connection is deleted: the record of what was done stays.
  connection_id uuid references public.mcp_connections(id) on delete set null,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null,
  tool text not null,
  -- The campaign or template the line is about, when there is one.
  target_id uuid,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_actions_org on public.mcp_actions(organization_id, created_at desc);
create index if not exists idx_mcp_actions_target on public.mcp_actions(target_id) where target_id is not null;

alter table public.mcp_connections enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.mcp_actions enable row level security;

revoke all on public.mcp_connections from public, anon, authenticated;
revoke all on public.mcp_auth_codes from public, anon, authenticated;
revoke all on public.mcp_tokens from public, anon, authenticated;
revoke all on public.mcp_actions from public, anon, authenticated;

grant all on public.mcp_connections to service_role;
grant all on public.mcp_auth_codes to service_role;
grant all on public.mcp_tokens to service_role;
grant all on public.mcp_actions to service_role;

-- Tell the API about the new tables straight away.
notify pgrst, 'reload schema';
