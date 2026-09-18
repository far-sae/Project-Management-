# Email Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Email page where a user connects their own SMTP account and sends a single email or a bulk personalized campaign to CRM contacts, a pasted list, or a CSV, with an enforced suppression list, one-click unsubscribe, and per-recipient delivery status.

**Architecture:** Recipients become rows in a Supabase outbox table. A Vercel Node function drains the outbox every minute (kicked by `pg_cron` + `pg_net`), decrypts the account's SMTP password with the existing AES-256-GCM format, and sends through nodemailer. Sending lives on Vercel because Supabase Edge Functions run on Deno, which blocks outbound SMTP ports 25 and 587, and Microsoft 365 requires 587. All pure logic lives in `src/lib/email/` so it is type-checked by `tsc`, unit-tested by Vitest, and importable by both the browser and the Vercel functions.

**Tech Stack:** React 18, TypeScript (strict), Vite, Tailwind, Radix UI, Supabase (Postgres + RLS + pg_cron + pg_net), Vercel Node serverless functions, nodemailer, papaparse, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-email-marketing-design.md`

## Global Constraints

- `npm run build` runs `tsc` under `strict: true` with `noUnusedLocals` and `noUnusedParameters`. `tsconfig.json` has `"include": ["src"]`, so files under `api/` are NOT type-checked by the build; keep all logic in `src/lib/email/` and keep `api/` files thin.
- `npm run lint` is NOT runnable in this repo (no ESLint config on `main`). Do not create one.
- 34 test files already fail on `main` at import (they reference CRM code deleted in migration 143). That is the baseline. The bar is: `npx tsc --noEmit` clean, and no NEW test failures.
- Tests live in `tests/unit/*.test.ts`, Vitest with `globals: false` (import `describe/it/expect` from `vitest`). Path alias `@/` maps to `src/`.
- Encryption format is fixed and must not change: AES-256-GCM, `base64url(iv(12) || ciphertext || tag(16))`, key from `INTEGRATION_TOKEN_KEY` (32 raw bytes, base64url). It must stay byte-compatible with `supabase/functions/_shared/crypto.ts`.
- RLS on every new table, using the existing helpers `public.is_org_member(uuid)` and `public.is_org_admin_or_owner(uuid)` from migration 036.
- Migration numbering continues from 151. Use 152, 153, 154 in that order.
- Never log a decrypted secret, an SMTP password, or a full recipient list.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File map

| File | Responsibility |
|---|---|
| `src/lib/email/crypto.ts` (new) | AES-256-GCM encrypt/decrypt, byte-compatible with the Deno helper |
| `src/lib/email/substitute.ts` (new) | `{{placeholder}}` substitution and HTML escaping |
| `src/lib/email/unsubscribe.ts` (new) | HMAC token sign/verify, unsubscribe URL and link injection |
| `src/lib/email/suppression.ts` (new) | Recipient normalization, dedupe, suppression filtering |
| `src/lib/email/message.ts` (new) | Builds the final subject/html/text/headers for one message |
| `src/lib/email/types.ts` (new) | Shared TypeScript types for accounts, campaigns, messages |
| `src/services/supabase/email.ts` (new) | All Supabase reads/writes for the feature from the browser |
| `supabase/migrations/152_email_marketing_schema.sql` (new) | Five tables + RLS + indexes |
| `supabase/migrations/153_email_claim_and_cron.sql` (new) | `claim_email_batch` RPC, tick cron, drops the dead CRM cron |
| `api/_lib/context.ts` (new) | Service-role Supabase client, env reading, shared-secret check |
| `api/email/tick.ts` (new) | The worker: claim, send, write back |
| `api/email/verify.ts` (new) | Send test email, mark account active or error |
| `api/email/unsubscribe.ts` (new) | Public one-click unsubscribe (GET + POST) |
| `vercel.json` | Exclude `/api/` from the SPA catch-all rewrite |
| `src/pages/Email.tsx` (new) | The page shell with four tabs |
| `src/components/email/*.tsx` (new) | `AccountsTab`, `ComposeTab`, `CampaignsTab`, `SuppressionTab` |
| `src/App.tsx`, `src/lib/pageCatalog.ts`, `src/lib/workspaceScope.ts`, `src/components/sidebar/Sidebar.tsx`, `src/context/SubscriptionContext.tsx` | Route, page key, quick-menu key, sidebar entry, plan feature |
| `src/services/email/emailService.ts` | Bug fix: stop calling the deleted `notify-send-gmail` |

---

### Task 1: Pure email helpers with tests

**Files:**
- Create: `src/lib/email/types.ts`, `src/lib/email/crypto.ts`, `src/lib/email/substitute.ts`, `src/lib/email/unsubscribe.ts`, `src/lib/email/suppression.ts`, `src/lib/email/message.ts`
- Test: `tests/unit/emailHelpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task depends on these exact names):
  - `types.ts`: `EmailAccount`, `EmailCampaign`, `EmailMessage`, `EmailSuppression`, `CampaignKind = 'single' | 'bulk'`, `MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'suppressed'`
  - `crypto.ts`: `encryptSecret(plaintext: string, keyB64: string): Promise<string>`, `decryptSecret(packed: string, keyB64: string): Promise<string>`
  - `substitute.ts`: `substitutePlaceholders(template: string, ctx: Record<string, unknown>): string`, `escapeHtml(s: string): string`
  - `unsubscribe.ts`: `signUnsubscribeToken(messageId: string, secret: string): Promise<string>`, `verifyUnsubscribeToken(messageId: string, token: string, secret: string): Promise<boolean>`, `unsubscribeUrl(baseUrl: string, messageId: string, token: string): string`, `ensureUnsubscribeLink(html: string, url: string): string`
  - `suppression.ts`: `normalizeEmail(raw: string): string`, `dedupeRecipients<T extends { email: string }>(list: T[]): T[]`, `filterSuppressed<T extends { email: string }>(list: T[], suppressed: string[]): { sendable: T[]; suppressed: T[] }`
  - `message.ts`: `buildMessage(input: BuildMessageInput): BuiltMessage` where
    ```ts
    export interface BuildMessageInput {
      kind: CampaignKind;
      subject: string; bodyHtml: string; bodyText?: string;
      mergeData: Record<string, unknown>;
      unsubscribeUrl?: string;
    }
    export interface BuiltMessage {
      subject: string; html: string; text: string;
      headers: Record<string, string>;
    }
    ```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/emailHelpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/email/crypto";
import { encrypt as denoEncrypt } from "../../supabase/functions/_shared/crypto";
import { substitutePlaceholders, escapeHtml } from "@/lib/email/substitute";
import {
  signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, ensureUnsubscribeLink,
} from "@/lib/email/unsubscribe";
import { normalizeEmail, dedupeRecipients, filterSuppressed } from "@/lib/email/suppression";
import { buildMessage } from "@/lib/email/message";

const KEY = "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc";

describe("crypto", () => {
  it("round-trips a secret", async () => {
    const packed = await encryptSecret("hunter2", KEY);
    expect(packed).not.toContain("hunter2");
    expect(await decryptSecret(packed, KEY)).toBe("hunter2");
  });
  it("produces a different ciphertext each time", async () => {
    expect(await encryptSecret("x", KEY)).not.toBe(await encryptSecret("x", KEY));
  });
  it("fails with the wrong key", async () => {
    const other = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
    await expect(decryptSecret(await encryptSecret("x", KEY), other)).rejects.toThrow();
  });
  it("decrypts what the Deno edge-function helper encrypted (wire-compatible)", async () => {
    const packed = await denoEncrypt("shared-secret", KEY);
    expect(await decryptSecret(packed, KEY)).toBe("shared-secret");
  });
});

describe("substitutePlaceholders", () => {
  const ctx = { first_name: "Ada", company: "Acme", empty: "" };
  it("replaces known keys", () => {
    expect(substitutePlaceholders("Hi {{first_name}} at {{company}}", ctx)).toBe("Hi Ada at Acme");
  });
  it("tolerates spaces inside the braces", () => {
    expect(substitutePlaceholders("Hi {{ first_name }}", ctx)).toBe("Hi Ada");
  });
  it("replaces an unknown key with an empty string", () => {
    expect(substitutePlaceholders("Hi {{nope}}!", ctx)).toBe("Hi !");
  });
  it("escapes HTML in values so a name cannot inject markup", () => {
    expect(substitutePlaceholders("Hi {{first_name}}", { first_name: "<b>x</b>" }))
      .toBe("Hi &lt;b&gt;x&lt;/b&gt;");
  });
  it("leaves a single brace alone", () => {
    expect(substitutePlaceholders("100% {sure}", ctx)).toBe("100% {sure}");
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("unsubscribe tokens", () => {
  const S = "unsub-secret";
  it("verifies a token it signed", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m1", t, S)).toBe(true);
  });
  it("rejects a token for a different message", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m2", t, S)).toBe(false);
  });
  it("rejects a tampered token", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m1", t.slice(0, -1) + "x", S)).toBe(false);
  });
  it("rejects a token signed with a different secret", async () => {
    const t = await signUnsubscribeToken("m1", "other");
    expect(await verifyUnsubscribeToken("m1", t, S)).toBe(false);
  });
  it("builds a url", () => {
    expect(unsubscribeUrl("https://app.test", "m1", "tok"))
      .toBe("https://app.test/api/email/unsubscribe?m=m1&t=tok");
  });
});

describe("ensureUnsubscribeLink", () => {
  const url = "https://app.test/api/email/unsubscribe?m=m1&t=tok";
  it("appends a link when the body has none", () => {
    const out = ensureUnsubscribeLink("<p>Hello</p>", url);
    expect(out).toContain(url);
    expect(out.toLowerCase()).toContain("unsubscribe");
  });
  it("does not append twice when the body already links to it", () => {
    const body = `<p>Hello</p><a href="${url}">Unsubscribe</a>`;
    expect(ensureUnsubscribeLink(body, url)).toBe(body);
  });
});

describe("suppression", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Ada@Acme.COM ")).toBe("ada@acme.com");
  });
  it("dedupes case-insensitively, keeping the first", () => {
    const out = dedupeRecipients([
      { email: "a@x.com", name: "first" },
      { email: "A@X.com", name: "second" },
      { email: "b@x.com", name: "third" },
    ]);
    expect(out.map((r) => r.name)).toEqual(["first", "third"]);
  });
  it("splits sendable from suppressed, case-insensitively", () => {
    const { sendable, suppressed } = filterSuppressed(
      [{ email: "a@x.com" }, { email: "b@x.com" }],
      ["A@X.COM"],
    );
    expect(sendable.map((r) => r.email)).toEqual(["b@x.com"]);
    expect(suppressed.map((r) => r.email)).toEqual(["a@x.com"]);
  });
});

describe("buildMessage", () => {
  const base = {
    subject: "Hi {{first_name}}",
    bodyHtml: "<p>Hello {{first_name}} at {{company}}</p>",
    mergeData: { first_name: "Ada", company: "Acme" },
  };
  it("substitutes into the subject and body", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.subject).toBe("Hi Ada");
    expect(m.html).toContain("Hello Ada at Acme");
  });
  it("derives a plain-text part from the html", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.text).toContain("Hello Ada at Acme");
    expect(m.text).not.toContain("<p>");
  });
  it("adds one-click unsubscribe headers for a bulk send", () => {
    const url = "https://app.test/api/email/unsubscribe?m=m1&t=tok";
    const m = buildMessage({ ...base, kind: "bulk", unsubscribeUrl: url });
    expect(m.headers["List-Unsubscribe"]).toBe(`<${url}>`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.html).toContain(url);
  });
  it("adds no unsubscribe headers for a single transactional send", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.headers["List-Unsubscribe"]).toBeUndefined();
    expect(m.html).not.toContain("unsubscribe");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/emailHelpers.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/email/crypto"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/email/types.ts`:

```ts
export type CampaignKind = 'single' | 'bulk';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'suppressed';
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';
export type AccountStatus = 'unverified' | 'active' | 'error';
export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complaint' | 'manual';

export interface EmailAccount {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  dailyLimit: number;
  hourlyLimit: number;
  status: AccountStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export interface EmailCampaign {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  accountId: string;
  kind: CampaignKind;
  name: string;
  subject: string;
  bodyHtml: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  ratePerHour: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  createdAt: Date;
}

export interface EmailMessage {
  id: string;
  campaignId: string;
  organizationId: string;
  contactId: string | null;
  toEmail: string;
  toName: string | null;
  mergeData: Record<string, unknown>;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
}

export interface EmailSuppression {
  id: string;
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  createdAt: Date;
}
```

Create `src/lib/email/crypto.ts`:

```ts
// AES-256-GCM, wire format base64url(iv(12) || ciphertext || tag(16)).
// Byte-compatible with supabase/functions/_shared/crypto.ts on purpose: the
// edge functions and the Vercel worker read each other's ciphertext. A test
// in tests/unit/emailHelpers.test.ts pins that compatibility.
// Uses only Web Crypto, so it runs in the browser, in Node 18+, and in Deno.

const IV_LEN = 12;

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.byteLength !== 32) {
    throw new Error(`email/crypto: key must be 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return b64encode(out);
}

export async function decryptSecret(packed: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = b64decode(packed);
  if (bytes.byteLength <= IV_LEN) throw new Error('email/crypto: ciphertext too short');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_LEN) },
    key,
    bytes.slice(IV_LEN),
  );
  return new TextDecoder().decode(plaintext);
}
```

Create `src/lib/email/substitute.ts`:

```ts
// {{placeholder}} substitution. Values are HTML-escaped: a contact's name is
// untrusted input and must never inject markup into the email body.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function substitutePlaceholders(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(TOKEN, (_match, key: string) => {
    const raw = ctx[key];
    if (raw === null || raw === undefined) return '';
    return escapeHtml(String(raw));
  });
}
```

Create `src/lib/email/unsubscribe.ts`:

```ts
// One-click unsubscribe (RFC 8058). The token is an HMAC-SHA256 of the
// message id, so the link needs no session and cannot be forged or replayed
// against another recipient.

function b64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(messageId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(messageId));
  return b64url(new Uint8Array(sig));
}

export async function signUnsubscribeToken(
  messageId: string,
  secret: string,
): Promise<string> {
  return hmac(messageId, secret);
}

export async function verifyUnsubscribeToken(
  messageId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmac(messageId, secret);
  if (expected.length !== token.length) return false;
  // Constant-time compare so a timing signal cannot leak the token.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function unsubscribeUrl(baseUrl: string, messageId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/email/unsubscribe?m=${encodeURIComponent(messageId)}&t=${encodeURIComponent(token)}`;
}

export function ensureUnsubscribeLink(html: string, url: string): string {
  if (html.includes(url)) return html;
  return (
    html +
    `\n<p style="margin-top:24px;font-size:12px;color:#6b7280">` +
    `<a href="${url}" style="color:#6b7280">Unsubscribe</a></p>`
  );
}
```

Create `src/lib/email/suppression.ts`:

```ts
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function dedupeRecipients<T extends { email: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const key = normalizeEmail(r.email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function filterSuppressed<T extends { email: string }>(
  list: T[],
  suppressed: string[],
): { sendable: T[]; suppressed: T[] } {
  const blocked = new Set(suppressed.map(normalizeEmail));
  const sendable: T[] = [];
  const skipped: T[] = [];
  for (const r of list) {
    (blocked.has(normalizeEmail(r.email)) ? skipped : sendable).push(r);
  }
  return { sendable, suppressed: skipped };
}
```

Create `src/lib/email/message.ts`:

```ts
import type { CampaignKind } from './types';
import { substitutePlaceholders } from './substitute';
import { ensureUnsubscribeLink } from './unsubscribe';

export interface BuildMessageInput {
  kind: CampaignKind;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  mergeData: Record<string, unknown>;
  /** Required for bulk; ignored for single (transactional mail is exempt). */
  unsubscribeUrl?: string;
}

