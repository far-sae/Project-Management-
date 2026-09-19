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
- **The mailbox pin is per MESSAGE, not per campaign.** `email_messages.pinned_account_id` (158d) plus one condition in `claim_email_batch()` (160). A step's hidden campaign is shared by every enrollment at that step, so pinning the campaign would route all of them through one mailbox and undo the pool for sequences.
- **Migration numbering continues at 158.** The user runs migrations by hand, later; do not attempt to apply them.
- Verification after every task: `npx tsc --noEmit`, `npx tsc -p api/tsconfig.json --noEmit`, `npx tsc -p worker/tsconfig.json --noEmit`, `npm run build`, and `npx vitest run` with **no new failures** against the documented baseline of **34 failed / 20 passed test files, 3 failed tests** (they import CRM code deleted in migration 143 and are unrelated to this work).

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/158_email_sequences.sql` | The three new tables, their RLS, the two new `email_messages` columns, the `kind` constraint, indexes |
| `supabase/migrations/160_claim_respects_pinned_mailbox.sql` | `claim_email_batch()` re-declared with one added condition, so a follow-up leaves from the mailbox its thread started on |
| `supabase/migrations/159_sequence_engine.sql` | `claim_sequence_enrollments()`, `stop_enrollments_for_address()`, the `record_send_result()` advance, the `record_inbox_result()` stop and `auto_reply` kind, the finalizer skip |
| `src/lib/email/sequence.ts` | Pure: `nextDueAt`, `threadHeaders`, `followUpSubject` (see Task 3's rulings — no `stopReasonFor`, no window argument) |
| `src/lib/email/inbox.ts` (modify) | `isAutoReply(headers)` |
| `src/lib/email/types.ts` (modify) | `EmailSequence`, `EmailSequenceStep`, `EmailEnrollment`, `SequenceStatus`, `EnrollmentStatus`, `StopReason`, `'auto_reply'`, `InboxEnvelope.headers` |
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

Confirm by reading: every `create` is `if not exists` or preceded by a `drop ... if exists`; every policy is dropped before being created; no column reference inside a policy is ambiguous; `lower(to_email)` is used in both indexes that compare an address; and **every new table carries its grants** — RLS does not replace them, and `authenticated` hits a permission error before any policy is consulted. Follow 152's pattern: `select, insert, update, delete` to `authenticated` and `all` to `service_role`, except `email_sequence_enrollments`, which gets no `delete` — an enrollment is the record of what was sent to somebody and why it stopped, and stopping one sets a status rather than removing the row.

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
  - `public.claim_sequence_enrollments(p_limit integer) returns table(enrollment_id uuid, sequence_id uuid, organization_id uuid, contact_id uuid, step_id uuid, step_index integer, campaign_id uuid, account_id uuid, to_email text, to_name text, merge_data jsonb, last_message_id uuid)`
  - **Pre-flight ruling (verified against the schema, not assumed):** `email_messages` has NO `subject` or `body_html` column — both live on `email_campaigns` (migration 152). So the claim returns neither, and the step's hidden campaign carries the wording. `followUpSubject()` is therefore applied when that campaign is created or updated (Task 7's service), not when a message is materialized. `email_campaigns.account_id` is nullable as of migration 156 line 410, so a step's campaign is created with `account_id: null`, meaning the pool.
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
  contact_id uuid,
  step_id uuid,
  step_index integer,
  campaign_id uuid,
  account_id uuid,
  to_email text,
  to_name text,
  merge_data jsonb,
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

  -- A step that EXISTS but has no campaign is not sendable, and the enrollment
  -- must NOT be advanced past it: the select below drops it, the completion
  -- sweep does not catch it (the step row is right there), and it is left
  -- active with a null next_due_at -- never claimed again, never completed,
  -- reporting nothing wrong. Remove those ids from v_ids here instead, leaving
  -- next_due_at where it is, so the enrollment stays due and sends as soon as
  -- the step is saved with its campaign.

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
    returning e.id, e.sequence_id, e.organization_id, e.contact_id,
              e.current_step - 1 as taking_step,
              e.account_id, e.to_email, e.to_name, e.merge_data, e.last_message_id
  )
  -- No subject and no body: email_messages carries neither (migration 152).
  -- The step's own hidden campaign holds the wording, which is why the step
  -- must have a campaign_id before it can be claimed at all.
  select c.id,
         c.sequence_id,
         c.organization_id,
         c.contact_id,
         st.id,
         st.step_index,
         st.campaign_id,
         c.account_id,
         c.to_email,
         c.to_name,
         c.merge_data,
         c.last_message_id
    from claimed c
    join public.email_sequence_steps st
      on st.sequence_id = c.sequence_id
     and st.step_index = c.taking_step
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

Every branch that leaves a message dead must also end its enrollment, and the SCOPE differs by branch — see the rulings recorded against this task:

- `'hard_bounce'`: `stop_enrollments_for_address(org, to_email, 'bounced')`. A bounce is a statement about the recipient, so it is organisation-wide, and the reason is `'bounced'` because the enrollment screen shows that word to a person.
- `'permanent'`: `stop_enrollment(m.enrollment_id, 'failed')` — this enrollment only. Phase 1 routes bad credentials and a rejected sender through `'permanent'` and increments the mailbox's strike count on it, so an organisation-wide stop would end conversations a sibling mailbox was delivering perfectly well, over our own misconfiguration.
- `'transient'` when it retires at three attempts: the same single-enrollment stop. A message that failed three times is no less final for having taken three goes about it.

This needs a second helper, `stop_enrollment(p_enrollment uuid, p_reason text)`, built the same way as `stop_enrollments_for_address` with the same `status = 'active'` idempotency guard.

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

- [ ] **Step 4b: The net — `reconcile_stalled_enrollments()`**

The claim advances `current_step` and clears `next_due_at` in one statement, and it takes nothing with a null due date. So from that instant the only thing that can move an enrollment is its message reaching a terminal state, and any path that ends a message without ending or rescheduling its enrollment leaves that person stopped for ever while every screen reports them active.

Step 3 closes the paths it can see. One it cannot: `claim_email_batch()` marks a message `'suppressed'` when the address was suppressed between materializing and sending, and that happens nowhere near `record_send_result()`.

So add a sweep the worker runs on every sequence cycle: any active enrollment with a null `next_due_at` whose most recent message is `'failed'` or `'suppressed'` is stopped, with reason `'unsubscribed'` for a suppressed message and `'failed'` otherwise. List the dead states explicitly rather than excluding `'sent'`, so a status added later is not swept up by accident.

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

---

### Task 3: The pure helpers

**Files:**
- Create: `src/lib/email/sequence.ts`
- Modify: `src/lib/email/inbox.ts` (add `isAutoReply`)
- Modify: `src/lib/email/types.ts` (the new row types)
- Test: `tests/unit/emailSequence.test.ts`

**Interfaces:**
- Consumes: `InboxEnvelope` from `src/lib/email/types.ts`.
- Produces:
  - `nextDueAt(sentAt: Date, delayHours: number): Date`
  - `threadHeaders(previousMessageIds: string[], senderDomain: string): Record<string, string>`
  - `followUpSubject(stepSubject: string, firstSubject: string): string` — called from Task 7's service when a step's hidden campaign is saved, NOT from the worker: the subject lives on the campaign, so it is resolved once when the step is written rather than on every message.
  - `isAutoReply(headers: Record<string, string>): boolean`
  - types `EmailSequence`, `EmailSequenceStep`, `EmailEnrollment`, `SequenceStatus`, `EnrollmentStatus`, `StopReason`

**Two rulings against the spec's testing list, made here rather than left to an implementer:**

1. The spec writes `nextDueAt(sentAt, delayHours, window)`. It takes **no window**. The send window is enforced by `claim_email_batch()` on the message row, which is where phase 1 put it; applying it again when scheduling would double-apply it — a step due at 5pm Friday would be pushed to Monday here and then held again by the claim, so every step would drift later than the one before.
2. The spec lists `stopReasonFor(event)`. It is **not built**: every stop is written by SQL (`stop_enrollments_for_address`), so a TypeScript function mapping events to reasons would have no caller, and dead code is what the last review round removed twice.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { followUpSubject, nextDueAt, threadHeaders } from '@/lib/email/sequence';
import { isAutoReply } from '@/lib/email/inbox';

describe('nextDueAt', () => {
  it('adds the delay to when the previous step was actually sent', () => {
    expect(nextDueAt(new Date('2026-09-19T09:00:00Z'), 72).toISOString()).toBe(
      '2026-09-22T09:00:00.000Z',
    );
  });

  it('is due immediately on a zero delay', () => {
    const sent = new Date('2026-09-19T09:00:00Z');
    expect(nextDueAt(sent, 0).getTime()).toBe(sent.getTime());
  });

  it('does not apply the send window, which the send claim owns', () => {
    // The message waits in the queue; the SCHEDULE must not also move, or a
    // 72-hour delay grows a little every step.
    const friday = new Date('2026-09-18T17:00:00Z');
    expect(nextDueAt(friday, 72).toISOString()).toBe('2026-09-21T17:00:00.000Z');
  });
});

describe('threadHeaders', () => {
  it('returns nothing for the first step, which starts the thread', () => {
    expect(threadHeaders([], 'acme.com')).toEqual({});
  });

  it('points a follow-up at the message before it', () => {
    const headers = threadHeaders(['aaa-111'], 'acme.com');
    expect(headers['In-Reply-To']).toBe('<aaa-111@acme.com>');
    expect(headers['References']).toBe('<aaa-111@acme.com>');
  });

  it('accumulates the whole chain in References, oldest first', () => {
    const headers = threadHeaders(['one', 'two', 'three'], 'acme.com');
    expect(headers['In-Reply-To']).toBe('<three@acme.com>');
    expect(headers['References']).toBe('<one@acme.com> <two@acme.com> <three@acme.com>');
  });

  it('returns nothing when the sender domain is unknown', () => {
    // A malformed In-Reply-To breaks threading more thoroughly than its
    // absence does.
    expect(threadHeaders(['one'], '')).toEqual({});
  });
});

describe('followUpSubject', () => {
  it('uses the step own subject when it has one', () => {
    expect(followUpSubject('A different angle', 'Quick question')).toBe('A different angle');
  });

  it('inherits the first subject, prefixed, when the step leaves it blank', () => {
    expect(followUpSubject('   ', 'Quick question')).toBe('Re: Quick question');
  });

  it('does not prefix a subject that is already a reply', () => {
    expect(followUpSubject('', 'Re: Quick question')).toBe('Re: Quick question');
    expect(followUpSubject('', 're: quick question')).toBe('re: quick question');
  });
});

describe('isAutoReply', () => {
  it('recognises each header that declares one', () => {
    expect(isAutoReply({ 'auto-submitted': 'auto-replied' })).toBe(true);
    expect(isAutoReply({ 'x-autoreply': 'yes' })).toBe(true);
    expect(isAutoReply({ 'x-autorespond': 'anything' })).toBe(true);
    expect(isAutoReply({ precedence: 'auto_reply' })).toBe(true);
  });

  it('reads header names case-insensitively, as a mail server writes them', () => {
    expect(isAutoReply({ 'Auto-Submitted': 'auto-generated' })).toBe(true);
  });

  it('treats Auto-Submitted: no as ordinary mail, which is what it means', () => {
    // RFC 3834: an ORDINARY message may carry `Auto-Submitted: no`, and some
    // clients put it on everything. Matching on the header's presence would
    // classify real replies as auto-replies, and a real reply that fails to
    // stop a sequence is the exact failure this phase exists to prevent.
    expect(isAutoReply({ 'auto-submitted': 'no' })).toBe(false);
  });

  it('does not guess from wording', () => {
    // "Out of office until Monday" is a sentence a person can type. Phase 2's
    // own subject-matching mistake -- suppressing a human who replied to a
    // forwarded bounce -- is this same mistake in a different place.
    expect(isAutoReply({ subject: 'Out of office until Monday' })).toBe(false);
    expect(isAutoReply({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/emailSequence.test.ts`
