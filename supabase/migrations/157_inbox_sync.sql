-- 157_inbox_sync.sql
--
-- Phase 2 of the deliverability work: reading the mailboxes we send from. See
-- docs/superpowers/specs/2026-09-19-email-inbox-sync-design.md
--
-- Everything up to 156 only ever writes outwards. The worker now also scans
-- each mailbox over IMAP for two facts a send can never report on its own:
-- whether the recipient replied, and whether the message bounced some minutes
-- or hours after SMTP accepted it. Both are properties of a message we already
-- sent, so they land on email_messages; the scan that found them is recorded
-- separately, because "why can we no longer mail this address?" is a support
-- question that has to have an answer months later.
--
-- Five parts, in this order because each is used by the one after it:
--   a. IMAP connection settings on email_accounts -- written by (e).
--   b. replied_at / bounced_at on email_messages -- written by (d).
--   c. email_inbox_events, the scan's record of what it saw -- written by (d).
--   d. record_inbox_result(): one call settles a reply or a bounce.
--   e. touch_inbox_scan(): the scan's own outcome, and nothing else.
--
-- Two rules run through the whole file, and each is one careless edit away
-- from being broken:
--
--   * An IMAP failure must never affect sending. Reading a mailbox and
--     sending from it are separate permissions at every provider -- Google and
--     Zoho both issue app passwords with IMAP left disabled -- so a mailbox
--     nobody can read may still deliver perfectly well. The inbox therefore
--     gets its own imap_status and imap_last_error, and nothing in this file
--     writes `status`, `is_active` or `consecutive_failures`, which are what
--     claim_email_batch() and record_mailbox_failure() in 156 consult to
--     decide whether a mailbox may send. Pausing the pool over an unreadable
--     inbox would be a self-inflicted outage.
--
--   * A bounce suppresses only what this organization actually sent. Bounce
--     notifications are unauthenticated mail from strangers and mailing lists,
--     and a suppression is permanent and tenant-wide. (d) suppresses the
--     matched message's own recorded recipient, so an unmatched bounce has
--     nothing to suppress -- see the comment on that statement.
--
-- No PostgreSQL 15 guard here: 156 already refuses to run on 14 and this
-- migration comes after it, and nothing below needs a 15-only feature -- the
-- one ON DELETE SET NULL is single-column, so it takes no column list.

-- ── a. IMAP settings on email_accounts ──────────────────────────────
--
-- All "add column if not exists", as in 156: this migration must survive a
-- re-run against a database where an earlier attempt got part way.
--
-- IMAP is optional and stays optional. A null imap_host means the mailbox is
-- never scanned -- which is the state every existing row is in the moment this
-- migration finishes, and the state it stays in until someone fills the host
-- in. Phase 1 keeps working untouched for all of them.
alter table public.email_accounts
  add column if not exists imap_host text;

-- 993 is IMAPS; 143 is the cleartext port, and imap_secure defaults to match.
-- These are settings, not credentials: the password stays in
-- email_account_secrets behind its deny-all policy (152), and the same secret
-- serves both SMTP and IMAP.
alter table public.email_accounts
  add column if not exists imap_port integer not null default 993;
alter table public.email_accounts
  add column if not exists imap_secure boolean not null default true;

-- Deliberately a different column from `status`, which records the SMTP
-- credential check, and from is_active, which is the pool's on/off switch. A
-- mailbox can sit at imap_status 'error' and go on sending -- that is the
-- ordinary state of one whose app password was only ever granted send scope --
-- and the whole reason the columns are separate is that no code path can then
-- confuse the two.
--
-- 'unconfigured' rather than `status`'s 'unverified' for the same idea,
-- because nothing has failed: there is simply no host to scan. Every row that
-- predates this migration starts there.
alter table public.email_accounts
  add column if not exists imap_status text not null default 'unconfigured'
    check (imap_status in ('unconfigured','active','error'));

-- Why the last scan failed, in the words classifyImapError() chose: "Zoho
-- needs an app password and IMAP access enabled" is a sentence the Accounts
-- screen can show and an admin can act on. Separate from
-- email_accounts.last_error for the same reason imap_status is separate from
-- status -- a failed scan must not overwrite the explanation of a failed send.
alter table public.email_accounts
  add column if not exists imap_last_error text;