export interface BuiltMessage {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMessage(input: BuildMessageInput): BuiltMessage {
  const subject = substitutePlaceholders(input.subject, input.mergeData);
  let html = substitutePlaceholders(input.bodyHtml, input.mergeData);
  const headers: Record<string, string> = {};

  // Gmail and Yahoo require one-click unsubscribe from bulk senders. Single
  // sends are transactional and must not carry it.
  if (input.kind === 'bulk' && input.unsubscribeUrl) {
    html = ensureUnsubscribeLink(html, input.unsubscribeUrl);
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const text = input.bodyText
    ? substitutePlaceholders(input.bodyText, input.mergeData)
    : htmlToText(html);

  return { subject, html, text, headers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/emailHelpers.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 5: Type check and commit**

Run: `npx tsc --noEmit` (must print nothing).

```bash
git add src/lib/email tests/unit/emailHelpers.test.ts
git commit -m "feat(email): pure helpers for crypto, merge fields, unsubscribe and suppression

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Database schema

**Files:**
- Create: `supabase/migrations/152_email_marketing_schema.sql`

**Interfaces:**
- Consumes: `public.is_org_member(uuid)` and `public.is_org_admin_or_owner(uuid)` from migration 036.
- Produces: tables `email_accounts`, `email_account_secrets`, `email_campaigns`, `email_messages`, `email_suppressions`. Later tasks read and write exactly these column names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/152_email_marketing_schema.sql`:

```sql
-- 152_email_marketing_schema.sql
--
-- Email marketing: users connect their own SMTP account and send single or
-- bulk personalized email. See
-- docs/superpowers/specs/2026-09-18-email-marketing-design.md
--
-- Secrets live in email_account_secrets, a separate table with a deny-all
-- RLS policy (the app_secrets pattern from migration 111), so the encrypted
-- SMTP password is never reachable from a browser session at all — only the
-- service role, used by the Vercel worker, can read it.

-- ── Sending accounts ────────────────────────────────────────────────
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  label text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  smtp_host text not null,
  smtp_port integer not null default 587,
  smtp_secure boolean not null default false,
  smtp_username text not null,
  daily_limit integer not null default 500,
  hourly_limit integer not null default 60,
  status text not null default 'unverified'
    check (status in ('unverified','active','error')),
  last_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_accounts enable row level security;
grant select, insert, update, delete on public.email_accounts to authenticated;
grant all on public.email_accounts to service_role;
create index if not exists idx_email_accounts_org on public.email_accounts(organization_id);

drop policy if exists "email_accounts_read" on public.email_accounts;
create policy "email_accounts_read" on public.email_accounts
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "email_accounts_write" on public.email_accounts;
create policy "email_accounts_write" on public.email_accounts
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ── Secrets (never readable by a browser) ───────────────────────────
create table if not exists public.email_account_secrets (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  secret_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.email_account_secrets enable row level security;
grant all on public.email_account_secrets to service_role;

drop policy if exists "email_account_secrets_no_one" on public.email_account_secrets;
create policy "email_account_secrets_no_one" on public.email_account_secrets
  for all to authenticated using (false) with check (false);

-- ── Campaigns ───────────────────────────────────────────────────────
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  account_id uuid not null references public.email_accounts(id) on delete restrict,
  kind text not null default 'bulk' check (kind in ('single','bulk')),
  name text not null,
  subject text not null,
  body_html text not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','paused','sent','failed')),
  scheduled_at timestamptz,
  rate_per_hour integer not null default 60,
  queued_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  suppressed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_campaigns enable row level security;
grant select, insert, update, delete on public.email_campaigns to authenticated;
grant all on public.email_campaigns to service_role;
create index if not exists idx_email_campaigns_org on public.email_campaigns(organization_id, created_at desc);

drop policy if exists "email_campaigns_rw" on public.email_campaigns;
create policy "email_campaigns_rw" on public.email_campaigns
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ── Outbox ──────────────────────────────────────────────────────────
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  to_email text not null,
  to_name text,
  merge_data jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','suppressed')),
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_messages enable row level security;
grant select on public.email_messages to authenticated;
grant insert on public.email_messages to authenticated;
grant all on public.email_messages to service_role;
-- The worker's claim query drives this index.
create index if not exists idx_email_messages_claim
  on public.email_messages(status, send_after);
create index if not exists idx_email_messages_campaign
  on public.email_messages(campaign_id);

drop policy if exists "email_messages_read" on public.email_messages;
create policy "email_messages_read" on public.email_messages
  for select to authenticated using (public.is_org_member(organization_id));

-- Members may enqueue, but never edit a row afterwards: status is the
-- worker's to own, so a client cannot mark its own mail as sent.
drop policy if exists "email_messages_insert" on public.email_messages;
create policy "email_messages_insert" on public.email_messages
  for insert to authenticated with check (public.is_org_member(organization_id));

-- ── Suppressions ────────────────────────────────────────────────────
create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  email text not null,
  reason text not null default 'unsubscribed'
    check (reason in ('unsubscribed','bounced','complaint','manual')),
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
alter table public.email_suppressions enable row level security;
grant select, insert, delete on public.email_suppressions to authenticated;
grant all on public.email_suppressions to service_role;
create index if not exists idx_email_suppressions_org on public.email_suppressions(organization_id);

drop policy if exists "email_suppressions_rw" on public.email_suppressions;
create policy "email_suppressions_rw" on public.email_suppressions
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Sanity-check the SQL**

There is no database to run this against. Re-read the file and confirm by eye:
every `create table` has a matching `enable row level security`; every table
has at least one policy; `email_account_secrets` has only the deny-all policy
and no `grant` to `authenticated`; every foreign key names a table that exists
(`organizations(organization_id)`, `workspaces(workspace_id)`,
`crm_contacts(id)`, `auth.users(id)`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/152_email_marketing_schema.sql
git commit -m "feat(email): schema for accounts, campaigns, outbox and suppressions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Claim RPC, worker cron, and the dead-cron fix

**Files:**
- Create: `supabase/migrations/153_email_claim_and_cron.sql`

**Interfaces:**
- Consumes: the tables from Task 2; `public.app_secrets(key, value)` from migration 111.
- Produces: `public.claim_email_batch(p_limit integer)` returning claimed rows; cron job `email_worker_minute`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/153_email_claim_and_cron.sql`:

```sql
-- 153_email_claim_and_cron.sql
--
-- 1. claim_email_batch(): the worker's atomic claim. FOR UPDATE SKIP LOCKED
--    means two overlapping ticks can never claim the same row, so a
--    recipient is never emailed twice.
-- 2. A cron job that pokes the Vercel worker every minute. Sending runs on
--    Vercel, not in an edge function, because Deno blocks outbound SMTP
--    ports 25 and 587 and Microsoft 365 requires 587.
-- 3. Cleanup: migration 143 deleted the crm-run-automations function but left
--    migration 111's cron job pointing at it, so this database has been
--    POSTing to a missing endpoint every minute ever since.

-- ── 1. Atomic claim ─────────────────────────────────────────────────
create or replace function public.claim_email_batch(p_limit integer default 25)
returns table (
  message_id uuid,
  campaign_id uuid,
  organization_id uuid,
  to_email text,
  to_name text,
  merge_data jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Rows stuck in 'sending' for over 10 minutes belong to a worker that died
  -- mid-send. Return them to the queue before claiming.
  update public.email_messages
     set status = 'queued', claimed_at = null
   where status = 'sending'
     and claimed_at < now() - interval '10 minutes';

  return query
  with claimed as (
    select m.id
      from public.email_messages m
      join public.email_campaigns c on c.id = m.campaign_id
     where m.status = 'queued'
       and m.send_after <= now()
       and c.status in ('sending','scheduled')
     order by m.send_after
     limit greatest(p_limit, 1)
     for update of m skip locked
  )
  update public.email_messages m
     set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
    from claimed
   where m.id = claimed.id
  returning m.id, m.campaign_id, m.organization_id, m.to_email, m.to_name,
            m.merge_data, m.attempts;
end;
$$;

revoke execute on function public.claim_email_batch(integer) from anon, authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

-- ── 2. Poke the Vercel worker every minute ──────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Configure once, as the project owner:
--   insert into public.app_secrets(key, value) values
--     ('site_url', 'https://your-app.vercel.app'),
--     ('email_worker_secret', '<same value as EMAIL_WORKER_SECRET in Vercel>')
--   on conflict (key) do update set value = excluded.value;
create or replace function public.kick_email_worker()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_pending integer;
begin
  select count(*) into v_pending
    from public.email_messages
   where status = 'queued' and send_after <= now();
  if v_pending = 0 then
    return;  -- nothing to do; don't spend an HTTP call
  end if;

  begin
    select value into v_url    from public.app_secrets where key = 'site_url';
    select value into v_secret from public.app_secrets where key = 'email_worker_secret';
  exception when others then
    v_url := null; v_secret := null;
  end;

  if v_url is null or v_secret is null then
    raise notice 'kick_email_worker: site_url or email_worker_secret not configured; skipping.';
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/api/email/tick',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-worker-secret', v_secret
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;

do $$
begin
  perform cron.unschedule('email_worker_minute');
exception when others then null;
end $$;

select cron.schedule(
  'email_worker_minute',
  '* * * * *',
  $$ select public.kick_email_worker(); $$
);

-- ── 3. Remove the orphaned CRM automation cron ──────────────────────
do $$
begin
  perform cron.unschedule('crm_automation_worker_minute');
exception when others then null;
end $$;

drop function if exists public.crm_kick_automation_worker();

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Sanity-check the SQL**

Re-read and confirm: `claim_email_batch` is `security definer`, revoked from
`anon`/`authenticated`, and its `returning` list matches the declared
`returns table` columns in order and type. Confirm the two `cron.unschedule`
calls are each wrapped so a missing job does not abort the migration.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/153_email_claim_and_cron.sql
git commit -m "feat(email): atomic outbox claim + worker cron, drop dead CRM cron

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Vercel API routes

**Files:**
- Create: `api/_lib/context.ts`, `api/email/tick.ts`, `api/email/verify.ts`, `api/email/unsubscribe.ts`
- Modify: `vercel.json`, `package.json`

**Interfaces:**
- Consumes: `buildMessage`, `decryptSecret`, `signUnsubscribeToken`, `verifyUnsubscribeToken`, `unsubscribeUrl` from `src/lib/email/*` (Task 1); `claim_email_batch` (Task 3); the tables from Task 2.
- Produces: `POST /api/email/tick`, `POST /api/email/verify`, `GET|POST /api/email/unsubscribe`.

Environment variables required in Vercel (document them in the report, do not
put values in code): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`INTEGRATION_TOKEN_KEY`, `EMAIL_WORKER_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET`,
`PUBLIC_SITE_URL`.

- [ ] **Step 1: Add dependencies**

Run: `npm install nodemailer && npm install -D @types/nodemailer @vercel/node`
Confirm `package.json` gained `nodemailer` under dependencies and the two
under devDependencies. Do not upgrade anything else.

- [ ] **Step 2: Fix the rewrite that would swallow /api**

`vercel.json` currently sends every path to `index.html`, which would make the
new functions unreachable. Replace its contents with:

```json
{
  "rewrites": [
    {
      "source": "/((?!api/|google[a-z0-9]+\\.html$).*)",
      "destination": "/index.html"
    }
  ]
}
```

- [ ] **Step 3: Write the shared context module**

Create `api/_lib/context.ts`:

```ts
// Shared plumbing for the email API routes. Files under api/_lib are not
// routes (Vercel ignores the underscore prefix).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Service-role client. Never expose this key or its client to a browser. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Constant-time string compare for shared secrets. */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function siteUrl(): string {
  return env('PUBLIC_SITE_URL').replace(/\/+$/, '');
}
```

- [ ] **Step 4: Write the worker**

Create `api/email/tick.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { env, serviceClient, secretEquals, siteUrl } from '../_lib/context';
import { decryptSecret } from '../../src/lib/email/crypto';
import { buildMessage } from '../../src/lib/email/message';
import { signUnsubscribeToken, unsubscribeUrl } from '../../src/lib/email/unsubscribe';

const BATCH = 25;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provided = String(req.headers['x-worker-secret'] ?? '');
  if (!provided || !secretEquals(provided, env('EMAIL_WORKER_SECRET'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = serviceClient();
  const { data: claimed, error: claimError } = await db.rpc('claim_email_batch', {
    p_limit: BATCH,
  });
  if (claimError) return res.status(500).json({ error: claimError.message });
  if (!claimed || claimed.length === 0) return res.status(200).json({ sent: 0, failed: 0 });

  let sent = 0;
  let failed = 0;

  // Group by campaign so one campaign's account and body are fetched once.
  const campaignIds = [...new Set(claimed.map((m: any) => m.campaign_id))];
  const { data: campaigns } = await db
    .from('email_campaigns')
    .select('*')
    .in('id', campaignIds);
  const byCampaign = new Map((campaigns ?? []).map((c: any) => [c.id, c]));

  const transports = new Map<string, nodemailer.Transporter>();
  const accounts = new Map<string, any>();

  for (const row of claimed as any[]) {
    const campaign = byCampaign.get(row.campaign_id);
    try {
      if (!campaign) throw new Error('Campaign not found');

      if (!transports.has(campaign.account_id)) {
        const { data: account } = await db
          .from('email_accounts')
          .select('*')
          .eq('id', campaign.account_id)
          .single();
        if (!account) throw new Error('Sending account not found');
        const { data: secretRow } = await db
          .from('email_account_secrets')
          .select('secret_encrypted')
          .eq('account_id', account.id)
          .single();
        if (!secretRow) throw new Error('Sending account has no stored password');
        const password = await decryptSecret(
          secretRow.secret_encrypted,
          env('INTEGRATION_TOKEN_KEY'),
        );
        accounts.set(campaign.account_id, account);
        transports.set(
          campaign.account_id,
          nodemailer.createTransport({
            host: account.smtp_host,
            port: account.smtp_port,
            secure: account.smtp_secure,
            auth: { user: account.smtp_username, pass: password },
          }),
        );
      }

      const account = accounts.get(campaign.account_id);
      const transport = transports.get(campaign.account_id)!;

      let unsub: string | undefined;
      if (campaign.kind === 'bulk') {
        const token = await signUnsubscribeToken(row.message_id, env('EMAIL_UNSUBSCRIBE_SECRET'));
        unsub = unsubscribeUrl(siteUrl(), row.message_id, token);
      }

      const built = buildMessage({
        kind: campaign.kind,
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        mergeData: row.merge_data ?? {},
        unsubscribeUrl: unsub,
      });

      const info = await transport.sendMail({
        from: `"${account.from_name}" <${account.from_email}>`,
        replyTo: account.reply_to ?? undefined,
        to: row.to_name ? `"${row.to_name}" <${row.to_email}>` : row.to_email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        headers: built.headers,
      });

      await db
        .from('email_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: info.messageId ?? null,
          last_error: null,
        })
        .eq('id', row.message_id);
      sent++;
    } catch (err: any) {
      const message = String(err?.message ?? err);
      // A 5xx from the server (bad credentials, rejected sender) will not fix
      // itself; fail immediately rather than burning the retry budget.
      const permanent = /^5\d\d/.test(String(err?.responseCode ?? '')) || row.attempts >= 3;
      await db
        .from('email_messages')
        .update({
          status: permanent ? 'failed' : 'queued',
          claimed_at: null,
          last_error: message.slice(0, 500),
        })
        .eq('id', row.message_id);
      if (permanent) failed++;
    }
  }

  // Roll the per-campaign counters up and close finished campaigns.
  for (const id of campaignIds) {
    const { count: remaining } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .in('status', ['queued', 'sending']);
    const { count: sentCount } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'sent');
    const { count: failedCount } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'failed');
    await db
      .from('email_campaigns')
      .update({
        sent_count: sentCount ?? 0,
        failed_count: failedCount ?? 0,
        status: (remaining ?? 0) === 0 ? 'sent' : 'sending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  return res.status(200).json({ sent, failed, claimed: claimed.length });
}
```

- [ ] **Step 5: Write the test-send route**

Create `api/email/verify.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { env, serviceClient } from '../_lib/context';
import { decryptSecret } from '../../src/lib/email/crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = String((req.body ?? {}).accountId ?? '');
  const to = String((req.body ?? {}).to ?? userData.user.email ?? '');
  if (!accountId || !to) return res.status(400).json({ error: 'accountId and to are required' });

  const { data: account } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // The caller must belong to the account's organization.
  const { data: profile } = await db
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile || profile.organization_id !== account.organization_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { data: secretRow } = await db
      .from('email_account_secrets')
      .select('secret_encrypted')
      .eq('account_id', accountId)
      .single();
    if (!secretRow) throw new Error('No stored password for this account');
    const password = await decryptSecret(secretRow.secret_encrypted, env('INTEGRATION_TOKEN_KEY'));

    const transport = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: { user: account.smtp_username, pass: password },
    });

    await transport.sendMail({
      from: `"${account.from_name}" <${account.from_email}>`,
      to,
      subject: 'TaskCalendar test email',
      text: 'This is a test message. Your sending account works.',
    });

    await db
      .from('email_accounts')
      .update({ status: 'active', last_error: null, last_verified_at: new Date().toISOString() })
      .eq('id', accountId);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    await db
      .from('email_accounts')
      .update({ status: 'error', last_error: message })
      .eq('id', accountId);
    return res.status(400).json({ ok: false, error: message });
  }
}
```

- [ ] **Step 6: Write the unsubscribe route**

Create `api/email/unsubscribe.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env, serviceClient } from '../_lib/context';
import { verifyUnsubscribeToken } from '../../src/lib/email/unsubscribe';

// Public and token-authenticated. POST is the RFC 8058 one-click path that
// Gmail and Yahoo call directly; GET is the human-visible link.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const messageId = String(req.query.m ?? '');
  const token = String(req.query.t ?? '');
  if (!messageId || !token) return res.status(400).json({ error: 'Invalid link' });

