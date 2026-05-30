# CRM Plan 4 — Lead-Capture Forms (Public Page + Embed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Admins create lead-capture forms tied to a pipeline. Each form has a public hosted page (`/forms/:slug`) and an embeddable iframe (`/forms/:slug/embed`). Submissions go through Cloudflare Turnstile, a honeypot, and per-IP rate limiting; valid submissions create a client + a deal in the form's pipeline.

**Architecture:** Three new tables (`lead_forms`, `form_submissions`, `form_submission_rate_limits`). Two public Edge Functions (`forms-get`, `forms-submit`). Two unauthenticated React routes mounted outside the app shell. A small embed-resize script (`forms.js`).

**Tech Stack:** Same as prior plans. Cloudflare Turnstile (free), no SDK — verify via plain fetch.

**Depends on:** Plan 1 (pipelines + stages). Optional but recommended: Plan 2 (`dupDetection` service is reused for the auto-merge path).

---

## File Structure

**Created:**
- `supabase/migrations/062_lead_forms.sql`
- `supabase/functions/forms-get/index.ts`
- `supabase/functions/forms-submit/index.ts`
- `supabase/functions/crm-rotate-turnstile-salt/index.ts` — daily cron
- `src/services/supabase/leadForms.ts`
- `src/hooks/useLeadForms.ts`
- `src/components/settings/LeadFormsSettingsTab.tsx`
- `src/components/settings/LeadFormEditor.tsx`
- `src/components/public/LeadFormRenderer.tsx`
- `src/pages/PublicLeadForm.tsx`
- `public/forms.js` — embed-resize bootstrap script
- `tests/unit/leadForms.test.ts`

**Modified:**
- `src/App.tsx` — register public `/forms/:slug` and `/forms/:slug/embed` routes outside the authenticated layout
- `src/pages/Settings.tsx` — add Lead Forms tab

---

## Task 1: Migration 062 — schema

**Files:**
- Create: `supabase/migrations/062_lead_forms.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 062_lead_forms.sql
-- Lead-capture forms: per-pipeline definitions, public submissions, rate limits.

create table if not exists public.lead_forms (
  form_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  pipeline_id uuid not null
    references public.pipelines(pipeline_id) on delete restrict,
  slug text not null,
  title text not null,
  description text,
  fields jsonb not null,
  thank_you_message text not null default 'Thanks — we got it.',
  redirect_url text,
  turnstile_enabled boolean not null default true,
  rate_limit_per_minute int not null default 10,
  rate_limit_per_hour int not null default 100,
  status text not null default 'active'
    check (status in ('active','paused','archived')),
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, slug)
);

create unique index if not exists ux_lead_forms_global_slug
  on public.lead_forms(slug);

create table if not exists public.form_submissions (
  submission_id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.lead_forms(form_id) on delete cascade,
  organization_id uuid not null,
  form_slug text not null,
  form_title text not null,
  client_id uuid references public.clients(client_id) on delete set null,
  deal_id   uuid references public.deals(deal_id)   on delete set null,
  raw_payload jsonb not null,
  ip_hash text,
  user_agent text,
  turnstile_token_verified boolean not null default false,
  honeypot_tripped boolean not null default false,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index if not exists form_submissions_org_idx
  on public.form_submissions(organization_id, created_at desc);
create index if not exists form_submissions_form_idx
  on public.form_submissions(form_id, created_at desc);

create table if not exists public.form_submission_rate_limits (
  form_id uuid not null,
  ip_hash text not null,
  bucket_started_at timestamptz not null,
  window_seconds int not null,
  count int not null default 1,
  primary key (form_id, ip_hash, bucket_started_at, window_seconds)
);

-- Daily-rotating salt for ip_hash. Single row; service-role-only access.
create table if not exists public.crm_secrets (
  key text primary key,
  value text not null,
  rotated_at timestamptz not null default now()
);

insert into public.crm_secrets (key, value)
values ('turnstile_daily_salt', encode(gen_random_bytes(32), 'base64'))
on conflict (key) do nothing;

alter table public.lead_forms enable row level security;
alter table public.form_submissions enable row level security;
-- form_submission_rate_limits has NO RLS; only the Edge Function reads/writes.

create policy "lead_forms read for org members"
  on public.lead_forms for select
  using (public.is_org_member(organization_id));

create policy "lead_forms admin write" on public.lead_forms
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy "form_submissions read for org members"
  on public.form_submissions for select
  using (public.is_org_member(organization_id));

-- Inserts to form_submissions happen via SECURITY DEFINER Edge Function only;
-- no write policy by design.
```

- [ ] **Step 2: Apply + verify**

Run: `npx supabase migration up`
Then: `select count(*) from public.crm_secrets where key = 'turnstile_daily_salt';` — expect 1.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/062_lead_forms.sql
git commit -m "feat(crm): lead form schema (forms, submissions, rate limits)"
```

---

## Task 2: leadForms service + tests

**Files:**
- Create: `src/services/supabase/leadForms.ts`
- Create: `tests/unit/leadForms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/leadForms.test.ts
import { describe, it, expect } from "vitest";
import { validateFormFields, validateSlug } from "@/services/supabase/leadForms";