Expected: FAIL — `sequence.ts` does not exist and `isAutoReply` is not exported.

- [ ] **Step 3: Write `src/lib/email/sequence.ts`**

```ts
// Pure helpers for phase 3, the sequence engine. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React, so the
// worker and the browser share one definition of each of these.

/**
 * When the step after this one falls due.
 *
 * Measured from when the previous step was actually SENT, never from
 * enrollment: a queue held overnight by the send window would otherwise
 * release three steps within minutes of each other.
 *
 * It takes no send window, deliberately. claim_email_batch() holds a message
 * until the window opens, which is where phase 1 put that rule and where it
 * belongs -- the message waits, the schedule does not move. Applying the
 * window here as well would push this date to the next open hour and the claim
 * would then hold it again, so every step would drift later than the one
 * before and a three-day sequence would take a week.
 */
export function nextDueAt(sentAt: Date, delayHours: number): Date {
  return new Date(sentAt.getTime() + Math.max(delayHours, 0) * 60 * 60 * 1000);
}

/**
 * `In-Reply-To` and `References` for a follow-up, from the ids of the messages
 * already sent in this enrollment, oldest first.
 *
 * Phase 1 gives every message a derived Message-ID of
 * `<{email_messages.id}@{sender domain}>`, so the whole thread is
 * reconstructable from the row ids and nothing has to be stored.
 *
 * Returns an empty object for the first step, which starts the thread, and for
 * an unknown domain -- a malformed In-Reply-To breaks threading more
 * thoroughly than no In-Reply-To at all.
 */
export function threadHeaders(
  previousMessageIds: string[],
  senderDomain: string,
): Record<string, string> {
  if (previousMessageIds.length === 0 || senderDomain.trim() === '') return {};

  const ids = previousMessageIds.map((id) => `<${id}@${senderDomain}>`);
  return {
    'In-Reply-To': ids[ids.length - 1],
    References: ids.join(' '),
  };
}

const ALREADY_A_REPLY = /^\s*re\s*:/i;

/**
 * The subject a follow-up goes out with.
 *
 * A step may carry its own, or leave it blank and inherit the first step's
 * with `Re: ` in front -- which is what a person would do, and what keeps the
 * message in the same conversation: most clients break threading on a fresh
 * subject however correct the References header is.
 */
export function followUpSubject(stepSubject: string, firstSubject: string): string {
  const own = stepSubject.trim();
  if (own !== '') return own;
  return ALREADY_A_REPLY.test(firstSubject) ? firstSubject : `Re: ${firstSubject}`;
}
```

