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
--   b. replied_at / bounced_at on email_messages, and the matching
--      replied_count / bounced_count roll-up on email_campaigns -- all
--      written by (d).
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
--     inbox would be a self-inflicted outage. The other half of the same rule
--     is that an inbox failure must not quietly lose the mail it failed to
--     read: (e) holds the scan cursor still on an error, so the first scan
--     after a repair covers the outage.
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
--
-- 'incomplete' is the fourth, and it is deliberately NOT 'error'. It means the
-- mailbox was read perfectly well -- connected, authenticated, envelopes
-- fetched -- and the scan then could not finish recording what it found,
-- because a record_inbox_result() call would not write or the set of addresses
-- to match against could not be read. Nothing is wrong with the mailbox or its
-- credentials, so the Accounts screen must not say there is: an admin told
-- 'error' goes and re-enters a password that was never wrong. The window is
-- simply re-read on the next pass, which (e) below makes true by holding the
-- cursor for this status as well.
alter table public.email_accounts
  add column if not exists imap_status text not null default 'unconfigured'
    check (imap_status in ('unconfigured','active','error','incomplete'));

-- A database that ran an EARLIER revision of this file already has the column,
-- with the three-value check, and `add column if not exists` above will not
-- revisit it -- the same situation the `drop index` in (b) handles, for the
-- same reason. So the constraint is dropped and recreated by name rather than
-- left to the inline definition above: PostgreSQL names an inline column check
-- <table>_<column>_check, which is the name used here. On a database seeing
-- this file for the first time these two statements simply replace the
-- constraint the ALTER above just created with an identical one.
alter table public.email_accounts
  drop constraint if exists email_accounts_imap_status_check;
alter table public.email_accounts
  add constraint email_accounts_imap_status_check
    check (imap_status in ('unconfigured','active','error','incomplete'));

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