-- When this mailbox was last scanned. The worker starts the next window from
-- here, with a few minutes of overlap (scanWindow in src/lib/email/inbox.ts),
-- so a null means "never scanned" and the first pass looks back one day rather
-- than over the mailbox's whole history.
alter table public.email_accounts
  add column if not exists inbox_last_scan_at timestamptz;

-- ── b. Reply and bounce on email_messages ───────────────────────────
--
-- Both describe the message we sent, not the one that came back: the
-- campaign's numbers are what they are for, and the incoming message itself is
-- never stored at all (the scan reads envelopes, not bodies -- the customer's
-- mail stays in the customer's mailbox). Null means it has not happened; there
-- is no "did not reply" state to backfill.
alter table public.email_messages
  add column if not exists replied_at timestamptz;
alter table public.email_messages
  add column if not exists bounced_at timestamptz;

-- record_inbox_result() below starts from an address and has to find what this
-- organization sent to it, and the worker's reply matching first reads the
-- distinct addresses a mailbox sent to over a bounded recent window. Both are
-- "this organization's messages to this address", and with no index leading on
-- organization_id both are a sequential scan over every message every tenant
-- has ever queued.
--
-- Not a duplicate of anything already here, which is worth stating because the
-- table already carries four indexes: 152's (status, send_after) for the claim
-- and (campaign_id) for a campaign's rows, 155's (campaign_id,
-- organization_id) for its composite foreign key, and 156's (sent_account_id,
-- sent_at) for mailbox_status.sent_today. None of them leads with
-- organization_id, so none can serve a lookup by recipient address.
--
-- One honest limitation: (d)'s match compares lower(m.to_email), which a btree
-- on the plain column cannot satisfy on its own. What this index gives that
-- lookup is the organization_id prefix -- the part that turns "every message
-- ever sent" into "this tenant's" -- while the worker's read of distinct
-- to_email values uses the whole key. If the address match ever becomes hot,
-- the answer is the expression index (organization_id, lower(to_email)), which
-- is what 154 added to email_suppressions for exactly this comparison.
create index if not exists idx_email_messages_org_to_email
  on public.email_messages (organization_id, to_email);

