# Integrations Framework — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared OAuth + token + webhook framework that all three platform integrations (Google Meet, Gmail, Slack) will use, plus a Settings → Integrations UI that lists providers as Connect/Disconnect cards. Phase 1 produces no end-user features by itself, but it's the deliverable that every subsequent integration plan plugs into.

**Architecture:** New Postgres tables (`integrations`, `integration_events`) store encrypted OAuth tokens. Five new Supabase Edge Functions handle the OAuth dance (`oauth-start`, `oauth-callback`, `integrations-disconnect`), provider RPC (`integrations-action`), and inbound webhooks (`integrations-webhook`). Cryptographic primitives (AES-256-GCM token encryption, HMAC-signed OAuth state) live in `supabase/functions/_shared/` as plain Web-Crypto TypeScript so they can be unit-tested with Vitest in Node. The React client gets a new `Integrations` tab in `Settings.tsx` driven by a small provider registry, a `ProviderCard` component, and a `useIntegration` hook.

**Tech Stack:** TypeScript, React 18, Vite, Supabase (Postgres + Edge Functions on Deno), shadcn/ui, Tailwind, Vitest (new dev dep), `react-router-dom`, Web Crypto API.

**Spec reference:** [docs/superpowers/specs/2026-05-15-platform-integrations-design.md](../specs/2026-05-15-platform-integrations-design.md)

---

## File Map

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/057_integrations_tables.sql` | DB schema (integrations, integration_events, RLS policies, task columns) |
| `supabase/functions/_shared/crypto.ts` | AES-256-GCM encrypt/decrypt for tokens (pure Web Crypto) |
| `supabase/functions/_shared/oauth-state.ts` | HMAC-signed OAuth state parameter (sign + verify) |
| `supabase/functions/_shared/providers.ts` | Server-side provider config: scopes, auth/token URLs, env-var names |
| `supabase/functions/_shared/tokens.ts` | `getProviderTokens(userId, provider)` with auto-refresh |
| `supabase/functions/_shared/cors.ts` | Tiny CORS header helper |
| `supabase/functions/_shared/auth.ts` | `verifyUser(req)` — extracts user from Supabase auth bearer token |
| `supabase/functions/oauth-start/index.ts` | Generates provider OAuth URL with signed state |
| `supabase/functions/oauth-callback/index.ts` | Exchanges code for tokens, encrypts, persists |
| `supabase/functions/integrations-disconnect/index.ts` | Revokes tokens at provider and marks row revoked |
| `supabase/functions/integrations-action/index.ts` | RPC dispatcher (skeleton; real actions added in later plans) |
| `supabase/functions/integrations-webhook/index.ts` | Inbound webhook router (skeleton; provider handlers added later) |
| `src/services/integrations/types.ts` | Shared TypeScript types |
| `src/services/integrations/providers.ts` | Client-side provider display registry (label, icon, description) |
| `src/services/integrations/api.ts` | Thin client wrapping the new Edge Functions |
| `src/hooks/useIntegration.ts` | React hook returning status + connect/disconnect actions |
| `src/components/integrations/ProviderCard.tsx` | Single provider row in the Integrations tab |
| `src/components/integrations/IntegrationsTab.tsx` | Tab body listing all providers |
| `src/components/integrations/IntegrationCallback.tsx` | Route component at `/integrations/callback` |
| `tests/unit/crypto.test.ts` | Unit tests for crypto helpers |
| `tests/unit/oauth-state.test.ts` | Unit tests for OAuth state signing |
| `vitest.config.ts` | Vitest configuration |

**Files modified:**

| Path | Change |
|---|---|
| `package.json` | Add `vitest`, `@vitest/coverage-v8`; add `test` / `test:watch` scripts |
| `src/pages/Settings.tsx` | Add Integrations tab between Appearance and Capacity |
| `src/App.tsx` | Register `/integrations/callback` route |

---

## Conventions Used Throughout

- **Migration numbering:** Last applied is `056_user_last_seen.sql`, so this plan uses `057_…`.
- **Edge Function auth:** Existing functions follow the `supabase.auth.getUser(token)` pattern (see `supabase/functions/create-checkout-session/index.ts:63-89`). All new functions follow the same.
- **Deno imports:** Edge Functions use `https://esm.sh/...` and `https://deno.land/std/...` imports — same as `stripe-webhook/index.ts`.
- **`_shared/` rule:** Files in `supabase/functions/_shared/` must use ONLY web-standard APIs (no `Deno.env` at module scope, no `https://deno.land/…` imports) so they can be unit-tested with Vitest. Anything Deno-specific gets injected as a parameter.
- **Commit style:** Each task ends with one commit. Messages follow `<type>: <short imperative summary>` (`feat:`, `chore:`, `test:`, `fix:`). No body needed unless the change is non-obvious. Sign with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Supabase secrets needed before deploy** (set later, not during code tasks): `INTEGRATION_TOKEN_KEY`, `OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `INTEGRATION_REDIRECT_URI`. Used by Edge Functions only.

---

## Task 1: Add Vitest and test scripts

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/unit/.gitkeep`

- [ ] **Step 1.1: Add Vitest to devDependencies**

In `package.json`, add these entries to `devDependencies` (keep alphabetical order with existing entries):

```json
"vitest": "^1.6.0",
"@vitest/coverage-v8": "^1.6.0"
```

And add these entries to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Run: `npm install`
Expected: installs without errors; `node_modules/vitest` exists.

- [ ] **Step 1.2: Create Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Vitest 1.x exits 1 on "no test files found" by default. We have
    // genuine tests starting from Task 3, but Tasks 1-2 should still
    // exit 0 so the npm test script doesn't fail in the gap.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
