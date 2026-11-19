-- ============================================================================
-- 184 — Signroom: agreements with e-signature, and invoices with receipts.
--
-- The tables behind /api/signroom (the Vercel function api/signroom.ts).
--
-- What this file does
--   1. Tables: the workspace's settings, clients, invoices, payments, invoice
--      history, private invoice links and their sessions, the email delivery
--      log, letterhead files, agreements, agreement templates, signing links
--      and their sessions, upload tickets, background jobs, evidence keys and
--      the rate-limit log.
--   2. Rules that protect records: an issued invoice is frozen; payments and
--      invoice history are append-only; a sent agreement only moves through
--      its allowed columns and a finished one is locked; evidence history only
--      grows; templates and evidence keys never change; an agreement can be
--      deleted only after its retention date. The CRM deal an agreement or an
--      invoice was created for never changes.
--   3. The functions the server calls to number, write and queue atomically.
--   4. The private "signroom" storage bucket.
--
-- How it fits TaskCalendar
--   * sr_workspaces.id IS a TaskCalendar workspace id (public.workspaces.workspace_id).
--     The row is created by the server the first time someone in that workspace
--     opens Signroom. Who may use it is decided on every request from the
--     workspace's organisation (public.organizations.owner_id and members);
--     there is no separate Signroom member list.
--   * sr_clients.crm_company_id links a client to the CRM company it was made
--     from (one client per company per workspace). sr_agreements.crm_deal_id
--     and sr_invoices.crm_deal_id link a document to a CRM deal.
--   * There is deliberately no foreign key from sr_workspaces to
--     public.workspaces: deleting a TaskCalendar workspace must not delete
--     signed agreements, issued invoices or their evidence.
--
-- Who can do what
--   Every sr_ table has row level security ON and NO policy, and anon /
--   authenticated have no grant at all. The only reader and writer is the
--   server, using the service role (which bypasses row level security). The
--   server checks the caller's sign-in, workspace and role itself.
--
-- Money is whole minor units (pence / cents) in bigint; tax is basis points.
--
-- Safe to run more than once: tables and indexes are "if not exists",
-- functions are "create or replace", triggers are dropped and re-created,
-- and the bucket insert does nothing when the bucket exists.
--
-- Needs: public.crm_companies and public.crm_deals (migration 144 onwards).
-- ============================================================================

-- ============================================================== 1. tables

-- One row per TaskCalendar workspace that uses Signroom. `owner` is only the
-- person who first opened it there; it gives no rights.
create table if not exists public.sr_workspaces (
  id uuid primary key,
  owner uuid references auth.users (id) on delete set null,
  name text,
  sender_name text,
  sender_email text,
  reply_to text,
  branding jsonb not null default '{}'::jsonb,
  logo text,
  next_invoice_seq int not null default 1,
  retention_days int default 2555,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The document server's own record of who a document is for. It is made from
-- a CRM company and keeps the details as they were when documents were issued.
create table if not exists public.sr_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  crm_company_id uuid references public.crm_companies (id) on delete set null,
  name text not null,
  contact_name text,
  email text,
  company_number text,
  notes text,
  billing_address text,
  account jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sr_clients add column if not exists crm_company_id uuid references public.crm_companies (id) on delete set null;
create index if not exists sr_clients_workspace on public.sr_clients (workspace_id);
-- One client per CRM company in a workspace.
create unique index if not exists sr_clients_workspace_company on public.sr_clients (workspace_id, crm_company_id) where crm_company_id is not null;
create index if not exists sr_clients_company on public.sr_clients (crm_company_id) where crm_company_id is not null;

create table if not exists public.sr_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  client_id uuid references public.sr_clients (id),
  crm_deal_id uuid references public.crm_deals (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  revision int not null default 1,
  status text not null default 'Draft' check (status in ('Draft', 'Issued', 'Part paid', 'Paid', 'Voided')),
  number text,
  currency text,
  issue_date date,
  due_date date,
  lines jsonb not null default '[]'::jsonb,
  tax_bps int not null default 0,
  subtotal_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  notes text,
  project text,
  receipt_draft jsonb,
  branding jsonb,
  customer jsonb,
  invoice_hash text,
  issued_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);
alter table public.sr_invoices add column if not exists crm_deal_id uuid references public.crm_deals (id) on delete set null;
create index if not exists sr_invoices_workspace on public.sr_invoices (workspace_id);
create index if not exists sr_invoices_client on public.sr_invoices (client_id);
create index if not exists sr_invoices_deal on public.sr_invoices (crm_deal_id) where crm_deal_id is not null;

create table if not exists public.sr_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sr_invoices (id) on delete cascade,
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  paid_on date not null,
  reference text,
  method text,
  receipt_number text not null,
  receipt_hash text,
  recorded_at timestamptz not null default now(),
  unique (workspace_id, receipt_number)
);
create index if not exists sr_payments_workspace on public.sr_payments (workspace_id);
create index if not exists sr_payments_invoice on public.sr_payments (invoice_id);

