# Email Deliverability (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sending to a persistent worker, and let an organization send from a pool of warmed mailboxes with health tracking, working-hours pacing, pre-send address verification, and actionable domain diagnostics.

**Architecture:** A new `worker/` Node service (run with `tsx`, deployed on Railway later by the user) becomes the only sender, replacing the Vercel tick route and its `pg_cron` job. It claims work per mailbox through an extended `claim_email_batch`, paces sends with jitter inside a configured send window, and updates each mailbox's health. Node-only concerns (nodemailer, DNS) live in `worker/lib/`; the existing pure helpers in `src/lib/email/` are reused unchanged.

**Tech Stack:** Node 20 + tsx, nodemailer, `@supabase/supabase-js`, Supabase Postgres, React 18 + TypeScript (strict) + Vite + Tailwind + Radix for the screens, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-email-deliverability-design.md`

**Reference implementation (read-only, do not copy UI):** `C:/Users/faraz/AppData/Local/Temp/claude/c--Users-faraz-task/b7c839a1-9ee9-44a3-b332-28fa768899a9/scratchpad/outreach-pilot-dash`. Its `src/server/mailer.ts`, `src/server/dns-check.ts`, `src/server/verify-address.ts` and `supabase/migrations/004_sending_pool.sql` are the proven versions of several pieces below. Port the logic; do not import from it and do not copy its React, its routing, or its Tailwind 4 classes.

## Global Constraints

- `npm run build` runs `tsc` under `strict: true` with `noUnusedLocals` and `noUnusedParameters`. `tsconfig.json` has `"include": ["src"]`.
- `npm run lint` is NOT runnable in this repo (no ESLint config). Do not create one.
- 34 test files already fail on `main` at import because they reference CRM code deleted in migration 143. That is the baseline; the bar is no NEW failures.
- Tests live in `tests/unit/*.test.ts`, Vitest with `globals: false`. Path alias `@/` maps to `src/`.
- `api/` must never import from `src/`; it is CommonJS while the repo root is ESM. `grep -rn "src/lib" api/` must keep returning nothing. The new `worker/` directory is ESM and MAY import from `src/lib/email/`.
- Migration numbering continues from 155. Use 156.
- Never log a decrypted secret, an SMTP password, or a full recipient list.
- Encryption format is fixed: AES-256-GCM, `base64url(iv(12) || ciphertext || tag(16))`, key `INTEGRATION_TOKEN_KEY`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File map

| File | Responsibility |
|---|---|
| `src/lib/email/sendWindow.ts` (new) | Pure: is `now` inside the configured window; describe a blocked window |
| `src/lib/email/mailboxPool.ts` (new) | Pure: mailbox health, effective limit, rotation order, slice sizes |
| `src/lib/email/smtpErrors.ts` (new) | Pure: classify an SMTP error, provider detection, readable advice |
| `src/lib/email/domainAuth.ts` (new) | Pure: turn raw DNS records into an SPF/DKIM/DMARC/MX report |
| `src/lib/email/types.ts` | Extend with the pool and settings types |
| `supabase/migrations/156_mailbox_pool_and_worker.sql` (new) | Pool columns, `mailbox_status` view, `email_settings`, extended claim, retire the tick cron |
| `worker/package.json`, `worker/tsconfig.json` (new) | The worker's own module and compiler settings |
| `worker/index.ts` (new) | The loop: cycle, sleep, shutdown |
| `worker/lib/engine.ts` (new) | One drain cycle: select mailboxes, claim, send, record |
| `worker/lib/mailer.ts` (new) | nodemailer transport factory, ported from the reference |
| `worker/lib/dns.ts` (new) | MX/A verification and the DNS lookups behind the domain report |
| `worker/lib/db.ts` (new) | Service-role client and env reading |
| `api/email/domain-auth.ts` (new) | Browser-callable domain report (JWT + org membership) |
| `api/email/tick.ts` | Deleted; the worker replaces it |
| `src/services/supabase/email.ts` | Pool and settings reads and writes |
| `src/components/email/AccountsTab.tsx`, `AccountFormDialog.tsx` | Pool view: warmup, health, caps, domain report |
| `src/components/email/SettingsTab.tsx` (new) | Send window and jitter |
| `src/pages/Email.tsx` | Fifth tab |
| `docs/superpowers/deployment/email-worker-setup.md` (new) | Railway deployment and cutover |

---

### Task 1: Pure deliverability helpers with tests

**Files:**
- Create: `src/lib/email/sendWindow.ts`, `src/lib/email/mailboxPool.ts`, `src/lib/email/smtpErrors.ts`, `src/lib/email/domainAuth.ts`
- Modify: `src/lib/email/types.ts`
- Test: `tests/unit/emailDeliverability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks depend on these exact names):

```ts
// types.ts additions
export interface SendWindow {
  enabled: boolean;
  startHour: number;      // 0-23, inclusive
  endHour: number;        // 0-23, exclusive
  days: number[];         // 1 = Monday … 7 = Sunday
  timezone: string;       // IANA, e.g. 'Europe/London'
}
export interface MailboxHealth {
  id: string;
  label: string;
  fromEmail: string;
  isActive: boolean;
  pausedReason: string | null;
  status: AccountStatus;
  consecutiveFailures: number;
  lastSentAt: Date | null;
  effectiveLimit: number;
  sentToday: number;
}
export interface EmailSettings {
  organizationId: string;
  window: SendWindow;
  jitterMinMs: number;
  jitterMaxMs: number;
}

// sendWindow.ts
export function isWithinSendWindow(w: SendWindow, now?: Date): boolean;
export function describeSendWindow(w: SendWindow): string;

// mailboxPool.ts
export const MAX_CONSECUTIVE_FAILURES = 3;
export const PER_MAILBOX_SLICE = 10;
export function remainingToday(m: MailboxHealth): number;
export function isSendable(m: MailboxHealth): boolean;
export function selectMailboxes(
  pool: MailboxHealth[], budget: number,
): Array<{ mailbox: MailboxHealth; take: number }>;
export function blockedReason(pool: MailboxHealth[]): string | null;

// smtpErrors.ts
export type SmtpProvider = 'zoho' | 'ionos' | 'google' | 'microsoft' | 'other';
export type SmtpOutcome = 'permanent' | 'hard_bounce' | 'transient';
export function providerOf(host?: string): SmtpProvider;
export function classifySmtpError(err: unknown): SmtpOutcome;
export function friendlySmtpError(err: unknown, host?: string): string;

// domainAuth.ts
export interface AuthCheck { ok: boolean; value: string | null; detail: string }
export interface DomainAuthReport {
  domain: string; spf: AuthCheck; dkim: AuthCheck; dmarc: AuthCheck; mx: string[];
}
export interface RawDnsRecords {
  domain: string; rootTxt: string[]; dmarcTxt: string[];
  mx: string[];                                   // hostnames, lowest priority first
  dkimSelectors: Array<{ selector: string; records: string[] }>;
}
export const DKIM_SELECTORS: string[];
export function interpretDomainAuth(raw: RawDnsRecords): DomainAuthReport;
```

`interpretDomainAuth` is pure so the report is testable without DNS; `worker/lib/dns.ts` and `api/email/domain-auth.ts` do the lookups and hand it records.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/emailDeliverability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isWithinSendWindow, describeSendWindow } from "@/lib/email/sendWindow";
import {
  remainingToday, isSendable, selectMailboxes, blockedReason,
  MAX_CONSECUTIVE_FAILURES, PER_MAILBOX_SLICE,
} from "@/lib/email/mailboxPool";
import { providerOf, classifySmtpError, friendlySmtpError } from "@/lib/email/smtpErrors";
import { interpretDomainAuth } from "@/lib/email/domainAuth";
import type { MailboxHealth, SendWindow } from "@/lib/email/types";

const win = (over: Partial<SendWindow> = {}): SendWindow => ({
  enabled: true, startHour: 8, endHour: 18,
  days: [1, 2, 3, 4, 5], timezone: "Europe/London", ...over,
});

// 2026-09-16 is a Wednesday.
const at = (iso: string) => new Date(iso);

describe("isWithinSendWindow", () => {
  it("is true inside the window on a working day", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T10:00:00Z"))).toBe(true);
  });
  it("is false before the start hour", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T06:00:00Z"))).toBe(false);
  });
  it("is false at and after the end hour", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T17:00:00Z"))).toBe(false);
  });
  it("is false on a day not in the list", () => {
    // 2026-09-19 is a Saturday.
    expect(isWithinSendWindow(win(), at("2026-09-19T10:00:00Z"))).toBe(false);
  });
  it("uses the window's timezone, not the host's", () => {
    // 21:00 UTC is 06:00 next day in Tokyo, outside 8-18 there.
    expect(isWithinSendWindow(win({ timezone: "Asia/Tokyo" }), at("2026-09-16T21:00:00Z")))
      .toBe(false);
    // 01:00 UTC is 10:00 in Tokyo, inside.
    expect(isWithinSendWindow(win({ timezone: "Asia/Tokyo" }), at("2026-09-16T01:00:00Z")))
      .toBe(true);
  });
  it("is always true when disabled", () => {
    expect(isWithinSendWindow(win({ enabled: false }), at("2026-09-19T03:00:00Z"))).toBe(true);
  });
});

describe("describeSendWindow", () => {
  it("names the hours, days and timezone", () => {
    const s = describeSendWindow(win());
    expect(s).toContain("08:00");
    expect(s).toContain("18:00");
    expect(s).toContain("Europe/London");
  });
});

const mb = (over: Partial<MailboxHealth> = {}): MailboxHealth => ({
  id: "m1", label: "Sales", fromEmail: "sales@acme.com",
  isActive: true, pausedReason: null, status: "active",
  consecutiveFailures: 0, lastSentAt: null,
  effectiveLimit: 20, sentToday: 0, ...over,
});

describe("remainingToday", () => {
  it("is the effective limit minus what has been sent", () => {
    expect(remainingToday(mb({ effectiveLimit: 20, sentToday: 8 }))).toBe(12);
  });
  it("never goes below zero", () => {
    expect(remainingToday(mb({ effectiveLimit: 5, sentToday: 9 }))).toBe(0);
  });
});

describe("isSendable", () => {
  it("accepts a healthy active mailbox with allowance left", () => {
    expect(isSendable(mb())).toBe(true);
  });
  it("rejects an inactive mailbox", () => {
    expect(isSendable(mb({ isActive: false }))).toBe(false);
  });
  it("rejects a paused mailbox", () => {
    expect(isSendable(mb({ pausedReason: "Authentication failed" }))).toBe(false);
  });
  it("rejects a mailbox whose status is error", () => {
    expect(isSendable(mb({ status: "error" }))).toBe(false);
  });
  it("rejects a mailbox at its effective limit", () => {
    expect(isSendable(mb({ effectiveLimit: 10, sentToday: 10 }))).toBe(false);
  });
  it("rejects a mailbox at the failure ceiling", () => {
    expect(isSendable(mb({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES }))).toBe(false);
  });
});

describe("selectMailboxes", () => {
  it("orders least recently used first, nulls before dates", () => {
    const out = selectMailboxes([
      mb({ id: "b", lastSentAt: new Date("2026-09-16T09:00:00Z") }),
      mb({ id: "a", lastSentAt: null }),
      mb({ id: "c", lastSentAt: new Date("2026-09-16T08:00:00Z") }),
    ], 100);
    expect(out.map((x) => x.mailbox.id)).toEqual(["a", "c", "b"]);
  });
  it("gives each mailbox at most the per-mailbox slice", () => {
    const out = selectMailboxes([mb({ effectiveLimit: 100 })], 100);
    expect(out[0].take).toBe(PER_MAILBOX_SLICE);
  });
  it("never exceeds a mailbox's remaining allowance", () => {
    const out = selectMailboxes([mb({ effectiveLimit: 4, sentToday: 1 })], 100);
    expect(out[0].take).toBe(3);
  });
  it("stops once the budget is spent", () => {
    const out = selectMailboxes([mb({ id: "a" }), mb({ id: "b" })], 4);
    expect(out.reduce((n, x) => n + x.take, 0)).toBe(4);
  });
  it("excludes unsendable mailboxes", () => {
    const out = selectMailboxes([mb({ id: "a", isActive: false }), mb({ id: "b" })], 10);
    expect(out.map((x) => x.mailbox.id)).toEqual(["b"]);
  });
  it("returns nothing for an empty pool", () => {
    expect(selectMailboxes([], 10)).toEqual([]);
  });
});

describe("blockedReason", () => {
  it("explains an empty pool", () => {
    expect(blockedReason([])).toMatch(/no mailbox/i);
  });
  it("explains a paused pool", () => {
    expect(blockedReason([mb({ pausedReason: "Authentication failed" })])).toMatch(/paused/i);
  });
  it("explains an exhausted pool", () => {
    expect(blockedReason([mb({ effectiveLimit: 10, sentToday: 10 })])).toMatch(/allowance/i);
  });
  it("is null when something can send", () => {
    expect(blockedReason([mb()])).toBeNull();
  });
});

describe("providerOf", () => {
  it("recognises the common hosts", () => {
    expect(providerOf("smtp.zoho.eu")).toBe("zoho");
    expect(providerOf("smtp.ionos.co.uk")).toBe("ionos");
    expect(providerOf("smtp.gmail.com")).toBe("google");
    expect(providerOf("smtp.office365.com")).toBe("microsoft");
    expect(providerOf("mail.example.com")).toBe("other");
    expect(providerOf()).toBe("other");
  });
});

describe("classifySmtpError", () => {
  it("treats 5xx as permanent", () => {
    expect(classifySmtpError({ responseCode: 535 })).toBe("permanent");
  });
  it("treats recipient rejections as a hard bounce", () => {
    expect(classifySmtpError({ responseCode: 550 })).toBe("hard_bounce");
    expect(classifySmtpError({ responseCode: 553 })).toBe("hard_bounce");
  });
  it("treats 4xx as transient", () => {
    expect(classifySmtpError({ responseCode: 451 })).toBe("transient");
  });
  it("treats an unknown error as transient", () => {
    expect(classifySmtpError(new Error("socket hang up"))).toBe("transient");
  });
});

describe("friendlySmtpError", () => {
  it("tells a Google user to use an app password", () => {
    const s = friendlySmtpError({ code: "EAUTH" }, "smtp.gmail.com");
    expect(s).toMatch(/app password/i);
    expect(s).toMatch(/google/i);
  });
  it("tells a Microsoft user their tenant may block SMTP auth", () => {
    expect(friendlySmtpError({ responseCode: 535 }, "smtp.office365.com")).toMatch(/SMTP AUTH/i);
  });
  it("explains a connection failure in terms of ports", () => {
    const s = friendlySmtpError({ code: "ETIMEDOUT" }, "mail.example.com");
    expect(s).toMatch(/465/);
    expect(s).toMatch(/587/);
  });
  it("explains throttling", () => {
    expect(friendlySmtpError({ responseCode: 421 }, "smtp.zoho.eu")).toMatch(/throttl/i);
  });
  it("falls back to the raw message when it has nothing better", () => {
    expect(friendlySmtpError(new Error("weird failure"))).toContain("weird failure");
  });
});

const raw = (over: Partial<Parameters<typeof interpretDomainAuth>[0]> = {}) => ({
  domain: "acme.com",
  rootTxt: ["v=spf1 include:_spf.google.com ~all"],
  dmarcTxt: ["v=DMARC1; p=none"],
  mx: ["aspmx.l.google.com"],
  dkimSelectors: [{ selector: "zmail", records: ["v=DKIM1; k=rsa; p=AAAA"] }],
  ...over,
});

describe("interpretDomainAuth", () => {
  it("passes a fully configured domain", () => {
    const r = interpretDomainAuth(raw());
    expect(r.spf.ok).toBe(true);
    expect(r.dkim.ok).toBe(true);
    expect(r.dmarc.ok).toBe(true);
    expect(r.mx).toEqual(["aspmx.l.google.com"]);
  });
  it("flags a missing SPF record", () => {
    const r = interpretDomainAuth(raw({ rootTxt: [] }));
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/no spf/i);
  });
  it("flags SPF that does not authorise the IONOS mail host", () => {
    const r = interpretDomainAuth(raw({
      rootTxt: ["v=spf1 include:_spf.google.com ~all"],
      mx: ["mx00.ionos.co.uk"],
    }));
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/ionos/i);
  });
  it("flags a missing DKIM key", () => {
    const r = interpretDomainAuth(raw({ dkimSelectors: [] }));
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.detail).toMatch(/unsigned|no dkim/i);
  });
  it("flags a DKIM key that belongs to another platform", () => {
    const r = interpretDomainAuth(raw({
      dkimSelectors: [{ selector: "selector1", records: ["v=DKIM1; p=BBBB"] }],
    }));
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.detail).toMatch(/another provider/i);
  });
  it("flags a missing DMARC record", () => {
    const r = interpretDomainAuth(raw({ dmarcTxt: [] }));
    expect(r.dmarc.ok).toBe(false);
    expect(r.dmarc.detail).toMatch(/dmarc/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/emailDeliverability.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/email/sendWindow"`.

- [ ] **Step 3: Implement the four modules and extend the types**

Add the three interfaces above to `src/lib/email/types.ts`, importing nothing new.

`src/lib/email/sendWindow.ts`: implement `isWithinSendWindow` using
`Intl.DateTimeFormat` with the window's `timeZone` and `{ hour: 'numeric',
weekday: 'short', hour12: false }` to read the local hour and weekday, rather
than host-local getters, which would be wrong for every user outside the
server's zone. Map the weekday to 1 = Monday through 7 = Sunday. A disabled
window returns true. `describeSendWindow` returns a sentence naming the hours
zero-padded, the days, and the timezone.

`src/lib/email/mailboxPool.ts`: implement exactly the Interfaces block. Ordering
in `selectMailboxes` puts `lastSentAt === null` first, then oldest first.
`take` is `Math.min(remainingBudget, remainingToday(m), PER_MAILBOX_SLICE)`, and
a mailbox contributing zero is omitted. `blockedReason` returns null when any
mailbox is sendable, and otherwise the most specific of: no mailboxes, all
paused, all out of allowance.

`src/lib/email/smtpErrors.ts`: port `providerOf`, the permanent/hard-bounce
rules, and the provider advice from the reference project's
`src/server/mailer.ts`. Keep its distinction exactly: 5xx is permanent, but
only 550, 551 and 553 are hard bounces, because 535 means our own credentials
were rejected and suppressing the recipient for that would blame the wrong
party and quietly destroy the list. `classifySmtpError` returns `hard_bounce`
before `permanent` for those three codes.

`src/lib/email/domainAuth.ts`: port `DKIM_SELECTORS`, the foreign-selector set
and the interpretation rules from the reference project's
`src/server/dns-check.ts`, but as a pure function over `RawDnsRecords` rather
than performing lookups. Derive the provider from the MX hostnames.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/emailDeliverability.test.ts`
Expected: PASS, 37 tests.

- [ ] **Step 5: Type check and commit**

Run: `npx tsc --noEmit` (must print nothing).

```bash
git add src/lib/email tests/unit/emailDeliverability.test.ts
git commit -m "feat(email): pure helpers for send windows, mailbox pool, SMTP errors and domain auth

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pool schema, settings, extended claim, retire the tick

**Files:**
- Create: `supabase/migrations/156_mailbox_pool_and_worker.sql`

**Interfaces:**
- Consumes: the tables and functions from migrations 152 to 155.
- Produces: pool columns on `email_accounts`; view `public.mailbox_status`; table `public.email_settings`; `claim_email_batch(p_account uuid, p_limit integer)`; `record_send_result(...)`; the removal of `kick_email_worker` and its cron.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/156_mailbox_pool_and_worker.sql` with the
following, in this order and with comments explaining each decision:

**a. Pool columns** on `public.email_accounts`, all `add column if not exists`:
`warmup_enabled boolean not null default true`,
`warmup_started_on date`,
`warmup_start_volume integer not null default 5`,
`warmup_increment integer not null default 3`,
`is_active boolean not null default true`,
`paused_reason text`,
`consecutive_failures integer not null default 0`,
`last_sent_at timestamptz`.
Also `alter table public.email_accounts alter column daily_limit set default 40;`
with a comment that 40 a day per mailbox is a conservative outreach figure and
that existing rows keep whatever they have.

**b. `mailbox_status` view** selecting from `email_accounts`: every pool column
plus `effective_limit` computed exactly as the spec's SQL, and `sent_today` as
a scalar subquery counting `email_messages` rows joined to `email_campaigns`
for that `account_id` with `status = 'sent'` and `sent_at >= date_trunc('day', now())`.
Follow it with `alter view public.mailbox_status set (security_invoker = on);`
and a comment saying that without it the view would run as its owner and
bypass row level security.

**c. `email_settings`** table: `organization_id uuid primary key references
public.organizations(organization_id) on delete cascade`,
`send_window_enabled boolean not null default true`,
`send_window_start integer not null default 8 check (send_window_start between 0 and 23)`,
`send_window_end integer not null default 18 check (send_window_end between 1 and 24)`,
`send_days integer[] not null default '{1,2,3,4,5}'`,
`send_timezone text not null default 'UTC'`,
`jitter_min_ms integer not null default 8000`,
`jitter_max_ms integer not null default 25000`,
`updated_at timestamptz not null default now()`.
RLS on; select for `public.is_org_member(organization_id)`; insert, update and
delete for `public.is_org_admin_or_owner(organization_id)`.

**d. Campaigns may use the pool.** `alter table public.email_campaigns alter
column account_id drop not null;` with a comment that null now means "use the
whole pool", which is the new default, and a specific account still pins the
campaign to one mailbox. The composite foreign key from migration 155 stays
valid because a null `account_id` skips the constraint under MATCH SIMPLE.

**e. Extended claim.** `create or replace function public.claim_email_batch(
p_account uuid, p_limit integer default 25)` keeping the existing seven
`returns table` columns and adding nothing to them. Preserve from migration 155:
`security definer`, `set search_path`, the stuck-row recovery including the
`attempts >= 3` rule and the settle-as-sent rule for a row carrying a
`provider_message_id`, the suppression sweep, the suppression `not exists`
guard, the `status = 'queued'` and `attempts < 3` predicates at the locking
level, and `for update of m skip locked`. Change only the candidate selection:
a row qualifies when its campaign's `account_id` is `p_account`, or is null and
`p_account` is a member of the same organization's pool. Drop the old
per-account hourly and daily budget arithmetic, because the worker now passes a
budget it computed from `mailbox_status`; `p_limit` is that budget. Keep
`revoke execute ... from public, anon, authenticated` and
`grant execute ... to service_role`.

Every column reference inside the function must be table-qualified. `attempts`
is one of the OUT parameters, so a bare `attempts` raises "column reference is
ambiguous" the first time the function runs, and `create or replace` will not
catch it.

Drop the single-argument version explicitly, since changing the argument list
creates an overload rather than replacing it:
`drop function if exists public.claim_email_batch(integer);`

**f. `record_send_result`.** `create or replace function
public.record_send_result(p_message uuid, p_account uuid, p_outcome text,
p_error text default null, p_provider_message_id text default null)
returns void`, security definer, revoked from public/anon/authenticated,
granted to service_role. It updates the message row and the mailbox health in
one transaction:
- `p_outcome = 'sent'`: message `status = 'sent'`, `sent_at = now()`,
  `provider_message_id = p_provider_message_id`; account
  `consecutive_failures = 0`, `last_sent_at = now()`, `last_error = null`.
- `p_outcome = 'transient'`: message back to `queued`, `claimed_at = null`,
  `last_error = p_error`; account untouched.
- `p_outcome = 'permanent'`: message `failed` with `last_error`; account
  `consecutive_failures = consecutive_failures + 1`, `last_error = p_error`,
  and when that reaches 3, also `is_active = false`,
  `paused_reason = p_error`, `status = 'error'`.
- `p_outcome = 'hard_bounce'`: message `failed`; insert the address into
  `email_suppressions` with reason `bounced` on conflict do nothing; account
  untouched, because a bad recipient is not the mailbox's fault.

**g. Retire the Vercel tick.** `select cron.unschedule('email_worker_minute');`
wrapped so a missing job does not abort, then
`drop function if exists public.kick_email_worker();`, with a comment recording
that sending moved to a persistent worker and that running both would
double-send.

End the file with `notify pgrst, 'reload schema';`.

- [ ] **Step 2: Read the migration back and confirm**

There is no database here. Re-read the file and confirm each of these in the
report: every table has RLS and at least one policy; the view is
`security_invoker`; every column reference inside both functions is
table-qualified; the claim's `returning` list still matches its `returns table`
in count, order and type; the old single-argument claim is dropped before the
new one is created; the cron unschedule is wrapped.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/156_mailbox_pool_and_worker.sql
git commit -m "feat(email): mailbox pool, warmup, send settings, per-account claim

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The worker service

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/index.ts`, `worker/lib/db.ts`, `worker/lib/mailer.ts`, `worker/lib/dns.ts`, `worker/lib/engine.ts`, `worker/README.md`
- Modify: `package.json` (a `worker` script and the `tsx` dev dependency)
- Delete: `api/email/tick.ts`
- Test: `tests/unit/emailEngine.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers from `@/lib/email/*`; Task 2's `claim_email_batch(p_account, p_limit)` and `record_send_result`; the existing `src/lib/email/message.ts`, `unsubscribe.ts`, `crypto.ts`.
- Produces: `runCycle(deps): Promise<CycleResult>` from `worker/lib/engine.ts`, where

```ts
export interface CycleDeps {
  db: SupabaseClient;
  createTransport: (cfg: SmtpConfig) => Transporter;
  domainAcceptsMail: (domain: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  env: { tokenKey: string; unsubscribeSecret: string; siteUrl: string };
  maxPerCycle: number;
}
export interface CycleResult {
  claimed: number; sent: number; failed: number; skipped: number;
  blocked: string | null; errors: string[];
}
export async function runCycle(deps: CycleDeps): Promise<CycleResult>;
```

Every side effect arrives through `deps`, so the test drives the whole cycle
with stubs and no network.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/emailEngine.test.ts` covering, with a stubbed `db` whose
`from(...)` and `rpc(...)` return canned rows and record calls:

1. Outside the send window, nothing is claimed and `blocked` names the window.
2. With an empty pool, nothing is claimed and `blocked` says no mailboxes.
3. Two healthy mailboxes are claimed in least-recently-used order, and each
   claim passes its own account id and its own budget.
4. A recipient whose domain does not accept mail is skipped, never sent, and
   recorded as a hard bounce.
5. A send that resolves calls `record_send_result` with `sent` and the
   provider message id.
6. An error with `responseCode: 535` records `permanent`.
7. An error with `responseCode: 550` records `hard_bounce`.
8. An error with `responseCode: 451` records `transient`.
9. `sleep` is called between messages with a value inside the configured
   jitter range.
10. A mailbox whose secret cannot be decrypted is skipped with its rows
    untouched, and the cycle still processes the other mailbox.

Assert on the recorded calls, not on the stubs' return values.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/emailEngine.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the worker**

`worker/package.json`: `{ "name": "taskcalendar-email-worker", "private": true,
"type": "module", "scripts": { "start": "tsx index.ts" } }`.

`worker/tsconfig.json`: extends nothing; `"module": "esnext"`,
`"moduleResolution": "bundler"`, `"target": "es2022"`, `"strict": true`,
`"skipLibCheck": true`, `"baseUrl": "..", "paths": { "@/*": ["src/*"] }`,
`"include": ["**/*.ts", "../src/lib/email/**/*.ts"]`.

