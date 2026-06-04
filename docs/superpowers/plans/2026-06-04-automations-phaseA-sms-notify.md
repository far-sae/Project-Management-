# Automations Phase A — send_sms + notify actions

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** Add two automation actions — `send_sms` (wraps the CORS-fixed `sms-send` edge fn) and `notify` (in-app notification) — wired into the engine registry, the frontend type unions, validation, and the RecipeBuilder UI.

**Architecture:** New `ActionHandler`s mirroring the existing `addNote`/`sendEmail` pattern (`ctx.admin`, `ctx.event.payload`, `ctx.orgId`, `substitute` templating); register in `ACTION_REGISTRY`; extend the `ActionType` unions (engine + frontend); add builder config panels.

**Tech Stack:** Deno edge fn (`deno check`), React + TS (vitest/build). No DB migration. **Branch:** `automations-extend`.

**Reference spec:** [docs/superpowers/specs/2026-06-04-automations-extend-design.md](../specs/2026-06-04-automations-extend-design.md) §A.

**Known facts:** `ActionHandler = async (ctx, config) => { status: "success"|"failure"|"skipped"; message?; meta? }`. `ctx` has `admin` (service-role SupabaseClient), `event.payload`, `orgId`, `recipeName`. `substitute(tpl, scope)` from `../shared/substitute.ts`. Registry at `actions/index.ts`; `ActionType` union in `crm-run-automations/shared/types.ts` AND `src/services/supabase/automations.ts`. The worker has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `Deno.env`. `sms-send` accepts POST `{ organizationId, to, body, clientId?, dealId? }` with a service-role bearer. `create_notification_v1` RPC (migration 028) does cross-user notification inserts.

---

## Task 1: `send_sms` action

**Files:** `supabase/functions/crm-run-automations/actions/sendSms.ts` (new), `actions/index.ts`, `shared/types.ts`

- [ ] **Step 1: Create `sendSms.ts`** (mirror `addNote.ts` for templating + skip-on-missing):
```typescript
// supabase/functions/crm-run-automations/actions/sendSms.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Send an SMS via the sms-send edge function. config:
 *  { to: "<E.164>" | "client_phone" | template, body: "<template>" } */
export const sendSms: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const clientId = (payload.client_id as string | undefined) ?? null;
  const dealId = (payload.deal_id as string | undefined) ?? null;

  // Resolve recipient.
  let to = "";
  const rawTo = String(config.to ?? "").trim();
  if (rawTo === "client_phone") {
    if (!clientId) return { status: "skipped", message: "No client to read a phone from" };
    const { data } = await ctx.admin.from("clients").select("phone").eq("client_id", clientId).maybeSingle();
    to = (data as { phone?: string } | null)?.phone ?? "";
  } else {
    to = substitute(rawTo, { deal: payload, client: { name: payload.client_name }, recipe: { name: ctx.recipeName } });
  }
  if (!to || !/^\+\d{6,}$/.test(to)) return { status: "skipped", message: `No valid E.164 recipient ("${to}")` };

  const body = substitute(String(config.body ?? ""), { deal: payload, client: { name: payload.client_name }, recipe: { name: ctx.recipeName } });
  if (!body.trim()) return { status: "skipped", message: "Empty SMS body" };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-send`, {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ organizationId: ctx.orgId, to, body, clientId, dealId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    return { status: "failure", message: (data as { error?: string }).error ?? `sms-send ${res.status}` };
  }
  return { status: "success", meta: { provider_sid: (data as { providerSid?: string }).providerSid } };
};
```
> Note: `sms-send`'s membership check passes for a service-role caller? It calls `supabase.auth.getUser()` with the service bearer → no user → returns 401 "Not signed in". **Handle this:** in `sms-send/index.ts`, allow the service-role key to bypass the user/membership check (if the bearer equals `SUPABASE_SERVICE_ROLE_KEY`, skip getUser + membership — it's a trusted server caller). Add that bypass as part of this task (small edit to `sms-send/index.ts`), else automation SMS will 401.

- [ ] **Step 2: Register + type.** In `actions/index.ts` import `sendSms` and add `send_sms: sendSms,` to `ACTION_REGISTRY`. In `crm-run-automations/shared/types.ts` add `"send_sms"` to the `ActionType` union.

- [ ] **Step 3: `deno check`** the worker entry (`supabase/functions/crm-run-automations/index.ts`) → clean. Commit:
```bash
git add supabase/functions/crm-run-automations/actions/sendSms.ts supabase/functions/crm-run-automations/actions/index.ts supabase/functions/crm-run-automations/shared/types.ts supabase/functions/sms-send/index.ts
git commit -m "feat(automations): send_sms action + allow service-role caller in sms-send"
```

## Task 2: `notify` action

**Files:** `supabase/functions/crm-run-automations/actions/notify.ts` (new), `actions/index.ts`, `shared/types.ts`

- [ ] **Step 1: Create `notify.ts`** (resolve user from payload owner fields; insert via the RPC, fall back to direct insert):
```typescript
// supabase/functions/crm-run-automations/actions/notify.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

