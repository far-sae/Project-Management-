# Email Sequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organization defines a multi-step email sequence, enrolls people in it, and the worker sends each step when it falls due — stopping the moment that person replies, bounces, unsubscribes or fails permanently.

**Architecture:** A sequence step becomes an ordinary `email_messages` row hanging off a hidden `email_campaigns` row, so phase 1's claim, pool, caps, warmup, send window and suppression all apply without change. A new worker loop materializes due enrollments into those rows; phase 2's inbox scan stops enrollments when it records a reply.

**Tech Stack:** Postgres (Supabase) with RLS and `security definer` functions, a Node worker (`worker/`, ESM, run with `tsx`), React 18 + TypeScript strict + Tailwind + Radix, Vitest (`globals: false`).

**Spec:** `docs/superpowers/specs/2026-09-19-email-sequences-design.md`

## Global Constraints

Copied from the spec and from what phases 1 and 2 already enforce. Every task's requirements include these.

- **The send path does not change.** No new sender, no second claim. A sequence step is an `email_messages` row that `claim_email_batch()` picks up like any other. Do not add sequence awareness to `worker/lib/engine.ts` beyond the threading headers named in Task 6.
- **An inbox fault must never affect sending.** Nothing added to `worker/lib/inboxCycle.ts` may write `email_accounts.status`, `is_active` or `consecutive_failures`, nor call `record_mailbox_failure()`.
- **Every column reference inside a PL/pgSQL function is table-qualified.** A bare reference that collides with an OUT parameter or a variable installs cleanly and raises `ambiguous column reference` on the FIRST call, not at `CREATE`. This has bitten this codebase twice.
- **Migrations are idempotent**: `add column if not exists`, `create table if not exists`, `create or replace function`, `drop ... if exists` before a signature change. They must survive a re-run against a database where an earlier attempt got part way.
- **`security_invoker = on` for any view.** Requires PostgreSQL 15; migration 156 already refuses to run on 14, so no new guard is needed.
- **Browser-safe means browser-safe.** Anything under `src/lib/email/` is pure: no Node built-ins, no Supabase client, no network, no React. `api/` may not import from `src/`; `grep -rn "src/lib" api/` must stay empty.
- **Addresses are stored and compared lower-cased and trimmed**, matching `email_suppressions` and the claim's `lower(s.email)` comparison.
- **No message body, subject line, password or recipient list may be written to a log or an error column.** Addresses appear one at a time.
- **Stopping an enrollment is one-way and idempotent.** A stopped enrollment is never re-stopped or reopened; the recorded reason is the FIRST thing that ended it.
- **Delays are measured from the previous step's actual send**, never from enrollment.
- **Migration numbering continues at 158.** The user runs migrations by hand, later; do not attempt to apply them.
- Verification after every task: `npx tsc --noEmit`, `npx tsc -p api/tsconfig.json --noEmit`, `npx tsc -p worker/tsconfig.json --noEmit`, `npm run build`, and `npx vitest run` with **no new failures** against the documented baseline of **34 failed / 20 passed test files, 3 failed tests** (they import CRM code deleted in migration 143 and are unrelated to this work).

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/158_email_sequences.sql` | The three new tables, their RLS, the two new `email_messages` columns, the `kind` constraint, indexes |
| `supabase/migrations/159_sequence_engine.sql` | `claim_sequence_enrollments()`, `stop_enrollments_for_address()`, the `record_send_result()` advance, the `record_inbox_result()` stop and `auto_reply` kind, the finalizer skip |
| `src/lib/email/sequence.ts` | Pure: `nextDueAt`, `threadHeaders`, `followUpSubject`, `stopReasonFor` |
| `src/lib/email/inbox.ts` (modify) | `isAutoReply(headers)` |
| `src/lib/email/types.ts` (modify) | `EmailSequence`, `EmailSequenceStep`, `EmailEnrollment`, `EnrollmentStatus`, `StopReason` |
| `worker/lib/imap.ts` (modify) | Fetch the four auto-reply headers alongside the envelope |
| `worker/lib/inboxCycle.ts` (modify) | Classify an auto-reply and record it as such |
| `worker/lib/sequenceCycle.ts` | The materialization loop |
| `worker/lib/engine.ts` (modify) | `In-Reply-To` / `References` on a step that has a chain |
| `worker/index.ts` (modify) | Run the sequence cycle |
| `src/services/supabase/emailSequences.ts` | Reads and writes for the screens |
| `src/components/email/SequencesTab.tsx` | The list |
| `src/components/email/SequenceEditor.tsx` | Steps, delays, bodies |
| `src/components/email/EnrollmentTable.tsx` | Who is in it, where they are, why they stopped |
| `src/pages/Email.tsx` (modify) | The tab |
| `tests/unit/emailSequence.test.ts` | The pure helpers |
| `tests/unit/emailSequenceCycle.test.ts` | The worker loop against a stubbed database |

---

### Task 1: The schema

**Files:**
- Create: `supabase/migrations/158_email_sequences.sql`

**Interfaces:**
- Consumes: `public.organizations(organization_id)`, `public.workspaces(workspace_id)`, `public.crm_contacts(id)`, `public.email_accounts(id)`, `public.email_campaigns(id)`, `public.email_messages(id)`, and the helpers `public.is_org_member(uuid)` / `public.is_org_admin_or_owner(uuid)` — all as used by migration 152.
- Produces: tables `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`; columns `email_messages.enrollment_id`, `email_messages.step_index`; `email_campaigns.kind` accepting `'sequence'`.

- [ ] **Step 1: Read the conventions you are matching**

Read `supabase/migrations/152_email_marketing_schema.sql` in full, and the header comment of `supabase/migrations/157_inbox_sync.sql`. Match their comment style: say WHY a column exists and what breaks without it, not what the SQL does. Match their RLS shape exactly.

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Check it against the constraints**

Confirm by reading: every `create` is `if not exists` or preceded by a `drop ... if exists`; every policy is dropped before being created; no column reference inside a policy is ambiguous; `lower(to_email)` is used in both indexes that compare an address.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/158_email_sequences.sql
git commit -m "feat(email): the sequences schema"
```