`worker/lib/db.ts`: `env(name)` that throws naming the variable, and
`serviceClient()` building a Supabase client with
`auth: { persistSession: false, autoRefreshToken: false }`. Required variables:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_TOKEN_KEY`,
`EMAIL_UNSUBSCRIBE_SECRET`, `PUBLIC_SITE_URL`.

`worker/lib/mailer.ts`: port `createTransport` from the reference project's
`src/server/mailer.ts` verbatim in behaviour, including `requireTLS: !secure`
and the three timeouts, with its comment explaining that true means implicit
TLS on 465 while false means STARTTLS on 587.

`worker/lib/dns.ts`: `domainOfEmail`, `domainAcceptsMail` with the per-process
cache and the MX-then-A fallback, and `fetchDnsRecords(domain)` returning the
`RawDnsRecords` shape that `interpretDomainAuth` consumes.

`worker/lib/engine.ts`: `runCycle` as specified. The order within a cycle:
read settings and check the window; read `mailbox_status`; `selectMailboxes`;
for each mailbox load and decrypt its secret, build one transport, claim its
budget, and for each row verify the domain, build the message with the existing
`buildMessage`, send, record the result, then sleep a jittered interval; close
the transport; move to the next mailbox. Errors are deduplicated per mailbox,
so one bad password reports once rather than once per recipient.

`worker/index.ts`: the loop. Read `WORKER_INTERVAL_MS` (default 15000) and
`WORKER_BATCH` (default 50), run a cycle, log a one-line summary, sleep, repeat.
Handle `SIGTERM` and `SIGINT` by finishing the current cycle and exiting, so a
Railway redeploy does not strand claimed rows. Never log a password or a full
recipient list.

`worker/README.md`: what it is, the environment variables, `npm start`, and a
warning that it must be the only sender.

Root `package.json`: add `"worker": "tsx worker/index.ts"` to scripts and `tsx`
to devDependencies. Then delete `api/email/tick.ts`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/emailEngine.test.ts` (expect all passing),
`npx tsc --noEmit` (prints nothing), `npx tsc -p worker/tsconfig.json --noEmit`
(exit 0), `npx tsc -p api/tsconfig.json --noEmit` (exit 0),
`grep -rn "src/lib" api/` (returns nothing), `npm run build` (succeeds).

