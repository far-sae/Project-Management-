// supabase/functions/forms-submit/index.ts
// Public submission endpoint. Order of operations:
//   honeypot → turnstile → rate limit → field validation → dup-aware insert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOrgAdmins } from "../_shared/notifyOrgAdmins.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const TURNSTILE_SITE_KEY = Deno.env.get("TURNSTILE_SITE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-form-slug, x-turnstile-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const kickAutomationWorker = () => {
  const promise = fetch(`${SUPABASE_URL}/functions/v1/crm-run-automations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "forms-submit" }),
  }).catch((err) => console.error("automation kick failed:", err));
  (globalThis as any).EdgeRuntime?.waitUntil?.(promise);
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

const textValue = (body: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const findExistingClient = async (
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  email: string | null,
  company: string | null,
  country: string | null,
): Promise<string | null> => {
  if (email) {
    const { data: existing } = await admin
      .from("clients")
      .select("client_id, email")
      .eq("organization_id", organizationId);
    for (const c of existing ?? []) {
      const r = c as Record<string, string>;
      if (r.email && normalizeEmail(r.email) === email) return r.client_id;
    }
  }

  if (company) {
    const { data: existing } = await admin
      .from("clients")
      .select("client_id, name, country")
      .eq("organization_id", organizationId);
    for (const c of existing ?? []) {
      const r = c as Record<string, string>;
      if (normalizeCompany(r.name) === normalizeCompany(company) && (r.country ?? "") === (country ?? "")) {
        return r.client_id;
      }
    }
  }

  return null;
};

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

// Top-level wrapper so an uncaught throw doesn't become a naked
// 500-with-no-body in the browser. We log the full reason to function
// logs (visible in Supabase dashboard) and return a request-scoped id
// the user can paste back so we can correlate. The message is included
// in the response too — this is a public form, but the alternative is
// "submission failed" with zero diagnostics for the operator.
const handle = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("forms-submit: SUPABASE_URL or SERVICE_KEY missing from env");
    return json({ error: "server_misconfigured", message: "SUPABASE_URL / SERVICE_ROLE_KEY env vars are not set on the function." }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "invalid_body" }, 400);

  const slug = req.headers.get("x-form-slug") ?? body._slug;
  if (!slug) return json({ error: "missing_slug" }, 400);

  const { data: form } = await admin
    .from("lead_forms")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!form || form.status !== "active") {
    return json({ error: "not_found" }, 404);
  }

  // 1. Honeypot
  if (body._hp !== "" && body._hp !== undefined) {
    await admin.from("form_submissions").insert({
      form_id: form.form_id, organization_id: form.organization_id,
      form_slug: form.slug, form_title: form.title,
      raw_payload: body, honeypot_tripped: true, rejected_reason: "honeypot",
    });
    return json({ ok: true, message: form.thank_you_message });
  }

  // 2. Turnstile
  //
  // The user keeps hitting "verification_failed" 403s when submitting
  // their public form. Common causes:
  //   - Form has turnstile_enabled=true but the public page isn't
  //     mounting the Turnstile widget (or it loaded but the token
  //     never made it back through the submit handler).
  //   - The token is correct but the user's Cloudflare account /
  //     site-key pair is in a "challenge expected" state.
  //   - The user's TURNSTILE_SECRET env var on the function is stale.
  //
  // Old behaviour: any of those returned a hard 403, blocking
  // legitimate submissions while the operator chases down config.
  //
  // New behaviour: if the token is missing OR verification fails,
  // we LOG it loudly and flag the submission via rejected_reason +
  // turnstile_token_verified=false, but still write the form row so
  // the lead reaches the rep. Honeypot + rate limit + field
  // validation still gate the truly-bad submissions; Turnstile is
  // demoted from "hard fail" to "noisy warn + tag for review".
  // Operators who want the strict behaviour can set
  // TURNSTILE_STRICT=1 in the function env to restore the 403.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  let turnstileVerified = false;
  let turnstileFailureReason: string | null = null;
  if (form.turnstile_enabled && TURNSTILE_SECRET && TURNSTILE_SITE_KEY) {
    const token = req.headers.get("x-turnstile-token") ?? "";
    if (!token) {
      turnstileFailureReason = "missing_token";
      console.warn(`forms-submit: Turnstile token missing for form ${form.form_id} from ip ${ip}`);
    } else {
      turnstileVerified = await verifyTurnstile(token, ip);
      if (!turnstileVerified) {
        turnstileFailureReason = "verification_failed";
        console.warn(`forms-submit: Turnstile verification failed for form ${form.form_id} from ip ${ip}`);
      }
    }
    if (turnstileFailureReason && Deno.env.get("TURNSTILE_STRICT") === "1") {
      // Operator opted into hard-fail mode; respect it.
      return json({ error: turnstileFailureReason }, 403);
    }
  } else if (form.turnstile_enabled && (!TURNSTILE_SECRET || !TURNSTILE_SITE_KEY)) {
    console.warn("Turnstile enabled for form but TURNSTILE secrets are incomplete; accepting submission without challenge.");
  }

  // 3. Rate limit
  const salt = await getDailySalt(admin);
  const ipHash = await sha256Hex(`${ip}|${salt}`);
  const rl = await rateLimitOk(admin, form.form_id, ipHash, form.rate_limit_per_minute, form.rate_limit_per_hour);
  if (!rl.ok) {
    return json({ error: "rate_limited", retry_after: rl.retryAfter }, 429);
  }

  // 4. Field validation
  const { cleaned, errors } = validate(form.fields as FormField[], body);
  if (Object.keys(errors).length > 0) {
    return json({ error: "validation", fields: errors }, 422);
  }

  // 5. Duplicate-aware insert
  const emailRaw = textValue(cleaned, ["email", "emailAddress", "email_address", "workEmail"]);
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  const leadName = textValue(cleaned, ["name", "fullName", "full_name", "contactName"]);
  const company = textValue(cleaned, ["company", "orgName", "org_name", "organization", "organization_name"]) ?? leadName;
  const country = textValue(cleaned, ["country", "orgCountry", "org_country"]);
  const phone = textValue(cleaned, ["phone", "phoneNumber", "phone_number"]);
  const website = textValue(cleaned, ["website", "orgWebsite", "org_website"]);

  let clientId: string | null = await findExistingClient(admin, form.organization_id, email, company, country);
  if (!clientId) {
    const { data: created, error: cErr } = await admin.from("clients").insert({
      organization_id: form.organization_id,
      name: company || leadName || "Unnamed lead",
      legal_name: company || null,
      email: emailRaw,
      phone,
      website,
      country: country,
      type: "prospect", status: "active",
      source: form.title,
      created_by_name: `Lead form: ${form.title}`,
      tags: ["dup_override"], // bypass insert-time dup index (we already searched)
    }).select("client_id").single();
    if (cErr) {
      clientId = await findExistingClient(admin, form.organization_id, email, company, country);
      if (!clientId) {
        const payload = { ...body }; delete payload._hp;
        await admin.from("form_submissions").insert({
          form_id: form.form_id, organization_id: form.organization_id,
          form_slug: form.slug, form_title: form.title,
          raw_payload: payload,
          ip_hash: ipHash,
          user_agent: req.headers.get("user-agent") ?? null,
          turnstile_token_verified: turnstileVerified,
          rejected_reason: `client_create_failed: ${cErr.message}`,
        });
        console.error("lead form client create failed:", cErr);
        return json({ error: "client_create_failed" }, 500);
      }
    } else {
      clientId = (created as { client_id: string }).client_id;
    }
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
      client_name: company || leadName || null,
      title: `${company || leadName || "Lead"} inquiry`,
      owner_id: form.created_by,
      owner_name: null,
      currency: "USD",
      value: 0,
    }).select("deal_id").single();
    dealId = (dealRow as { deal_id: string } | null)?.deal_id ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // ALSO insert a Lead row so the submission appears in CRM → Leads.
  //
  // The form was already creating an Account (clients) + Deal, but reps
  // expect a "lead form" to produce a "lead" — they kept asking where
  // their form submissions went. The Lead row points at the freshly-
  // created account + deal via the conversion columns, marked as
  // already-converted (lead_status='converted'), so it shows in the
  // Leads tab with a "Converted" badge instead of looking like a
  // duplicate to re-convert.
  //
  // Schema-drift defensive: strip-and-retry like convertLead does, so
  // a DB missing migration 100 (leads table) doesn't break the whole
  // submission. We swallow leads insert errors entirely — the account
  // + deal + form_submission have already landed, so the rep still
  // gets the data; only the Leads-tab visibility is missing.
  // ───────────────────────────────────────────────────────────────────────
  let leadId: string | null = null;
  try {
    // Best-effort lead_number lookup. If the RPC is missing, fall back
    // to a synthetic timestamp-based number so the NOT NULL constraint
    // on lead_number is satisfied.
    let leadNumber: string;
    const { data: numData, error: numErr } = await admin
      .rpc("next_lead_number", { p_organization_id: form.organization_id });
    if (numErr || !numData) {
      leadNumber = `L-FORM-${Date.now().toString(36).toUpperCase()}`;
    } else {
      leadNumber = String(numData);
    }

    // Workspace: forms don't bind to a specific workspace today; use
    // the organization's first workspace as a sane default so the
    // workspace_id NOT NULL passes.
    const { data: ws } = await admin
      .from("workspaces")
      .select("workspace_id")
      .eq("organization_id", form.organization_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const workspaceId = (ws as { workspace_id?: string } | null)?.workspace_id ?? null;

    // Field-name flexibility — the form might collect firstName /
    // first_name / contactFirstName, etc. textValue picks whichever
    // is present.
    const firstName = textValue(cleaned, ["firstName", "first_name", "contactFirstName"]);
    const lastName  = textValue(cleaned, ["lastName", "last_name", "contactLastName", "surname"])
                   ?? (leadName ? leadName.split(/\s+/).slice(-1)[0] : null)
                   ?? company
                   ?? "Lead";
    const title     = textValue(cleaned, ["title", "jobTitle", "job_title", "role"]);
    const industry  = textValue(cleaned, ["industry"]);

    const leadPayload: Record<string, unknown> = {
      organization_id: form.organization_id,
      workspace_id: workspaceId,
      lead_number: leadNumber,
      first_name: firstName,
      last_name: lastName,
      title,
      email: emailRaw,
      phone,
      company: company || leadName || "Lead form submission",
      industry,
      website,
      country,
      lead_source: form.title,
      lead_status: "converted",
      converted_at: new Date().toISOString(),
      converted_to_client_id: clientId,
      converted_to_deal_id: dealId,
      description: `Submitted via lead form "${form.title}".`,
      created_by: form.created_by,
      created_by_name: `Lead form: ${form.title}`,
    };

    const tryInsertLead = () =>
      admin.from("leads").insert(leadPayload).select("lead_id").single();

    let { data: leadRow, error: leadErr } = await tryInsertLead();
    // Same drift loop — drop columns the DB doesn't have, up to 8x.
    for (let i = 0; i < 8 && leadErr; i++) {
      const e = leadErr as { code?: string; message?: string };
      if (e.code !== "42703" && !/does not exist/i.test(String(e.message ?? ""))) break;
      const m = /column "([^"]+)" of relation/i.exec(String(e.message ?? ""));
      const col = m?.[1];
      if (!col || !(col in leadPayload)) break;
      delete leadPayload[col];
      ({ data: leadRow, error: leadErr } = await tryInsertLead());
    }
    if (!leadErr && leadRow) {
      leadId = (leadRow as { lead_id: string }).lead_id;
    } else if (leadErr) {
      // Don't fail the whole submission — the account + deal already
      // landed. Log so the operator can fix the schema drift but the
      // form still 200s for the public user.
      console.warn("forms-submit: leads insert failed (account+deal still saved):", leadErr);
    }
  } catch (e) {
    console.warn("forms-submit: leads insert threw (account+deal still saved):", e);
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
    // Tag rows that failed Turnstile but were accepted anyway so the
    // operator can review them in the submissions log (instead of
    // silently dropping every submission while config is broken).
    ...(turnstileFailureReason ? { rejected_reason: `turnstile:${turnstileFailureReason}` } : {}),
  });
  kickAutomationWorker();

  // Email owner + admins of the org so they see new lead submissions
  // without having to refresh the CRM. EdgeRuntime.waitUntil keeps
  // the public form's 200 response fast — fanout runs after the
  // response is sent. Failures are logged inside the helper, never
  // re-raised, so they can't break the submission.
  const notifyPromise = (async () => {
    const subject = `New lead from "${form.title}"`;
    const niceName = leadName || company || emailRaw || "(unknown)";
    const where = [niceName, company && niceName !== company ? company : null, country].filter(Boolean).join(" · ");
    const bodyHtml = `
      <p>A new submission just arrived through your lead form <strong>${form.title}</strong>.</p>
      <ul>
        <li><strong>Lead:</strong> ${where || niceName}</li>
        ${emailRaw  ? `<li><strong>Email:</strong> <a href="mailto:${emailRaw}">${emailRaw}</a></li>` : ""}
        ${phone     ? `<li><strong>Phone:</strong> ${phone}</li>` : ""}
        ${website   ? `<li><strong>Website:</strong> ${website}</li>` : ""}
      </ul>
      <p>Open it in CRM → Leads to follow up.</p>
    `;
    try {
      await notifyOrgAdmins({
        admin, organizationId: form.organization_id,
        subject, bodyHtml, source: "forms-submit",
      });
    } catch (err) {
      console.warn("forms-submit: org notification failed:", err);
    }
  })();
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(notifyPromise);

  return json({
    ok: true,
    message: form.thank_you_message,
    redirect_url: form.redirect_url ?? null,
    // Echo back the records we created so the form host page can
    // link the rep directly to /clients?lead=<id> etc.
    client_id: clientId,
    deal_id: dealId,
    lead_id: leadId,
  });
};

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (err) {
    // Make uncaught throws visible. Crypto random for the id so two
    // simultaneous submissions don't collide.
    const errorId = crypto.randomUUID().slice(0, 8);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`forms-submit unhandled error [${errorId}]:`, message, stack);
    return json({
      error: "internal_error",
      error_id: errorId,
      message: `Submission failed: ${message}`,
    }, 500);
  }
});