/** In-app notification. config: { user: "deal_owner"|"client_owner"|"<user_id>", title, body } */
export const notify: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const who = String(config.user ?? "deal_owner");
  let userId: string | null = null;
  if (who === "deal_owner") userId = (payload.owner_id as string) ?? null;
  else if (who === "client_owner") userId = (payload.account_owner_id as string) ?? null;
  else userId = who || null;
  if (!userId) return { status: "skipped", message: `Could not resolve recipient "${who}"` };

  const scope = { deal: payload, client: { name: payload.client_name }, recipe: { name: ctx.recipeName } };
  const title = substitute(String(config.title ?? "Automation"), scope) || "Automation";
  const body = substitute(String(config.body ?? ""), scope);

  const { error } = await ctx.admin.rpc("create_notification_v1", {
    p_user_id: userId, p_type: "automation", p_title: title, p_message: body,
  });
  if (error) {
    // Fallback: direct insert (service-role bypasses RLS).
    const { error: e2 } = await ctx.admin.from("notifications").insert({
      notification_id: crypto.randomUUID(), user_id: userId, type: "automation",
      title, message: body, read: false, created_at: new Date().toISOString(),
    });
    if (e2) return { status: "failure", message: e2.message };
  }
  return { status: "success" };
};
```
> Confirm `create_notification_v1`'s exact parameter names against migration 028 and adjust if different; the direct-insert fallback covers signature drift.

- [ ] **Step 2: Register + type** (`notify: notify` in registry; `"notify"` in the engine `ActionType`).

- [ ] **Step 3: `deno check`** → clean. Commit:
```bash
git add supabase/functions/crm-run-automations/actions/notify.ts supabase/functions/crm-run-automations/actions/index.ts supabase/functions/crm-run-automations/shared/types.ts
git commit -m "feat(automations): notify (in-app notification) action"
```

## Task 3: Frontend types + builder UI

**Files:** `src/services/supabase/automations.ts`, `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1:** Add `"send_sms"` and `"notify"` to the frontend `ActionType` union in `automations.ts`.
- [ ] **Step 2:** In `RecipeBuilder.tsx`: add labels to the action label map (`send_sms → "send SMS"`, `notify → "notify a user in-app"`), add them to the action picker, and add config panels:
  - `send_sms`: a "To" input (free text; hint: an E.164 number, `client_phone`, or a `{{template}}`) + a "Message" textarea (`body`).
  - `notify`: a "User" select (Deal owner / Client owner / specific member) → `user` = `deal_owner`|`client_owner`|`<userId>`, a "Title" input, a "Message" textarea.
- [ ] **Step 3:** Find `validateRecipeDraft` (grep) and add rules: `send_sms` requires `to` + `body`; `notify` requires `user` + `title`.
- [ ] **Step 4:** `npm run build` → success. Commit:
```bash
git add src/services/supabase/automations.ts src/components/settings/RecipeBuilder.tsx
git commit -m "feat(automations): send_sms + notify in the recipe builder"
```

## Task 4: Verify
- [ ] `deno check supabase/functions/crm-run-automations/index.ts` and `deno check supabase/functions/sms-send/index.ts` → clean.
- [ ] `npm run build` → success; `npm run test` → green.
- Manual (post-deploy): a recipe with a `send_sms` action fires an SMS on its trigger; a `notify` action drops an in-app notification to the deal owner; run history shows the action results.

## Self-Review
**Spec coverage (§A):** send_sms action (Task 1, + the necessary sms-send service-role bypass) ✓; notify action (Task 2) ✓; registry + both type unions + validation + builder (Tasks 1–3) ✓.
**Placeholder scan:** Two "confirm against source" notes (create_notification_v1 params; validateRecipeDraft location) are real code-dependent checks, called out; handlers shown in full. The sms-send service-role bypass is a required, explicit sub-step (not vague).
**Type consistency:** `ActionHandler` signature matches `addNote`. `ActionType` extended identically in engine `shared/types.ts` and frontend `automations.ts`. `sms-send` request body matches its handler (`organizationId, to, body, clientId?, dealId?`).