```

- [ ] **Step 1.3: Verify Vitest runs**

Create `tests/unit/.gitkeep` (empty file) so the directory is tracked.

Run: `npx vitest run`
Expected output includes `No test files found, exiting with code 0` or similar. Exit code 0.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/unit/.gitkeep
git commit -m "$(cat <<'EOF'
chore: add Vitest for unit testing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Database migration — integrations tables

**Files:**
- Create: `supabase/migrations/057_integrations_tables.sql`

- [ ] **Step 2.1: Write the migration**

Create `supabase/migrations/057_integrations_tables.sql`:

```sql
-- 057_integrations_tables.sql
-- Adds the integrations + integration_events tables that support
-- Google Meet, Gmail, Slack and future third-party integrations.
--
-- Uses the existing public.is_org_member(uuid) helper from migration 036
-- to gate org-level reads. The organizations table's primary key is
-- organization_id (not id) -- see migration 036.

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(organization_id) on delete cascade,
  provider text not null check (provider in ('google','gmail','slack')),
  scopes text[] not null default '{}',
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  status text not null default 'active'
      check (status in ('active','revoked','error','pending')),
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists integrations_org_provider_idx
  on public.integrations(org_id, provider);

create index if not exists integrations_user_provider_idx
  on public.integrations(user_id, provider);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

-- RLS

alter table public.integrations enable row level security;

create policy "users read own user-level integrations"
  on public.integrations for select
  using (auth.uid() = user_id and org_id is null);

create policy "org members read org-level integrations"
  on public.integrations for select
  using (org_id is not null and public.is_org_member(org_id));

-- All writes go through Edge Functions using the service-role key,
-- so we do not add INSERT/UPDATE/DELETE policies. End-user clients
-- cannot mutate this table directly.

-- Add Google Meet columns to tasks (used by the Meet plan, but the
-- columns belong with the integrations migration so future migrations
-- can rely on them).

alter table public.tasks
  add column if not exists google_meet_link text,
  add column if not exists google_event_id text;
```

- [ ] **Step 2.2: Apply the migration locally**

Run: `npx supabase db reset --linked`
(Or `npx supabase migration up` if the user prefers an incremental apply.)
Expected: migration `057_integrations_tables.sql` listed in the applied set with no errors.

If the user is not running Supabase locally, skip the apply and verify only that the SQL parses by running:

`npx supabase db lint --file supabase/migrations/057_integrations_tables.sql`

Expected: no syntax errors.

- [ ] **Step 2.3: Commit**

```bash
git add supabase/migrations/057_integrations_tables.sql
git commit -m "$(cat <<'EOF'
feat: add integrations and integration_events tables

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Crypto helper — AES-256-GCM encrypt/decrypt

**Files:**
- Create: `supabase/functions/_shared/crypto.ts`
- Create: `tests/unit/crypto.test.ts`

This module encrypts OAuth tokens before they're written to the `integrations` table. It MUST use only Web Crypto APIs (no `Deno.env`, no Deno-specific imports) so Vitest can import and test it in Node.

- [ ] **Step 3.1: Write the failing tests**

Create `tests/unit/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from '../../supabase/functions/_shared/crypto';

describe('crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const key = await generateKey();
    const ciphertext = await encrypt('hello world', key);
    expect(ciphertext).not.toBe('hello world');
    const plaintext = await decrypt(ciphertext, key);
    expect(plaintext).toBe('hello world');
  });

  it('produces different ciphertext each call for the same plaintext (random IV)', async () => {
    const key = await generateKey();
    const a = await encrypt('same input', key);
    const b = await encrypt('same input', key);
    expect(a).not.toBe(b);
    expect(await decrypt(a, key)).toBe('same input');
    expect(await decrypt(b, key)).toBe('same input');
  });

  it('fails to decrypt with the wrong key', async () => {
    const keyA = await generateKey();
    const keyB = await generateKey();
    const ciphertext = await encrypt('secret', keyA);
    await expect(decrypt(ciphertext, keyB)).rejects.toThrow();
  });

  it('accepts long inputs (refresh tokens can be 200+ chars)', async () => {
    const key = await generateKey();
    const long = 'r'.repeat(2048);
    const ct = await encrypt(long, key);
    expect(await decrypt(ct, key)).toBe(long);
  });
});
```

- [ ] **Step 3.2: Run the tests, verify they fail**

Run: `npx vitest run tests/unit/crypto.test.ts`
Expected: 4 failing tests with "Cannot find module" or similar — the source file doesn't exist yet.

- [ ] **Step 3.3: Write the implementation**

Create `supabase/functions/_shared/crypto.ts`:

```typescript
// AES-256-GCM encrypt/decrypt using Web Crypto.
// Pure web-standard so this can be unit-tested in Node via Vitest
// AND imported by Deno Edge Functions at runtime.
//
// Wire format (base64url):  iv(12) || ciphertext || tag(16)

const IV_LEN = 12;

function b64encode(bytes: Uint8Array): string {
  // base64url (url-safe, no padding)
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
    throw new Error(`crypto: key must be 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function generateKey(): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return b64encode(raw);
}