create table if not exists public.sr_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sr_invoices (id) on delete cascade,
  at timestamptz not null default now(),
  type text not null,
  actor text
);
create index if not exists sr_invoice_events_invoice on public.sr_invoice_events (invoice_id);

-- A private invoice or receipt link. Only the sha256 of the link is stored.
create table if not exists public.sr_tokens (
  id uuid primary key default gen_random_uuid(),
  digest text not null unique,
  purpose text not null check (purpose in ('billing')),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  invoice_id uuid references public.sr_invoices (id) on delete cascade,
  payment_id uuid references public.sr_payments (id) on delete cascade,
  artifact_hash text,
  email text,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  code_digest text,
  code_sent_at timestamptz,
  code_expires_at timestamptz,
  attempts int not null default 0,
  code_sends int not null default 0,
  code_window_start timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sr_tokens_workspace on public.sr_tokens (workspace_id);
create index if not exists sr_tokens_invoice on public.sr_tokens (invoice_id);

-- An invoice guest's session after the emailed code is accepted; the cookie's sha256 only.
create table if not exists public.sr_sessions (
  digest text primary key,
  kind text not null check (kind in ('billing')),
  token_id uuid references public.sr_tokens (id) on delete cascade,
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  invoice_id uuid references public.sr_invoices (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sr_sessions_workspace on public.sr_sessions (workspace_id);

-- The letterhead PDFs a workspace has uploaded. The file itself is in the
-- private "signroom" bucket at <workspace_id>/<hash>.
create table if not exists public.sr_template_files (
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  hash text not null,
  name text not null,
  size_bytes int not null,
  scan_engine text not null,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, hash)
);

-- One row per agreement, with the people, fields, pages, frozen snapshot and
-- evidence events as JSON.
create table if not exists public.sr_agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  client_id uuid not null references public.sr_clients (id),
  crm_deal_id uuid references public.crm_deals (id) on delete set null,
  type text not null,
  title text not null,
  status text not null default 'Draft' check (status in ('Draft','Awaiting signatures','Finalising','Completed','Declined','Cancelled','Expired')),
  revision int not null default 1,
  row_version int not null default 1,
  content text not null default '' check (char_length(content) <= 200000),
  source_kind text not null default 'authored' check (source_kind in ('authored','upload')),
  document_hash text,
  pages jsonb not null default '[]',
  participants jsonb not null default '[]',
  fields jsonb not null default '[]',
  events jsonb not null default '[]',
  sequential boolean not null default false,
  sender_first boolean not null default false,
  sender_release_pending boolean not null default false,
  sender_signed_hash text,
  deadline date,
  reminder_days int not null default 3,
  subject text not null default '',
  message text not null default '',
  branding jsonb,
  frozen jsonb,
  send_key text,
  template_version_id uuid,
  legal_hold boolean not null default false,
  archived_at timestamptz,
  trashed_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  last_reminder_at timestamptz,
  artifacts jsonb,
  final_snapshot jsonb,
  exported_at timestamptz,
  deletion_at timestamptz,
  link_origin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sr_agreements add column if not exists crm_deal_id uuid references public.crm_deals (id) on delete set null;
create index if not exists sr_agreements_workspace on public.sr_agreements (workspace_id);
create index if not exists sr_agreements_sender on public.sr_agreements (workspace_id, sender_id);
create index if not exists sr_agreements_client on public.sr_agreements (client_id);
create index if not exists sr_agreements_deal on public.sr_agreements (crm_deal_id) where crm_deal_id is not null;
create index if not exists sr_agreements_deletion on public.sr_agreements (deletion_at) where deletion_at is not null;

-- A template version is never edited; a new version is a new row.
create table if not exists public.sr_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  name text not null,
  type text not null,
  version int not null,
  content text not null default '',
  roles jsonb not null default '[]',
  fields jsonb not null default '[]',
  branding jsonb,
  document_hash text,
  pages jsonb,
  source_kind text check (source_kind in ('authored','upload')),
  created_at timestamptz not null default now(),
  unique (workspace_id, name, version)
);

-- A signing (or download) link sent to one participant. Only the sha256 of
-- the link, and of the emailed code, is stored.
create table if not exists public.sr_sign_tokens (
  id uuid primary key default gen_random_uuid(),
  digest text not null unique,
  purpose text not null check (purpose in ('sign','complete')),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  agreement_id uuid not null references public.sr_agreements (id) on delete cascade,
  participant_id text not null,
  email text not null,
  version int not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  code_digest text,
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  attempts int not null default 0,
  code_sends int not null default 0,
  code_window_start timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sr_sign_tokens_agreement on public.sr_sign_tokens (agreement_id);

-- A one-use right to upload one PDF to <workspace_id>/quarantine/<id>.pdf.
create table if not exists public.sr_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  agreement_id uuid not null references public.sr_agreements (id) on delete cascade,
  path text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sr_uploads_workspace_created on public.sr_uploads (workspace_id, created_at);

-- An agreement guest's session after the emailed code is accepted; the cookie's sha256 only.
create table if not exists public.sr_sign_sessions (
  digest text primary key,
  token_id uuid not null references public.sr_sign_tokens (id) on delete cascade,
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  agreement_id uuid not null references public.sr_agreements (id) on delete cascade,
  participant_id text not null,
  purpose text not null check (purpose in ('sign','complete')),
  version int not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sr_sign_sessions_agreement on public.sr_sign_sessions (agreement_id);

-- The email delivery log: one row per send (sending, then sent or failed).
-- route: the sending route's name in the log ('securovix' = sent by the
-- platform through Resend, the only route this server has). job_id has no
-- foreign key: done jobs are purged, while their delivery rows stay as the
-- sending history.
create table if not exists public.sr_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  invoice_id uuid references public.sr_invoices (id) on delete cascade,
  agreement_id uuid references public.sr_agreements (id) on delete cascade,
  participant_id text,
  job_id uuid,
  recipient text,
  subject text,
  purpose text,
  route text check (route in ('mailbox', 'securovix')),
  status text not null check (status in ('sending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists sr_deliveries_workspace on public.sr_deliveries (workspace_id);
create index if not exists sr_deliveries_invoice on public.sr_deliveries (invoice_id);
create index if not exists sr_deliveries_agreement on public.sr_deliveries (agreement_id);
create index if not exists sr_deliveries_job on public.sr_deliveries (job_id) where job_id is not null;

-- Background work: emails, finishing a signed agreement, retention deletion.
-- The payload of a mail job is encrypted by the server (SIGNROOM_JOB_KEY).
-- agreement_id has no foreign key, so a deletion job outlives the agreement it
-- deleted.
create table if not exists public.sr_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  agreement_id uuid,
  participant_id text,
  kind text not null check (kind in ('mail','finalise','delete')),
  purpose text not null,
  dedupe text not null unique,
  status text not null default 'queued' check (status in ('queued','working','done','failed','suppressed')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  payload text not null default '',
  error text,
  live_attempted_at timestamptz,
  manual_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sr_jobs_status_available on public.sr_jobs (status, available_at);
create index if not exists sr_jobs_agreement on public.sr_jobs (agreement_id);

-- The public half of each evidence signing key, recorded once and never changed.
create table if not exists public.sr_evidence_keys (
  key_id text primary key check (key_id ~ '^taskcalendar-ed25519-v[0-9]+$'),
  public_key text not null,
  created_at timestamptz not null default now()
);

-- The rate-limit log: one row per attempt. `key` names what is limited
-- (workspace:<id>, invoice:<id>, agreement:<id>, ...), never a person's address.
create table if not exists public.sr_attempts (
  id bigint generated always as identity primary key,
  tool text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists sr_attempts_lookup on public.sr_attempts (tool, key, created_at desc);
-- For the occasional "older than a day" clean-up.
create index if not exists sr_attempts_created_at on public.sr_attempts (created_at);

-- ------------------------------------------------------------------- RLS
-- On, with no policy: the browser (anon / authenticated) can read and write
-- nothing; the service role bypasses row level security.

alter table public.sr_workspaces enable row level security;
alter table public.sr_clients enable row level security;
alter table public.sr_invoices enable row level security;
alter table public.sr_payments enable row level security;
alter table public.sr_invoice_events enable row level security;
alter table public.sr_tokens enable row level security;
alter table public.sr_sessions enable row level security;
alter table public.sr_template_files enable row level security;
alter table public.sr_agreements enable row level security;
alter table public.sr_agreement_templates enable row level security;
alter table public.sr_sign_tokens enable row level security;
alter table public.sr_uploads enable row level security;
alter table public.sr_sign_sessions enable row level security;
alter table public.sr_deliveries enable row level security;
alter table public.sr_jobs enable row level security;
alter table public.sr_evidence_keys enable row level security;
alter table public.sr_attempts enable row level security;

-- ----------------------------------------------------------- table grants

revoke all on
  public.sr_workspaces, public.sr_clients, public.sr_invoices, public.sr_payments, public.sr_invoice_events,
  public.sr_tokens, public.sr_sessions, public.sr_template_files, public.sr_agreements, public.sr_agreement_templates,
  public.sr_sign_tokens, public.sr_uploads, public.sr_sign_sessions, public.sr_deliveries, public.sr_jobs,
  public.sr_evidence_keys, public.sr_attempts
from public, anon, authenticated;

grant all on
  public.sr_workspaces, public.sr_clients, public.sr_invoices, public.sr_payments, public.sr_invoice_events,
  public.sr_tokens, public.sr_sessions, public.sr_template_files, public.sr_agreements, public.sr_agreement_templates,
  public.sr_sign_tokens, public.sr_uploads, public.sr_sign_sessions, public.sr_deliveries, public.sr_jobs,
  public.sr_evidence_keys, public.sr_attempts
to service_role;

-- ============================================================== 2. rules

-- An invoice is editable only while it is a Draft. After that the only changes
-- allowed are to status, sent_at, revision and updated_at, and to invoice_hash
-- while it is still empty (null -> value). Everything else raises.
-- The CRM deal an invoice was created for never changes, not even on a Draft.
create or replace function public.sr_invoices_freeze()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_free text[] := array['status', 'sent_at', 'revision', 'updated_at', 'invoice_hash'];
  -- Deleting a deal sets crm_deal_id to null through a foreign-key action (one
  -- trigger level deeper). That one change is let through; a direct update is not.
  v_deal_removed boolean := pg_trigger_depth() > 1 and old.crm_deal_id is not null and new.crm_deal_id is null;
begin
  if new.crm_deal_id is distinct from old.crm_deal_id and not v_deal_removed then
    raise exception 'The linked deal cannot change.' using errcode = 'P0001';
  end if;
  if old.status = 'Draft' then
    return new;
  end if;
  if v_deal_removed then
    v_free := array_append(v_free, 'crm_deal_id');
  end if;
  -- Deleting a user sets created_by to null through a foreign-key action (one
  -- trigger level deeper). That one change is let through; a direct update is not.
  if pg_trigger_depth() > 1 and old.created_by is not null and new.created_by is null then
    v_free := array_append(v_free, 'created_by');
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'An issued invoice cannot be changed.' using errcode = 'P0001';
  end if;
  if new.invoice_hash is distinct from old.invoice_hash and old.invoice_hash is not null then
    raise exception 'An issued invoice cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists sr_invoices_freeze on public.sr_invoices;
create trigger sr_invoices_freeze before update on public.sr_invoices
  for each row execute function public.sr_invoices_freeze();

-- A payment is never changed or removed, except that its receipt_hash is filled
-- in once (null -> value). A delete that arrives from a foreign-key cascade (the
-- workspace or invoice itself being deleted) runs one trigger level deeper and is
-- let through; a direct delete is refused.
create or replace function public.sr_payments_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Payments cannot be deleted.' using errcode = 'P0001';
  end if;
  if old.receipt_hash is null
     and (to_jsonb(new) - 'receipt_hash') is not distinct from (to_jsonb(old) - 'receipt_hash') then
    return new;
  end if;
  raise exception 'Payments cannot be changed.' using errcode = 'P0001';
end;
$$;

drop trigger if exists sr_payments_append_only on public.sr_payments;
create trigger sr_payments_append_only before update or delete on public.sr_payments
  for each row execute function public.sr_payments_append_only();

-- An invoice event is never changed. Direct deletes are refused; cascades (see above) pass.
create or replace function public.sr_invoice_events_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Invoice events cannot be changed or deleted.' using errcode = 'P0001';
end;
$$;

drop trigger if exists sr_invoice_events_append_only on public.sr_invoice_events;
create trigger sr_invoice_events_append_only before update or delete on public.sr_invoice_events
  for each row execute function public.sr_invoice_events_append_only();

-- One function guards every update and delete of an agreement.
-- * Every update bumps row_version (the server's compare-and-set counter).
-- * events only ever grows: the old events must be the first elements of the new.
-- * sender_signed_hash, artifacts and final_snapshot are each set once.
-- * crm_deal_id (the CRM deal the agreement was created for) is accepted when
--   the row is inserted and never changes afterwards, in any status. The one
--   exception is the deal itself being deleted: its foreign key sets the
--   column to null one trigger level deeper.
-- * A draft may otherwise change freely. A sent one (Awaiting signatures,
--   Finalising) may only change the listed columns. Any other status is locked
--   apart from archive, trash, legal hold, events, exported_at and deletion_at.
-- * A direct delete is allowed once deletion_at has passed, when there is no
--   legal hold and the agreement is not Awaiting signatures or Finalising. A
--   cascade from the workspace (one trigger level deeper) passes, and so does
--   the foreign-key action that nulls sender_id when a user is deleted.
create or replace function public.sr_agreements_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_free text[];
  v_deal_removed boolean;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if old.deletion_at is not null
       and old.deletion_at <= now()
       and not old.legal_hold
       and old.status not in ('Awaiting signatures', 'Finalising') then
      return old;
    end if;
    raise exception 'Agreements cannot be deleted.' using errcode = 'P0001';
  end if;

  new.row_version := old.row_version + 1;
  new.updated_at := now();

  v_deal_removed := pg_trigger_depth() > 1 and old.crm_deal_id is not null and new.crm_deal_id is null;
  if new.crm_deal_id is distinct from old.crm_deal_id and not v_deal_removed then
    raise exception 'The linked deal cannot change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(new.events) >= jsonb_array_length(old.events) then
    if exists (
      select 1
      from jsonb_array_elements(old.events) with ordinality as o(e, i)
      where (new.events -> (o.i - 1)::int) is distinct from o.e
    ) then
      raise exception 'Evidence history is append-only.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Evidence history is append-only.' using errcode = 'P0001';
  end if;

  if old.sender_signed_hash is not null and new.sender_signed_hash is distinct from old.sender_signed_hash then
    raise exception 'Sender-signed document is immutable.' using errcode = 'P0001';
  end if;

  if old.artifacts is not null and new.artifacts is distinct from old.artifacts then
    raise exception 'Completed artifacts are immutable.' using errcode = 'P0001';
  end if;

  if old.final_snapshot is not null and new.final_snapshot is distinct from old.final_snapshot then
    raise exception 'The final evidence snapshot is immutable.' using errcode = 'P0001';
  end if;

  if old.status = 'Draft' then
    return new;
  end if;

  if old.status in ('Awaiting signatures', 'Finalising') then
    v_free := array['status', 'sent_at', 'completed_at', 'last_reminder_at', 'participants', 'sender_release_pending', 'sender_signed_hash', 'archived_at', 'trashed_at', 'legal_hold', 'events', 'row_version', 'updated_at', 'final_snapshot', 'artifacts'];
  else
    v_free := array['archived_at', 'trashed_at', 'legal_hold', 'events', 'row_version', 'updated_at', 'exported_at', 'deletion_at'];
  end if;
  if v_deal_removed then
    v_free := array_append(v_free, 'crm_deal_id');
  end if;
  -- Deleting a user sets sender_id to null through a foreign-key action (one
  -- trigger level deeper). That one change is let through; a direct update is not.
  if pg_trigger_depth() > 1 and old.sender_id is not null and new.sender_id is null then
    v_free := array_append(v_free, 'sender_id');
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'Sent and finished agreements cannot change.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists sr_agreements_guard on public.sr_agreements;
create trigger sr_agreements_guard before update or delete on public.sr_agreements
  for each row execute function public.sr_agreements_guard();

-- A template version is never edited; a new version is a new row. Direct deletes
-- are refused; cascades from the workspace pass.
create or replace function public.sr_agreement_templates_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Templates cannot change.' using errcode = 'P0001';
end;
$$;

drop trigger if exists sr_agreement_templates_immutable on public.sr_agreement_templates;
create trigger sr_agreement_templates_immutable before update or delete on public.sr_agreement_templates
  for each row execute function public.sr_agreement_templates_immutable();

-- Refuses every change to an evidence key: a row update or delete, and a
-- truncate (a statement trigger, so it reads neither OLD nor NEW).
create or replace function public.sr_evidence_keys_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Evidence keys are never changed or deleted.' using errcode = 'P0001';
end;
$$;

drop trigger if exists sr_evidence_keys_immutable on public.sr_evidence_keys;
create trigger sr_evidence_keys_immutable before update or delete on public.sr_evidence_keys
  for each row execute function public.sr_evidence_keys_immutable();
drop trigger if exists sr_evidence_keys_no_truncate on public.sr_evidence_keys;
create trigger sr_evidence_keys_no_truncate before truncate on public.sr_evidence_keys
  for each statement execute function public.sr_evidence_keys_immutable();

-- ============================================================ 3. functions

-- The next invoice number for a workspace, e.g. INV-2026-00001. The counter is
-- bumped and read in one statement, so two callers can never get the same number.
create or replace function public.sr_take_invoice_number(p_workspace uuid, p_year int)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq int;
begin
  update public.sr_workspaces
     set next_invoice_seq = next_invoice_seq + 1
   where id = p_workspace
  returning next_invoice_seq - 1 into v_seq;
  if v_seq is null then
    raise exception 'Workspace not found.' using errcode = 'P0001';
  end if;
  return 'INV-' || p_year::text || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

-- Issues a draft invoice in one transaction: updates the invoice, inserts an
-- optional payment and appends the events. Returns false (and writes nothing)
-- when the invoice has moved on, i.e. its revision is not p_revision, or it
-- does not exist.
--
-- p_patch: the invoice fields to set, snake_case keys named like the sr_invoices
--   columns. Only keys that are present are applied; a JSON null clears the
--   column. Keys: status, number, branding (object), customer (object),
--   invoice_hash, issued_at (timestamptz string), sent_at, receipt_draft
--   (null clears the draft).
-- p_payment: null, or one payment object with snake_case keys named like the
--   sr_payments columns: amount_minor, paid_on (YYYY-MM-DD), receipt_number
--   (required), reference, method, receipt_hash, recorded_at, id (optional).
-- p_events: a jsonb array of {"at": timestamptz string, "type": text, "actor": text}.
-- Both revision and updated_at are bumped (revision + 1, updated_at = now()).
create or replace function public.sr_issue_invoice(p_id uuid, p_revision int, p_patch jsonb, p_payment jsonb, p_events jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sr_invoices;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select * into v_inv from public.sr_invoices where id = p_id for update;
  if not found then
    return false;
  end if;
  if v_inv.revision <> p_revision then
    return false;
  end if;

  update public.sr_invoices
     set status = coalesce(v_patch->>'status', status),
         number = case when v_patch ? 'number' then v_patch->>'number' else number end,
         branding = case when v_patch ? 'branding' then nullif(v_patch->'branding', 'null'::jsonb) else branding end,
         customer = case when v_patch ? 'customer' then nullif(v_patch->'customer', 'null'::jsonb) else customer end,
         invoice_hash = case when v_patch ? 'invoice_hash' then v_patch->>'invoice_hash' else invoice_hash end,
         issued_at = case when v_patch ? 'issued_at' then (v_patch->>'issued_at')::timestamptz else issued_at end,
         sent_at = case when v_patch ? 'sent_at' then (v_patch->>'sent_at')::timestamptz else sent_at end,
         receipt_draft = case when v_patch ? 'receipt_draft' then nullif(v_patch->'receipt_draft', 'null'::jsonb) else receipt_draft end,
         revision = revision + 1,
         updated_at = now()
   where id = v_inv.id;

  if jsonb_typeof(p_payment) = 'object' then
    insert into public.sr_payments
      (id, invoice_id, workspace_id, amount_minor, paid_on, reference, method, receipt_number, receipt_hash, recorded_at)
    values
      (coalesce((p_payment->>'id')::uuid, gen_random_uuid()), v_inv.id, v_inv.workspace_id,
       (p_payment->>'amount_minor')::bigint, (p_payment->>'paid_on')::date,
       p_payment->>'reference', p_payment->>'method', p_payment->>'receipt_number', p_payment->>'receipt_hash',
       coalesce((p_payment->>'recorded_at')::timestamptz, now()));
  end if;

  if jsonb_typeof(p_events) = 'array' then
    insert into public.sr_invoice_events (invoice_id, at, type, actor)
    select v_inv.id, coalesce((e->>'at')::timestamptz, now()), e->>'type', e->>'actor'
      from jsonb_array_elements(p_events) as e;
  end if;

  return true;
end;
$$;

-- Records a payment against an issued invoice in one transaction: inserts the
-- payment, moves the invoice to p_status ('Part paid' or 'Paid') and appends
-- one event. Returns false (and writes nothing) when the revision is not
-- p_revision or the invoice does not exist.
--
-- p_payment: one payment object, keys as for sr_issue_invoice (amount_minor,
--   paid_on, receipt_number required, reference, method, receipt_hash,
--   recorded_at, id).
-- p_event: null or one {"at", "type", "actor"} object.
-- Both revision and updated_at are bumped (revision + 1, updated_at = now()).
create or replace function public.sr_record_payment(p_id uuid, p_revision int, p_payment jsonb, p_status text, p_event jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sr_invoices;
begin
  select * into v_inv from public.sr_invoices where id = p_id for update;
  if not found then
    return false;
  end if;
  if v_inv.revision <> p_revision then
    return false;
  end if;

  insert into public.sr_payments
    (id, invoice_id, workspace_id, amount_minor, paid_on, reference, method, receipt_number, receipt_hash, recorded_at)
  values
    (coalesce((p_payment->>'id')::uuid, gen_random_uuid()), v_inv.id, v_inv.workspace_id,
     (p_payment->>'amount_minor')::bigint, (p_payment->>'paid_on')::date,
     p_payment->>'reference', p_payment->>'method', p_payment->>'receipt_number', p_payment->>'receipt_hash',
     coalesce((p_payment->>'recorded_at')::timestamptz, now()));

  update public.sr_invoices
     set status = p_status,
         revision = revision + 1,
         updated_at = now()
   where id = v_inv.id;

  if jsonb_typeof(p_event) = 'object' then
    insert into public.sr_invoice_events (invoice_id, at, type, actor)
    values (v_inv.id, coalesce((p_event->>'at')::timestamptz, now()), p_event->>'type', p_event->>'actor');
  end if;

  return true;
end;
$$;

-- Saves p_account as the client's account settings only when the stored revision
-- (0 when there are no settings yet) equals p_revision. Returns the new settings, or
-- null when the client is not in that workspace or the revision no longer matches.
create or replace function public.sr_set_client_account(p_workspace uuid, p_client uuid, p_revision int, p_account jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account jsonb;
begin
  update public.sr_clients
     set account = p_account, updated_at = now()
   where id = p_client
     and workspace_id = p_workspace
     and not archived
     and coalesce((account ->> 'revision')::int, 0) = p_revision
  returning account into v_account;
  return v_account;
end;
$$;

-- Takes up to p_limit due jobs: queued ones whose time has come, and working ones
-- whose lease has run out (the run that held them died). Each is marked working
-- under a fresh lease and its attempts counted. skip locked lets two runs claim
-- at once without taking the same job. p_ids limits the claim to those jobs.
create or replace function public.sr_claim_jobs(p_limit int, p_lease_seconds int, p_ids uuid[] default null)
returns setof public.sr_jobs
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.sr_jobs
     set status = 'working',
         attempts = attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id in (
     select id
       from public.sr_jobs
      where ((status = 'queued' and available_at <= now()) or (status = 'working' and lease_until < now()))
        and (p_ids is null or id = any(p_ids))
      order by available_at, created_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

-- True while any row in the workspace still refers to the stored file with this
-- hash, so it must not be removed from the bucket.
create or replace function public.sr_blob_in_use(p_workspace uuid, p_hash text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1
             from public.sr_agreements a
            where a.workspace_id = p_workspace
              and (a.document_hash = p_hash
                   or a.sender_signed_hash = p_hash
                   or a.frozen->>'sourceHash' = p_hash
                   or exists (select 1 from jsonb_each_text(coalesce(a.artifacts, '{}')) as x(k, v) where x.v = p_hash))
         )
      or exists (select 1 from public.sr_agreement_templates t where t.workspace_id = p_workspace and t.document_hash = p_hash)
      or exists (select 1 from public.sr_invoices i where i.workspace_id = p_workspace and i.invoice_hash = p_hash)
      or exists (select 1 from public.sr_payments p where p.workspace_id = p_workspace and p.receipt_hash = p_hash)
      or exists (select 1 from public.sr_template_files f where f.workspace_id = p_workspace and f.hash = p_hash);
$$;

-- The scheduled run's work lists. Each is bounded by p_limit and ordered by
-- when the work fell due, so a long backlog never starves newer work.

-- Awaiting signatures with the deadline passed (the day after it, UTC) or an
-- automatic reminder due (reminders on, the sender not still to sign first,
-- last reminder or send more than reminder_days ago), and Expired agreements
-- whose sender has not yet been told.
create or replace function public.sr_agreements_due(p_limit int)
returns setof public.sr_agreements
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.*
    from public.sr_agreements a
   where (a.status = 'Awaiting signatures'
          and ((a.deadline is not null and (a.deadline + 1)::timestamp at time zone 'UTC' <= now())
               or (not a.sender_release_pending and a.reminder_days > 0
                   and coalesce(a.last_reminder_at, a.sent_at) + a.reminder_days * interval '24 hours' < now())))
      or (a.status = 'Expired' and not (a.events @> '[{"type": "Expiry notification queued"}]'::jsonb))
   order by least(
              case when a.status = 'Expired' then a.updated_at end,
              case when a.deadline is not null then (a.deadline + 1)::timestamp at time zone 'UTC' end,
              case when not a.sender_release_pending and a.reminder_days > 0
                   then coalesce(a.last_reminder_at, a.sent_at) + a.reminder_days * interval '24 hours' end
            ), a.id
   limit p_limit;
$$;

-- Past their deletion date, not on legal hold and not being signed (the same
-- rule as the delete guard), with no delete job other than a suppressed one: a
-- job suppressed by a hold that has since been released is queued again.
create or replace function public.sr_deletions_due(p_limit int)
returns setof public.sr_agreements
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.*
    from public.sr_agreements a
   where a.deletion_at is not null
     and a.deletion_at <= now()
     and not a.legal_hold
     and a.status not in ('Awaiting signatures', 'Finalising')
     and not exists (select 1 from public.sr_jobs j where j.dedupe = 'delete:' || a.id::text and j.status <> 'suppressed')
   order by a.deletion_at, a.id
   limit p_limit;
$$;

-- Finalising with no finalise job (the enqueue after the Finalising write
-- failed), or only a failed one whose wait has passed (tried again, for example
-- after a new evidence key): an hour after its fifth attempt, doubling with
-- each attempt after that, at most a day.
create or replace function public.sr_finalising_stranded(p_limit int)
returns setof public.sr_agreements
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.*
    from public.sr_agreements a
   where a.status = 'Finalising'
     and not exists (
           select 1
             from public.sr_jobs j
            where j.dedupe = 'finalise:' || a.id::text
              and (j.status <> 'failed'
                   or j.updated_at > now() - least(interval '24 hours', interval '1 hour' * power(2, greatest(j.attempts - 5, 0))))
         )
   order by a.updated_at, a.id
   limit p_limit;
$$;

-- Completion emails refused before sending (a send limit), never ones held
-- for review (those may have been delivered): failed after their five quick
-- tries, never attempted live, payload kept. Each is listed a day after its
-- last failure and queued again with its attempts kept, so it is tried once a
-- day, seven more times (attempts below 12), oldest failure first.
create or replace function public.sr_completion_mail_refused(p_limit int)
returns setof public.sr_jobs
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select j.*
    from public.sr_jobs j
   where j.kind = 'mail'
     and j.purpose = 'completion'
     and j.status = 'failed'
     and not j.manual_review
     and j.live_attempted_at is null
     and j.payload <> ''
     and j.attempts < 12
     and j.updated_at <= now() - interval '24 hours'
   order by j.updated_at, j.id
   limit p_limit;
$$;

-- --------------------------------------------------------- function grants
-- Trigger functions and the server's functions: nobody but the service role.

revoke all on function public.sr_invoices_freeze() from public, anon, authenticated;
revoke all on function public.sr_payments_append_only() from public, anon, authenticated;
revoke all on function public.sr_invoice_events_append_only() from public, anon, authenticated;
revoke all on function public.sr_agreements_guard() from public, anon, authenticated;
revoke all on function public.sr_agreement_templates_immutable() from public, anon, authenticated;
revoke all on function public.sr_evidence_keys_immutable() from public, anon, authenticated;
revoke all on function public.sr_take_invoice_number(uuid, int) from public, anon, authenticated;
revoke all on function public.sr_issue_invoice(uuid, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sr_record_payment(uuid, int, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.sr_set_client_account(uuid, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function public.sr_claim_jobs(int, int, uuid[]) from public, anon, authenticated;
revoke all on function public.sr_blob_in_use(uuid, text) from public, anon, authenticated;
revoke all on function public.sr_agreements_due(int) from public, anon, authenticated;
revoke all on function public.sr_deletions_due(int) from public, anon, authenticated;
revoke all on function public.sr_finalising_stranded(int) from public, anon, authenticated;
revoke all on function public.sr_completion_mail_refused(int) from public, anon, authenticated;

grant execute on function public.sr_invoices_freeze() to service_role;
grant execute on function public.sr_payments_append_only() to service_role;
grant execute on function public.sr_invoice_events_append_only() to service_role;
grant execute on function public.sr_agreements_guard() to service_role;
grant execute on function public.sr_agreement_templates_immutable() to service_role;
grant execute on function public.sr_evidence_keys_immutable() to service_role;
grant execute on function public.sr_take_invoice_number(uuid, int) to service_role;
grant execute on function public.sr_issue_invoice(uuid, int, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.sr_record_payment(uuid, int, jsonb, text, jsonb) to service_role;
grant execute on function public.sr_set_client_account(uuid, uuid, int, jsonb) to service_role;
grant execute on function public.sr_claim_jobs(int, int, uuid[]) to service_role;
grant execute on function public.sr_blob_in_use(uuid, text) to service_role;
grant execute on function public.sr_agreements_due(int) to service_role;
grant execute on function public.sr_deletions_due(int) to service_role;
grant execute on function public.sr_finalising_stranded(int) to service_role;
grant execute on function public.sr_completion_mail_refused(int) to service_role;

-- ============================================================== 4. storage
-- Private: files reach a browser only through the server or a short-lived
-- signed link it issues. No storage policy is added, so anon / authenticated
-- can read and write nothing in this bucket. 30 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('signroom', 'signroom', false, 31457280)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