-- ── c. email_inbox_events: what each scan found ─────────────────────
--
-- One row per reply or bounce a scan recognised. It exists because the writes
-- (d) makes -- a timestamp on a message, a row on the suppression list -- keep
-- no record of where they came from. Months later, "why is this address
-- suppressed?" has to be answerable, and so does the more interesting case:
-- "a bounce arrived for them and we deliberately suppressed nothing."
create table if not exists public.email_inbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  -- Whose inbox the event was seen in. ON DELETE SET NULL because the record
  -- has to outlive the mailbox, the same call 156 made for
  -- email_messages.sent_account_id.
  --
  -- A single-column reference is enough here, where 155 and 156 both needed
  -- composite ones. Their columns are writable by a member through an INSERT
  -- policy, and foreign key validation bypasses row level security, so a
  -- single-column key would have let one tenant name another tenant's mailbox.
  -- This table has no insert policy for authenticated at all -- only the
  -- worker writes it, as the definer, from an account id it looked up itself
  -- -- so there is no client-supplied value to constrain.
  account_id uuid references public.email_accounts(id) on delete set null,
  kind text not null check (kind in ('reply','bounce')),
  -- Who the event is about: the replier for a reply, the failed recipient for
  -- a bounce. Stored lower-cased and trimmed by (d), matching how
  -- email_suppressions stores an address and how the claim's lower(s.email)
  -- comparison reads one.
  address text not null,
  -- The sent message it was matched to, or null when nothing matched -- and
  -- the null is the point: it is exactly the bounce that suppressed nothing,
  -- recorded so that the decision is visible rather than invisible. ON DELETE
  -- SET NULL so deleting a campaign's messages does not erase the record of
  -- what arrived.
  message_id uuid references public.email_messages(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.email_inbox_events enable row level security;

-- Select only for a session. Members may read what their own scans found;
-- nobody but the worker writes it. That is said twice on purpose -- the absent
-- write grant and the absent write policy each stop a client write on their
-- own, so loosening either one alone is not enough to let a member forge an
-- event.
grant select on public.email_inbox_events to authenticated;
grant all on public.email_inbox_events to service_role;

drop policy if exists "email_inbox_events_read" on public.email_inbox_events;
create policy "email_inbox_events_read" on public.email_inbox_events
  for select to authenticated
  using (public.is_org_member(organization_id));

-- No insert, update or delete policy, deliberately. record_inbox_result() is
-- security definer and service_role-only, so it writes past RLS and needs
-- none. A member who could insert here could invent a bounce against a rival's
-- address; one who could delete could erase the reason an address is
-- suppressed, which is the one question this table exists to answer.

-- Newest-first for one organization is the only way this is ever read.
create index if not exists idx_email_inbox_events_org
  on public.email_inbox_events (organization_id, created_at desc);

-- ── d. record_inbox_result(): settle a reply or a bounce ────────────
--
-- The worker calls this once per recognised message rather than writing the
-- message, the suppression and the event separately, for the same reason
-- record_send_result() exists in 156: three writes that can half-succeed are
-- three ways for the record to end up disagreeing with what actually happened.
-- One call, one transaction.
--
-- Returns the sent message it matched, or null when nothing matched. The
-- worker logs the difference; the event row records it either way.
--
-- Every column reference in the body is table-qualified. This function returns
-- a scalar, so it has no OUT parameters for a bare reference to collide with,
-- and none of its parameters or locals (p_account, p_kind, p_address, p_at,
-- p_detail, v_org, v_message) shares a name with a column of email_accounts,
-- email_messages, email_suppressions or email_inbox_events. It is qualified
-- anyway: 155 shipped with a single bare reference that collided with an OUT
-- parameter, installed cleanly because CREATE OR REPLACE does not analyse the
-- body, and then raised on every call. The habit is what prevents that, not
-- the audit that follows it.
create or replace function public.record_inbox_result(
  p_account uuid,
  p_kind text,
  p_address text,
  p_at timestamptz,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_message uuid;
begin
  -- The scan is always for one mailbox, and the event row's organization_id is
  -- NOT NULL, so a missing account is not something to record quietly: it
  -- means the worker is holding an account row that has since been deleted.
  -- The caller wraps each mailbox in its own try/catch, so raising costs that
  -- mailbox's cycle and nothing else.
  select a.organization_id
    into v_org
    from public.email_accounts a
   where a.id = p_account;

  if v_org is null then
    raise exception 'record_inbox_result: unknown account %', p_account;
  end if;

  -- The message this is about, if we sent one.
  --
  -- Scoped to the ORGANIZATION rather than to p_account: a pooled campaign
  -- sends from whichever mailbox was free, and a reply goes wherever From or
  -- Reply-To pointed, so requiring the reply to arrive in the same mailbox
  -- that sent it would miss ordinary matches. Suppression is organization-wide
  -- in any case, and the tenant boundary is what actually matters here.
  --
  -- status = 'sent' is what makes this a match against something that really
  -- went out: nobody replied to a queued row, and a bounce quoting a failed
  -- one is quoting a message that never left.
  --
  -- Most recent first, because an address mailed twice is replying to the
  -- latest. NULLS LAST because DESC sorts nulls first in PostgreSQL, and a
  -- 'sent' row with no sent_at -- which record_send_result() never produces,
  -- but 152's schema permits -- would otherwise outrank every real send.
  select m.id
    into v_message
    from public.email_messages m
   where m.organization_id = v_org
     and m.status = 'sent'
     and lower(m.to_email) = lower(trim(p_address))
   order by m.sent_at desc nulls last
   limit 1;

  if p_kind = 'reply' then
    -- coalesce keeps the FIRST reply's time. What follows is more of the same
    -- conversation, not a second reply, and overwriting would push every
    -- "replied after" figure later each time they wrote again.
    --
    -- With no match v_message is null and this updates nothing: a reply from
    -- someone we never mailed is not an error, it is simply not ours. The
    -- event row below still records that we saw it.
    update public.email_messages m
       set replied_at = coalesce(m.replied_at, p_at)
     where m.id = v_message;

  elsif p_kind = 'bounce' then
    -- Same coalesce, same reason: the first failure is when it bounced.
    update public.email_messages m
       set bounced_at = coalesce(m.bounced_at, p_at)
     where m.id = v_message;

    -- The rule this function exists to enforce. A bounce notification is
    -- unauthenticated mail: anyone who knows a customer's address can post
    -- their mailbox a delivery-failure report naming that customer's best
    -- client, and a suppression is permanent and tenant-wide. So suppression
    -- has to be evidence-led.
    --
    -- The address inserted is the MATCHED MESSAGE's own to_email, read back
    -- out of email_messages -- not p_address. With no match there is no row to
    -- select from and nothing at all is inserted, so the rule is the shape of
    -- the statement rather than an `if` that a later edit could quietly drop.
    -- It also means what gets suppressed is the address we hold, not the
    -- spelling a stranger chose to put in their DSN.
    --
    -- Lower-cased and trimmed, and `on conflict do nothing` so an address
    -- already suppressed keeps the reason it has -- both matching 156's
    -- hard_bounce branch and api/email/unsubscribe.ts.
    insert into public.email_suppressions (organization_id, email, reason, campaign_id)
    select m.organization_id,
           lower(trim(m.to_email)),
           'bounced',
           m.campaign_id
      from public.email_messages m
     where m.id = v_message
    on conflict do nothing;

  else
    -- Loud rather than silent, matching record_send_result()'s contract. A
    -- kind the caller invented would otherwise reach the insert below and
    -- surface as a check constraint violation naming a column rather than the
    -- caller. Raising here also guarantees no event is written for a kind we
    -- do not understand.
    raise exception 'record_inbox_result: unknown kind %', p_kind;
  end if;

  -- Written for both kinds, matched or not. The unmatched bounce is the row
  -- that answers "we saw this and deliberately did nothing with it", which is
  -- the answer nothing else in the schema can give.
  insert into public.email_inbox_events
    (organization_id, account_id, kind, address, message_id, detail)
  values
    (v_org, p_account, p_kind, lower(trim(p_address)), v_message, p_detail);

  return v_message;
end;
$$;

-- This writes to every organization's messages and suppression list as the
-- definer, so its privileges are not left to chance.
revoke execute on function public.record_inbox_result(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_inbox_result(uuid, text, text, timestamptz, text)
  to service_role;

-- ── e. touch_inbox_scan(): the scan's outcome, and nothing else ─────
--
-- Called at the end of every scan of a mailbox, successful or not.
--
-- What it does NOT write is the whole point of it. `status`, `is_active` and
-- `consecutive_failures` belong to the send path: claim_email_batch() refuses
-- a mailbox whose status is 'error' or which is not active, and
-- record_mailbox_failure() takes one out of rotation on its third strike.
-- Reading a mailbox and sending from it are separate permissions -- a host
-- typed one character wrong, or an app password granted send scope only, makes
-- the inbox unreadable and changes nothing about delivery. Writing any of
-- those three columns here would turn one wrong setting into a silent outage
-- of the customer's sending, which is the failure this column split exists to
-- prevent.
create or replace function public.touch_inbox_scan(
  p_account uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- p_status is validated by the column's own check constraint rather than
  -- again here, so there is one definition of what an imap_status may be and a
  -- value the caller invented fails loudly instead of being stored.
  --
  -- imap_last_error is written unconditionally, which is how a mailbox that
  -- recovered is cleared: the caller passes null on success, and without this
  -- write the Accounts screen would go on showing the previous failure beside
  -- an imap_status of 'active'. Same reasoning as record_send_result()
  -- clearing last_error on a successful send.
  --
  -- inbox_last_scan_at moves whether the scan succeeded or failed, because it
  -- records when we last tried. The cost is named here rather than left to be
  -- discovered: a scan that failed before reading anything still moves the
  -- window on, so mail that arrived while a mailbox was unauthenticated is not
  -- re-fetched once it is fixed. Holding the timestamp back instead would
  -- re-read that window, but scanWindow()'s one-day floor caps how far back it
  -- could ever reach anyway, so the recovery it buys is a day at most -- and
  -- what is lost is a reply timestamp or an asynchronous bounce, while an
  -- SMTP-time hard bounce is still suppressed by record_send_result() in 156,
  -- which does not depend on this scan at all.
  --
  -- The row is addressed by a.id and every reference is qualified, as in 156:
  -- p_account, p_status and p_error share no name with any column of
  -- email_accounts, and the three columns set here are the only ones touched.
  update public.email_accounts a
     set inbox_last_scan_at = now(),
         imap_status = p_status,
         imap_last_error = p_error
   where a.id = p_account;
end;
$$;

revoke execute on function public.touch_inbox_scan(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.touch_inbox_scan(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