export async function encrypt(plaintext: string, keyB64: string): Promise<string> {
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

export async function decrypt(packedB64: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const packed = b64decode(packedB64);
  if (packed.byteLength <= IV_LEN) {
    throw new Error('crypto: ciphertext too short');
  }
  const iv = packed.slice(0, IV_LEN);
  const ciphertext = packed.slice(IV_LEN);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 3.4: Run the tests, verify they pass**

Run: `npx vitest run tests/unit/crypto.test.ts`
Expected: 4 passing tests.

- [ ] **Step 3.5: Commit**

```bash
git add supabase/functions/_shared/crypto.ts tests/unit/crypto.test.ts
git commit -m "$(cat <<'EOF'
feat: add AES-256-GCM crypto helper for integration tokens

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: OAuth state signer — HMAC-signed state token

**Files:**
- Create: `supabase/functions/_shared/oauth-state.ts`
- Create: `tests/unit/oauth-state.test.ts`

The `state` query param passed to the OAuth provider must be tamper-proof: it carries `user_id`, `org_id`, `provider`, and a nonce. We HMAC-SHA256 sign it server-side; the callback verifies the signature before trusting the contents.

- [ ] **Step 4.1: Write the failing tests**

Create `tests/unit/oauth-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../../supabase/functions/_shared/oauth-state';

const SECRET = 'test-secret-key-do-not-use-in-prod';

describe('oauth-state', () => {
  it('round-trips a payload through sign/verify', async () => {
    const payload = {
      userId: 'u_123',
      orgId: 'o_456',
      provider: 'google',
      nonce: 'n_789',
    };
    const token = await signState(payload, SECRET);
    const decoded = await verifyState(token, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'slack', nonce: 'n_1' },
      SECRET,
    );
    // Flip a byte in the payload portion
    const parts = token.split('.');
    const tampered = parts[0].slice(0, -1) + (parts[0].slice(-1) === 'a' ? 'b' : 'a') + '.' + parts[1];
    await expect(verifyState(tampered, SECRET)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'google', nonce: 'n_1' },
      SECRET,
    );
    await expect(verifyState(token, 'other-secret')).rejects.toThrow();
  });

  it('preserves null orgId', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'gmail', nonce: 'n_2' },
      SECRET,
    );
    const decoded = await verifyState(token, SECRET);
    expect(decoded.orgId).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run the tests, verify they fail**

Run: `npx vitest run tests/unit/oauth-state.test.ts`
Expected: 4 failing tests, "Cannot find module".

- [ ] **Step 4.3: Write the implementation**

Create `supabase/functions/_shared/oauth-state.ts`:

```typescript
// HMAC-SHA256 signed OAuth state tokens.
// Wire format (base64url): payloadJsonB64 + "." + signatureB64

export interface OAuthStatePayload {
  userId: string;
  orgId: string | null;
  provider: string;
  nonce: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payloadJson));
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<OAuthStatePayload> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('oauth-state: malformed token');
  }
  const [payloadB64, sigB64] = parts;
  const key = await importHmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) {
    throw new Error('oauth-state: invalid signature');
  }
  const json = new TextDecoder().decode(b64urlDecode(payloadB64));
  return JSON.parse(json) as OAuthStatePayload;
}
```

- [ ] **Step 4.4: Run the tests, verify they pass**

Run: `npx vitest run tests/unit/oauth-state.test.ts`
Expected: 4 passing tests.

- [ ] **Step 4.5: Commit**

```bash
git add supabase/functions/_shared/oauth-state.ts tests/unit/oauth-state.test.ts
git commit -m "$(cat <<'EOF'
feat: add HMAC-signed OAuth state helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Server-side helpers — providers, tokens, cors, auth

**Files:**
- Create: `supabase/functions/_shared/providers.ts`
- Create: `supabase/functions/_shared/tokens.ts`
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/auth.ts`

These four small modules are infrastructure for the Edge Functions. No unit tests — they're thin glue over Supabase + Web standards and will be exercised by the manual smoke test in Task 12.

- [ ] **Step 5.1: Create `providers.ts`**

Create `supabase/functions/_shared/providers.ts`:

```typescript
// Server-side provider configuration registry.
// Each provider lists its OAuth endpoints, env-var names for client_id/secret,
// and the set of scopes that Phase 1 of the framework registers for.
// Concrete actions (send-email, create-meet, slack-post) are added to this
// registry by the per-integration plans that follow.

export type ProviderId = 'google' | 'gmail' | 'slack';

export interface ProviderConfig {
  id: ProviderId;
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  // org-level providers store one row per org, not per user
  orgLevel: boolean;
}

export const providers: Record<ProviderId, ProviderConfig> = {
  google: {
    id: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    // Filled in by the Google Meet plan; framework registers an empty scope set
    // and the per-provider plans add to it.
    scopes: [],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  gmail: {
    id: 'gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: [],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  slack: {
    id: 'slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    scopes: [],
    orgLevel: true,
  },
};

export function getProvider(id: string): ProviderConfig {
  if (!(id in providers)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providers[id as ProviderId];
}
```

- [ ] **Step 5.2: Create `cors.ts`**

Create `supabase/functions/_shared/cors.ts`:

```typescript
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

export function preflight(): Response {
  return new Response('ok', { headers: corsHeaders });
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}
```

- [ ] **Step 5.3: Create `auth.ts`**

Create `supabase/functions/_shared/auth.ts`:

```typescript
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export interface AuthContext {
  userId: string;
  supabase: SupabaseClient;
}

/**
 * Verifies the Authorization: Bearer <token> header against Supabase auth.
 * Mirrors the pattern in supabase/functions/create-checkout-session/index.ts.
 * Throws Response on failure (caller does `try { await verifyUser(req) } catch (r) { return r }`).
 */
export async function verifyUser(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return { userId: data.user.id, supabase };
}
```

- [ ] **Step 5.4: Create `tokens.ts`**

Create `supabase/functions/_shared/tokens.ts`:

```typescript
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { decrypt, encrypt } from './crypto.ts';
import { getProvider, ProviderId } from './providers.ts';

export interface IntegrationTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, unknown>;
}

interface IntegrationRow {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  status: string;
}

/**
 * Returns decrypted tokens for a user's integration with a provider.
 * Refreshes the access token if it expires within the next 60 seconds.
 * Throws if the integration is not connected or is in error state.
 */
export async function getProviderTokens(
  supabase: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<IntegrationTokens> {
  const key = Deno.env.get('INTEGRATION_TOKEN_KEY');
  if (!key) throw new Error('INTEGRATION_TOKEN_KEY not set');

  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No ${provider} integration for user`);
  const row = data as IntegrationRow;
  if (row.status !== 'active') {
    throw new Error(`Integration status is ${row.status}`);
  }

  let accessToken = await decrypt(row.access_token_encrypted, key);
  const refreshToken = row.refresh_token_encrypted
    ? await decrypt(row.refresh_token_encrypted, key)
    : null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

  // Refresh if expiring within 60 seconds
  if (refreshToken && expiresAt && expiresAt.getTime() - Date.now() < 60_000) {
    const refreshed = await refreshAccessToken(provider, refreshToken);
    accessToken = refreshed.accessToken;
    await supabase
      .from('integrations')
      .update({
        access_token_encrypted: await encrypt(refreshed.accessToken, key),
        token_expires_at: refreshed.expiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: row.scopes,
    metadata: row.metadata ?? {},
  };
}

async function refreshAccessToken(
  provider: ProviderId,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const config = getProvider(provider);
  const clientId = Deno.env.get(config.clientIdEnv);
  const clientSecret = Deno.env.get(config.clientSecretEnv);
  if (!clientId || !clientSecret) {
    throw new Error(`Missing client credentials for ${provider}`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000)
    : null;
  return { accessToken: json.access_token, expiresAt };
}
```

- [ ] **Step 5.5: Type-check the new files**

Run: `npx tsc --noEmit --skipLibCheck supabase/functions/_shared/providers.ts supabase/functions/_shared/cors.ts`
Expected: no errors. (We skip `auth.ts` and `tokens.ts` because they import `https://...` URLs that the local TS compiler can't resolve; those are checked at deploy time by the Supabase CLI.)

- [ ] **Step 5.6: Commit**

```bash
git add supabase/functions/_shared/providers.ts supabase/functions/_shared/cors.ts supabase/functions/_shared/auth.ts supabase/functions/_shared/tokens.ts
git commit -m "$(cat <<'EOF'
feat: add provider registry, CORS, auth, and token-refresh helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Edge Function — `oauth-start`

**Files:**
- Create: `supabase/functions/oauth-start/index.ts`

Given a `provider`, builds the OAuth consent URL with a signed `state` parameter and returns it. The client redirects the user there.

- [ ] **Step 6.1: Write the function**

Create `supabase/functions/oauth-start/index.ts`:

```typescript
// Edge Function: oauth-start
// POST /oauth-start  { provider: "google" | "gmail" | "slack", scopes?: string[], orgId?: string }
// Returns { authUrl: string }
//
// The client redirects the browser to authUrl. After consent the provider
// redirects back to <INTEGRATION_REDIRECT_URI>?code=...&state=... which is
// served by the oauth-callback function.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { signState } from '../_shared/oauth-state.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    scopes?: string[];
    orgId?: string | null;
  };
  const providerId = body.provider as ProviderId;
  if (!providerId) return json({ error: 'provider required' }, 400);

  let config;
  try {
    config = getProvider(providerId);
  } catch {
    return json({ error: `Unknown provider: ${providerId}` }, 400);
  }

  const clientId = Deno.env.get(config.clientIdEnv);
  const redirectUri = Deno.env.get('INTEGRATION_REDIRECT_URI');
  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');
  if (!clientId || !redirectUri || !stateSecret) {
    return json({ error: 'Server configuration error' }, 500);
  }

  const scopes = body.scopes && body.scopes.length > 0 ? body.scopes : config.scopes;
  const nonce = crypto.randomUUID();
  const state = await signState(
    {
      userId: auth.userId,
      orgId: body.orgId ?? null,
      provider: providerId,
      nonce,
    },
    stateSecret,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    ...(config.extraAuthParams ?? {}),
  });

  // Slack uses comma-separated scopes in user_scope / scope params, not space-separated.
  // It accepts space-separated for bot scopes ('scope') and is the spec; we keep space here.
  // Per-integration plans can override scope formatting if needed.

  return json({ authUrl: `${config.authUrl}?${params.toString()}` }, 200, corsHeaders);
});
```

- [ ] **Step 6.2: Smoke test manually (after secrets set)**

After the user has set the Supabase secrets (deferred to deploy time), the Edge Function can be invoked locally:

Run: `npx supabase functions serve oauth-start --env-file supabase/.env`
Then in another shell:
`curl -X POST http://localhost:54321/functions/v1/oauth-start -H "Authorization: Bearer <user_token>" -H "Content-Type: application/json" -d '{"provider":"google","scopes":["openid"]}'`
Expected: `{"authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=…&state=…"}`.