- [ ] **Step 5: Commit**

```bash
git add worker package.json package-lock.json tests/unit/emailEngine.test.ts
git rm api/email/tick.ts
git commit -m "feat(email): persistent sending worker with rotation, warmup and pacing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Domain report endpoint and service layer

**Files:**
- Create: `api/email/domain-auth.ts`, `api/_lib/dns.ts`, `api/_lib/domainAuth.ts`
- Modify: `src/services/supabase/email.ts`
- Test: extend `tests/unit/emailApiParity.test.ts`

**Interfaces:**
- Consumes: Task 1's `interpretDomainAuth`; the existing JWT and owner/admin pattern in `api/email/verify.ts`.
- Produces: `POST /api/email/domain-auth` returning a `DomainAuthReport`; and in the service layer:
  - `listMailboxStatus(orgId: string): Promise<MailboxHealth[]>`
  - `updateAccountPool(accountId: string, input: PoolInput): Promise<void>` where `PoolInput` covers `dailyLimit`, `warmupEnabled`, `warmupStartedOn`, `warmupStartVolume`, `warmupIncrement`, `isActive`
  - `resumeAccount(accountId: string): Promise<void>` clearing `paused_reason`, `consecutive_failures` and setting `is_active` true
  - `getEmailSettings(orgId: string): Promise<EmailSettings>` returning defaults when no row exists
  - `saveEmailSettings(orgId: string, settings: EmailSettings): Promise<void>`
  - `checkDomainAuth(domain: string): Promise<DomainAuthReport>` calling the route with the user's bearer token

- [ ] **Step 1: The route**

`api/` cannot import from `src/`, so copy `domainAuth.ts` into `api/_lib/` the
way `crypto.ts` and `message.ts` were copied, and add `api/_lib/dns.ts` for the
lookups. Extend `tests/unit/emailApiParity.test.ts` with a case proving both
copies of `interpretDomainAuth` return deeply equal reports for the same input,
including the missing-SPF and foreign-DKIM branches.

`api/email/domain-auth.ts`: verify the caller's Supabase JWT, require org
membership (read, not admin, since this is a diagnostic), accept `{ domain }`,
perform the lookups, and return the report. Reject a domain that fails a basic
shape check before touching DNS.

- [ ] **Step 2: The service layer**

Add the functions above to `src/services/supabase/email.ts`, following its
existing conventions: one mapper per row shape, `logger.error` then rethrow.
`getEmailSettings` returns the documented defaults rather than null when the
row is absent, so the settings screen always has something to render.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`, `npx tsc -p api/tsconfig.json --noEmit`,
`grep -rn "src/lib" api/`, `npx vitest run tests/unit/emailApiParity.test.ts`,
`npm run build`.

