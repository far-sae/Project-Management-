-- 158: email sequences (phase 3).
--
-- A sequence is a first message and a series of follow-ups, each with a delay.
-- What it is NOT is a new way to send: every step becomes an ordinary
-- email_messages row hanging off a hidden email_campaigns row, so
-- claim_email_batch() applies the mailbox pool, the daily and hourly caps, the
-- warmup ramp, the send window, the suppression list and the retry budget to a
-- sequence step exactly as it does to a campaign. A second sender that
-- reimplemented any of that would drift from it, and what drift costs here is
-- the customer's sending domain.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- ── a. email_sequences ──────────────────────────────────────────────
create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  -- 'draft' accepts edits and sends nothing. 'active' is the only status the
  -- materializer claims from. 'paused' holds every enrollment where it stands
  -- without stopping it, so resuming continues rather than restarts.
  -- 'archived' is a soft delete: enrollments stay readable for support.
  status text not null default 'draft'
    check (status in ('draft','active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_sequences enable row level security;

-- Grants, which RLS does not replace: a policy filters rows for a role that
-- already reaches the table, and without the grant `authenticated` gets a
-- permission error before any policy is consulted. 152 grants each email table
-- explicitly for the same reason.
grant select, insert, update, delete on public.email_sequences to authenticated;
grant all on public.email_sequences to service_role;

drop policy if exists email_sequences_read on public.email_sequences;
create policy email_sequences_read on public.email_sequences
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists email_sequences_write on public.email_sequences;
create policy email_sequences_write on public.email_sequences
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ── b. email_sequence_steps ─────────────────────────────────────────
create table if not exists public.email_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  -- 0 is the first message. The delay on step 0 is ignored: it is sent when
  -- the person is enrolled.
  step_index integer not null check (step_index >= 0),
  -- Hours after the PREVIOUS step was actually SENT -- not after enrollment.
  -- A queue held overnight by the send window would otherwise release three
  -- steps within minutes of each other, which is both the worst possible
  -- impression and a spam signal.
  delay_hours integer not null default 72 check (delay_hours >= 0),
  -- Empty means "Re: " + step 0's subject, which is what a human would do and
  -- what keeps the follow-up in the same thread: most clients break threading
  -- on a fresh subject however correct the References header is.
  subject text not null default '',
  body_html text not null,
  -- The hidden campaign this step's messages hang off. Nullable only so the
  -- row can be inserted before its campaign exists; the materializer refuses a
  -- step without one rather than inventing a campaign at send time.
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (sequence_id, step_index)
);

alter table public.email_sequence_steps enable row level security;

grant select, insert, update, delete on public.email_sequence_steps to authenticated;
grant all on public.email_sequence_steps to service_role;

-- Reachable only through the sequence's organization: the steps table has no
-- organization_id of its own, deliberately, so there is one place a step's
-- tenant is defined and no way for the two to disagree.
drop policy if exists email_sequence_steps_read on public.email_sequence_steps;
create policy email_sequence_steps_read on public.email_sequence_steps
  for select to authenticated using (
    exists (
      select 1 from public.email_sequences s
       where s.id = sequence_id and public.is_org_member(s.organization_id)
    )
  );

drop policy if exists email_sequence_steps_write on public.email_sequence_steps;
create policy email_sequence_steps_write on public.email_sequence_steps
  for all to authenticated
  using (
    exists (
      select 1 from public.email_sequences s
       where s.id = sequence_id and public.is_org_member(s.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.email_sequences s
       where s.id = sequence_id and public.is_org_member(s.organization_id)
    )
  );

-- ── c. email_sequence_enrollments ───────────────────────────────────
create table if not exists public.email_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  -- Carried rather than read through the sequence every time: the
  -- materializer, the suppression check and the stop-on-reply all filter by
  -- organization, and a join per row on the hot path buys nothing.
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  to_email text not null,
  to_name text,
  merge_data jsonb not null default '{}'::jsonb,
  -- Pinned on the first send, never before. A conversation that continues from
  -- a different address is not a conversation: it breaks the recipient's own
  -- threading and reads as two strangers. ON DELETE SET NULL rather than
  -- restrict -- a deleted mailbox must not block deleting itself -- and the
  -- materializer stops an enrollment whose pinned mailbox has gone rather than
  -- silently switching sender.
  account_id uuid references public.email_accounts(id) on delete set null,
  -- The step this enrollment will send NEXT. Starts at 0.
  current_step integer not null default 0,
  -- When that step is due. Null means "not scheduled": either the previous
  -- step has been queued and has not been sent yet, or the sequence is done.
  -- The materializer claims on `next_due_at <= now()`, so a null is simply
  -- never claimed, which is the whole point -- a step becomes due only once
  -- the one before it has actually gone out.
  next_due_at timestamptz default now(),
  -- The email_messages row of the last step sent, which is all threading
  -- needs: phase 1 derives each Message-ID from the row id, so the chain is
  -- reconstructable from the rows without storing a single header.
  last_message_id uuid references public.email_messages(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','stopped','completed')),
  -- Why it ended. 'replied' and 'bounced' come from the inbox scan,
  -- 'unsubscribed' from the public endpoint, 'failed' from a permanent send
  -- failure or a mailbox that has gone, 'manual' from a person.
  stop_reason text
    check (stop_reason is null or stop_reason in
      ('replied','bounced','unsubscribed','failed','manual')),
  stopped_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.email_sequence_enrollments enable row level security;

-- Insert and update, but no delete: an enrollment is the record of what was
-- sent to somebody and why it stopped, which is what a complaint is answered
-- with. Stopping one sets a status; it does not remove the row.
grant select, insert, update on public.email_sequence_enrollments to authenticated;
grant all on public.email_sequence_enrollments to service_role;

drop policy if exists email_enrollments_read on public.email_sequence_enrollments;
create policy email_enrollments_read on public.email_sequence_enrollments
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists email_enrollments_write on public.email_sequence_enrollments;
create policy email_enrollments_write on public.email_sequence_enrollments
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- One ACTIVE enrollment per address per sequence. Enrolling the same person
-- twice into one sequence is a mistake every time -- they would get every step
-- twice, from a tool whose entire value is not looking like a machine. Partial
-- on status so a stopped enrollment does not block a deliberate re-enrollment,
-- and on lower(to_email) because that is how every other email table compares
-- an address.
create unique index if not exists email_enrollments_one_active
  on public.email_sequence_enrollments (sequence_id, lower(to_email))
  where status = 'active';

-- The materializer's claim: active enrollments, due now, oldest first.
create index if not exists email_enrollments_due
  on public.email_sequence_enrollments (next_due_at)
  where status = 'active';

-- The stop-on-reply lookup, which arrives with an organization and an address
-- and must not scan.
create index if not exists email_enrollments_org_address
  on public.email_sequence_enrollments (organization_id, lower(to_email))
  where status = 'active';

-- ── d. what a message knows about its enrollment ────────────────────
--
-- Both nullable: a campaign message has neither. They exist so
-- record_send_result() can advance the right enrollment without a lookup, on
-- the one path where a lookup would be a join against three tables inside the
-- statement that every single send runs through.
alter table public.email_messages
  add column if not exists enrollment_id uuid
    references public.email_sequence_enrollments(id) on delete set null;

alter table public.email_messages
  add column if not exists step_index integer;

-- The mailbox this message MUST go through, or null for "any pool member".
--
-- Phase 1 pins at the campaign: claim_email_batch() takes a row when the
-- campaign names this mailbox or names none. That is the wrong grain for a
-- sequence. A step's hidden campaign is shared by every enrollment at that
-- step, so pinning it would put all of them through one mailbox and undo the
-- pool for sequences entirely -- while pinning nothing lets a follow-up go out
-- from a different address than the message it is replying to, which breaks
-- the recipient's own threading and reads as two strangers.
--
-- So the pin lives on the message, set from the enrollment's own account_id,
-- which record_send_result() stamps the first time a step is sent.
--
-- The foreign key is composite, on (pinned_account_id, organization_id), for
-- the same reason sent_account_id's is (156): a single-column reference would
-- let one organization's row name another organization's mailbox, and the
-- claim's own organization join would then simply never match it -- a message
-- queued for ever, which is worse than the wrong sender.
--
-- ON DELETE SET NULL, deliberately, and it is the one place the thread is
-- allowed to break: a deleted mailbox leaves the message pinned to an id that
-- no longer exists, and the claim would never take it. Releasing it to the
-- pool sends it from the wrong address; not releasing it sends it never. The
-- enrollment-level check in claim_sequence_enrollments() stops the SEQUENCE
-- when its pinned mailbox goes, so this only ever affects a step already
-- queued at that moment.
alter table public.email_messages
  add column if not exists pinned_account_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_messages_pinned_account_fk'
  ) then
    alter table public.email_messages
      add constraint email_messages_pinned_account_fk
      foreign key (pinned_account_id, organization_id)
      references public.email_accounts (id, organization_id)
      on delete set null (pinned_account_id);
  end if;
end $$;

-- The claim filters on it for every queued row, so it is not optional.
create index if not exists email_messages_pinned_account
  on public.email_messages (pinned_account_id)
  where pinned_account_id is not null;

-- Reading a person's thread back, which is what the enrollment screen and the
-- References header both do.
create index if not exists email_messages_enrollment
  on public.email_messages (enrollment_id, step_index)
  where enrollment_id is not null;

-- ── e. 'sequence' is a kind of campaign ─────────────────────────────
--
-- The hidden campaign per step is what lets every step be an ordinary message.
-- The constraint is dropped and recreated rather than altered because a check
-- constraint cannot be extended in place.
alter table public.email_campaigns drop constraint if exists email_campaigns_kind_check;
alter table public.email_campaigns
  add constraint email_campaigns_kind_check
  check (kind in ('single','bulk','sequence'));

notify pgrst, 'reload schema';