This step is deferred to deploy time; the engineer should NOT block on this during plan execution.

- [ ] **Step 6.3: Commit**

```bash
git add supabase/functions/oauth-start/index.ts
git commit -m "$(cat <<'EOF'
feat: add oauth-start Edge Function

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Edge Function — `oauth-callback`

**Files:**
- Create: `supabase/functions/oauth-callback/index.ts`

Receives `?code&state` from the provider after the user consents. Verifies state, exchanges the code for tokens, encrypts and persists them, then redirects the browser back to the app.

- [ ] **Step 7.1: Write the function**

Create `supabase/functions/oauth-callback/index.ts`:

```typescript
// Edge Function: oauth-callback
// GET /oauth-callback?code=...&state=...&error=...
// Verifies state, exchanges code for tokens via the provider, encrypts and
// upserts the row in `integrations`, then 302-redirects the browser back to
// /settings?tab=integrations&connected=<provider>  (or &error=<msg> on failure).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { verifyState } from '../_shared/oauth-state.ts';
import { encrypt } from '../_shared/crypto.ts';

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';
  const successBase = `${appUrl}/settings?tab=integrations`;
  const failureBase = `${appUrl}/settings?tab=integrations&error=`;

  if (providerError) return redirect(`${failureBase}${encodeURIComponent(providerError)}`);
  if (!code || !state) return redirect(`${failureBase}missing_params`);

  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');
  const tokenKey = Deno.env.get('INTEGRATION_TOKEN_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const redirectUri = Deno.env.get('INTEGRATION_REDIRECT_URI');
  if (!stateSecret || !tokenKey || !supabaseUrl || !serviceKey || !redirectUri) {
    return redirect(`${failureBase}server_misconfigured`);
  }

  let payload;
  try {
    payload = await verifyState(state, stateSecret);
  } catch {
    return redirect(`${failureBase}invalid_state`);
  }

  const config = getProvider(payload.provider as ProviderId);
  const clientId = Deno.env.get(config.clientIdEnv);
  const clientSecret = Deno.env.get(config.clientSecretEnv);
  if (!clientId || !clientSecret) {
    return redirect(`${failureBase}missing_client_credentials`);
  }

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  if (!tokenRes.ok) {
    return redirect(`${failureBase}token_exchange_failed`);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    // Slack-specific
    authed_user?: { access_token?: string };
    team?: { id?: string; name?: string };
  };

  // Slack returns its bot/user tokens differently. For now we take the top-level
  // access_token (bot token for Slack, user token for Google). The per-integration
  // plans refine metadata extraction.
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return redirect(`${failureBase}no_access_token`);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;
  const scopes = tokenJson.scope ? tokenJson.scope.split(/[ ,]+/) : [];

  const metadata: Record<string, unknown> = {};
  if (tokenJson.team?.id) metadata.team_id = tokenJson.team.id;
  if (tokenJson.team?.name) metadata.team_name = tokenJson.team.name;

  // Upsert by (user_id, provider)
  const { error: upsertError } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: payload.userId,
        org_id: payload.orgId,
        provider: payload.provider,
        scopes,
        access_token_encrypted: await encrypt(accessToken, tokenKey),
        refresh_token_encrypted: tokenJson.refresh_token
          ? await encrypt(tokenJson.refresh_token, tokenKey)
          : null,
        token_expires_at: expiresAt,
        status: 'active',
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  if (upsertError) {
    console.error('integrations upsert failed', upsertError);
    return redirect(`${failureBase}persist_failed`);
  }

  return redirect(`${successBase}&connected=${payload.provider}`);
});
```

- [ ] **Step 7.2: Commit**

```bash
git add supabase/functions/oauth-callback/index.ts
git commit -m "$(cat <<'EOF'
feat: add oauth-callback Edge Function

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Edge Function — `integrations-disconnect`