```bash
git add api src/services/supabase/email.ts tests/unit/emailApiParity.test.ts
git commit -m "feat(email): domain authentication report and pool service layer

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pool and settings screens

**Files:**
- Modify: `src/components/email/AccountsTab.tsx`, `src/components/email/AccountFormDialog.tsx`, `src/pages/Email.tsx`
- Create: `src/components/email/MailboxCard.tsx`, `src/components/email/DomainAuthPanel.tsx`, `src/components/email/SettingsTab.tsx`

Everything is built from the components already in `src/components/ui/`, in the
style of `src/pages/Contracts.tsx`. Nothing from the reference project's
interface is copied. Keep each file under roughly 300 lines.

- [ ] **Step 1: MailboxCard**

One card per mailbox showing: label and from address; a status badge driven by
`isSendable`; today's usage as `sentToday / effectiveLimit` with a `Progress`
bar; the warmup state, either "Warmup day N, allowance X" or "Full volume";
`paused_reason` in red when present with a Resume button beside it; and Send
test and Delete. Admin only for every control, as today.

- [ ] **Step 2: Warmup and limit controls**

Extend `AccountFormDialog.tsx` with a Sending section: daily limit; a warmup
switch; start volume and daily increment, shown only when warmup is on; and a
line stating in words what that means, for example that the mailbox starts at 5
a day and climbs by 3 until it reaches 40.

- [ ] **Step 3: DomainAuthPanel**

Below the mailbox list, a panel per distinct sending domain. A Check button
calls `checkDomainAuth`. Render SPF, DKIM, DMARC and MX as four rows, each with
a tick or cross, the record value in a monospace block when present, and the
`detail` sentence. While unchecked, say so rather than implying a pass.

- [ ] **Step 4: SettingsTab**

A fifth tab on the Email page: the send window switch, start and end hour
selects, weekday toggles, a timezone select defaulting to the organization's
timezone, and the jitter range with a sentence explaining that a random pause
between messages keeps sending from looking automated. Admin only; members see
it read-only. Save through `saveEmailSettings`.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit` and `npm run build`.