- [ ] **Step 4: Add `isAutoReply` to `src/lib/email/inbox.ts`**

```ts
/**
 * Headers that declare a message machine-generated, per RFC 3834 and the
 * de-facto ones beside it.
 *
 * `Auto-Submitted` is the standard, and its VALUE matters: `no` is what an
 * ordinary message says, and some clients say it on everything. Matching on
 * the header's presence would classify real replies as auto-replies, and a
 * real reply that fails to stop a sequence is exactly the failure phase 3
 * exists to prevent.
 *
 * Wording is deliberately not consulted. "Out of office until Monday" is a
 * sentence a person can type, and phase 2's own subject-matching mistake is
 * the same mistake in a different place.
 */
export function isAutoReply(headers: Record<string, string>): boolean {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase().trim()] = String(value ?? '').toLowerCase().trim();
  }

  const submitted = lower['auto-submitted'];
  if (submitted !== undefined && submitted !== '' && submitted !== 'no') return true;
  if (lower['x-autoreply'] !== undefined) return true;
  if (lower['x-autorespond'] !== undefined) return true;
  if (lower['precedence'] === 'auto_reply') return true;

  return false;
}
```

- [ ] **Step 5: Add the row types to `src/lib/email/types.ts`**

Match the existing types in that file exactly: camelCase properties, `Date` for timestamps, a union type per status column. Add `SequenceStatus`, `EnrollmentStatus`, `StopReason`, `EmailSequence`, `EmailSequenceStep`, `EmailEnrollment`, and add `'auto_reply'` to the inbox event kind union. `InboxEnvelope` gains `headers: Record<string, string>`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/emailSequence.test.ts tests/unit/emailInbox.test.ts`
Expected: PASS, with no new failure in the inbox suite.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm run build
git add src/lib/email/sequence.ts src/lib/email/inbox.ts src/lib/email/types.ts tests/unit/emailSequence.test.ts
git commit -m "feat(email): pure helpers for sequences and auto-reply detection"
```