describe("leadForms validation", () => {
  it("accepts a valid slug", () => {
    expect(() => validateSlug("acme-newbiz")).not.toThrow();
  });
  it("rejects slugs with spaces or upper case", () => {
    expect(() => validateSlug("Acme NewBiz")).toThrow();
    expect(() => validateSlug("ab")).toThrow();   // too short
    expect(() => validateSlug("a".repeat(50))).toThrow();  // too long
  });
  it("requires email and name fields in v1", () => {
    expect(() => validateFormFields([])).toThrow();
    const valid = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ];
    expect(() => validateFormFields(valid as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement the service**

```ts
// src/services/supabase/leadForms.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type FieldType = "text" | "email" | "tel" | "url" | "textarea" | "select" | "number";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  options?: string[];
}

export interface LeadForm {
  formId: string;
  organizationId: string;
  pipelineId: string;
  slug: string;
  title: string;
  description: string | null;
  fields: FormField[];
  thankYouMessage: string;
  redirectUrl: string | null;
  turnstileEnabled: boolean;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  status: "active" | "paused" | "archived";
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_KEYS = new Set(["_hp"]);

export const validateSlug = (slug: string): void => {
  if (!SLUG_RE.test(slug)) throw new Error("Slug must be 3–40 chars, lowercase letters, digits, hyphens.");
};

export const validateFormFields = (fields: FormField[]): void => {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Form must have at least one field.");
  }
  const keys = new Set<string>();
  let hasName = false;
  let hasEmail = false;
  for (const f of fields) {
    if (!f.key || RESERVED_KEYS.has(f.key)) throw new Error(`Invalid field key '${f.key}'`);
    if (keys.has(f.key)) throw new Error(`Duplicate field key '${f.key}'`);
    keys.add(f.key);
    if (!f.label?.trim()) throw new Error(`Field '${f.key}' missing label`);
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      throw new Error(`Select field '${f.key}' must have options`);
    }
    if (f.key === "name") hasName = true;
    if (f.key === "email") hasEmail = true;
  }
  if (!hasName) throw new Error("A 'name' field is required.");
  if (!hasEmail) throw new Error("An 'email' field is required.");
};

const mapForm = (r: Record<string, unknown>): LeadForm => ({
  formId: r.form_id as string,
  organizationId: r.organization_id as string,
  pipelineId: r.pipeline_id as string,
  slug: r.slug as string,
  title: r.title as string,
  description: (r.description as string) ?? null,
  fields: Array.isArray(r.fields) ? (r.fields as FormField[]) : [],
  thankYouMessage: r.thank_you_message as string,
  redirectUrl: (r.redirect_url as string) ?? null,
  turnstileEnabled: Boolean(r.turnstile_enabled),
  rateLimitPerMinute: Number(r.rate_limit_per_minute ?? 10),
  rateLimitPerHour: Number(r.rate_limit_per_hour ?? 100),
  status: (r.status as LeadForm["status"]) ?? "active",
  createdBy: (r.created_by as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export const getOrganizationForms = async (
  organizationId: string,
): Promise<LeadForm[]> => {
  const { data, error } = await supabase
    .from("lead_forms")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("Failed to load lead forms:", error);
    return [];
  }
  return (data || []).map(mapForm);
};

export interface CreateFormInput {
  pipelineId: string;
  slug: string;
  title: string;
  description?: string | null;
  fields: FormField[];
  thankYouMessage?: string;
  redirectUrl?: string | null;
  turnstileEnabled?: boolean;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
}

export const createForm = async (
  organizationId: string,
  input: CreateFormInput,
): Promise<LeadForm> => {
  validateSlug(input.slug);
  validateFormFields(input.fields);
  if (input.redirectUrl && input.thankYouMessage) {
    // Treat redirect as mutually exclusive (server keeps either, prefers redirect).
  }
  const { data, error } = await supabase
    .from("lead_forms")
    .insert({
      organization_id: organizationId,
      pipeline_id: input.pipelineId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      fields: input.fields,
      thank_you_message: input.thankYouMessage ?? "Thanks — we got it.",
      redirect_url: input.redirectUrl ?? null,
      turnstile_enabled: input.turnstileEnabled ?? true,
      rate_limit_per_minute: input.rateLimitPerMinute ?? 10,
      rate_limit_per_hour: input.rateLimitPerHour ?? 100,
    })
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Slug already in use. Pick a different one.");
    }
    throw error;
  }
  return mapForm(data);
};

export const updateForm = async (
  formId: string,
  patch: Partial<CreateFormInput & { status: LeadForm["status"] }>,
): Promise<LeadForm> => {
  if (patch.slug) validateSlug(patch.slug);
  if (patch.fields) validateFormFields(patch.fields);
  const update: Record<string, unknown> = {};
  if (patch.pipelineId) update.pipeline_id = patch.pipelineId;
  if (patch.slug) update.slug = patch.slug;
  if (patch.title) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.fields) update.fields = patch.fields;
  if (patch.thankYouMessage !== undefined) update.thank_you_message = patch.thankYouMessage;
  if (patch.redirectUrl !== undefined) update.redirect_url = patch.redirectUrl;
  if (patch.turnstileEnabled !== undefined) update.turnstile_enabled = patch.turnstileEnabled;
  if (patch.rateLimitPerMinute !== undefined) update.rate_limit_per_minute = patch.rateLimitPerMinute;
  if (patch.rateLimitPerHour !== undefined) update.rate_limit_per_hour = patch.rateLimitPerHour;
  if (patch.status) update.status = patch.status;

  const { data, error } = await supabase
    .from("lead_forms")
    .update(update)
    .eq("form_id", formId)
    .select()
    .single();
  if (error) throw error;
  return mapForm(data);
};

export const deleteForm = async (formId: string): Promise<void> => {
  const { error } = await supabase.from("lead_forms").delete().eq("form_id", formId);
  if (error) throw error;
};

export interface SubmissionSummary {
  submissionId: string;
  clientId: string | null;
  formSlug: string;
  formTitle: string;
  createdAt: Date;
  rejectedReason: string | null;
}

export const getRecentSubmissions = async (
  organizationId: string,
  formId?: string,
  limit = 20,
): Promise<SubmissionSummary[]> => {
  let q = supabase
    .from("form_submissions")
    .select("submission_id, client_id, form_slug, form_title, created_at, rejected_reason")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (formId) q = q.eq("form_id", formId);
  const { data, error } = await q;
  if (error) {
    logger.error("Failed to load submissions:", error);
    return [];
  }
  return (data || []).map((r) => ({
    submissionId: (r as Record<string, string>).submission_id,
    clientId: (r as Record<string, string>).client_id ?? null,
    formSlug: (r as Record<string, string>).form_slug,
    formTitle: (r as Record<string, string>).form_title,
    createdAt: new Date((r as Record<string, string>).created_at),
    rejectedReason: (r as Record<string, string>).rejected_reason ?? null,
  }));
};
```

- [ ] **Step 3: Run tests**

Run: `npm test -- leadForms.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase/leadForms.ts tests/unit/leadForms.test.ts
git commit -m "feat(crm): lead forms service + validation"
```

---

## Task 3: forms-get Edge Function

**Files:**
- Create: `supabase/functions/forms-get/index.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/forms-get/index.ts
// Public read endpoint that returns only the fields needed to render a form.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SITE_KEY = Deno.env.get("TURNSTILE_SITE_KEY") ?? "";

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "public, max-age=60",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return new Response(JSON.stringify({ error: "missing_slug" }), { status: 400, headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("lead_forms")
    .select("title, description, fields, thank_you_message, turnstile_enabled, status")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data || data.status !== "active") {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
  }
  return new Response(JSON.stringify({
    title: data.title,
    description: data.description,
    fields: data.fields,
    thank_you_message: data.thank_you_message,
    turnstile_site_key: data.turnstile_enabled ? TURNSTILE_SITE_KEY : null,
  }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy forms-get --no-verify-jwt
npx supabase secrets set TURNSTILE_SITE_KEY=<your-cloudflare-site-key>
npx supabase secrets set APP_ORIGIN=https://app.taskcalendar.com
```

The `--no-verify-jwt` flag is critical — this endpoint must be reachable unauthenticated.

- [ ] **Step 3: Smoke-test**

`curl 'https://<project>.supabase.co/functions/v1/forms-get?slug=does-not-exist'` → 404
After creating a test form in the UI: `curl '…?slug=test'` → 200 with title/fields.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/forms-get/index.ts
git commit -m "feat(crm): public forms-get edge function"
```

---

## Task 4: forms-submit Edge Function

**Files:**
- Create: `supabase/functions/forms-submit/index.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/forms-submit/index.ts
// Public submission endpoint. Order of operations:
//   honeypot → turnstile → rate limit → field validation → dup-aware insert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-form-slug, x-turnstile-token",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "url" | "textarea" | "select" | "number";
  required: boolean;
  maxLength?: number;
  options?: string[];
}

const sha256Hex = async (s: string) => {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const getDailySalt = async (admin: ReturnType<typeof createClient>): Promise<string> => {
  const { data } = await admin.from("crm_secrets").select("value").eq("key", "turnstile_daily_salt").maybeSingle();
  return (data?.value as string) ?? "fallback-salt";
};

const verifyTurnstile = async (token: string, ip: string): Promise<boolean> => {
  if (!TURNSTILE_SECRET) return true; // dev mode
  const body = new FormData();
  body.set("secret", TURNSTILE_SECRET);
  body.set("response", token);
  body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!res.ok) return false;
  const out = await res.json();
  return Boolean(out.success);
};

const rateLimitOk = async (
  admin: ReturnType<typeof createClient>,
  formId: string,
  ipHash: string,
  perMin: number,
  perHour: number,
): Promise<{ ok: boolean; retryAfter: number }> => {
  const now = new Date();
  const minBucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const hourBucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

  for (const [bucketStart, window, limit] of [
    [minBucket, 60, perMin],
    [hourBucket, 3600, perHour],
  ] as Array<[Date, number, number]>) {
    const { data } = await admin
      .from("form_submission_rate_limits")
      .select("count")
      .eq("form_id", formId).eq("ip_hash", ipHash)
      .eq("bucket_started_at", bucketStart.toISOString())
      .eq("window_seconds", window)
      .maybeSingle();
    const current = Number(data?.count ?? 0);
    if (current >= limit) {
      const retry = window - Math.floor((now.getTime() - bucketStart.getTime()) / 1000);
      return { ok: false, retryAfter: retry };
    }
    await admin.from("form_submission_rate_limits").upsert({
      form_id: formId, ip_hash: ipHash,
      bucket_started_at: bucketStart.toISOString(),
      window_seconds: window,
      count: current + 1,
    }, { onConflict: "form_id,ip_hash,bucket_started_at,window_seconds" });
  }
  return { ok: true, retryAfter: 0 };
};

const normalizeEmail = (e: string): string =>
  e.trim().toLowerCase().replace(/\+[^@]*(?=@)/, "");

const SUFFIX_RE = /\b(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\.?\b/g;
const normalizeCompany = (n: string): string =>
  n.toLowerCase().replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim();

const validate = (fields: FormField[], body: Record<string, unknown>) => {
  const cleaned: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    let v = body[f.key];
    if (typeof v === "string") v = v.trim();
    const empty = v === undefined || v === null || v === "";
    if (empty) {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (typeof v === "string" && f.maxLength && v.length > f.maxLength) {
      v = v.slice(0, f.maxLength);
    }
    if (f.type === "email" && (typeof v !== "string" || !EMAIL_RE.test(v))) {
      errors[f.key] = "Invalid email";
      continue;
    }
    if (f.type === "select" && (!f.options?.includes(String(v)))) {
      errors[f.key] = "Invalid choice";
      continue;
    }
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors[f.key] = "Must be a number";
        continue;
      }
      v = n;
    }
    cleaned[f.key] = v;
  }
  return { cleaned, errors };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => null);
  if (!body) return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: corsHeaders });

  const slug = req.headers.get("x-form-slug") ?? body._slug;
  if (!slug) return new Response(JSON.stringify({ error: "missing_slug" }), { status: 400, headers: corsHeaders });

  const { data: form } = await admin
    .from("lead_forms")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!form || form.status !== "active") {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
  }

  // 1. Honeypot
  if (body._hp !== "" && body._hp !== undefined) {
    await admin.from("form_submissions").insert({
      form_id: form.form_id, organization_id: form.organization_id,
      form_slug: form.slug, form_title: form.title,
      raw_payload: body, honeypot_tripped: true, rejected_reason: "honeypot",
    });
    return new Response(JSON.stringify({ ok: true, message: form.thank_you_message }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // 2. Turnstile
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  let turnstileVerified = false;
  if (form.turnstile_enabled) {
    const token = req.headers.get("x-turnstile-token") ?? "";
    turnstileVerified = await verifyTurnstile(token, ip);
    if (!turnstileVerified) {
      return new Response(JSON.stringify({ error: "verification_failed" }), {
        status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
  }

  // 3. Rate limit
  const salt = await getDailySalt(admin);
  const ipHash = await sha256Hex(`${ip}|${salt}`);
  const rl = await rateLimitOk(admin, form.form_id, ipHash, form.rate_limit_per_minute, form.rate_limit_per_hour);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "rate_limited", retry_after: rl.retryAfter }), {
      status: 429, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // 4. Field validation
  const { cleaned, errors } = validate(form.fields as FormField[], body);
  if (Object.keys(errors).length > 0) {
    return new Response(JSON.stringify({ error: "validation", fields: errors }), {
      status: 422, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // 5. Duplicate-aware insert
  const email = typeof cleaned.email === "string" ? normalizeEmail(cleaned.email) : null;
  const company = typeof cleaned.company === "string" ? cleaned.company : (cleaned.name as string);
  const country = typeof cleaned.country === "string" ? cleaned.country : null;

  let clientId: string | null = null;
  if (email) {
    const { data: existing } = await admin
      .from("clients")
      .select("client_id, email")
      .eq("organization_id", form.organization_id);
    for (const c of existing ?? []) {
      const r = c as Record<string, string>;
      if (r.email && normalizeEmail(r.email) === email) { clientId = r.client_id; break; }
    }
  }
  if (!clientId && company) {
    const { data: existing } = await admin
      .from("clients")
      .select("client_id, name, country")
      .eq("organization_id", form.organization_id);
    for (const c of existing ?? []) {
      const r = c as Record<string, string>;
      if (normalizeCompany(r.name) === normalizeCompany(company) && (r.country ?? "") === (country ?? "")) {
        clientId = r.client_id; break;
      }
    }
  }
  if (!clientId) {
    const { data: created, error: cErr } = await admin.from("clients").insert({
      organization_id: form.organization_id,
      name: company || (cleaned.name as string) || "Unnamed lead",
      email: typeof cleaned.email === "string" ? cleaned.email : null,
      phone: typeof cleaned.phone === "string" ? cleaned.phone : null,
      country: country,
      type: "prospect", status: "active",
      source: form.title,
      created_by_name: `Lead form: ${form.title}`,
      tags: ["dup_override"], // bypass insert-time dup index (we already searched)
    }).select("client_id").single();
    if (cErr) {
      return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: corsHeaders });
    }
    clientId = (created as { client_id: string }).client_id;
  }

  // Find the first stage of the form's pipeline.
  const { data: firstStage } = await admin
    .from("pipeline_stages")
    .select("stage_id")
    .eq("pipeline_id", form.pipeline_id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  let dealId: string | null = null;
  if (firstStage) {
    const { data: dealRow } = await admin.from("deals").insert({
      organization_id: form.organization_id,
      pipeline_id: form.pipeline_id,
      stage_id: (firstStage as { stage_id: string }).stage_id,
      client_id: clientId,
      client_name: company || (cleaned.name as string) || null,
      title: `${company || "Lead"} inquiry`,
      owner_id: form.created_by,
      owner_name: null,
      currency: "USD",
      value: 0,
    }).select("deal_id").single();
    dealId = (dealRow as { deal_id: string } | null)?.deal_id ?? null;
  }

  // Strip the honeypot so it doesn't end up in the raw_payload.
  const payload = { ...body }; delete payload._hp;

  await admin.from("form_submissions").insert({
    form_id: form.form_id, organization_id: form.organization_id,
    form_slug: form.slug, form_title: form.title,
    client_id: clientId, deal_id: dealId,
    raw_payload: payload,
    ip_hash: ipHash,
    user_agent: req.headers.get("user-agent") ?? null,
    turnstile_token_verified: turnstileVerified,
  });

  return new Response(JSON.stringify({
    ok: true,
    message: form.thank_you_message,
    redirect_url: form.redirect_url ?? null,
  }), { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy forms-submit --no-verify-jwt
npx supabase secrets set TURNSTILE_SECRET_KEY=<your-cloudflare-server-secret>
```

- [ ] **Step 3: Smoke-test**

After creating a test form:

```bash
curl -X POST 'https://<project>.supabase.co/functions/v1/forms-submit' \
  -H 'content-type: application/json' \
  -H 'x-form-slug: test-form' \
  -d '{"name":"Jane","email":"jane@example.com","company":"Acme","_hp":""}'
```
Expected: 200 with `{ ok: true, message: "..." }`. Verify a row appeared in `clients`, `deals`, and `form_submissions`.

Replay the curl 11 times in a minute: expect 429 with `retry_after`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/forms-submit/index.ts
git commit -m "feat(crm): public forms-submit edge function with turnstile + rate limit"
```

---

## Task 5: Daily salt-rotation cron

**Files:**
- Create: `supabase/functions/crm-rotate-turnstile-salt/index.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/crm-rotate-turnstile-salt/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const newSalt = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
};

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("crm_secrets").update({
    value: newSalt(), rotated_at: new Date().toISOString(),
  }).eq("key", "turnstile_daily_salt");

  // Clean rate-limit rows older than 25 hours so the table doesn't grow forever.
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await admin.from("form_submission_rate_limits").delete().lt("bucket_started_at", cutoff);

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});
```

- [ ] **Step 2: Deploy + schedule daily**

```bash
npx supabase functions deploy crm-rotate-turnstile-salt
```

Schedule via Supabase dashboard: every day at 03:00 UTC.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/crm-rotate-turnstile-salt/index.ts
git commit -m "feat(crm): daily turnstile-salt rotation + rate-limit cleanup"
```

---

## Task 6: Lead-forms settings UI

**Files:**
- Create: `src/hooks/useLeadForms.ts`
- Create: `src/components/settings/LeadFormsSettingsTab.tsx`
- Create: `src/components/settings/LeadFormEditor.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Hook**

```ts
// src/hooks/useLeadForms.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { LeadForm, getOrganizationForms } from "@/services/supabase/leadForms";
import { supabase } from "@/services/supabase/config";

export const useLeadForms = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [forms, setForms] = useState<LeadForm[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    getOrganizationForms(orgId).then((next) => { if (!cancelled) setForms(next); });
    const channel = supabase.channel(`forms-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_forms",
        filter: `organization_id=eq.${orgId}` }, () => getOrganizationForms(orgId).then(setForms))
      .subscribe();
    return () => { cancelled = true; channel.unsubscribe(); };
  }, [orgId]);

  return { organizationId: orgId, forms, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 2: LeadFormEditor**

```tsx
// src/components/settings/LeadFormEditor.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadForm, FormField, FieldType, updateForm } from "@/services/supabase/leadForms";
import { Trash2, Plus, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  form: LeadForm;
  onChanged: () => void;
}

const FIELD_TYPES: FieldType[] = ["text", "email", "tel", "url", "textarea", "select", "number"];

export const LeadFormEditor: React.FC<Props> = ({ form, onChanged }) => {
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [thankYou, setThankYou] = useState(form.thankYouMessage);
  const [redirectUrl, setRedirectUrl] = useState(form.redirectUrl ?? "");
  const [turnstileEnabled, setTurnstileEnabled] = useState(form.turnstileEnabled);
  const [perMin, setPerMin] = useState(form.rateLimitPerMinute);
  const [perHour, setPerHour] = useState(form.rateLimitPerHour);
  const [saving, setSaving] = useState(false);

  const setField = (idx: number, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const save = async () => {
    setSaving(true);
    try {
      await updateForm(form.formId, {
        fields,
        thankYouMessage: redirectUrl ? "" : thankYou,
        redirectUrl: redirectUrl || null,
        turnstileEnabled,
        rateLimitPerMinute: perMin,
        rateLimitPerHour: perHour,
      });
      toast.success("Form saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const embedIframe =
    `<iframe src="${window.location.origin}/forms/${form.slug}/embed" ` +
    `width="100%" height="640" frameborder="0" ` +
    `style="border:0;background:transparent;"></iframe>`;

  const embedScript =
    `<script async src="${window.location.origin}/forms.js" ` +
    `data-slug="${form.slug}"></script>`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Public URL: <a className="underline" href={`/forms/${form.slug}`} target="_blank" rel="noopener noreferrer">
          {window.location.origin}/forms/{form.slug}
        </a>
      </p>

      <div className="space-y-2">
        <Label>Fields</Label>
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2">
            <Input className="col-span-2" placeholder="key" value={f.key} onChange={(e) => setField(i, { key: e.target.value })} />
            <Input className="col-span-3" placeholder="label" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
            <Select value={f.type} onValueChange={(v) => setField(i, { type: v as FieldType })}>
              <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <div className="col-span-1 flex items-center gap-1">
              <Switch checked={f.required} onCheckedChange={(v) => setField(i, { required: v })} />
              <Label className="text-xs">req</Label>
            </div>
            <Input className="col-span-3" placeholder="options (comma-separated)" defaultValue={(f.options ?? []).join(",")}
              onBlur={(e) => setField(i, { options: e.target.value ? e.target.value.split(",").map((s) => s.trim()) : undefined })}
              disabled={f.type !== "select"} />
            <Button variant="ghost" size="icon" className="col-span-1"
              onClick={() => setFields((p) => p.filter((_, x) => x !== i))}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setFields((p) => [
          ...p, { key: `f${p.length}`, label: "New field", type: "text", required: false },
        ])}>
          <Plus className="w-4 h-4 mr-1" /> Add field
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Redirect URL (optional)</Label>
          <Input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <Label>Thank-you message</Label>
          <Input value={thankYou} onChange={(e) => setThankYou(e.target.value)} disabled={!!redirectUrl} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={turnstileEnabled} onCheckedChange={setTurnstileEnabled} />
          <Label>Cloudflare Turnstile</Label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Rate / min</Label>
            <Input type="number" value={perMin} onChange={(e) => setPerMin(Number(e.target.value) || 1)} />
          </div>
          <div>
            <Label>Rate / hour</Label>
            <Input type="number" value={perHour} onChange={(e) => setPerHour(Number(e.target.value) || 1)} />
          </div>
        </div>
      </div>

      <div>
        <Label>Embed</Label>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea readOnly value={embedIframe} rows={3} />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(embedIframe); toast.success("Copied"); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Textarea readOnly value={embedScript} rows={2} />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(embedScript); toast.success("Copied"); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save form"}</Button>
    </div>
  );
};
```

- [ ] **Step 3: LeadFormsSettingsTab**

```tsx
// src/components/settings/LeadFormsSettingsTab.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLeadForms } from "@/hooks/useLeadForms";
import { usePipelines } from "@/hooks/usePipelines";
import { createForm, deleteForm } from "@/services/supabase/leadForms";
import { LeadFormEditor } from "./LeadFormEditor";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_FIELDS = [
  { key: "name", label: "Full name", type: "text", required: true, maxLength: 120 },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "company", label: "Company", type: "text", required: true, maxLength: 120 },
  { key: "notes", label: "Notes", type: "textarea", required: false, maxLength: 2000 },
];

export const LeadFormsSettingsTab: React.FC = () => {
  const { organizationId, forms, canManage } = useLeadForms();
  const { pipelines, defaultPipeline } = usePipelines();
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPipelineId, setNewPipelineId] = useState<string>("");

  React.useEffect(() => {
    if (!newPipelineId && defaultPipeline) setNewPipelineId(defaultPipeline.pipelineId);
  }, [newPipelineId, defaultPipeline]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Only admins can manage lead forms.</p>;
  if (!organizationId) return null;

  const createNew = async () => {
    try {
      await createForm(organizationId, {
        pipelineId: newPipelineId,
        slug: newSlug,
        title: newTitle,
        fields: DEFAULT_FIELDS as any,
      });
      setNewSlug(""); setNewTitle("");
      toast.success("Form created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <Label>Title</Label>
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <div className="col-span-3">
            <Label>Slug</Label>
            <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="acme-newbiz" />
          </div>
          <div className="col-span-3">
            <Label>Pipeline</Label>
            <Select value={newPipelineId} onValueChange={setNewPipelineId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (<SelectItem key={p.pipelineId} value={p.pipelineId}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button className="col-span-3" onClick={createNew} disabled={!newSlug || !newTitle || !newPipelineId}>
            <Plus className="w-4 h-4 mr-1" /> Create form
          </Button>
        </CardContent>
      </Card>

      {forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lead forms yet.</p>
      ) : (
        <Tabs defaultValue={forms[0].formId}>
          <TabsList className="flex flex-wrap">
            {forms.map((f) => (<TabsTrigger key={f.formId} value={f.formId}>{f.title} · /{f.slug}</TabsTrigger>))}
          </TabsList>
          {forms.map((f) => (
            <TabsContent key={f.formId} value={f.formId} className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button variant="ghost" size="icon" onClick={async () => {
                  if (confirm(`Delete form "${f.title}"?`)) {
                    await deleteForm(f.formId);
                    toast.success("Deleted");
                  }
                }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <LeadFormEditor form={f} onChanged={() => undefined} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Wire into Settings**

`src/pages/Settings.tsx`:

```tsx
import { LeadFormsSettingsTab } from "@/components/settings/LeadFormsSettingsTab";
// in <TabsList>:
<TabsTrigger value="lead-forms">Lead forms</TabsTrigger>
// in TabsContent:
<TabsContent value="lead-forms"><LeadFormsSettingsTab /></TabsContent>
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLeadForms.ts src/components/settings/LeadFormsSettingsTab.tsx \
  src/components/settings/LeadFormEditor.tsx src/pages/Settings.tsx
git commit -m "feat(crm): lead-forms settings UI + editor"
```

---

## Task 7: Public form renderer + routes

**Files:**
- Create: `src/components/public/LeadFormRenderer.tsx`
- Create: `src/pages/PublicLeadForm.tsx`
- Create: `public/forms.js`
- Modify: `src/App.tsx`

- [ ] **Step 1: LeadFormRenderer**

```tsx
// src/components/public/LeadFormRenderer.tsx
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FieldDef {
  key: string;
  label: string;
  type: "text"|"email"|"tel"|"url"|"textarea"|"select"|"number";
  required: boolean;
  options?: string[];
  maxLength?: number;
}

interface FormConfig {
  title: string;
  description: string | null;
  fields: FieldDef[];
  thank_you_message: string;
  turnstile_site_key: string | null;
}

declare global {
  interface Window {
    turnstile?: { render: (selector: string, opts: { sitekey: string; callback: (token: string) => void }) => void };
  }
}

const FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : "";

interface Props { slug: string; embed?: boolean }

export const LeadFormRenderer: React.FC<Props> = ({ slug, embed }) => {
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ _hp: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string; redirectUrl?: string } | null>(null);
  const [tsToken, setTsToken] = useState<string>("");

  useEffect(() => {
    fetch(`${FUNCTIONS_BASE}/forms-get?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((c: FormConfig) => setConfig(c))
      .catch(() => setConfig({ title: "Not found", description: null, fields: [], thank_you_message: "", turnstile_site_key: null }));
  }, [slug]);

  useEffect(() => {
    if (!config?.turnstile_site_key) return;
    if (!document.getElementById("ts-script")) {
      const s = document.createElement("script");
      s.id = "ts-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      document.head.appendChild(s);
    }
    const id = setInterval(() => {
      if (window.turnstile && document.getElementById("ts-widget")) {
        window.turnstile.render("#ts-widget", {
          sitekey: config.turnstile_site_key!,
          callback: setTsToken,
        });
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, [config?.turnstile_site_key]);

  // Embed mode: post height to parent so forms.js can resize.
  useEffect(() => {
    if (!embed) return;
    const post = () => window.parent.postMessage({ type: "tc-form-height", height: document.body.scrollHeight }, "*");
    const obs = new ResizeObserver(post);
    obs.observe(document.body);
    return () => obs.disconnect();
  });

  if (!config) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (done) {
    if (done.redirectUrl) {
      window.location.href = done.redirectUrl;
      return null;
    }
    return <p className="p-6 text-center">{done.message}</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/forms-submit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-form-slug": slug,
          ...(tsToken ? { "x-turnstile-token": tsToken } : {}),
        },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (res.status === 422 && body.fields) {
        setErrors(body.fields);
        return;
      }
      if (res.status === 403) {
        setErrors({ _form: "Verification failed. Try again." });
        return;
      }
      if (res.status === 429) {
        setErrors({ _form: "Too many submissions. Try again later." });
        return;
      }
      if (!res.ok) {
        setErrors({ _form: "Something went wrong." });
        return;
      }
      setDone({ message: body.message, redirectUrl: body.redirect_url ?? undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-6 max-w-md mx-auto">
      <div>
        <h2 className="text-xl font-semibold">{config.title}</h2>
        {config.description && <p className="text-sm text-muted-foreground mt-1">{config.description}</p>}
      </div>
      {config.fields.map((f) => (
        <div key={f.key}>
          <Label>{f.label}{f.required && " *"}</Label>
          {f.type === "textarea" ? (
            <Textarea value={values[f.key] ?? ""} maxLength={f.maxLength}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          ) : f.type === "select" ? (
            <Select value={values[f.key] ?? ""} onValueChange={(v) => setValues((vs) => ({ ...vs, [f.key]: v }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input type={f.type} value={values[f.key] ?? ""} maxLength={f.maxLength}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          )}
          {errors[f.key] && <p className="text-xs text-destructive">{errors[f.key]}</p>}
        </div>
      ))}
      <input type="text" name="_hp" tabIndex={-1} autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        value={values._hp ?? ""}
        onChange={(e) => setValues((v) => ({ ...v, _hp: e.target.value }))} />
      {config.turnstile_site_key && <div id="ts-widget" />}
      {errors._form && <p className="text-sm text-destructive">{errors._form}</p>}
      <Button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
    </form>
  );
};
```

- [ ] **Step 2: PublicLeadForm page**

```tsx
// src/pages/PublicLeadForm.tsx
import React from "react";
import { useParams } from "react-router-dom";
import { LeadFormRenderer } from "@/components/public/LeadFormRenderer";

export const PublicLeadForm: React.FC<{ embed?: boolean }> = ({ embed }) => {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return null;
  return (
    <div className={embed
      ? "min-h-screen bg-transparent"
      : "min-h-screen bg-background text-foreground"}>
      <LeadFormRenderer slug={slug} embed={embed} />
    </div>
  );
};

export default PublicLeadForm;
```

- [ ] **Step 3: forms.js embed script**

```js
// public/forms.js
(function () {
  var scripts = document.currentScript ? [document.currentScript] : document.querySelectorAll("script[data-slug]");
  Array.prototype.forEach.call(scripts, function (s) {
    var slug = s.getAttribute("data-slug");
    if (!slug) return;
    var iframe = document.createElement("iframe");
    iframe.src = s.src.replace(/forms\.js.*$/, "") + "forms/" + encodeURIComponent(slug) + "/embed";
    iframe.style.cssText = "border:0;background:transparent;width:100%;display:block;";
    iframe.setAttribute("frameborder", "0");
    s.parentNode.insertBefore(iframe, s);
    window.addEventListener("message", function (e) {
      if (e.source === iframe.contentWindow && e.data && e.data.type === "tc-form-height") {
        iframe.style.height = (e.data.height + 20) + "px";
      }
    });
  });
})();
```

- [ ] **Step 4: Register public routes**

In `src/App.tsx`, **outside** the authenticated layout (i.e. not inside any `<RequireAuth>` or similar guard):

```tsx
import { PublicLeadForm } from "@/pages/PublicLeadForm";
// at the top level of <Routes>, before any auth-gated routes:
<Route path="/forms/:slug" element={<PublicLeadForm />} />
<Route path="/forms/:slug/embed" element={<PublicLeadForm embed />} />
```

- [ ] **Step 5: Manual E2E**

Run `npm run dev`. Create a form in Settings → Lead forms with slug `test`. Open `http://localhost:5173/forms/test` in an incognito window. Fill name + email + company, submit. Verify:
- `clients` table has a new row.
- `deals` table has a new row in the form's pipeline at position 1.
- `form_submissions` has a row linked to both.

Also load `http://localhost:5173/forms/test/embed` in an iframe (use a quick standalone HTML file) and confirm the iframe resizes via `forms.js`.

- [ ] **Step 6: Commit**

```bash
git add src/components/public/LeadFormRenderer.tsx \
  src/pages/PublicLeadForm.tsx public/forms.js src/App.tsx
git commit -m "feat(crm): public lead-form pages + embed bootstrap"
```

---

## Self-review pass

1. The `forms-submit` function inserts a client with `tags: ["dup_override"]` to bypass the partial unique index from Plan 2. This is intentional — the function has already done its own normalized duplicate check and chosen between merge vs. create. Without the tag, the index would re-reject the new row.
2. Turnstile is enabled by default. In a development environment without `TURNSTILE_SECRET_KEY` set, `verifyTurnstile` returns `true` so local testing works. Confirm production has the secret set or every submission will be implicitly allowed.
3. The rate-limit upsert reads the prior count, then writes count+1 — this is racy under high concurrent load. For v1, acceptable; the bot has to be fast and lucky to slip a few extra past the limit. If misuse becomes a problem, replace the read-modify-write with a Postgres function that does the increment in one statement.
4. The embed iframe `postMessage`s `tc-form-height` to `"*"`. That's safe for the host page (we're sending data out, not reading); the host's window cannot read into the iframe via that channel. The `e.source === iframe.contentWindow` check on the listening side guards against spoofing.
5. The `forms.js` script relies on its own `src` URL to derive the iframe's origin. If a customer hosts our script on a CDN that rewrites the URL, the derivation breaks. Acceptable for v1; document the limitation when we publish embed instructions.
6. Verify `is_org_admin(uuid)` exists in the database. If only `is_org_member` exists, replace the policy and use the application-side admin gate (existing pattern in `clients.ts`).