**Files:**
- Create: `supabase/functions/integrations-disconnect/index.ts`

- [ ] **Step 8.1: Write the function**

Create `supabase/functions/integrations-disconnect/index.ts`:

```typescript
// Edge Function: integrations-disconnect
// POST /integrations-disconnect { provider: "google"|"gmail"|"slack" }
// Best-effort revokes the token at the provider, then marks the row revoked.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { decrypt } from '../_shared/crypto.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  const providerId = body.provider as ProviderId;
  if (!providerId) return json({ error: 'provider required' }, 400);

  const tokenKey = Deno.env.get('INTEGRATION_TOKEN_KEY');
  if (!tokenKey) return json({ error: 'Server configuration error' }, 500);

  const { data: row, error } = await auth.supabase
    .from('integrations')
    .select('id, access_token_encrypted')
    .eq('user_id', auth.userId)
    .eq('provider', providerId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ ok: true, note: 'no integration to revoke' });

  const config = getProvider(providerId);
  if (config.revokeUrl) {
    try {
      const accessToken = await decrypt(row.access_token_encrypted, tokenKey);
      await fetch(`${config.revokeUrl}?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
      });
    } catch (err) {
      console.warn('provider revoke failed (continuing):', err);
    }
  }

  const { error: updateError } = await auth.supabase
    .from('integrations')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true });
});
```

- [ ] **Step 8.2: Commit**

```bash
git add supabase/functions/integrations-disconnect/index.ts
git commit -m "$(cat <<'EOF'
feat: add integrations-disconnect Edge Function

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Edge Function — `integrations-action` (skeleton)

**Files:**
- Create: `supabase/functions/integrations-action/index.ts`

This is the RPC dispatcher. Phase 1 ships with one action — `whoami` — to prove the auth + token loading path works. Real actions (`create-meet`, `send-email`, `slack-post`) are added by the per-integration plans.

- [ ] **Step 9.1: Write the function**

Create `supabase/functions/integrations-action/index.ts`:

```typescript
// Edge Function: integrations-action
// POST /integrations-action { provider, action, payload }
// Dispatcher for provider-specific actions. Phase 1 ships only `whoami`
// (returns the connected account's metadata) so the framework is end-to-end
// verifiable. Per-integration plans (Meet, Gmail, Slack) extend the action map.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProviderTokens } from '../_shared/tokens.ts';
import { ProviderId } from '../_shared/providers.ts';

type ActionHandler = (args: {
  userId: string;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  // deno-lint-ignore no-explicit-any
  payload: any;
  tokens: Awaited<ReturnType<typeof getProviderTokens>>;
  // deno-lint-ignore no-explicit-any
}) => Promise<any>;

const actions: Record<string, ActionHandler> = {
  // 'whoami' is intentionally minimal: it proves auth + token decryption work.
  whoami: async ({ tokens }) => ({
    scopes: tokens.scopes,
    expiresAt: tokens.expiresAt,
    metadata: tokens.metadata,
  }),
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    action?: string;
    payload?: unknown;
  };
  if (!body.provider || !body.action) {
    return json({ error: 'provider and action required' }, 400);
  }

  const handler = actions[body.action];
  if (!handler) return json({ error: `Unknown action: ${body.action}` }, 400);

  let tokens;
  try {
    tokens = await getProviderTokens(
      auth.supabase,
      auth.userId,
      body.provider as ProviderId,
    );
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  try {
    const result = await handler({
      userId: auth.userId,
      supabase: auth.supabase,
      payload: body.payload,
      tokens,
    });
    return json({ ok: true, result });
  } catch (err) {
    console.error('action failed', err);
    return json({ error: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 9.2: Commit**

```bash
git add supabase/functions/integrations-action/index.ts
git commit -m "$(cat <<'EOF'
feat: add integrations-action dispatcher with whoami action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Edge Function — `integrations-webhook` (skeleton)

**Files:**
- Create: `supabase/functions/integrations-webhook/index.ts`

Inbound endpoint for provider events (Slack events, SendGrid inbound, etc.). Phase 1 ships a no-op router that verifies the request, writes to `integration_events` for idempotency, and returns 200. Per-integration plans add real handlers.

- [ ] **Step 10.1: Write the function**

Create `supabase/functions/integrations-webhook/index.ts`:

```typescript
// Edge Function: integrations-webhook
// POST /integrations-webhook?provider=slack|gmail-inbound|...
// Phase 1 only logs the event for idempotency and returns 200. Per-integration
// plans add the actual handlers (Slack signature verify, SendGrid signature
// verify, then dispatch).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { json, preflight } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const provider = new URL(req.url).searchParams.get('provider');
  if (!provider) return json({ error: 'provider query param required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server configuration error' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    // Some providers (Slack URL verification) send form-encoded; allow text fallback.
    payload = await req.text();
  }

  // External event id — best-effort. Each provider plan replaces this with
  // the provider's real event id (Slack event_id, SendGrid message_id, etc.)
  // For Phase 1 we use a random UUID so every request is logged as new.
  const externalEventId = crypto.randomUUID();

  const { error } = await supabase.from('integration_events').insert({
    provider,
    external_event_id: externalEventId,
    payload: typeof payload === 'string' ? { raw: payload } : payload,
    processed_at: new Date().toISOString(),
  });
  if (error) {
    console.error('integration_events insert failed', error);
    // Still return 200 so the provider doesn't retry hot.
  }

  return json({ ok: true });
});
```

- [ ] **Step 10.2: Commit**

```bash
git add supabase/functions/integrations-webhook/index.ts
git commit -m "$(cat <<'EOF'
feat: add integrations-webhook router skeleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Client types, provider registry, and API wrapper

**Files:**
- Create: `src/services/integrations/types.ts`
- Create: `src/services/integrations/providers.ts`
- Create: `src/services/integrations/api.ts`

- [ ] **Step 11.1: Create types**

Create `src/services/integrations/types.ts`:

```typescript
export type ProviderId = 'google' | 'gmail' | 'slack';

export type IntegrationStatus = 'active' | 'revoked' | 'error' | 'pending' | 'not_connected';

export interface IntegrationRow {
  id: string;
  provider: ProviderId;
  status: IntegrationStatus;
  scopes: string[];
  connected_at: string;
  metadata: Record<string, unknown>;
}

export interface ProviderDisplay {
  id: ProviderId;
  label: string;
  description: string;
  /** Lucide icon name, resolved at render time */
  iconName: 'Video' | 'Mail' | 'MessageSquare';
  /** Brand color used as the card accent (Tailwind class fragment) */
  accent: string;
  /** Whether this provider is org-level (admin-only) */
  orgLevel: boolean;
}
```

- [ ] **Step 11.2: Create client-side provider registry**

Create `src/services/integrations/providers.ts`:

```typescript
import type { ProviderDisplay, ProviderId } from './types';

export const providerDisplay: Record<ProviderId, ProviderDisplay> = {
  google: {
    id: 'google',
    label: 'Google Meet',
    description: 'Add Google Meet links to tasks with a due date and time.',
    iconName: 'Video',
    accent: 'text-emerald-600',
    orgLevel: false,
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    description: 'Send task notifications from your own Gmail address.',
    iconName: 'Mail',
    accent: 'text-rose-600',
    orgLevel: false,
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    description: 'Post project activity to a Slack channel and create tasks from messages.',
    iconName: 'MessageSquare',
    accent: 'text-violet-600',
    orgLevel: true,
  },
};

export const providerOrder: ProviderId[] = ['google', 'gmail', 'slack'];
```

- [ ] **Step 11.3: Create API wrapper**

Create `src/services/integrations/api.ts`:

```typescript
import { supabase } from '@/services/supabase/config';
import type { IntegrationRow, ProviderId } from './types';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export async function startOAuth(provider: ProviderId, scopes?: string[], orgId?: string | null): Promise<string> {
  const res = await fetch(`${FUNCTIONS_URL}/oauth-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider, scopes, orgId }),
  });
  if (!res.ok) throw new Error(`oauth-start failed: ${res.status}`);
  const json = await res.json();
  return json.authUrl as string;
}

export async function disconnect(provider: ProviderId): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/integrations-disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  // Reads come straight from the integrations table over the user's session,
  // gated by RLS.
  const { data, error } = await supabase
    .from('integrations')
    .select('id, provider, status, scopes, connected_at, metadata');
  if (error) throw error;
  return (data ?? []) as IntegrationRow[];
}

export async function callAction<T = unknown>(
  provider: ProviderId,
  action: string,
  payload?: unknown,
): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/integrations-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider, action, payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`action failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json.result as T;
}
```

- [ ] **Step 11.4: Type-check the client modules**

Run: `npx tsc --noEmit`
Expected: zero new errors. (Existing errors in the codebase, if any, should be unchanged.)

- [ ] **Step 11.5: Commit**

```bash
git add src/services/integrations/types.ts src/services/integrations/providers.ts src/services/integrations/api.ts
git commit -m "$(cat <<'EOF'
feat: add integrations client API and provider registry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `useIntegration` hook

**Files:**
- Create: `src/hooks/useIntegration.ts`

- [ ] **Step 12.1: Write the hook**

Create `src/hooks/useIntegration.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { startOAuth, disconnect as disconnectApi, listIntegrations } from '@/services/integrations/api';
import type { IntegrationRow, IntegrationStatus, ProviderId } from '@/services/integrations/types';

export interface UseIntegrationResult {
  status: IntegrationStatus;
  row: IntegrationRow | null;
  loading: boolean;
  error: string | null;
  /** Kicks off the OAuth redirect for this provider. */
  connect: (opts?: { scopes?: string[]; orgId?: string | null }) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useIntegration(provider: ProviderId): UseIntegrationResult {
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIntegrations();
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const row = rows?.find((r) => r.provider === provider) ?? null;
  const status: IntegrationStatus = row ? row.status : 'not_connected';

  const connect = useCallback(
    async (opts?: { scopes?: string[]; orgId?: string | null }) => {
      setError(null);
      try {
        const authUrl = await startOAuth(provider, opts?.scopes, opts?.orgId ?? null);
        window.location.assign(authUrl);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [provider],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectApi(provider);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [provider, refresh]);

  return { status, row, loading, error, connect, disconnect, refresh };
}
```

- [ ] **Step 12.2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 12.3: Commit**

```bash
git add src/hooks/useIntegration.ts
git commit -m "$(cat <<'EOF'
feat: add useIntegration React hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `ProviderCard` component

**Files:**
- Create: `src/components/integrations/ProviderCard.tsx`

- [ ] **Step 13.1: Write the component**

Create `src/components/integrations/ProviderCard.tsx`:

```tsx
import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Mail, MessageSquare, Loader2 } from 'lucide-react';
import { providerDisplay } from '@/services/integrations/providers';
import type { ProviderDisplay, ProviderId } from '@/services/integrations/types';
import { useIntegration } from '@/hooks/useIntegration';