---

### Task 4: The scan reads the auto-reply headers

**Files:**
- Modify: `worker/lib/imap.ts`, `worker/lib/inboxCycle.ts`
- Test: `tests/unit/emailImap.test.ts`, `tests/unit/emailInboxCycle.test.ts`

**Interfaces:**
- Consumes: `isAutoReply` from Task 3, `InboxEnvelope.headers` from Task 3.
- Produces: envelopes carrying parsed headers; a `record_inbox_result` call with `p_kind = 'auto_reply'`.

- [ ] **Step 1: Widen the envelope fetch**

In `scanInbox`'s envelope pass:

```ts
      for await (const msg of client.fetch(
        { since },
        {
          uid: true,
          envelope: true,
          internalDate: true,
          // Headers, never bodies. The promise this phase makes about the
          // customer's mailbox is that ordinary mail is not pulled into this
          // process, and four header lines per message neither move the cost
          // of the scan nor break it. Named explicitly rather than fetched
          // whole, so widening this stays a deliberate act.
          headers: ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence'],
        },
      )) {
```

imapflow returns `msg.headers` as a `Buffer` of raw header lines. Parse it inside `toEnvelope` into `Record<string, string>`: lower-case the names, unfold continuation lines (a line beginning with whitespace continues the previous one), ignore any line without a colon. An absent or unparseable value becomes `{}` and never throws — a header the server declined to send must not fail a scan.