-- Whether a delivered send is also filed as a copy in this mailbox's own Sent
-- folder over IMAP (worker/lib/engine.ts's fileSentCopies). Defaults to on,
-- matching the only behaviour that existed before this column did.
--
-- Independent of imap_host: with no host configured there is nothing to file
-- a copy into, so the switch is simply inert on a mailbox with IMAP off, the
-- same way imap_port and imap_secure are.
--
-- It is also independent of -- and does not replace -- fileSentCopies' own
-- automatic skip for a Google host (providerOf(smtp_host) === 'google'),
-- which stays exactly as it is: Gmail and Google Workspace file their own
-- copy of an SMTP send server-side, so appending one here would hand the
-- customer two copies of every message with no way to undo it from their
-- end. That detection keys off the SMTP HOSTNAME, though, so it cannot see a
-- Google Workspace mailbox sent through a custom relay hostname -- which
-- would still get two copies, with nothing in the product able to stop it,
-- without a switch that does not depend on guessing the provider from the
-- host. This column is that switch: an admin who hits the duplicate turns it
-- off regardless of what the host is named, and the automatic Google skip
-- keeps covering everyone who never has to know this setting exists.
alter table public.email_accounts
  add column if not exists sent_folder_enabled boolean not null default true;

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

-- Per-campaign roll-ups, alongside queued_count/sent_count/failed_count/
-- suppressed_count (152) so a campaign row stays the one place to read every
-- count rather than three, and the Campaigns screen can show these two
-- unconditionally, the same way it already shows the other four.
--
-- Unlike those four, finalize_email_campaigns() (155) never touches these: it
-- only recomputes a campaign still 'sending' or 'scheduled', and a reply or a
-- bounce typically arrives well after a campaign has already closed to
-- 'sent'. record_inbox_result() below increments them itself instead, once
-- per message, exactly on the transition a null replied_at/bounced_at makes
-- to a set one -- see the comment there for how that transition is detected
-- without double-counting a repeat.
alter table public.email_campaigns
  add column if not exists replied_count integer not null default 0;
alter table public.email_campaigns
  add column if not exists bounced_count integer not null default 0;

-- record_inbox_result() below starts from an address and has to find what this
-- organization sent to it, once per reply and once per bounce on every scan.
-- The comparison is case-insensitive of necessity -- the address arrives out
-- of a stranger's mail headers, in whatever case they chose -- so the
-- predicate is lower(m.to_email) = ..., and a btree on the raw column cannot
-- serve that at all. It would narrow to the tenant and then scan every message
-- that tenant has ever queued, which is the one thing that grows without bound
-- here: a customer's message history only ever gets longer.
--
-- The expression index matches that predicate exactly. It is the same pairing
-- 154 made between its lower(s.email) = lower(m.to_email) sweep and
-- idx_email_suppressions_org_lower_email, and it works for the same reason:
-- lower() is immutable, so it may be indexed. The trim() in the predicate sits
-- on the PARAMETER side of the comparison, where it folds to a constant and
-- changes nothing about the expression the planner has to match.
--
-- Nothing already here covers it. The table's four existing indexes are 152's
-- (status, send_after) for the claim and (campaign_id) for a campaign's rows,
-- 155's (campaign_id, organization_id) for its composite foreign key, and
-- 156's (sent_account_id, sent_at) for mailbox_status.sent_today. None of the
-- four leads with organization_id, and none indexes to_email in any form.
-- (The worker's other new read, the addresses an organization sent to
-- recently, is not served by any of them either -- it gets its own index
-- below.)
create index if not exists idx_email_messages_org_lower_to_email
  on public.email_messages (organization_id, lower(to_email));

-- An earlier revision of this same migration created a plain
-- (organization_id, to_email) index here, before the expression index above
-- replaced it. Nothing reads a message by its raw recipient address:
-- api/email/unsubscribe.ts finds the row by id and merely reads the column,
-- and the address read below filters on sent_at, not on to_email. A
-- second index over the same table earns its write cost on every insert into
-- the outbox, which is the highest-volume table here, so one with no reader
-- goes rather than lingering. `if exists` because on any database that never
-- ran that revision it was never created.
drop index if exists public.idx_email_messages_org_to_email;

-- The inbox cycle's OTHER read, and the one the index above cannot serve.
--
-- readSentAddresses() in worker/lib/inboxCycle.ts builds the set of addresses
-- an organization has written to recently, which every incoming sender is
-- matched against. Its predicate carries no address at all:
--   organization_id = $1 and sent_at >= now() - 30 days
--
-- idx_email_messages_org_lower_to_email leads with organization_id, so the
-- planner can use it here -- but only as a leading-column scan. sent_at is not
-- in it, so every message that tenant has ever sent comes back out of the
-- index and the thirty-day bound is applied afterwards as a filter. That is
-- the same unbounded growth this section already worries about, reached from
-- the other side, and it would happen on every inbox cycle of every
-- organization with a connected mailbox: a customer who has been sending for a
-- few months pays for their whole history every five minutes, silently.
--
-- 156's (sent_account_id, sent_at) cannot serve it either, though an earlier
-- revision of the worker was written so that it could. That version read the
-- addresses one MAILBOX had sent to, which fitted that index exactly and was
-- wrong: record_inbox_result() below matches organization-wide, deliberately
-- (see its comment on the pooled campaign), so a reply arriving in one mailbox
-- for a campaign pooled out through another was dropped before the function
-- ever saw it. The read follows the function's scope now and has no
-- sent_account_id left to offer.
--
-- Hence both of the columns it actually filters on, in that order. The
-- direction is immaterial to the >= bound itself -- a btree reads either way
-- -- but it is not immaterial to the read: that query pages, and it orders by
-- sent_at desc with id as the tiebreak precisely so the index can supply the
-- order as well as the range. Ordering by anything else would make the planner
-- sort the whole matched set on every page and throw away most of what this
-- index is for. This is NOT a duplicate of the expression index above:
-- they share a leading column and nothing else, and neither can do the other's
-- job. Deleting either one makes a read that runs every few minutes scan a
-- table that only ever grows.
create index if not exists idx_email_messages_org_sent_at
  on public.email_messages (organization_id, sent_at desc);

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

-- Newest-first for one organization is the only way this table is ever read by
-- a query anyone writes.
create index if not exists idx_email_inbox_events_org
  on public.email_inbox_events (organization_id, created_at desc);

-- ...but PostgreSQL reads it one other way, and never says so. message_id
-- references email_messages ON DELETE SET NULL, and that referential action
-- has to find the referencing rows every time a parent message is deleted --
-- with no index, by scanning this whole table, once per deleted message.
-- Messages are not deleted one at a time: deleting a campaign cascades to
-- every message it ever queued, which is how a routine delete of an old
-- campaign turns into a timeout once this table has a year of events in it.
--
-- account_id deliberately gets no equivalent. It also references ON DELETE SET
-- NULL, but a mailbox is deleted singly and by hand, so the cost is one scan
-- for one deliberate action rather than one per row of a cascade.
create index if not exists idx_email_inbox_events_message
  on public.email_inbox_events (message_id);

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
  --
  -- Raising here is deliberate and was reviewed as such. Nothing but the
  -- worker can call this function -- it is service_role-only -- so an account
  -- id that does not resolve is not user input to be tolerated, it is a bug or
  -- a race, and returning null would hide it behind a scan that looked
  -- successful. The caller wraps each mailbox in its own try/catch, so the
  -- blast radius is that one mailbox's cycle and nothing else.
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
    -- The WHERE clause carries `and m.replied_at is null` rather than the
    -- coalesce an earlier revision used, and it is doing the same job that
    -- coalesce did -- the FIRST reply's time wins, and what follows is more
    -- of the same conversation, not a second reply, so overwriting it would
    -- push every "replied after" figure later each time they wrote again.
    -- Gating the WHERE clause this way, instead of writing the same value
    -- back unconditionally, is what makes plpgsql's FOUND below tell the
    -- truth: it is only true when this call is the one that actually made
    -- the null-to-set transition, never on a repeat, and never when
    -- v_message is null (m.id = null matches no row either way, exactly as
    -- it did before) -- a reply from someone we never mailed is not an
    -- error, it is simply not ours. The event row below still records that
    -- we saw it.
    update public.email_messages m
       set replied_at = p_at
     where m.id = v_message
       and m.replied_at is null;

    -- Increments the matched message's own campaign, and only on the
    -- transition FOUND just confirmed -- never on a repeat reply to a
    -- message already marked replied, and never for an unmatched reply,
    -- since FOUND is then false too. campaign_id is NOT NULL on
    -- email_messages (152), so a matched message always has exactly one
    -- campaign to credit.
    if found then
      update public.email_campaigns c
         set replied_count = c.replied_count + 1
        from public.email_messages m
       where m.id = v_message
         and c.id = m.campaign_id;
    end if;

  elsif p_kind = 'bounce' then
    -- Same transition guard, same reason: the first failure is when it
    -- bounced.
    update public.email_messages m
       set bounced_at = p_at
     where m.id = v_message
       and m.bounced_at is null;

    -- Same increment, same transition-only rule, for the campaign's
    -- bounced_count. Deliberately BEFORE the suppression insert below: that
    -- insert runs unconditionally against whatever v_message resolved to,
    -- repeat bounce or not (it is itself idempotent via `on conflict do
    -- nothing`), so this count would otherwise have no fixed point to check
    -- FOUND against once other statements below have run and reset it.
    if found then
      update public.email_campaigns c
         set bounced_count = c.bounced_count + 1
        from public.email_messages m
       where m.id = v_message
         and c.id = m.campaign_id;
    end if;

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
-- The three-argument shape this function had while phase 2 was being written,
-- dropped rather than left beside the four-argument one below. Nothing has
-- applied this migration anywhere, so on every real database this is a no-op;
-- it is here so a workstation that ran an earlier revision of the file does
-- not end up with two overloads, where PostgREST would have to guess which one
-- a caller meant and the one that ignores p_scanned_at could win.
drop function if exists public.touch_inbox_scan(uuid, text, text);

create or replace function public.touch_inbox_scan(
  p_account uuid,
  p_status text,
  p_error text default null,
  p_scanned_at timestamptz default null
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
  -- inbox_last_scan_at is the scan CURSOR, not a log of when we last tried,
  -- and that is why a failure leaves it exactly where it was. scanWindow() in
  -- src/lib/email/inbox.ts starts the next fetch from this value: advance it
  -- after a scan that read nothing, and the window steps straight over the
  -- period nobody could read, so every reply and bounce that arrived while the
  -- mailbox was unauthenticated stays behind the window forever -- fixing the
  -- password would not bring them back. Holding it still means the first scan
  -- after the repair covers the outage, which is the whole point of this
  -- phase. The re-read cannot run away either: scanWindow() floors the window
  -- at twenty-four hours, so a mailbox broken for a week looks back one day
  -- when it recovers, not a week.
  --
  -- 'error' and 'incomplete' are the two statuses that hold the cursor, for
  -- the same reason and about two different failures: 'error' is the mailbox
  -- we could not read, 'incomplete' is the mailbox we read but whose replies
  -- and bounces we could not finish recording. Either way there is work behind
  -- this window that has not been done, so the window must come round again.
  -- 'active' advances the cursor, and so does 'unconfigured' -- there is
  -- nothing unread behind a mailbox that is not being scanned.
  --
  -- What it advances TO is p_scanned_at, the moment the scan STARTED, falling
  -- back to now() only for a caller that passes nothing. The difference is not
  -- academic: the cursor is the start of the next window, and scanWindow()
  -- gives it SCAN_OVERLAP_MS of slack, three minutes. A scan that takes longer
  -- than that -- a mailbox with a slow server, a long recording pass -- and
  -- then writes now() at the end has moved the cursor past everything that
  -- arrived while it was running. Writing its own start time means the next
  -- window begins where this one did, so a message that landed mid-scan is
  -- read by the next one instead of being stepped over.
  --
  -- The two are separate statuses rather than one because the ACCOUNTS SCREEN
  -- reads them and an admin acts on what it says. 'error' means go and check
  -- the host and the app password; 'incomplete' means nothing is wrong with
  -- the mailbox and the next scan will pick the window up again. Collapsing
  -- them sends people to re-enter a password that was never wrong.
  --
  -- imap_status and imap_last_error are written either way, because the admin
  -- has to see the failure to act on it: a scan that goes on failing silently
  -- while the cursor waits for it is the same outage with no explanation.
  --
  -- The row is addressed by a.id and every reference is qualified, as in 156:
  -- p_account, p_status and p_error share no name with any column of
  -- email_accounts, and the three columns set here are the only ones touched.
  update public.email_accounts a
     set inbox_last_scan_at = case
                                when p_status in ('error','incomplete')
                                  then a.inbox_last_scan_at
                                else coalesce(p_scanned_at, now())
                              end,
         imap_status = p_status,
         imap_last_error = p_error
   where a.id = p_account;
end;
$$;

revoke execute on function public.touch_inbox_scan(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_inbox_scan(uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