const icons = { Video, Mail, MessageSquare } as const;

interface Props {
  provider: ProviderId;
  /** Optional scope list to request when connecting; defaults to provider's framework scopes. */
  scopes?: string[];
  /** For org-level providers, pass the current organization id. */
  orgId?: string | null;
  /** When false, hide the Connect button (e.g., for non-admins of org-level providers). */
  canConnect?: boolean;
}

export const ProviderCard: React.FC<Props> = ({
  provider,
  scopes,
  orgId,
  canConnect = true,
}) => {
  const display: ProviderDisplay = providerDisplay[provider];
  const Icon = icons[display.iconName];
  const { status, row, loading, error, connect, disconnect } = useIntegration(provider);

  const connectedAccount =
    (row?.metadata?.team_name as string | undefined) ??
    (row?.metadata?.email as string | undefined) ??
    null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-start gap-3">
          <Icon className={`h-6 w-6 ${display.accent}`} />
          <div>
            <CardTitle className="text-base">
              {display.label}
              {display.orgLevel && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Workspace
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {display.description}
            </CardDescription>
          </div>
        </div>
        <div>
          {status === 'active' && <Badge variant="default">Connected</Badge>}
          {status === 'error' && <Badge variant="destructive">Error</Badge>}
          {status === 'revoked' && <Badge variant="secondary">Disconnected</Badge>}
          {status === 'not_connected' && (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {connectedAccount && (
          <p className="text-sm text-muted-foreground mb-2">
            Connected as <span className="font-mono">{connectedAccount}</span>
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive mb-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          {status === 'active' || status === 'error' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void disconnect()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void connect({ scopes, orgId })}
              disabled={loading || !canConnect}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Connect ${display.label}`
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 13.2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 13.3: Commit**

```bash
git add src/components/integrations/ProviderCard.tsx
git commit -m "$(cat <<'EOF'
feat: add ProviderCard component for Settings integrations tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `IntegrationsTab` component

**Files:**
- Create: `src/components/integrations/IntegrationsTab.tsx`

- [ ] **Step 14.1: Write the component**

Create `src/components/integrations/IntegrationsTab.tsx`:

```tsx
import React from 'react';
import { ProviderCard } from './ProviderCard';
import { providerOrder, providerDisplay } from '@/services/integrations/providers';
import { useOrganization } from '@/context/OrganizationContext';

export const IntegrationsTab: React.FC = () => {
  const { currentOrgId, canManageSettings } = useOrganization();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Connected services</h3>
        <p className="text-sm text-muted-foreground">
          Link external tools so they can power task workflows. Each connection
          uses OAuth — TaskCalendar never sees your password.
        </p>
      </div>
      <div className="grid gap-3">
        {providerOrder.map((id) => {
          const display = providerDisplay[id];
          // Org-level providers (Slack) can only be connected by admins.
          // Non-admins still see the card so they know the connection exists,
          // but the Connect button is disabled.
          const canConnect = display.orgLevel ? canManageSettings : true;
          return (
            <ProviderCard
              key={id}
              provider={id}
              orgId={display.orgLevel ? currentOrgId : null}
              canConnect={canConnect}
            />
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 14.2: Verify `OrganizationContext` exposes `currentOrgId` and `canManageSettings`**

Run: `grep -n "currentOrgId\|canManageSettings" src/context/OrganizationContext.tsx`
Expected: both names are exported from the context. If `currentOrgId` is named differently (e.g. `orgId` or `activeOrgId`), update the import in `IntegrationsTab.tsx` to match.

- [ ] **Step 14.3: Commit**

```bash
git add src/components/integrations/IntegrationsTab.tsx
git commit -m "$(cat <<'EOF'
feat: add IntegrationsTab listing all provider cards

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Add the Integrations tab to `Settings.tsx`

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 15.1: Read the existing Settings tabs structure**

Run: `grep -n "TabsTrigger\|TabsContent" src/pages/Settings.tsx`
Expected: a list of `<TabsTrigger value="...">` entries and matching `<TabsContent value="...">` entries. Note the existing order (e.g. `profile`, `notifications`, `appearance`, `capacity`, `organization`).

- [ ] **Step 15.2: Add the import**

In `src/pages/Settings.tsx`, add to the existing imports:

```typescript
import { IntegrationsTab } from '@/components/integrations/IntegrationsTab';
import { Plug } from 'lucide-react';
```

- [ ] **Step 15.3: Add the TabsTrigger**

Find the `<TabsList>` block. Add a new trigger between `appearance` and `capacity` (or before `organization` if `capacity` is missing — the placement should match the spec's section 5 layout):

```tsx
<TabsTrigger value="integrations" className="gap-2">
  <Plug className="h-4 w-4" />
  Integrations
</TabsTrigger>
```

- [ ] **Step 15.4: Add the TabsContent**

Find where existing `<TabsContent>` blocks live. Add:

```tsx
<TabsContent value="integrations" className="space-y-4">
  <IntegrationsTab />
</TabsContent>
```

- [ ] **Step 15.5: Verify the page renders without TypeScript errors**

Run: `npx tsc --noEmit`
Expected: zero new errors.

Run: `npm run dev`
Then open `http://localhost:5173/settings?tab=integrations` in a browser.
Expected: the Integrations tab is selectable. Inside, three `ProviderCard` rows appear (Google Meet, Gmail, Slack), each showing "Not connected." Clicking "Connect Google Meet" should attempt to call `/functions/v1/oauth-start` (which will 401 or 500 until secrets are set — that's expected at this stage).

Stop the dev server with Ctrl+C.

- [ ] **Step 15.6: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
feat: add Integrations tab to Settings page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: OAuth callback route

**Files:**
- Create: `src/components/integrations/IntegrationCallback.tsx`
- Modify: `src/App.tsx`

The `oauth-callback` Edge Function itself redirects the browser straight to `/settings?tab=integrations&connected=...` after success. The frontend route here exists only to surface the `connected` or `error` query param as a toast and clean the URL. It's purely cosmetic glue.

- [ ] **Step 16.1: Write the callback component**

Create `src/components/integrations/IntegrationCallback.tsx`:

```tsx
import React, { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

export const IntegrationCallback: React.FC = () => {
  const [params] = useSearchParams();
  const connected = params.get('connected');
  const error = params.get('error');

  useEffect(() => {
    if (connected) {
      toast.success(`${connected} connected`);
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
    }
  }, [connected, error]);

  // The Edge Function redirects directly to /settings?tab=integrations, so
  // this component is mostly a safety net. If it ever loads, forward to the
  // tab.
  return <Navigate to="/settings?tab=integrations" replace />;
};
```

- [ ] **Step 16.2: Register the route**

In `src/App.tsx`, near the other lazy imports add:

```typescript
const IntegrationCallback = React.lazy(() =>
  import('@/components/integrations/IntegrationCallback').then((m) => ({
    default: m.IntegrationCallback,
  })),
);
```

Then add the route inside the public `RouterShell` children list (alongside `/accept-invite/:token`):

```typescript
{ path: '/integrations/callback', element: lazyRoute(<IntegrationCallback />) },
```

- [ ] **Step 16.3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 16.4: Commit**

```bash
git add src/components/integrations/IntegrationCallback.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: register /integrations/callback route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final verification

**Files:** none (this is a verification-only task).

- [ ] **Step 17.1: Run the full test suite**

Run: `npm run test`
Expected: 8 passing tests (4 crypto + 4 oauth-state). 0 failures.

- [ ] **Step 17.2: Full type-check**

Run: `npx tsc --noEmit`
Expected: no new TypeScript errors compared to the baseline before this plan started.

- [ ] **Step 17.3: Lint**

Run: `npm run lint`
Expected: no new lint errors in the files this plan added.

- [ ] **Step 17.4: Build**

Run: `npm run build`
Expected: build succeeds; bundle size delta is small (a few KB for the new components).

- [ ] **Step 17.5: Visual smoke test**

Run: `npm run dev`
Open `http://localhost:5173/settings` and navigate to the Integrations tab.
Verify:
- All three ProviderCards render with their Lucide icons and brand colors.
- Each card shows "Not connected".
- The Slack card shows a "Workspace" badge.
- Clicking "Connect Google Meet" / "Connect Gmail" / "Connect Slack" attempts a network call (browser DevTools → Network → look for a POST to `oauth-start`). The call will fail with 401/500 until Supabase secrets are set — this is expected at this stage. The framework code is complete.

Stop the dev server.

- [ ] **Step 17.6: Print remaining deploy steps for the engineer**

The framework is code-complete. To actually connect a provider end-to-end, the user needs to (these are deploy-time, not plan-execution-time):

1. Generate `INTEGRATION_TOKEN_KEY` and `OAUTH_STATE_SECRET`:
   - `INTEGRATION_TOKEN_KEY`: 32 random bytes, base64url-encoded. Generate with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.
   - `OAUTH_STATE_SECRET`: any high-entropy string (>= 32 chars).
2. Register an OAuth app at https://console.cloud.google.com (Google + Gmail) and https://api.slack.com/apps (Slack). Set the redirect URI for both to `https://<project-ref>.supabase.co/functions/v1/oauth-callback`.
3. Save secrets in Supabase:
   `npx supabase secrets set INTEGRATION_TOKEN_KEY=... OAUTH_STATE_SECRET=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=... INTEGRATION_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/oauth-callback APP_URL=https://yourapp.com`
4. Deploy the functions:
   `npx supabase functions deploy oauth-start oauth-callback integrations-disconnect integrations-action integrations-webhook`
5. Apply the migration to production: `npx supabase db push --linked`.

After those five steps, the framework is live. The next plans (Google Meet, Slack, Gmail) layer real actions on top.

- [ ] **Step 17.7: Tag the framework as complete**

```bash
git tag -a integrations-framework-v1 -m "Phase 1: integration framework complete"
```

(Optional. Skip if the user doesn't tag releases.)

---

## What's NOT in this plan (and where it lives)

- **Google Meet "Add Google Meet" button & event creation** — Plan 2.
- **Gmail send + SendGrid inbound + reply parsing + forward-to-sender** — Plan 4.
- **Slack per-project channel link, slash command, message action** — Plan 3.
- **Notification preference toggle "Send my notifications via my Gmail"** — Plan 4.
- **CASA audit application for `gmail.readonly`** — V2, not yet planned.

Each subsequent plan adds: (a) one action handler to `integrations-action`, (b) one or more handlers to `integrations-webhook`, (c) feature-specific frontend (a button on tasks, a project settings panel, a notification toggle), (d) any provider-specific data model additions.

---

## Spec-coverage self-check

| Spec section | Implemented in this plan | Notes |
|---|---|---|
| Database schema (integrations, integration_events, RLS) | Task 2 | ✅ |
| Token encryption (AES-256-GCM) | Task 3 | ✅ |
| OAuth state signing (HMAC) | Task 4 | ✅ |
| Edge Function: oauth-start | Task 6 | ✅ |
| Edge Function: oauth-callback | Task 7 | ✅ |
| Edge Function: integrations-disconnect | Task 8 | ✅ |
| Edge Function: integrations-action | Task 9 | Skeleton with `whoami`; real actions per-integration |
| Edge Function: integrations-webhook | Task 10 | Skeleton router; real handlers per-integration |
| Frontend: Settings → Integrations tab + ProviderCard | Tasks 13-15 | ✅ |
| Frontend: useIntegration hook | Task 12 | ✅ |
| Frontend: OAuth callback route | Task 16 | ✅ |
| Google Meet feature | NOT YET — Plan 2 | Out of scope (this plan = framework only) |
| Gmail send + inbound | NOT YET — Plan 4 | Out of scope |
| Slack feature | NOT YET — Plan 3 | Out of scope |
| Notification preferences toggle | NOT YET — Plan 4 | Out of scope |
| Reply-To HMAC token format | NOT YET — Plan 4 | Out of scope |
| `project_slack_links` table | NOT YET — Plan 3 | Out of scope |