- [ ] **Step 2: Test the parse before anything uses it**

Extend the fake in `tests/unit/emailImap.test.ts` to yield a `headers` Buffer when the query asks for one (a `headerLines` field on `FakeMessage`), then:

```ts
  it('reads the auto-reply headers without pulling a body', async () => {
    state.messages = [
      message({
        from: 'ada@acme.com',
        headerLines: 'Auto-Submitted: auto-replied\r\nX-Mailer: something\r\n',
      }),
    ];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes[0].headers['auto-submitted']).toBe('auto-replied');
    // And an ordinary message's body is still never fetched.
    expect(state.sourcesFetched).toEqual([]);
  });

  it('unfolds a header split across lines', async () => {
    state.messages = [message({ headerLines: 'Auto-Submitted: auto-\r\n replied\r\n' })];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes[0].headers['auto-submitted']).toBe('auto-replied');
  });

  it('treats a message with no headers as a message with no headers', async () => {
    state.messages = [message({ headerLines: undefined })];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes[0].headers).toEqual({});
  });
```

- [ ] **Step 3: Classify in the cycle**

In `runInboxCycle`, partition the envelopes into auto-replies and the rest BEFORE matching, so an out-of-office can never reach `replied_at`. Run `matchReplies` over each partition separately — reuse it rather than writing a second matcher — so an auto-reply is recorded only when its sender matches an address this organization sent to, the same gate a reply gets. An out-of-office from a stranger is not an event about us.

The `alreadyReplied` skip applies to replies only: it exists so one reply is not written as an event on every overlapping scan, and an auto-reply sets no `replied_at` to check against. The earliest-per-address collapse inside `matchReplies` already gives one auto-reply event per address per scan.

- [ ] **Step 4: Test the cycle change**

```ts
  it('records an out-of-office as an auto-reply and never as a reply', async () => {
    // Phase 2 counted this as a reply. From phase 3 a reply STOPS a sequence,
    // so counting an out-of-office as one silences the follow-up for somebody
    // who never read the first message.
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()], messages: [sentRow()] },
      {
        envelopes: [
          envelope({ from: 'ada@acme.com', headers: { 'auto-submitted': 'auto-replied' } }),
        ],
      },
    );

    await runInboxCycle(h.deps);

    const kinds = h.results().map((c) => (c.args as { p_kind: string }).p_kind);
    expect(kinds).toEqual(['auto_reply']);
  });

  it('still records a real reply from a client that stamps Auto-Submitted: no', async () => {
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()], messages: [sentRow()] },
      { envelopes: [envelope({ from: 'ada@acme.com', headers: { 'auto-submitted': 'no' } })] },
    );

    await runInboxCycle(h.deps);

    expect(h.results().map((c) => (c.args as { p_kind: string }).p_kind)).toEqual(['reply']);
  });

  it('ignores an out-of-office from somebody this organisation never mailed', async () => {
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()], messages: [] },
      {
        envelopes: [
          envelope({ from: 'stranger@example.com', headers: { 'x-autoreply': 'yes' } }),
        ],
      },
    );

    await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(0);
  });
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc -p worker/tsconfig.json --noEmit
npx vitest run tests/unit/emailImap.test.ts tests/unit/emailInboxCycle.test.ts
git add -A && git commit -m "feat(email): record an out-of-office as an auto-reply, not a reply"
```

