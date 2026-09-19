# Email Inbox Sync (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker reads each connected mailbox over IMAP on a slow loop. A reply marks the message and its contact and shows in the campaign. A bounce suppresses the address. Every message the worker sends is filed in the mailbox's own Sent folder.

**Architecture:** A second, slower cycle in the existing worker, every five minutes, separate from the fifteen-second send cycle. All matching and parsing lives in pure helpers under `src/lib/email/` so it is unit-tested without a network; `worker/lib/imap.ts` holds the only IMAP code. Sent-folder sync changes the send path to build raw MIME once and hand the same bytes to SMTP and to the Sent folder.

**Tech Stack:** Node 20 + tsx, `imapflow`, nodemailer (`MailComposer` for raw MIME), Supabase Postgres, React 18 + TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-email-inbox-sync-design.md`

**Reference implementation (read-only, do not import):** `C:/Users/faraz/AppData/Local/Temp/claude/c--Users-faraz-task/b7c839a1-9ee9-44a3-b332-28fa768899a9/scratchpad/outreach-pilot-dash`. Its `src/server/imap.ts` is the proven version of the connection handling, the envelope scan, the bounce heuristics and the Sent-folder append. Port the behaviour; its React 19 interface does not apply here.

## Global Constraints

- `npm run build` runs `tsc` strict with `noUnusedLocals` and `noUnusedParameters`. The root `tsconfig.json` has `"include": ["src"]`.
- `npm run lint` is NOT runnable in this repo. Do not create an ESLint config.
- 34 test files already fail on `main` at import because they reference CRM code deleted in migration 143. That is the baseline; the bar is no NEW failures.
- Tests live in `tests/unit/*.test.ts`, Vitest with `globals: false`. Path alias `@/` maps to `src/`.
- `api/` is CommonJS and must never import from `src/`; `grep -rn "src/lib" api/` must keep returning nothing. `worker/` is ESM and MAY import from `src/lib/email/`.
- Migration numbering continues from 156. Use 157. No migration on this branch has been applied to any database, but 157 is new work: write it as its own file rather than amending 156.
- IMAP is optional. A mailbox with no `imap_host` is simply not scanned, and every phase 1 behaviour must continue unchanged.
- An IMAP failure must never affect sending. A mailbox that cannot be read can still deliver.
- Never log a password, a message body, a subject line, or a full recipient list.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File map

| File | Responsibility |
|---|---|
| `src/lib/email/inbox.ts` (new) | Pure: reply matching, bounce heuristics, address extraction, scan windows |
| `src/lib/email/imapErrors.ts` (new) | Pure: classify an IMAP failure, provider-specific advice |
| `src/lib/email/types.ts` | IMAP fields on the mailbox types, plus the inbox event type |
| `supabase/migrations/157_inbox_sync.sql` (new) | IMAP columns, reply and bounce columns, `email_inbox_events`, the recording function |
| `worker/lib/imap.ts` (new) | The only IMAP code: connect, scan envelopes, fetch bounce candidates, append to Sent |
| `worker/lib/inboxCycle.ts` (new) | One scan pass over one organization's mailboxes |
| `worker/lib/engine.ts` | Build raw MIME once; collect sent bytes for the Sent folder |
| `worker/lib/mailer.ts` | Expose `buildRaw` |
| `worker/index.ts` | The second loop, on its own interval |
| `src/services/supabase/email.ts` | IMAP settings, inbox events, reply and bounce counts |
| `src/components/email/AccountFormDialog.tsx`, `MailboxCard.tsx` | IMAP fields, IMAP health, last scan |
| `src/components/email/CampaignsTab.tsx` | Replied and bounced per recipient and per campaign |
| `docs/superpowers/deployment/email-worker-setup.md` | IMAP setup and the new interval variable |

---

### Task 1: Pure inbox helpers with tests

**Files:**
- Create: `src/lib/email/inbox.ts`, `src/lib/email/imapErrors.ts`
- Modify: `src/lib/email/types.ts`
- Test: `tests/unit/emailInbox.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// types.ts additions
export type ImapStatus = 'unconfigured' | 'active' | 'error';
export interface InboxEnvelope {
  from: string;
  subject: string;
  at: Date;
}
export interface InboxEvent {
  id: string;
  organizationId: string;
  accountId: string;
  kind: 'reply' | 'bounce';
  address: string;
  messageId: string | null;
  detail: string | null;
  createdAt: Date;
}

// inbox.ts
export const FIRST_SCAN_LOOKBACK_MS: number;   // 24 hours
export const SCAN_OVERLAP_MS: number;          // 3 minutes
export function scanWindow(lastScanAt: Date | null, now: Date): Date;
export function normalizeAddress(raw: string): string;
export function matchReplies(
  incoming: InboxEnvelope[], sentTo: string[],
): Array<{ address: string; at: Date }>;
export function looksLikeBounce(envelope: InboxEnvelope): boolean;
export function extractBouncedAddress(source: string): string | null;

// imapErrors.ts
export type ImapOutcome = 'auth' | 'unreachable' | 'other';
export function classifyImapError(err: unknown): ImapOutcome;
export function friendlyImapError(err: unknown, host?: string): string;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/emailInbox.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  FIRST_SCAN_LOOKBACK_MS, SCAN_OVERLAP_MS,
  scanWindow, normalizeAddress, matchReplies, looksLikeBounce, extractBouncedAddress,
} from "@/lib/email/inbox";
import { classifyImapError, friendlyImapError } from "@/lib/email/imapErrors";
import type { InboxEnvelope } from "@/lib/email/types";

const now = new Date("2026-09-19T12:00:00Z");
const env = (over: Partial<InboxEnvelope> = {}): InboxEnvelope => ({
  from: "ada@acme.com", subject: "Re: hello", at: now, ...over,
});

describe("scanWindow", () => {
  it("looks back one day on the first scan", () => {
    expect(scanWindow(null, now).getTime()).toBe(now.getTime() - FIRST_SCAN_LOOKBACK_MS);
  });
  it("starts a little before the last scan so nothing falls between scans", () => {
    const last = new Date("2026-09-19T11:50:00Z");
    expect(scanWindow(last, now).getTime()).toBe(last.getTime() - SCAN_OVERLAP_MS);
  });
  it("never returns a window wider than the first-scan floor", () => {
    const ancient = new Date("2020-01-01T00:00:00Z");
    expect(scanWindow(ancient, now).getTime()).toBe(now.getTime() - FIRST_SCAN_LOOKBACK_MS);
  });
  it("never returns a window in the future when the clock jumped backwards", () => {
    const future = new Date("2026-09-19T13:00:00Z");
    expect(scanWindow(future, now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("normalizeAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeAddress("  Ada@Acme.COM ")).toBe("ada@acme.com");
  });
  it("strips angle brackets and a display name", () => {
    expect(normalizeAddress('"Ada Lovelace" <Ada@Acme.com>')).toBe("ada@acme.com");
  });
  it("returns an empty string for junk", () => {
    expect(normalizeAddress("not an address")).toBe("");
  });
});

describe("matchReplies", () => {
  const sentTo = ["ada@acme.com", "bob@other.com"];
  it("matches a sender we mailed", () => {
    const out = matchReplies([env()], sentTo);
    expect(out.map((r) => r.address)).toEqual(["ada@acme.com"]);
  });
  it("ignores a sender we never mailed", () => {
    expect(matchReplies([env({ from: "stranger@nowhere.com" })], sentTo)).toEqual([]);
  });
  it("matches case-insensitively and through a display name", () => {
    const out = matchReplies([env({ from: "Ada <ADA@ACME.COM>" })], sentTo);
    expect(out.map((r) => r.address)).toEqual(["ada@acme.com"]);
  });
  it("counts a sender who replied twice once, keeping the earliest reply", () => {
    const early = new Date("2026-09-19T10:00:00Z");
    const late = new Date("2026-09-19T11:00:00Z");
    const out = matchReplies([env({ at: late }), env({ at: early })], sentTo);
    expect(out).toHaveLength(1);
    expect(out[0].at.getTime()).toBe(early.getTime());
  });
  it("returns nothing when we sent to nobody", () => {
    expect(matchReplies([env()], [])).toEqual([]);
  });
});

describe("looksLikeBounce", () => {
  it("recognises the usual notifier senders", () => {
    expect(looksLikeBounce(env({ from: "MAILER-DAEMON@acme.com" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "postmaster@acme.com" }))).toBe(true);
  });
  it("recognises the usual subjects", () => {
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Undeliverable: hello" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Delivery Status Notification" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Returned mail: see below" }))).toBe(true);
  });
  it("leaves an ordinary reply alone", () => {
    expect(looksLikeBounce(env())).toBe(false);
  });
});

describe("extractBouncedAddress", () => {
  it("reads the standard Final-Recipient field", () => {
    const src = "Final-Recipient: rfc822; bob@other.com\r\nAction: failed\r\n";
    expect(extractBouncedAddress(src)).toBe("bob@other.com");
  });
  it("falls back to an inline failure line", () => {
    const src = "Your message to bob@other.com could not be delivered.";
    expect(extractBouncedAddress(src)).toBe("bob@other.com");
  });
  it("returns null when it finds nothing", () => {
    expect(extractBouncedAddress("nothing useful here")).toBeNull();
  });
  it("lowercases what it finds", () => {
    expect(extractBouncedAddress("Final-Recipient: rfc822; BOB@OTHER.COM")).toBe("bob@other.com");
  });
});

describe("classifyImapError", () => {
  it("recognises an authentication failure", () => {
    expect(classifyImapError({ authenticationFailed: true })).toBe("auth");
    expect(classifyImapError(new Error("Invalid credentials (AUTHENTICATIONFAILED)"))).toBe("auth");
  });
  it("recognises an unreachable server", () => {
    expect(classifyImapError({ code: "ETIMEDOUT" })).toBe("unreachable");
    expect(classifyImapError({ code: "ENOTFOUND" })).toBe("unreachable");
  });
  it("falls back to other", () => {
    expect(classifyImapError(new Error("something odd"))).toBe("other");
  });
});

describe("friendlyImapError", () => {
  it("tells a Zoho user to enable IMAP and use an app password", () => {
    const s = friendlyImapError({ authenticationFailed: true }, "imap.zoho.eu");
    expect(s).toMatch(/zoho/i);
    expect(s).toMatch(/app password/i);
  });
  it("mentions port 993 when the server is unreachable", () => {
    expect(friendlyImapError({ code: "ETIMEDOUT" }, "imap.acme.com")).toMatch(/993/);
  });
  it("falls back to the raw message", () => {
    expect(friendlyImapError(new Error("weird imap failure"))).toContain("weird imap failure");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/emailInbox.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/email/inbox"`.

- [ ] **Step 3: Implement**

Add the types to `src/lib/email/types.ts`.

`src/lib/email/inbox.ts`:
- `FIRST_SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000`, `SCAN_OVERLAP_MS = 3 * 60 * 1000`.
- `scanWindow` returns `lastScanAt` minus the overlap, floored at `now` minus the lookback, and never later than `now`. Comment why the floor exists: a mailbox that has not been scanned for a month must not pull a month of envelopes on its first pass back.
- `normalizeAddress` extracts the address from a `Name <addr>` form, trims, lowercases, and returns an empty string when the result does not contain an `@` with something either side.
- `matchReplies` normalizes both sides, keeps only senders present in `sentTo`, and returns one entry per address carrying the earliest `at`. Comment why the earliest: that is when they actually replied; a later message from the same person is part of the same conversation.
- `looksLikeBounce` tests the sender against `mailer-daemon`, `postmaster` and `no-?reply` notifier patterns, and the subject against undeliverable, delivery status, returned mail, and failure notice.
- `extractBouncedAddress` tries `Final-Recipient:` with its optional `rfc822;` prefix first, then an inline pattern, and lowercases the result.

`src/lib/email/imapErrors.ts`: port the classification and the provider advice from the reference project's `friendlyImapError`, keeping Zoho's "needs an app password and IMAP access enabled", the port 993 guidance, and the generic full-address-as-username advice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/emailInbox.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Type check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/email tests/unit/emailInbox.test.ts
git commit -m "feat(email): pure helpers for reply matching, bounce parsing and scan windows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema for IMAP, replies and bounces

**Files:**
- Create: `supabase/migrations/157_inbox_sync.sql`

**Interfaces:**
- Consumes: the tables from 152, the pool columns and helpers from 156.
- Produces: IMAP columns on `email_accounts`; `replied_at` and `bounced_at` on `email_messages`; table `email_inbox_events`; function `record_inbox_result`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/157_inbox_sync.sql`, in this order, commented in the house style of 152 to 156:

**a. IMAP columns** on `email_accounts`, all `add column if not exists`:
`imap_host text`, `imap_port integer not null default 993`,
`imap_secure boolean not null default true`,
`imap_status text not null default 'unconfigured' check (imap_status in ('unconfigured','active','error'))`,
`imap_last_error text`, `inbox_last_scan_at timestamptz`.
Comment that IMAP is optional and a null host means the mailbox is never scanned.

**b. Reply and bounce columns** on `email_messages`: `replied_at timestamptz`,
`bounced_at timestamptz`, plus an index on `(organization_id, to_email)` to
support matching an incoming address back to what was sent. Check whether 152
or 155 already created an equivalent index before adding a duplicate.

**c. `email_inbox_events`**: `id uuid primary key default gen_random_uuid()`,
`organization_id uuid not null references organizations(organization_id) on delete cascade`,
`account_id uuid references email_accounts(id) on delete set null`,
`kind text not null check (kind in ('reply','bounce'))`,
`address text not null`, `message_id uuid references email_messages(id) on delete set null`,
`detail text`, `created_at timestamptz not null default now()`.
RLS on; select for `is_org_member`; no insert, update or delete policy for
`authenticated`, because only the worker writes it. Index on
`(organization_id, created_at desc)`.

**d. `record_inbox_result`**, `security definer`, `set search_path`, revoked
from `public, anon, authenticated` and granted to `service_role`:

```
record_inbox_result(
  p_account uuid, p_kind text, p_address text, p_at timestamptz, p_detail text
) returns uuid
```

For `'reply'`: find the most recent `email_messages` row for that account's
organization whose `to_email` matches case-insensitively and whose status is
`'sent'`, set `replied_at = coalesce(replied_at, p_at)` so a second reply does
not overwrite the first, insert an `email_inbox_events` row, and return the
message id or null.

For `'bounce'`: the same lookup, set `bounced_at = coalesce(bounced_at, p_at)`,
upsert `email_suppressions` with reason `'bounced'` on conflict do nothing, and
insert the event. **Suppress only when a matching sent message was found**; a
bounce for an address this organization never mailed must not land on their
suppression list, so in that case insert the event with a null message id and
suppress nothing.

Any other `p_kind` raises, matching `record_send_result`'s contract.

Every column reference must be table-qualified. `record_inbox_result` has no
OUT parameters, but qualify anyway for consistency with 156.

**e. `touch_inbox_scan(p_account uuid, p_status text, p_error text)`**, same
security shape, setting `inbox_last_scan_at = now()`, `imap_status` and
`imap_last_error`. It must never touch `status`, `is_active` or
`consecutive_failures`: a mailbox that cannot be read can still send.

End with `notify pgrst, 'reload schema';`.

- [ ] **Step 2: Read it back and confirm**

Confirm individually in the report: every new table has RLS and a policy; the
functions are revoked and granted correctly; the bounce path cannot suppress an
address with no matching sent message; nothing in the file writes `status`,
`is_active` or `consecutive_failures`; and no bare column reference collides
with a parameter name.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/157_inbox_sync.sql
git commit -m "feat(email): schema for IMAP settings, replies, bounces and inbox events

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The IMAP client module

**Files:**
- Create: `worker/lib/imap.ts`
- Modify: `package.json` (add `imapflow`)

**Interfaces:**
- Consumes: `src/lib/email/inbox.ts`, `src/lib/email/imapErrors.ts`.
- Produces:

```ts
export interface ImapConfig {
  host: string; port: number; secure: boolean; user: string; password: string;
}
export function fetchRecentEnvelopes(
  cfg: ImapConfig, since: Date, limit?: number,
): Promise<InboxEnvelope[]>;
export function fetchBounceSources(
  cfg: ImapConfig, since: Date, limit?: number,
): Promise<Array<{ envelope: InboxEnvelope; source: string }>>;
export function appendToSent(
  cfg: ImapConfig, messages: Buffer[],
): Promise<number>;
```

- [ ] **Step 1: Add the dependency**

Run: `npm install imapflow`. It is a runtime dependency of the worker, so it
belongs in `dependencies`, like `tsx`, `nodemailer` and `@supabase/supabase-js`.
Confirm nothing else in the lockfile changed version.

- [ ] **Step 2: Write the module**

Port from the reference project's `src/server/imap.ts`, keeping its reasoning
comments where they explain something non-obvious:

- A client factory that attaches an `error` listener before connecting. Keep
  the comment explaining why: ImapFlow is an EventEmitter, Node terminates the
  process on an unhandled `error` event, and those arrive asynchronously, so
  the try/catch around `connect()` never sees them. Without the listener a
  stalled IMAP connection kills the worker.
- `fetchRecentEnvelopes`: envelopes only, never bodies, with a limit. Keep the
  comment that bodies are never downloaded, which keeps the scan fast and keeps
  the customer's mail out of our system.
- `fetchBounceSources`: fetch envelope and source, but only download the source
  of messages `looksLikeBounce` already accepts, and stop at the limit.
- `appendToSent`: find the folder by its `\Sent` special-use flag, falling back
  to `Sent`, and append every buffer over one connection.
- Every function closes its connection in a `finally`, tolerating a `logout`
  that throws on an already-dropped socket.

Pass `socketTimeout` and `greetingTimeout` as the reference does.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -p worker/tsconfig.json --noEmit` and `npx tsc --noEmit`.

```bash
git add worker/lib/imap.ts package.json package-lock.json
git commit -m "feat(email): IMAP client for envelope scans, bounce sources and Sent append

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The inbox cycle

**Files:**
- Create: `worker/lib/inboxCycle.ts`
- Modify: `worker/index.ts`
- Test: `tests/unit/emailInboxCycle.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `record_inbox_result` and `touch_inbox_scan` from Task 2.
- Produces:

```ts
export interface InboxDeps {
  db: SupabaseClient;
  connect: {
    envelopes: (cfg: ImapConfig, since: Date) => Promise<InboxEnvelope[]>;
    bounces: (cfg: ImapConfig, since: Date) => Promise<Array<{ envelope: InboxEnvelope; source: string }>>;
  };
  now: () => Date;
  env: { tokenKey: string };
  shouldStop?: () => boolean;
}
export interface InboxResult {
  scanned: number; replies: number; bounces: number; errors: string[];
}
export async function runInboxCycle(deps: InboxDeps): Promise<InboxResult>;
```

Every side effect arrives through `deps`, so the test drives it with stubs.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/emailInboxCycle.test.ts` with a stubbed Supabase client
recording its calls, covering:

1. A mailbox with no `imap_host` is skipped entirely: no connection attempted,
   no scan recorded.
2. A reply from an address the mailbox sent to calls `record_inbox_result` with
   kind `reply`, that address, and the envelope's time.
3. A sender the mailbox never wrote to produces no call at all.
4. A bounce-shaped message calls `record_inbox_result` with kind `bounce` and
   the extracted address.
5. A message that is not bounce-shaped never has its source fetched.
6. An authentication failure calls `touch_inbox_scan` with status `error` and a
   readable message, and makes no attempt to change the mailbox's sending
   status.
7. A successful scan calls `touch_inbox_scan` with status `active`.
8. The scan window passed to the client is the first-scan floor when the
   mailbox has never been scanned, and the overlap window when it has.
9. A failure on one mailbox does not stop the next mailbox being scanned.
10. `shouldStop` returning true between mailboxes ends the cycle cleanly.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/emailInboxCycle.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the cycle**

`worker/lib/inboxCycle.ts`: page through mailboxes with an `imap_host`, the way
`readAll` in `engine.ts` pages, ordered deterministically. For each: decrypt the
stored secret, compute the window with `scanWindow`, fetch envelopes, match
against the addresses that mailbox sent to, record each reply, then fetch bounce
candidates and record each extracted address, then `touch_inbox_scan`. Wrap each
mailbox in its own try/catch so one failure cannot end the cycle, and classify a
failure with `classifyImapError` so an authentication error is recorded as such.

To match replies, read the distinct `to_email` values this account sent within a
bounded window, for example the last thirty days, rather than the whole history.
Say so in a comment: an unbounded read would grow without limit.

`worker/index.ts`: add the second loop on `INBOX_INTERVAL_MS`, defaulting to
300000. It must run independently of the send loop, log a one-line summary, and
never let an inbox failure stop sending. Reuse the same shutdown flag.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/unit/emailInboxCycle.test.ts`, `npx tsc --noEmit`,
`npx tsc -p worker/tsconfig.json --noEmit`, `npm run build`.

```bash
git add worker/lib/inboxCycle.ts worker/index.ts tests/unit/emailInboxCycle.test.ts
git commit -m "feat(email): inbox cycle recording replies and bounces per mailbox

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sent-folder sync

**Files:**
- Modify: `worker/lib/mailer.ts`, `worker/lib/engine.ts`

**Interfaces:**
- Consumes: `appendToSent` from Task 3.
- Produces: `buildRaw(mail: Mail.Options): Promise<Buffer>` from `worker/lib/mailer.ts`.

- [ ] **Step 1: Expose raw MIME**

Add `buildRaw` to `worker/lib/mailer.ts` using nodemailer's `MailComposer`,
with the reference project's comment: sending these exact bytes and appending
the same bytes guarantees the copy in the mailbox is byte-identical to what the
recipient received, same Message-ID and headers, which building it twice would
not achieve.

- [ ] **Step 2: Send the raw bytes**

In `engine.ts`, build the mail options as today, then `buildRaw` them once, pass
the buffer to `transport.sendMail({ raw })`, and keep the buffer for the batch.
Do not change the surrounding logic: the settlement must stay outside the send's
try/catch, the delivered flag must still be set the moment `sendMail` resolves,
and `deliveredOnTransport` must still increment, because the mailbox-fault rule
depends on it.

- [ ] **Step 3: File the copies**

After a mailbox's batch finishes, if the account has an `imap_host`, append the
collected buffers to its Sent folder over one connection. Wrap it so a failure
is noted and never fails a send, with a comment saying why: the message was
delivered, the copy is a convenience. Skip entirely when the mailbox has no
IMAP configuration.

- [ ] **Step 4: Extend the engine test**

Add cases to `tests/unit/emailEngine.test.ts`: the raw buffer handed to
`sendMail` is the one `buildRaw` produced; the same buffers are handed to the
Sent append; an append that rejects does not change any message's outcome; and a
mailbox without an `imap_host` never attempts an append.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run tests/unit/emailEngine.test.ts`, `npx tsc --noEmit`,
`npx tsc -p worker/tsconfig.json --noEmit`, `npm run build`.

```bash
git add worker/lib/mailer.ts worker/lib/engine.ts tests/unit/emailEngine.test.ts
git commit -m "feat(email): file every sent message in the mailbox's own Sent folder

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Interface and deployment guide

**Files:**
- Modify: `src/services/supabase/email.ts`, `src/lib/email/types.ts`, `src/components/email/AccountFormDialog.tsx`, `src/components/email/MailboxCard.tsx`, `src/components/email/CampaignsTab.tsx`, `docs/superpowers/deployment/email-worker-setup.md`

**Interfaces:**
- Produces, in the service layer:
  - `updateAccountImap(accountId: string, input: { imapHost: string | null; imapPort: number; imapSecure: boolean }): Promise<void>`
  - `listInboxEvents(orgId: string, limit?: number): Promise<InboxEvent[]>`
  - `listMessages` extended to carry `repliedAt` and `bouncedAt`

- [ ] **Step 1: Service layer**

Add the functions above, following the file's existing conventions: a mapper per
row shape, `logger.error` then rethrow. Extend the message mapper with the two
new columns.

- [ ] **Step 2: Mailbox form and card**

`AccountFormDialog.tsx` gains an optional Inbox section: IMAP host, port
defaulting to 993, and a TLS switch, with a line saying that leaving the host
empty means replies and bounces are not detected for this mailbox. Default the
host from the SMTP host when the user has typed one, for example replacing a
leading `smtp` with `imap`, as a suggestion they can edit rather than a silent
value.

`MailboxCard.tsx` shows the IMAP state: not configured, active with the last
scan time, or an error with its message. Keep it visually subordinate to the
sending state, and state plainly that an inbox error does not stop sending.

- [ ] **Step 3: Campaign view**

`CampaignsTab.tsx` shows replied and bounced counts per campaign, and per
recipient a badge for replied or bounced. A bounced recipient should also say
the address was added to the suppression list, since that is the consequence
the user will ask about.

- [ ] **Step 4: Deployment guide**

Extend `email-worker-setup.md`: the new `INBOX_INTERVAL_MS` variable with its
default, migration 157 in the list, how to fill in IMAP settings for the common
providers, the fact that IMAP is optional, and a troubleshooting row for an
authentication failure that names the Zoho and Google app-password requirement.
State clearly that an IMAP failure never stops sending.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`, `npx tsc -p api/tsconfig.json --noEmit`,
`npx tsc -p worker/tsconfig.json --noEmit`, `grep -rn "src/lib" api/`,
`npm run build`, `npx vitest run`.

```bash
git add src docs/superpowers/deployment/email-worker-setup.md
git commit -m "feat(email): IMAP settings, inbox health and reply/bounce reporting

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** IMAP polled by the worker on its own slower loop → Task 4.
Credentials reused with only host, port and TLS added → Task 2a, Task 6 step 2.
A reply marks the message and the contact and shows in the campaign → Task 2d,
Task 4, Task 6 step 3. A reply does not suppress → Task 2d writes suppressions
only on the bounce path. Bounces suppress automatically → Task 2d. Envelopes
only for replies, bodies only for bounce candidates → Task 3. Bounce for an
address never mailed does not suppress → Task 2d, tested in Task 4 case 4 and
pinned in SQL. Sent-folder sync using the exact bytes → Task 5. IMAP optional
and never affecting sending → Tasks 2a, 2e, 4 case 1 and case 6, Task 5 step 3.
Bounded scan windows → Task 1 `scanWindow`. Provider-specific IMAP advice →
Task 1 `imapErrors`.

**Placeholder scan.** None. Tasks 2 to 6 describe behaviour rather than quoting
every line, because the SQL and the screens follow patterns already established
in phase 1; every column, default, policy, function signature and rule they
must satisfy is stated explicitly.

**Type consistency.** `InboxEnvelope` is produced by Task 3's client and
consumed by Task 1's matchers and Task 4's cycle. `ImapConfig` is identical in
Tasks 3 and 4. `record_inbox_result`'s two kinds are exactly the `kind` values
in `email_inbox_events` and in `InboxEvent`. `touch_inbox_scan`'s statuses are
exactly the `imap_status` check constraint's values, which are also
`ImapStatus`.