```bash
git add src/components/email src/pages/Email.tsx
git commit -m "feat(email): mailbox pool, warmup and send-window screens

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Deployment guide and final verification

**Files:**
- Create: `docs/superpowers/deployment/email-worker-setup.md`
- Modify: `docs/superpowers/deployment/email-marketing-setup.md`

- [ ] **Step 1: The worker guide**

Write `email-worker-setup.md` covering: what the worker is and why it replaced
the Vercel tick; deploying it on Railway as a service with root directory
`worker`, build command `npm install`, start command `npm start`; the five
environment variables it needs, each with where the value comes from; how to
confirm it is running from the Railway logs; and a troubleshooting table with
the real failure modes, namely nothing sending because the pool is empty or
outside the send window, authentication failures naming the provider, and rows
stuck in `sending` after a crash being recovered by the claim's ten-minute
sweep.

State plainly that the worker must be the only sender, and that migration 156
removes the old cron for exactly that reason.

- [ ] **Step 2: Update the existing guide**

In `email-marketing-setup.md`, mark the `/api/email/tick` section as
superseded, point to the worker guide, add migration 156 to the list, and
remove `EMAIL_WORKER_SECRET` from the Vercel variables if nothing else uses it.
Verify that by reading the remaining routes rather than assuming.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit`, `npx tsc -p api/tsconfig.json --noEmit`,
`npx tsc -p worker/tsconfig.json --noEmit`, `grep -rn "src/lib" api/`,
`npm run build`, and `npx vitest run`. The suite must show no new failures
against the 34-file baseline, and every email suite must pass.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/deployment
git commit -m "docs: worker deployment guide and cutover from the Vercel tick

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Persistent worker replacing the tick → Task 3, with the cron
removed in Task 2g. Mailbox pool with rotation → Task 1 `selectMailboxes`,
Task 2a columns, Task 3 cycle order. Warmup ramp → Task 2b view, Task 5 step 2
controls. Health and auto-pause at three failures → Task 2f
`record_send_result`, Task 1 `MAX_CONSECUTIVE_FAILURES`, Task 5 step 1 Resume.
Send window and jitter → Task 1 `sendWindow`, Task 2c settings, Task 3 cycle,
Task 5 step 4. Pre-send address verification with auto-suppression → Task 3
`domainAcceptsMail` plus the hard-bounce path. Domain report → Task 1
`interpretDomainAuth`, Task 4 route, Task 5 step 3. Provider-aware errors and
classification → Task 1 `smtpErrors`, applied in Task 3. Campaigns defaulting
to the pool → Task 2d.

**Placeholder scan.** None. Tasks 2, 3 and 5 describe behaviour rather than
quoting every line, because the SQL and the screens are long and follow
patterns already in the repo; every exported name, column, default, policy and
rule they must satisfy is stated explicitly.

**Type consistency.** `MailboxHealth` as produced by Task 1 is what
`mailbox_status` (Task 2b) returns and what `listMailboxStatus` (Task 4) maps
to and what `MailboxCard` (Task 5) renders. `SendWindow` and `EmailSettings`
match between Task 1, the `email_settings` columns in Task 2c, the service
layer in Task 4 and the screen in Task 5. `claim_email_batch(p_account,
p_limit)` as defined in Task 2e is what `runCycle` calls in Task 3, and the old
single-argument overload is dropped so no caller can bind the wrong one.
`record_send_result`'s four outcomes are exactly the values `classifySmtpError`
returns plus `sent`.