---

### Task 5: The materialization loop

**Files:**
- Create: `worker/lib/sequenceCycle.ts`
- Modify: `worker/index.ts`
- Test: `tests/unit/emailSequenceCycle.test.ts`

**Interfaces:**
- Consumes: `claim_sequence_enrollments(p_limit)` from Task 2; `followUpSubject` from Task 3; the `InboxDeps` shape in `worker/lib/inboxCycle.ts` as the pattern to follow.
- Produces: `runSequenceCycle(deps: SequenceDeps): Promise<SequenceResult>`, where `SequenceResult` is `{ queued: number; completed: number; errors: string[] }`; `SequenceDeps` is `{ db: SupabaseClient; now: () => Date; shouldStop?: () => boolean }`.

- [ ] **Step 1: Read the loop you are matching**

Read `worker/lib/inboxCycle.ts` end to end — its deps injection, its per-item try/catch, its `note()` helper, its comment style — and `worker/index.ts` for how a loop is scheduled. This task adds a third loop beside the existing two; it does not restructure them.

- [ ] **Step 2: Write the failing tests**

Against a stubbed `db` in the same shape `tests/unit/emailInboxCycle.test.ts` uses:

```ts
  it('queues exactly one message per due enrollment', async () => {
    const h = makeDeps({ claimed: [enrollment({ stepIndex: 0 })] });

    const result = await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages')).toHaveLength(1);
    expect(h.inserted('email_messages')[0]).toMatchObject({
      campaign_id: 'camp-step-0',
      enrollment_id: 'enr-1',
      step_index: 0,
      to_email: 'ada@acme.com',
      status: 'queued',
    });
    expect(result.queued).toBe(1);
  });

  it('does not queue twice for an enrollment the claim already advanced', async () => {
    // The claim advances current_step in the same statement that returns the
    // row, so a second cycle over the same data claims nothing. This asserts
    // the cycle adds no second path of its own.
    const h = makeDeps({ claimed: [enrollment({ stepIndex: 0 })] });

    await runSequenceCycle(h.deps);
    h.claimReturns([]);
    await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages')).toHaveLength(1);
  });

  it('records a failed insert without losing the enrollment', async () => {
    // The claim has already advanced the enrollment, so a failed insert means
    // that step will never be sent. It must be loud, and it must not take the
    // rest of the batch down with it.
    const h = makeDeps({
      claimed: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      insertErrors: 1,
    });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/enr-1/);
  });

  it('stops between enrollments when the process is shutting down', async () => {
    const h = makeDeps({
      claimed: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      shouldStop: () => true,
    });

    await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages').length).toBeLessThan(2);
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/unit/emailSequenceCycle.test.ts`
Expected: FAIL — `worker/lib/sequenceCycle.ts` does not exist.

- [ ] **Step 4: Write the cycle**

One `claim_sequence_enrollments(50)` call per cycle. For each row returned, insert one `email_messages` row:

```ts
{
  campaign_id: row.campaign_id,
  organization_id: row.organization_id,
  contact_id: row.contact_id,
  enrollment_id: row.enrollment_id,
  step_index: row.step_index,
  to_email: row.to_email,
  to_name: row.to_name,
  merge_data: row.merge_data,
  status: 'queued',
  send_after: new Date().toISOString(),
}
```

No `subject` and no `body_html`: `email_messages` has neither column. The step's hidden campaign carries the wording, and `worker/lib/engine.ts` already reads it from there for every message it sends.

Rules this file must hold to, each as a comment saying why:

- **It never sends.** No transport, no SMTP, no `claim_email_batch`. It writes a queued row and stops; phase 1's send cycle picks it up with the pool, the caps, the warmup, the window and the suppression list all applied.
- **One enrollment cannot end the cycle.** Each is in its own try/catch and a failure is recorded and stepped past — the next enrollment is somebody else's tenant.
- **A failed insert is loud.** The claim has already advanced `current_step`, so a row that fails to insert is a step that will never be sent. It goes into `errors` naming the enrollment id, never the address, never the body.
- **`shouldStop` is checked between enrollments, never inside one.**
- **Do not add a subject or body column to `email_messages`.** The pre-flight scan confirmed it has neither and that `engine.ts` reads both from the campaign. Adding one would give a message two places to disagree about its own wording.

- [ ] **Step 5: Wire it into `worker/index.ts`**

A third loop, every 60 seconds, with a start delay so it does not collide with the first send cycle. It uses the same interruptible `waitFor` and the same shutdown flag as the existing two. A sequence cycle failing must not stop the send cycle.

- [ ] **Step 6: Run the tests, verify, commit**

```bash
npx vitest run tests/unit/emailSequenceCycle.test.ts
npx tsc -p worker/tsconfig.json --noEmit && npm run build
git add -A && git commit -m "feat(email): the sequence materialization loop"
```

---

### Task 6: Threading in the send path

**Files:**
- Modify: `worker/lib/engine.ts`
- Test: `tests/unit/emailEngine.test.ts` (or the existing engine test file — find it first)

**Interfaces:**
- Consumes: `threadHeaders` from Task 3; `email_messages.enrollment_id` and `step_index` from Task 1.
- Produces: no new export. The engine's existing send path gains two headers on a sequence follow-up.

This is the ONLY change the send path gets, and it must stay this small.

- [ ] **Step 1: Write the failing test**

```ts
  it('threads a follow-up onto the messages already sent in its enrollment', async () => {
    // Without In-Reply-To and References the follow-up opens a second
    // conversation, and the recipient sees a stranger repeating themselves.
    const h = makeEngine({
      claimed: [row({ id: 'msg-2', enrollment_id: 'enr-1', step_index: 1 })],
      chain: ['msg-1'],
      account: { from_email: 'sales@acme.com' },
    });

    await runSendCycle(h.deps);

    const sent = h.sentMail()[0];
    expect(sent.headers['In-Reply-To']).toBe('<msg-1@acme.com>');
    expect(sent.headers['References']).toBe('<msg-1@acme.com>');
  });

  it('adds no threading headers to a campaign message', async () => {
    const h = makeEngine({ claimed: [row({ id: 'msg-9', enrollment_id: null })] });

    await runSendCycle(h.deps);

    expect(h.sentMail()[0].headers['In-Reply-To']).toBeUndefined();
  });
```

- [ ] **Step 2: Implement**

When the claimed row has an `enrollment_id` and a `step_index` greater than zero, read the ids of that enrollment's already-sent messages in step order — `select id from email_messages where enrollment_id = $1 and status = 'sent' order by step_index` — and merge `threadHeaders(ids, domainOfEmail(account.from_email))` into the headers the message is built with. One read per message is acceptable here and nowhere else: a sequence follow-up is a small fraction of volume, and the alternative is carrying the chain through the claim.