  const ok = await verifyUnsubscribeToken(messageId, token, env('EMAIL_UNSUBSCRIBE_SECRET'));
  if (!ok) return res.status(403).json({ error: 'Invalid link' });

  const db = serviceClient();
  const { data: message } = await db
    .from('email_messages')
    .select('id, organization_id, to_email, campaign_id')
    .eq('id', messageId)
    .single();
  if (!message) return res.status(404).json({ error: 'Not found' });

  await db.from('email_suppressions').upsert(
    {
      organization_id: message.organization_id,
      email: String(message.to_email).trim().toLowerCase(),
      reason: 'unsubscribed',
      campaign_id: message.campaign_id,
    },
    { onConflict: 'organization_id,email' },
  );

  if (req.method === 'POST') return res.status(200).json({ ok: true });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>` +
      `<div style="font:16px system-ui;max-width:32rem;margin:15vh auto;text-align:center">` +
      `<h1 style="font-size:20px">You are unsubscribed</h1>` +
      `<p style="color:#6b7280">We removed ${String(message.to_email).replace(/[<>&]/g, '')} from this list. You will not receive further messages.</p>` +
      `</div>`,
  );
}
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit` (must print nothing — `api/` is outside the tsconfig
include, so this checks that `src/lib/email` still compiles).
Run: `npm run build` (must succeed).

```bash
git add api vercel.json package.json package-lock.json
git commit -m "feat(email): Vercel worker, test-send and one-click unsubscribe routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Supabase service layer for the browser

**Files:**
- Create: `src/services/supabase/email.ts`
- Test: `tests/unit/emailRecipients.test.ts`

**Interfaces:**
- Consumes: `src/lib/email/types.ts`, `suppression.ts` (Task 1); tables from Task 2.
- Produces:
  - `listAccounts(orgId: string): Promise<EmailAccount[]>`
  - `createAccount(input: CreateAccountInput): Promise<EmailAccount>` — inserts the account, then stores the encrypted password through `saveAccountSecret`
  - `saveAccountSecret(accountId: string, password: string): Promise<void>` — encrypts with `VITE_INTEGRATION_TOKEN_KEY` and writes via the `email_account_secrets` service path (see Step 3 note)
  - `deleteAccount(accountId: string): Promise<void>`
  - `listCampaigns(orgId: string, workspaceId: string | null): Promise<EmailCampaign[]>`
  - `createCampaign(input: CreateCampaignInput): Promise<EmailCampaign>`
  - `queueRecipients(campaignId: string, orgId: string, recipients: Recipient[]): Promise<{ queued: number; suppressed: number }>`
  - `listMessages(campaignId: string): Promise<EmailMessage[]>`
  - `listSuppressions(orgId: string): Promise<EmailSuppression[]>`
  - `addSuppression(orgId: string, email: string): Promise<void>`
  - `removeSuppression(id: string): Promise<void>`
  - `contactsForCampaign(orgId: string, workspaceId: string | null): Promise<Recipient[]>`
  - `parseRecipientsCsv(text: string): { recipients: Recipient[]; errors: string[] }`
  - `parsePastedRecipients(text: string): { recipients: Recipient[]; errors: string[] }`
  - `type Recipient = { email: string; name?: string; contactId?: string; mergeData: Record<string, unknown> }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/emailRecipients.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRecipientsCsv, parsePastedRecipients } from "@/services/supabase/email";