---

### Task 2: The engine in SQL

**Files:**
- Create: `supabase/migrations/159_sequence_engine.sql`
- Read first: `supabase/migrations/156_mailbox_pool_and_worker.sql` (for `claim_email_batch`'s claim shape and `record_send_result`'s full body), `supabase/migrations/157_inbox_sync.sql` (for `record_inbox_result`'s full body)

**Interfaces:**
- Consumes: everything Task 1 created, plus `public.record_send_result(uuid, uuid, text, text, text, boolean)`, `public.record_inbox_result(uuid, text, text, timestamptz, text)`, `public.finalize_email_campaigns()`, `public.email_suppressions`.
- Produces:
  - `public.claim_sequence_enrollments(p_limit integer) returns table(enrollment_id uuid, sequence_id uuid, organization_id uuid, step_id uuid, step_index integer, campaign_id uuid, account_id uuid, to_email text, to_name text, merge_data jsonb, subject text, body_html text, first_subject text, last_message_id uuid)`
  - `public.stop_enrollments_for_address(p_org uuid, p_address text, p_reason text) returns integer`
  - `record_send_result` extended to advance an enrollment on `'sent'` and stop it on `'permanent'` / `'hard_bounce'`
  - `record_inbox_result` extended to stop enrollments on `'reply'` and `'bounce'`, and to accept `p_kind = 'auto_reply'`

- [ ] **Step 1: Write the stop helper first — everything else calls it**

```sql
-- ── a. stop_enrollments_for_address() ───────────────────────────────
--
-- One definition of what stopping means, called from four places: the inbox
-- scan (reply, bounce), the unsubscribe endpoint, and the send result
-- (permanent failure). Having four callers write this UPDATE themselves is how
-- the reasons drift apart and one of them forgets the idempotency guard.
--
-- Organization-wide by ADDRESS, not per enrollment: somebody enrolled in two
-- sequences who replies to one has answered a human, and a second machine
-- still talking to them is the same failure the reply was supposed to prevent.
--
-- `status = 'active'` in the WHERE clause is the idempotency guard and the
-- one-way guard at once. A stopped enrollment is never re-stopped, so
-- stop_reason and stopped_at record the FIRST thing that ended it -- which is
-- the one a support question is ever about -- and a later bounce for an
-- address that already replied does not rewrite the history.
create or replace function public.stop_enrollments_for_address(
  p_org uuid,
  p_address text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stopped integer;
begin
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = p_reason,
         stopped_at = now(),
         next_due_at = null
   where e.organization_id = p_org
     and lower(e.to_email) = lower(trim(p_address))
     and e.status = 'active';

  get diagnostics v_stopped = row_count;
  return v_stopped;
end;
$$;

revoke all on function public.stop_enrollments_for_address(uuid, text, text) from public;
grant execute on function public.stop_enrollments_for_address(uuid, text, text) to service_role;
```

- [ ] **Step 2: The claim**

```sql
-- ── b. claim_sequence_enrollments() ─────────────────────────────────
--
-- The materializer's half of the cycle: take due enrollments, hand the worker
-- everything it needs to write an email_messages row, and advance the
-- enrollment so the same one is not taken twice.
--
-- FOR UPDATE SKIP LOCKED, as claim_email_batch() does, so two workers -- or
-- one worker overlapping itself after a slow cycle -- cannot take the same
-- enrollment. Without it the same person gets the same step twice.
--
-- What it does NOT do is send, or decide whether sending is allowed. Suppression,
-- the pool, the caps, the warmup and the send window are all applied later by
-- claim_email_batch() on the row this produces. The ONE gate here is the
-- suppression check, and it is here as well as there because materializing a
-- message that the send claim will refuse leaves a queued row that never sends
-- and never finalizes, and because an enrollment for a suppressed address
-- should END rather than accumulate dead rows.
create or replace function public.claim_sequence_enrollments(p_limit integer default 50)
returns table (
  enrollment_id uuid,
  sequence_id uuid,
  organization_id uuid,
  step_id uuid,
  step_index integer,
  campaign_id uuid,
  account_id uuid,
  to_email text,
  to_name text,
  merge_data jsonb,
  subject text,
  body_html text,
  first_subject text,
  last_message_id uuid
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
begin
  -- Every reference below is qualified. An unqualified `step_index` or
  -- `to_email` here resolves to this function's own OUT parameter, which
  -- installs cleanly and raises on the first call -- the exact failure this
  -- codebase has already shipped twice.
  select array_agg(d.id)
    into v_ids
    from (
      select e.id
        from public.email_sequence_enrollments e
        join public.email_sequences s on s.id = e.sequence_id
       where e.status = 'active'
         and e.next_due_at is not null
         and e.next_due_at <= now()
         and s.status = 'active'
       order by e.next_due_at
       limit greatest(p_limit, 0)
         for update of e skip locked
    ) d;

  if v_ids is null then
    return;
  end if;

  -- Suppressed addresses end their enrollment rather than queue a message the
  -- send claim would refuse. Done in its own statement, before the advance, so
  -- a suppressed enrollment is never advanced and never returned.
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'unsubscribed',
         stopped_at = now(),
         next_due_at = null
   where e.id = any(v_ids)
     and exists (
       select 1
         from public.email_suppressions sup
        where sup.organization_id = e.organization_id
          and lower(sup.email) = lower(e.to_email)
     );

  -- A pinned mailbox that has gone, or that has been taken out of rotation,
  -- stops the enrollment too. Switching sender mid-conversation would break
  -- the thread for the recipient and put a stranger's address on a reply they
  -- were expecting from someone else.
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'failed',
         stopped_at = now(),
         next_due_at = null
   where e.id = any(v_ids)
     and e.status = 'active'
     and e.account_id is not null
     and not exists (
       select 1
         from public.email_accounts a
        where a.id = e.account_id
          and a.is_active
          and a.status <> 'error'
     );

  -- What is left is sendable. The advance and the read are one statement:
  -- anything that reads first and writes after can hand the same step out
  -- twice if the write fails.
  return query
  with claimed as (
    update public.email_sequence_enrollments e
       set current_step = e.current_step + 1,
           -- Cleared, not computed. The NEXT step becomes due when THIS one is
           -- actually sent, which record_send_result() knows and this function
           -- cannot: the row it is about to create may sit in the queue for
           -- hours behind a send window.
           next_due_at = null
     where e.id = any(v_ids)
       and e.status = 'active'
    returning e.id, e.sequence_id, e.organization_id, e.current_step - 1 as taking_step,
              e.account_id, e.to_email, e.to_name, e.merge_data, e.last_message_id
  )
  select c.id,
         c.sequence_id,
         c.organization_id,
         st.id,
         st.step_index,
         st.campaign_id,
         c.account_id,
         c.to_email,
         c.to_name,
         c.merge_data,
         st.subject,
         st.body_html,
         first_step.subject,
         c.last_message_id
    from claimed c
    join public.email_sequence_steps st
      on st.sequence_id = c.sequence_id
     and st.step_index = c.taking_step
    join public.email_sequence_steps first_step
      on first_step.sequence_id = c.sequence_id
     and first_step.step_index = 0
   where st.campaign_id is not null;

  -- An enrollment whose current_step has no step row has reached the end.
  -- Marked here rather than by the worker, because this function is the only
  -- thing that knows the step did not exist: the join above simply dropped it.
  update public.email_sequence_enrollments e
     set status = 'completed',
         next_due_at = null
   where e.id = any(v_ids)
     and e.status = 'active'
     and not exists (
       select 1
         from public.email_sequence_steps st
        where st.sequence_id = e.sequence_id
          and st.step_index = e.current_step - 1
     );
end;
$$;

revoke all on function public.claim_sequence_enrollments(integer) from public;
grant execute on function public.claim_sequence_enrollments(integer) to service_role;
```

- [ ] **Step 3: Advance on send, stop on failure**

Re-declare `record_send_result()` with its existing body unchanged and these additions. Copy the existing body verbatim from migration 156 — do not paraphrase it; every comment in it is load-bearing and was written in response to a specific bug.

In the `'sent'` branch, after the two existing `update` statements:

```sql
    -- ── phase 3: the next step becomes due ──────────────────────────
    --
    -- HERE and nowhere else, because this is the one place a message becomes
    -- 'sent'. The delay runs from the actual send, so a queue held overnight
    -- by the send window releases the follow-up a proper interval later rather
    -- than minutes after the first message finally went out.
    --
    -- The mailbox is pinned on the way through: the first step's sender is the
    -- sequence's sender, and every later step is queued for it.
    update public.email_sequence_enrollments e
       set next_due_at = now() + make_interval(hours => st.delay_hours),
           last_message_id = m.id,
           account_id = coalesce(e.account_id, p_account)
      from public.email_messages m
      join public.email_sequence_steps st
        on st.sequence_id = e.sequence_id
       and st.step_index = m.step_index + 1
     where m.id = p_message
       and m.enrollment_id = e.id
       and e.status = 'active';

    -- The last step has no successor, so the join above matched nothing and
    -- the enrollment is done. Separate statement: a single one cannot both
    -- schedule and complete.
    update public.email_sequence_enrollments e
       set status = 'completed',
           next_due_at = null,
           last_message_id = m.id
      from public.email_messages m
     where m.id = p_message
       and m.enrollment_id = e.id
       and e.status = 'active'
       and e.next_due_at is null
       and not exists (
         select 1
           from public.email_sequence_steps st
          where st.sequence_id = e.sequence_id
            and st.step_index = m.step_index + 1
       );
```

In the `'permanent'` branch and the `'hard_bounce'` branch, after the existing statements:

```sql
    -- A step that cannot be delivered ends the sequence. Stepping forward
    -- would queue two more messages to an address that has just proved it
    -- cannot receive one, and a hard bounce has suppressed it in any case.
    perform public.stop_enrollments_for_address(
      (select m.organization_id from public.email_messages m where m.id = p_message),
      (select m.to_email from public.email_messages m where m.id = p_message),
      'failed'
    );
```

- [ ] **Step 4: Stop on reply, and the `auto_reply` kind**

Re-declare `record_inbox_result()` with its existing body unchanged, plus:

```sql
-- The event kinds this function accepts. 'auto_reply' is new in phase 3: an
-- out-of-office is recorded so the scan's work is visible and a support
-- question has an answer, and it does exactly nothing else. It does not mark
-- replied_at, so it does not inflate the reply rate; it does not stop a
-- sequence, because the person has not read the message. Phase 2 counted one
-- as a reply and flagged this as phase 3's to settle. This is it, settled.
alter table public.email_inbox_events drop constraint if exists email_inbox_events_kind_check;
alter table public.email_inbox_events
  add constraint email_inbox_events_kind_check
  check (kind in ('reply','bounce','auto_reply'));
```

In the `'reply'` branch, after the campaign counter update:

```sql
    -- A reply ends every sequence this organisation is running at that
    -- address, whether or not it matched a message -- somebody writing to a
    -- mailbox we are sequencing has engaged, and a follow-up after that reads
    -- as a machine that is not listening. Organisation-wide and by address,
    -- for the reason on stop_enrollments_for_address().
    perform public.stop_enrollments_for_address(v_org, p_address, 'replied');
```

In the `'bounce'` branch, inside the existing `if v_message is not null` guard — a bounce for an address this organization never mailed must not stop anything:

```sql
      perform public.stop_enrollments_for_address(v_org, p_address, 'bounced');
```

And an `elsif p_kind = 'auto_reply' then` branch that records the event and returns without touching `email_messages` at all. The final `insert into public.email_inbox_events` is shared by every branch and needs no change.

- [ ] **Step 5: The finalizer leaves sequence campaigns alone**

`finalize_email_campaigns()` closes a campaign once no message of it is still open. A step's campaign is open for as long as the sequence can enroll anybody, which is not a state the finalizer can see, so it must skip them:

```sql
-- ...and never a sequence step's campaign. Its queue empties every time the
-- last enrolled person reaches that step and fills again with the next
-- enrollment, so "no open messages" means nothing here -- finalizing it would
-- mark a running sequence complete, repeatedly.
   and c.kind <> 'sequence'
```

Add that line to the existing `where` clause; read the function out of its own migration first and re-declare it whole.

- [ ] **Step 6: Check every function for ambiguity**

For each function in this file, read every statement and confirm each column reference is prefixed by its table alias, and that no alias shadows an OUT parameter name. `claim_sequence_enrollments` returns `step_index`, `to_email`, `subject`, `campaign_id` and `account_id` — all of which are also column names.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/159_sequence_engine.sql
git commit -m "feat(email): the sequence engine in SQL"
```