A failed chain read sends the message WITHOUT the headers rather than failing the send. An unthreaded follow-up is a cosmetic loss; a message not sent is the feature not working.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run && npx tsc -p worker/tsconfig.json --noEmit
git add -A && git commit -m "feat(email): thread sequence follow-ups onto the first message"
```

---

### Task 7: The screens

**Files:**
- Create: `src/services/supabase/emailSequences.ts`, `src/components/email/SequencesTab.tsx`, `src/components/email/SequenceEditor.tsx`, `src/components/email/EnrollmentTable.tsx`
- Modify: `src/pages/Email.tsx`

**Interfaces:**
- Consumes: the tables from Task 1; the types from Task 3; the existing `RecipientPicker` and the existing services in `src/services/supabase/email.ts`.
- Produces: a `Sequences` tab on the Email page.

- [ ] **Step 1: Read what you are matching**

Read `src/components/email/CampaignsTab.tsx`, `src/components/email/ComposeTab.tsx` and `src/services/supabase/email.ts` in full. Every pattern this task needs already exists there: the list layout, the dialog shape, the way a service maps snake_case rows to camelCase types, the loading and error states, the toast on save. **Nothing here introduces a new visual pattern.** The user's instruction on this feature was that everything should match.

- [ ] **Step 2: The service**

`listSequences(organizationId)`, `getSequence(id)` (with its steps), `createSequence`, `updateSequence`, `saveStep`, `deleteStep`, `enroll(sequenceId, recipients)`, `listEnrollments(sequenceId)`, `stopEnrollment(id)`.

`createSequence` and `saveStep` must also create or update the step's hidden campaign row and set `campaign_id` on the step. A step with no campaign is never claimed, so this is not optional. The campaign is where the wording actually lives — `email_messages` has no subject or body column — so `saveStep` writes:

- `kind: 'sequence'`, `status: 'sending'`, `account_id: null` (the pool; nullable since migration 156)
- `name: '<sequence name> — step <n+1>'`
- `subject:` for step 0, the step's own subject; for any later step, `followUpSubject(step.subject, stepZero.subject)`
- `body_html:` the step's body

Because the subject is resolved here, editing step 0's subject must re-resolve every later step that inherits — `saveStep` on step 0 updates the campaigns of the steps after it. A step that is already frozen (Step 4) is not re-resolved: its wording is fixed, including the subject people have already received.

`enroll` writes one `email_sequence_enrollments` row per recipient with `next_due_at: now()`, and tolerates the partial unique index rejecting a duplicate: a re-enrolled address that is already active is skipped and reported, not an error the user sees as a failure.

- [ ] **Step 3: The list**

`SequencesTab`: name, status badge, step count, and the enrollment counts (active / replied / stopped / completed). A row opens the editor. A "New sequence" button. Empty state in the same words and layout as `CampaignsTab`'s.

- [ ] **Step 4: The editor**

`SequenceEditor`: the steps in order, each with delay in hours (shown in days where it divides evenly), subject and body, using the same body input and the same `{{placeholder}}` help as Compose. Add a step, remove the last step, reorder is out of scope.

A step that has been sent to anybody is read-only and says so in a sentence — "This step has already been sent, so its wording is fixed. Add a step after it instead." Determined by whether any `email_messages` row exists with that `enrollment_id`'s sequence and `step_index`; ask the service for a count rather than fetching rows.

Activating a sequence requires at least one step with a non-empty body, and step 0 to have a subject. Say which is missing rather than disabling the button silently.

- [ ] **Step 5: The enrollment table**

`EnrollmentTable`: person, current step, next due, status, and the stop reason where there is one, in plain words — "Replied", "Bounced", "Unsubscribed", "Could not be delivered", "Stopped by hand". A row action stops an active enrollment.

- [ ] **Step 6: The tab**

Add `<TabsTrigger value="sequences">Sequences</TabsTrigger>` between Campaigns and Compose, and the matching `TabsContent`.

- [ ] **Step 7: Hide sequence campaigns from the Campaigns tab**

`CampaignsTab`'s query gains `.neq('kind', 'sequence')`. A hidden campaign per step would otherwise fill that list with one row per step per sequence, which is the list's whole usefulness gone.

- [ ] **Step 8: Verify and commit**

```bash
npx tsc --noEmit && npm run build && npx vitest run
git add -A && git commit -m "feat(email): the sequences screens"
```

---

### Task 8: The documentation

**Files:**
- Modify: `docs/email-worker-setup.md`, `docs/email-marketing-setup.md`
- Modify: `worker/README.md`

- [ ] **Step 1: Say what the user has to run**

Migrations 158 and 159, in order, after 157. No new environment variable and no new service: the sequence loop runs inside the worker that is already deployed.

- [ ] **Step 2: Say what a sequence does to the send volume**

A sequence multiplies volume by its step count over its duration. The daily limit and the warmup ramp still bound it, so the practical effect is that a mailbox's queue takes longer to drain, not that it sends more than it should. Say this plainly — it is the first thing a user will ask when their campaign appears to slow down.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: running and operating sequences"
```