describe("parsePastedRecipients", () => {
  it("accepts one address per line", () => {
    const { recipients } = parsePastedRecipients("a@x.com\nb@x.com");
    expect(recipients.map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
  });
  it("accepts comma and semicolon separated addresses", () => {
    const { recipients } = parsePastedRecipients("a@x.com, b@x.com; c@x.com");
    expect(recipients).toHaveLength(3);
  });
  it("accepts a display name in angle brackets", () => {
    const { recipients } = parsePastedRecipients("Ada Lovelace <ada@x.com>");
    expect(recipients[0]).toMatchObject({ email: "ada@x.com", name: "Ada Lovelace" });
  });
  it("reports invalid addresses instead of silently dropping them", () => {
    const { recipients, errors } = parsePastedRecipients("good@x.com\nnot-an-email");
    expect(recipients.map((r) => r.email)).toEqual(["good@x.com"]);
    expect(errors.join(" ")).toContain("not-an-email");
  });
  it("dedupes case-insensitively", () => {
    const { recipients } = parsePastedRecipients("a@x.com\nA@X.com");
    expect(recipients).toHaveLength(1);
  });
});

describe("parseRecipientsCsv", () => {
  it("reads an email column and exposes other columns as merge data", () => {
    const csv = "email,first_name,company\nada@x.com,Ada,Acme";
    const { recipients } = parseRecipientsCsv(csv);
    expect(recipients[0].email).toBe("ada@x.com");
    expect(recipients[0].mergeData).toMatchObject({ first_name: "Ada", company: "Acme" });
  });
  it("finds the email column whatever its case or spacing", () => {
    const { recipients } = parseRecipientsCsv(" Email Address \nada@x.com");
    expect(recipients[0].email).toBe("ada@x.com");
  });
  it("errors when no email column exists", () => {
    const { recipients, errors } = parseRecipientsCsv("name,company\nAda,Acme");
    expect(recipients).toHaveLength(0);
    expect(errors.join(" ").toLowerCase()).toContain("email");
  });
  it("skips blank rows", () => {
    const { recipients } = parseRecipientsCsv("email\nada@x.com\n\n");
    expect(recipients).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/emailRecipients.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the service**

Create `src/services/supabase/email.ts` following the conventions in
`src/services/supabase/workspaces.ts`: import `supabase` from `./config`,
import `logger` from `@/lib/logger`, map snake_case rows to camelCase through
one `mapX` function per table, log and rethrow on error.

Implement every function in the Interfaces block above. Specific requirements:

- `parsePastedRecipients` splits on newline, comma and semicolon, trims, and
  accepts the `Name <email>` form. An entry failing
  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` goes to `errors` as
  `` `Not a valid email address: ${entry}` ``. Dedupe with
  `dedupeRecipients` from `@/lib/email/suppression`.
- `parseRecipientsCsv` uses `Papa.parse(text, { header: true, skipEmptyLines: true })`
  (papaparse is already a dependency). Find the email column by normalizing
  each header with `h.trim().toLowerCase().replace(/[\s_-]+/g, '')` and
  matching `email` or `emailaddress`. Every other column becomes a
  `mergeData` key under its normalized snake_case name. If no email column is
  found, return `{ recipients: [], errors: ['No "email" column found in the CSV'] }`.
- `contactsForCampaign` selects `id, first_name, last_name, email, company_id`
  from `crm_contacts` where `organization_id` matches, `email` is not null,
  and — when `workspaceId` is not null — `workspace_id` equals it. It returns
  `mergeData` of `{ first_name, last_name, full_name, email }`.
- `queueRecipients` reads the org's suppression list, splits with
  `filterSuppressed`, inserts one `email_messages` row per sendable recipient
  in chunks of 500, and updates the campaign's `queued_count` and
  `suppressed_count`. It returns both counts. It must never insert a
  suppressed recipient.
- `saveAccountSecret` encrypts with `encryptSecret` from `@/lib/email/crypto`
  using `import.meta.env.VITE_INTEGRATION_TOKEN_KEY`. **Note for the
  implementer:** `email_account_secrets` denies all access to `authenticated`,
  so a browser insert will fail. Write the encrypted value by calling
  `POST /api/email/verify`'s sibling route if one exists, otherwise implement
  `saveAccountSecret` to call a new `POST /api/email/account-secret` route you
  add in `api/email/account-secret.ts`, following the same JWT-verification
  and membership-check pattern as `api/email/verify.ts`, storing
  `{ accountId, secretEncrypted }`. Encryption happens in the browser so the
  plaintext password never leaves it in readable form.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/emailRecipients.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`

```bash
git add src/services/supabase/email.ts api/email/account-secret.ts tests/unit/emailRecipients.test.ts
git commit -m "feat(email): service layer for accounts, campaigns, recipients and suppressions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The Email page

**Files:**
- Create: `src/pages/Email.tsx`, `src/components/email/AccountsTab.tsx`, `src/components/email/ComposeTab.tsx`, `src/components/email/CampaignsTab.tsx`, `src/components/email/SuppressionTab.tsx`, `src/components/email/index.ts`

**Interfaces:**
- Consumes: everything from Task 5; `useAuth`, `useOrganization`, `useSelectedWorkspace`.
- Produces: `export const Email: React.FC` from `src/pages/Email.tsx`.

Follow the visual conventions of `src/pages/Contracts.tsx`: `Card`,
`CardHeader`, `CardTitle`, `CardContent`, `Button`, `Input`, `Label`,
`Textarea`, `Select`, `Badge`, `Tabs`, `lucide-react` icons, `toast` from
`sonner`, `Loader2` while loading. Each tab is its own file so no file grows
past roughly 300 lines.

- [ ] **Step 1: Page shell**

`src/pages/Email.tsx` renders a header ("Email", with a one-line description)
and a `Tabs` with four values: `campaigns`, `compose`, `accounts`,
`suppression`. It reads `organization` from `useOrganization()` and the
workspace from `useSelectedWorkspace()`, and passes `orgId` and `workspaceId`
down to each tab. Default tab is `campaigns`.

- [ ] **Step 2: Accounts tab**

`AccountsTab.tsx`:
- Lists accounts with label, from address, host and port, and a status badge
  (`unverified` grey, `active` green, `error` red with `last_error` shown).
- "Add account" dialog with fields: Label, From name, From email, Reply-to
  (optional), SMTP host, SMTP port (default 587), "Use TLS on connect"
  switch (sets `smtp_secure`, on for port 465), Username, Password.
- On save: `createAccount` then `saveAccountSecret`, then automatically call
  the verify route and show the result. On failure show the SMTP error text
  in the dialog, since it is the actionable part.
- A "Send test" button per account re-runs verification.
- Delete with a confirm dialog.
- Only `isAdmin` from `useOrganization()` may add, edit, delete, or test. A
  member sees the list read-only.

- [ ] **Step 3: Compose tab**

`ComposeTab.tsx`:
- Fields: Campaign name, sending account (Select of active accounts), Subject,
  Body (Textarea, HTML allowed), and a placeholder hint listing
  `{{first_name}}`, `{{last_name}}`, `{{full_name}}`, `{{email}}`, plus any
  CSV column.
- Recipients, choose one: **CRM contacts** (loads `contactsForCampaign`,
  shows the count and a scrollable preview with checkboxes), **Paste**
  (Textarea, parsed live with `parsePastedRecipients`, invalid entries listed),
  or **CSV** (file input, parsed with `parseRecipientsCsv`, shows detected
  columns).
- A live summary line: "N recipients, M suppressed and will be skipped".
- "Send test to me" sends one message to the current user's address.
- Send controls: "Send now" or "Schedule" with a datetime, and a rate per hour
  number input (default 60).
- On submit: `createCampaign` with `kind: recipients.length === 1 ? 'single' : 'bulk'`
  and status `sending` (or `scheduled` with `scheduledAt`), then
  `queueRecipients`, then a toast with the queued and suppressed counts, then
  switch to the Campaigns tab.
- Disable the submit button unless an account is selected and active, a
  subject exists, a body exists, and there is at least one sendable recipient.

- [ ] **Step 4: Campaigns tab**

`CampaignsTab.tsx`:
- Lists campaigns newest first: name, kind badge, status badge, counts
  (queued, sent, failed, suppressed), created date.
- Clicking one expands the per-recipient list from `listMessages`: address,
  status badge, and `last_error` when failed.
- A refresh button, plus a 15-second poll while any campaign is `sending`.

- [ ] **Step 5: Suppression tab**

`SuppressionTab.tsx`: a searchable list of suppressed addresses with reason
and date, an "Add address" input, and a remove button per row (admin only).

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm run build`

```bash
git add src/pages/Email.tsx src/components/email
git commit -m "feat(email): Email page with campaigns, compose, accounts and suppression tabs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire the page into the app, and fix the notification bug

**Files:**
- Modify: `src/context/SubscriptionContext.tsx`, `src/lib/pageCatalog.ts`, `src/lib/workspaceScope.ts`, `src/App.tsx`, `src/components/sidebar/Sidebar.tsx`, `src/services/email/emailService.ts`
- Test: `tests/unit/workspaceScope.test.ts` (update the pinned key list)

**Interfaces:**
- Consumes: `Email` from Task 6.
- Produces: route `/email`, `PageKey 'email'`, `AppFeature 'email_campaigns'`.

- [ ] **Step 1: Plan feature**

In `src/context/SubscriptionContext.tsx`, add `| "email_campaigns"` to the
`AppFeature` union, and add to `FEATURE_TIERS`:

```ts
  email_campaigns: ["trial", "advanced", "premium"],
```

- [ ] **Step 2: Page catalog**

In `src/lib/pageCatalog.ts`, add `| 'email'` to the `PageKey` union and this
entry to `PAGE_CATALOG`, directly after the `crm` entry:

```ts
  { key: 'email',              label: 'Email',              group: 'CRM',            routes: ['/email'], feature: 'email_campaigns' },
```

- [ ] **Step 3: Quick-menu key list**

In `src/lib/workspaceScope.ts`, add `'email'` to `QUICK_MENU_PAGE_KEYS`,
immediately after `'crm'`, so the per-workspace menu toggles cover the new
page. Then update the pinned expectation in
`tests/unit/workspaceScope.test.ts` (the `QUICK_MENU_PAGE_KEYS` test) to
include `"email"` in the same position.

- [ ] **Step 4: Route**

In `src/App.tsx`, add the lazy import beside the other page imports:

```ts
const EmailPage = React.lazy(() => import('@/pages/Email').then((m) => ({ default: m.Email })));
```

and this route inside the `AppLayout` children array, after the `/crm` route
object:

```tsx
            {
              path: '/email',
              element: (
                <ProtectedRoute requireSubscription requireFeature="email_campaigns" requirePage="email">
                  {lazyAppRoute(<EmailPage />)}
                </ProtectedRoute>
              ),
            },
```

- [ ] **Step 5: Sidebar entry**

In `src/components/sidebar/Sidebar.tsx`, import the `Mail` icon from
`lucide-react` and add to `QUICK_ITEMS_FULL`, directly after the CRM entry:

```ts
  { icon: Mail, label: 'Email', href: '/email', feature: 'email_campaigns' as const, page: 'email' as PageKey },
```

Then extend the existing feature filter in the `quickItems` memo so it also
covers the new href:

```ts
            (i.href !== '/email' || hasFeature('email_campaigns')) &&
```

- [ ] **Step 6: Fix the broken notification email**

In `src/services/email/emailService.ts`, `trySendViaGmailEdgeFn` posts to the
`notify-send-gmail` edge function, which migration 143 deleted, so every
notification 404s before falling back to EmailJS. Delete that function and its
call site, so `sendNotificationEmail` goes straight to the EmailJS path it
already falls back to. Leave a comment recording why:

```ts
// The notify-send-gmail edge function was removed with the CRM stack in
// migration 143; calling it 404'd on every notification. Notifications go
// through EmailJS until they are migrated onto the email_messages outbox.
```

Remove any import or constant left unused by the deletion, or the build fails
under `noUnusedLocals`.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit && npm run build && npx vitest run tests/unit/workspaceScope.test.ts`
Expected: clean build, workspaceScope tests pass with the updated key list.

```bash
git add src/context/SubscriptionContext.tsx src/lib/pageCatalog.ts src/lib/workspaceScope.ts src/App.tsx src/components/sidebar/Sidebar.tsx src/services/email/emailService.ts tests/unit/workspaceScope.test.ts
git commit -m "feat(email): route, sidebar and plan gate; stop calling the deleted notify function

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Deployment documentation and final verification

**Files:**
- Create: `docs/superpowers/deployment/email-marketing-setup.md`

- [ ] **Step 1: Write the setup guide**

Create `docs/superpowers/deployment/email-marketing-setup.md` covering, in
order, with exact commands:

1. Apply migrations 152 and 153 (`supabase db push`, or paste into the SQL
   Editor).
2. Generate the two secrets:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   for `EMAIL_WORKER_SECRET` and `EMAIL_UNSUBSCRIBE_SECRET`.
3. Reuse the existing `INTEGRATION_TOKEN_KEY` value, or generate one the same
   way if the project has none.
4. Set the Vercel environment variables for Production and Preview:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_TOKEN_KEY`,
   `EMAIL_WORKER_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET`, `PUBLIC_SITE_URL`, plus
   the browser-side `VITE_INTEGRATION_TOKEN_KEY` with the same value as
   `INTEGRATION_TOKEN_KEY`.
5. Configure the database side so the cron can reach Vercel:
   ```sql
   insert into public.app_secrets(key, value) values
     ('site_url', 'https://<your-domain>'),
     ('email_worker_secret', '<EMAIL_WORKER_SECRET value>')
   on conflict (key) do update set value = excluded.value;
   ```
6. Redeploy so Vite bakes in the new `VITE_` variable.
7. Smoke test: add an account, send a test, send a one-recipient campaign,
   confirm the row reaches `sent`, then click the unsubscribe link and confirm
   a suppression row appears.
8. A troubleshooting table: nothing sends (check `app_secrets` and the cron
   with `select * from cron.job`), 401 from the tick (secret mismatch),
   SMTP timeout on port 587 (confirm the route is the Vercel function, not an
   edge function), authentication failed (Gmail needs an app password, not
   the account password).

Also note the security property worth keeping: `VITE_INTEGRATION_TOKEN_KEY`
ships in the browser bundle, so it protects the password at rest in the
database, not from a determined authenticated user of your own app. Record it
as a known limitation and a follow-up (move encryption server-side into the
account-secret route).

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: clean type check, successful build, and no new test failures against
the documented baseline (34 pre-existing failing files).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/deployment/email-marketing-setup.md
git commit -m "docs: email marketing deployment and troubleshooting guide

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Connect own SMTP provider → Tasks 2, 4, 5, 6 (Accounts tab
plus verify route). Single and bulk through one pipeline → `kind` column,
Compose tab chooses it by recipient count. Recipients from CRM, paste, CSV →
Task 5 parsers and `contactsForCampaign`, Task 6 Compose tab. Personalization
→ `substitutePlaceholders`, tested. Suppression enforced at claim time → the
`queueRecipients` filter plus the worker's campaign-status join; unsubscribe
writes the row. One-click unsubscribe headers for bulk only → `buildMessage`,
tested. Per-recipient status → `email_messages.status` and `last_error`,
surfaced in the Campaigns tab. Sending on Vercel with nodemailer → Task 4.
Queue with exactly-once claiming → `claim_email_batch` with
`FOR UPDATE SKIP LOCKED`. Retry and stuck-row recovery → attempts, the
10-minute requeue, permanent-failure rule. Both bugs → dead cron dropped in
Task 3, notification 404 removed in Task 7.

**Placeholder scan.** None. Task 5 Step 3 and Task 6 describe behaviour rather
than quoting every line, because those files are long and follow existing
repo conventions; every exported name, column, and rule they must satisfy is
stated explicitly.

**Type consistency.** `Recipient` and `mergeData` are used identically in
Tasks 5 and 6. `buildMessage`'s input fields match the columns the worker
reads (`campaign.kind`, `campaign.subject`, `campaign.body_html`,
`row.merge_data`). `claim_email_batch` returns `message_id, campaign_id,
organization_id, to_email, to_name, merge_data, attempts`, which is exactly
what `api/email/tick.ts` destructures. `PageKey 'email'` and
`AppFeature 'email_campaigns'` are spelled the same in the catalog, the route,
the sidebar, and `QUICK_MENU_PAGE_KEYS`.
