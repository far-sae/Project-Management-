# CRM Features — Batch 1

**Date:** 2026-05-16
**Status:** Draft — pending user review
**Scope:** Add eight CRM features to TaskCalendar that close the gap with monday CRM's Basic/Standard/Pro tiers, without overlapping the in-flight platform-integrations work.

---

## Goals

1. Multiple pipelines per org with per-pipeline stages, probabilities, and required-field rules.
2. Hard-blocked stage advancement when required fields are missing (DB-enforced).
3. Deal → Project conversion via a confirm modal when a deal enters its won stage.
4. Configurable per-org lead scoring with a rules editor + computed score on every client.
5. Forecasting dashboard: monthly + quarterly buckets, filterable by pipeline + owner.
6. Hard-block duplicate detection on client create/import with admin override.
7. Per-client activity timeline + new org-wide `/clients/activity` page.
8. Public lead-capture forms (page + embed) with Cloudflare Turnstile, honeypot, and rate limiting.

## Non-Goals (Batch 1)

Deferred to Batch 2 (and a subsequent spec):

- Email templates, sequences, mass email, open/click tracking, AI email drafting, AI sales agents — depend on the Gmail integration the other agent is shipping in `2026-05-15-platform-integrations-design.md`.
- Quotes / invoices (explicitly excluded by user).
- HIPAA / SSO / multi-level permissions / audit logs (Enterprise tier).
- Snapshot-based forecasting trend lines — current state only in v1; v2 may add `deal_snapshots`.
- Contact / client merge UI — duplicate detection blocks at create time; merging existing rows is a separate workflow.

## Coordination with the platform-integrations spec

Another agent is concurrently implementing `2026-05-15-platform-integrations-design.md`. This Batch 1 spec stays out of their lane:

**Their files (this spec does not touch):**

- `src/components/integrations/**`
- `src/services/integrations/**`
- `src/hooks/useIntegration.ts`
- `supabase/functions/oauth-start/`, `oauth-callback/`, `integrations-action/`, `integrations-disconnect/`, `integrations-webhook/`
- `supabase/migrations/057_integrations_tables.sql`

**Shared territory, additive only (no merge conflicts expected):**

- `src/pages/Settings.tsx` — they add an `Integrations` tab; this spec adds `Pipelines`, `Lead scoring`, `Lead forms` tabs. Tab additions appear in a different region of the JSX.
- Migration numbering — they own `057_`; this spec uses `058_` through `063_`.

---

## New tables and migrations

| # | Filename | Adds |
|---|---|---|
| 058 | `pipelines_and_stages.sql` | `pipelines`, `pipeline_stages`, `project_templates`, seeding triggers |
| 059 | `deal_pipeline_link_and_stage_gating.sql` | `deals.pipeline_id`, `deals.stage_id`, stage-sync + required-field triggers |
| 060 | `lead_scoring_rules.sql` | `lead_scoring_rules`, `lead_scoring_thresholds`, `clients.score`, `clients.score_band`, recompute functions and triggers |
| 061 | `dup_detection_indexes.sql` | `normalize_email`, `normalize_company_name`, partial unique indexes, `client_dup_overrides` |
| 062 | `lead_forms.sql` | `lead_forms`, `form_submissions`, `form_submission_rate_limits` |
| 063 | `org_activity_views.sql` | `crm_activity_v` view + supporting indexes |

---

## Section B — Deal lifecycle: pipelines, stage gating, won handoff

### B.1 Pipelines and stages — `058_pipelines_and_stages.sql`

```sql
create table pipelines (
  pipeline_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  position int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index ux_pipelines_one_default
  on pipelines(organization_id) where is_default;

create table pipeline_stages (
  stage_id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(pipeline_id) on delete cascade,
  organization_id uuid not null,
  key text not null,
  label text not null,
  color text not null default '#94A3B8',
  position int not null,
  default_probability int not null default 10
    check (default_probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  required_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (pipeline_id, key),
  unique (pipeline_id, position)
);

create unique index ux_pipeline_stages_one_won
  on pipeline_stages(pipeline_id) where is_won;
create unique index ux_pipeline_stages_one_lost
  on pipeline_stages(pipeline_id) where is_lost;

create table project_templates (
  template_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  task_definitions jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique (organization_id, name)
);
```

**Per-org seeding:** a trigger on `organizations` insert creates one default pipeline named "Sales" with the existing six stages (lead → qualified → proposal → negotiation → won → lost) and two `project_templates` ("Onboarding (4 tasks)" and "SOW Delivery (6 tasks)").

For existing orgs, a one-shot data migration inside `058_` walks every org and inserts the same defaults.

### B.2 Deal linkage + stage-gating — `059_deal_pipeline_link_and_stage_gating.sql`

```sql
alter table deals
  add column pipeline_id uuid references pipelines(pipeline_id) on delete restrict,
  add column stage_id   uuid references pipeline_stages(stage_id) on delete restrict;

-- Backfill: map each deal's stage text to the seeded stage row for its org's
-- default pipeline.
update deals d set
  pipeline_id = p.pipeline_id,
  stage_id    = s.stage_id
from pipelines p, pipeline_stages s
where p.organization_id = d.organization_id
  and p.is_default
  and s.pipeline_id = p.pipeline_id
  and s.key = d.stage;

alter table deals
  alter column pipeline_id set not null,
  alter column stage_id set not null;

-- Keep deals.stage (text) in sync with the linked stage row's key, so existing
-- queries that read `stage` still work unchanged.
create or replace function deals_sync_stage_text() returns trigger as $$
begin
  select key into new.stage from pipeline_stages where stage_id = new.stage_id;
  return new;
end;
$$ language plpgsql;

create trigger deals_sync_stage_text_t
  before insert or update of stage_id on deals
  for each row execute function deals_sync_stage_text();
```

**Stage-gating trigger (hard block):**

```sql
create or replace function deals_enforce_required_fields() returns trigger as $$
declare
  req text[];
  f text;
  has_primary boolean;
begin
  if tg_op = 'UPDATE' and old.stage_id = new.stage_id then return new; end if;
  select required_fields into req from pipeline_stages where stage_id = new.stage_id;
  foreach f in array req loop
    case f
      when 'value' then
        if new.value is null or new.value <= 0 then
          raise exception 'Stage requires deal value > 0' using errcode = 'P0001';
        end if;
      when 'expected_close_date' then
        if new.expected_close_date is null then
          raise exception 'Stage requires expected close date' using errcode = 'P0001';
        end if;
      when 'description' then
        if new.description is null or length(btrim(new.description)) = 0 then
          raise exception 'Stage requires description' using errcode = 'P0001';
        end if;
      when 'primary_contact' then
        select exists(
          select 1 from client_contacts
          where client_id = new.client_id and is_primary
        ) into has_primary;
        if not has_primary then
          raise exception 'Stage requires a primary contact on the linked client'
            using errcode = 'P0001';
        end if;
      else
        -- Unknown key — silently skip so the pipeline editor can introduce new
        -- keys later without rejecting existing rows.
        null;
    end case;
  end loop;
  return new;
end;
$$ language plpgsql;

create trigger deals_enforce_required_fields_t
  before insert or update on deals
  for each row execute function deals_enforce_required_fields();
```

**Allowed `required_fields` keys (v1):** `value`, `expected_close_date`, `description`, `primary_contact`. The pipeline editor restricts selections to this whitelist; the trigger silently ignores unknown keys for forward compat.

### B.3 Frontend — pipeline editor + kanban

- **Settings → Pipelines** (new tab, admin-only): list, create, rename, set default; per-pipeline editor for stage drag-reorder, label, color, probability, required-fields multi-select, won/lost flags. Uses existing shadcn `Dialog`, `Input`, `Switch`, `Select`.
- **Clients → Pipeline tab**: pipeline `Select` above the existing `DealsKanban`. Stage columns now come from `pipeline_stages` for the selected pipeline. On drag-stop, if the server trigger rejects with `P0001`, the toast surfaces the human message and the card snaps back. (The realtime layer already snaps back on update rejection.)
- **`useDeals(pipelineId)`**: extends the existing hook with an optional pipeline filter.

### B.4 Won-handoff modal

When a deal moves into the stage with `is_won = true`:

- `DealsKanban` intercepts the drag-stop (and the stage-select in `ClientDetailDrawer`) and opens `<DealWonModal />` before calling `updateDeal`.
- Modal fields (pre-filled, all editable except Client):
  - `Name` — `${client.name} — ${deal.title}` (truncated to 120 chars)
  - `Owner` — defaults to `deal.owner_id`
  - `Template` — Select from org's `project_templates`; default "None"
  - `Start` — today
  - `Due` — today + 30d
  - `Client` — locked to `deal.client_id`
- Buttons: `Skip` (just transitions the deal), `Create project` (atomic: transition deal + insert project + apply template tasks via the existing `tasks` table).
- The transaction lives in a new RPC `crm_close_deal_to_won(p_deal_id, p_project_input jsonb)` — single round-trip, all-or-nothing.

### B.5 RLS

`pipelines`, `pipeline_stages`, `project_templates`: read for org members, write only for `canManageSettings` admins. Same pattern already used for `organizations.settings`.

---

## Section C — Lead scoring & duplicate detection

### C.1 Lead scoring schema — `060_lead_scoring_rules.sql`

```sql
create table lead_scoring_rules (
  rule_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id) on delete cascade,
  label text not null,
  field text not null,
  operator text not null check (operator in (
    'eq','neq','gte','lte','gt','lt','in','contains','exists'
  )),
  value jsonb not null,
  points int not null,
  position int not null default 0,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index lead_scoring_rules_org_idx
  on lead_scoring_rules(organization_id, position);

create table lead_scoring_thresholds (
  organization_id uuid primary key
    references organizations(organization_id) on delete cascade,
  hot int not null default 70,
  warm int not null default 40
);

alter table clients
  add column score int not null default 0,
  add column score_band text not null default 'cold'
    check (score_band in ('hot','warm','cold')),
  add column score_updated_at timestamptz;

create index clients_score_idx on clients(organization_id, score desc);

create table lead_scoring_recompute_queue (
  organization_id uuid primary key
    references organizations(organization_id) on delete cascade,
  enqueued_at timestamptz not null default now()
);
```

**Allowed `field` values (v1):**

- Top-level client columns: `industry`, `annual_revenue`, `employee_count`, `source`, `status`, `type`, `rating`, `country`
- Derived: `recent_activity_days` (days since latest `client_notes.occurred_at` for that client), `open_deals_count` (count of non-won, non-lost deals), `tag_present` (operator `in` against `tags`)

**Computation:** SECURITY DEFINER SQL function `recompute_client_score(p_client_id uuid)`:

1. Loads the client row + derived counts.
2. For every enabled rule for the org, evaluates the predicate and accumulates `points`.
3. Clamps total to `[-100, 200]`.
4. Looks up org thresholds; assigns `score_band ∈ {hot, warm, cold}`.
5. Updates the `clients` row with `score`, `score_band`, `score_updated_at = now()`.

**Triggers:**

- `AFTER INSERT OR UPDATE` on `clients` → recompute that client.
- `AFTER INSERT OR UPDATE OR DELETE` on `deals` → recompute `clients.client_id = deals.client_id`.
- `AFTER INSERT OR UPDATE OR DELETE` on `client_notes` → recompute that client.
- `AFTER UPDATE` on `lead_scoring_rules` or `lead_scoring_thresholds` → write a single row to a `lead_scoring_recompute_queue(organization_id)` table. A background Edge Function polling every 60s walks any queued orgs and recomputes all of their clients in batches of 500. This keeps a multi-rule save from fanning into hundreds of synchronous recomputes inside one transaction.

### C.2 Lead scoring UI

- **Settings → Lead scoring** (new tab, admin-only):
  - Rules list with drag-reorder, inline edit, enable toggle.
  - Add-rule modal: `field` dropdown → `operator` dropdown → `value` input (type adapts to field — number, text, dropdown for `in`).
  - Thresholds: two number inputs (`hot ≥`, `warm ≥`); cold is the implicit remainder.
  - "Preview impact" button — submits the unsaved rule set to a dry-run endpoint that returns the top-10 hot clients under those rules. Nothing persists until Save.
- **Clients page:**
  - New sortable "Score" column.
  - New filter: `Score band: all / hot / warm / cold`.
  - Existing card grid: a small score `<Badge>` joins the badge row, colored by band.
- **ClientDetailDrawer:** "Score: 78 (Hot)" badge near the header with a tooltip listing the top three rule contributions.

**Seeded defaults on org creation:**

| Field | Operator | Value | Points |
|---|---|---|---|
| `annual_revenue` | `gte` | 1,000,000 | +20 |
| `annual_revenue` | `gte` | 10,000,000 | +15 |
| `employee_count` | `gte` | 50 | +10 |
| `source` | `in` | `["referral","event"]` | +10 |
| `recent_activity_days` | `lte` | 14 | +10 |
| `open_deals_count` | `gte` | 1 | +15 |
| `status` | `eq` | `"inactive"` | −20 |
| `type` | `eq` | `"vendor"` | −10 |

Default thresholds: `hot ≥ 70`, `warm ≥ 40`.

### C.3 Duplicate detection — `061_dup_detection_indexes.sql`

**Normalization functions (immutable, used by indexes and matching helpers):**

```sql
create or replace function normalize_email(e text) returns text
  language sql immutable as $$
  select case
    when e is null then null
    when btrim(lower(e)) = '' then null
    else regexp_replace(btrim(lower(e)), '\+[^@]*(?=@)', '')
  end;
$$;

create or replace function normalize_company_name(n text) returns text
  language sql immutable as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(n,'')),
        '\m(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\.?\M', '', 'g'),
      '\s+', ' ', 'g'
    )), ''
  );
$$;
```

**Partial unique indexes (server-side hard block, with admin override via a sentinel tag):**

```sql
create unique index ux_clients_email_per_org
  on clients(organization_id, normalize_email(email))
  where email is not null
    and not ('dup_override' = any(tags));

create unique index ux_clients_name_country_per_org
  on clients(organization_id, normalize_company_name(name), coalesce(country,''))
  where not ('dup_override' = any(tags));

create unique index ux_client_contacts_email_per_org
  on client_contacts(organization_id, normalize_email(email))
  where email is not null;

create table client_dup_overrides (
  override_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references clients(client_id) on delete cascade,
  matched_existing_id uuid not null references clients(client_id) on delete cascade,
  overridden_by uuid,
  reason text,
  created_at timestamptz default now()
);
```

**Frontend behavior:**

- `ClientFormDialog` calls a new `findDuplicates(orgId, input)` helper before submit. On match: inline red banner — *"Client with email `jane@acme.com` already exists: **Acme Corp**."* — with `[View existing]` and `[Override duplicate]`. Override prompts for an optional `reason`, sets `dup_override` on the new row's tags, and writes a `client_dup_overrides` audit row.
- `ImportClientsDialog`: same check pre-insert per row. Rejected duplicates surface in a new "Rejected: 2 duplicate(s)" section of the result summary with a per-row `[Override and create anyway]`.
- Server is the source of truth: the partial unique indexes reject anyway; `clients.ts` translates Postgres `23505` into a human message (pattern already present for `ux_client_contacts_primary`).

---

## Section D — Forecasting & activity timeline

### D.1 Forecasting view

No new tables. Forecast metrics derive from `deals` + `pipeline_stages` + the existing FX helper.

```sql
create or replace view deal_forecast_v as
select
  d.organization_id,
  d.pipeline_id,
  d.owner_id,
  d.owner_name,
  d.currency,
  to_char(
    coalesce(d.actual_close_date, d.expected_close_date, d.created_at::date),
    'YYYY-MM'
  ) as month_bucket,
  d.value,
  d.value * (d.probability::numeric / 100.0) as weighted_value,
  s.is_won,
  s.is_lost,
  d.stage_id,
  d.stage
from deals d
join pipeline_stages s on s.stage_id = d.stage_id
where not s.is_lost;
```

### D.2 Forecast aggregations

Computed in a new `src/services/supabase/forecast.ts` for `{ pipelineId|null, ownerId|null, currency, period: 'month'|'quarter'|'next_quarter' }`:

- **Committed** = Σ `value` over rows in the period with `is_won = true`
- **Best case** = Σ `weighted_value` over rows in the period with `is_won = false`
- **Pipeline** = Σ `value` over rows in the period with `is_won = false`

Currency conversion reuses `useFxRates()` + the pipeline-tab `pipelineCurrency` selector pattern from `src/pages/Clients.tsx:91-115`.

### D.3 Forecast UI

- **Route + tab:** `/clients/forecast`, also exposed as a fourth tab on `Clients` (`Accounts | Pipeline | Tasks | Forecast`).
- **Top toolbar:** display currency, pipeline filter, owner filter, period picker (`This month | This quarter | Next quarter`).
- **Three KPI cards:** Committed / Best case / Pipeline.
- **Bar chart (Recharts, already in stack):** stacked bars per month inside the period — committed (green) + best case (blue) + pipeline (gray).
- **By-owner table:** owner, committed, best case, pipeline, win rate. Win rate sourced from the existing `computeAnalytics` helper, scoped to the filter set.

### D.4 Activity timeline view — `063_org_activity_views.sql`

User picked per-client drawer **and** an org-wide page, sourced by unioning existing tables (no new `crm_activities` table).

```sql
create or replace view crm_activity_v as
  select
    'note'::text as event_type,
    n.organization_id,
    n.client_id,
    null::uuid as deal_id,
    n.author_id as actor_id,
    n.author_name as actor_name,
    n.kind as subtype,
    coalesce(n.subject, left(coalesce(n.body,''), 80)) as title,
    n.body as body,
    n.occurred_at as occurred_at
  from client_notes n
union all
  select
    'deal_stage'::text,
    d.organization_id,
    d.client_id,
    d.deal_id,
    coalesce(d.closed_by, d.created_by),
    coalesce(d.created_by_name, 'system'),
    d.stage::text,
    format('Deal %s moved to %s', d.title, d.stage),
    null,
    coalesce(d.closed_at, d.updated_at)
  from deals d
union all
  select
    'task'::text,
    t.organization_id,
    t.client_id,
    null::uuid,
    t.created_by,
    t.created_by_name,
    case when t.done then 'completed' else 'created' end,
    t.title,
    null,
    coalesce(t.completed_at, t.created_at)
  from client_tasks t
union all
  select
    'form_submission'::text,
    f.organization_id,
    f.client_id,
    f.deal_id,
    null::uuid,
    'Lead form'::text,
    f.form_slug,
    format('Submission to "%s"', f.form_title),
    null,
    f.created_at
  from form_submissions f;
```

### D.5 Activity UI

- **Per-client timeline:** new "Activity" tab inside `ClientDetailDrawer`. Query `crm_activity_v` filtered by `client_id`, ordered `occurred_at desc`, page size 50, cursor-based pagination. Lucide icons per event type.
- **Org-wide page:** `/clients/activity`. Same view, no `client_id` filter. Top toolbar: event-type multi-select, pipeline multi-select (applies only to `deal_stage` and `form_submission` rows via the linked deal's pipeline), owner, date range. Realtime via Supabase channels subscribed to `client_notes`, `deals`, `client_tasks`, `form_submissions` for the org; re-queries the first page on any event.

**Performance:** The view is a four-way `UNION ALL`. Each leg filters by `organization_id`, which is indexed. For Batch 1 this is acceptable; if profiling shows seq scans, partial indexes on `(organization_id, occurred_at desc)` get added to each base table (some already exist). The escape hatch — a `crm_activities` materialized table — is explicitly Batch 2 and out of scope here.

---

## Section E — Lead-capture forms

### E.1 Schema — `062_lead_forms.sql`

```sql
create table lead_forms (
  form_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id) on delete cascade,
  pipeline_id uuid not null references pipelines(pipeline_id) on delete restrict,
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

create unique index ux_lead_forms_global_slug on lead_forms(slug);

create table form_submissions (
  submission_id uuid primary key default gen_random_uuid(),
  form_id uuid not null references lead_forms(form_id) on delete cascade,
  organization_id uuid not null,
  form_slug text not null,
  form_title text not null,
  client_id uuid references clients(client_id) on delete set null,
  deal_id uuid references deals(deal_id) on delete set null,
  raw_payload jsonb not null,
  ip_hash text,
  user_agent text,
  turnstile_token_verified boolean not null default false,
  honeypot_tripped boolean not null default false,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index form_submissions_org_idx
  on form_submissions(organization_id, created_at desc);
create index form_submissions_form_idx
  on form_submissions(form_id, created_at desc);

create table form_submission_rate_limits (
  form_id uuid not null,
  ip_hash text not null,
  bucket_started_at timestamptz not null,
  window_seconds int not null,
  count int not null default 1,
  primary key (form_id, ip_hash, bucket_started_at, window_seconds)
);
```

**`fields` jsonb schema (v1 field types: `text | email | tel | url | textarea | select | number`):**

```jsonb
[
  { "key": "name",    "label": "Full name", "type": "text",     "required": true,  "maxLength": 120 },
  { "key": "email",   "label": "Email",     "type": "email",    "required": true },
  { "key": "company", "label": "Company",   "type": "text",     "required": true,  "maxLength": 120 },
  { "key": "phone",   "label": "Phone",     "type": "tel",      "required": false },
  { "key": "budget",  "label": "Budget",    "type": "select",
    "options": ["<10k","10–50k","50–250k",">250k"], "required": false },
  { "key": "notes",   "label": "Notes",     "type": "textarea", "required": false, "maxLength": 2000 }
]
```

### E.2 Public Edge Functions

Two new public functions. **These are the only public-unauth Edge Functions in Batch 1.**

**`supabase/functions/forms-get/index.ts`** (GET, cached 60s):

```
GET /functions/v1/forms-get?slug=<slug>
→ { title, description, fields, turnstile_site_key, thank_you_message }
```

Returns enough to render the form. Never exposes `pipeline_id`, `created_by`, or rate-limit numbers. CORS: allow the app origin only.

**`supabase/functions/forms-submit/index.ts`** (POST):

```
POST /functions/v1/forms-submit
Headers:
  X-Form-Slug: <slug>
  X-Turnstile-Token: <token>           (required if form.turnstile_enabled)
Body (JSON):
  { "<field.key>": "value", … , "_hp": "" }
```

**Pipeline:**

1. Load `lead_forms` by slug. 404 if not found or `status != 'active'`.
2. **Honeypot:** body must include `_hp` and it must be empty. Non-empty → 200 OK fake-success response, set `honeypot_tripped = true`, no client/deal insert. (200 to avoid teaching bots they've been caught.)
3. **Turnstile verification** (if enabled): POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET_KEY` + token + remote_ip. Failure → 403 `{ error: 'verification_failed' }`.
4. **Rate limit:** `ip_hash = sha256(ip + TURNSTILE_DAILY_SALT)`. Increment two `form_submission_rate_limits` rows: 60s and 3600s windows. If either count exceeds the form's limits → 429 `{ error: 'rate_limited', retry_after }`.
5. **Field validation:** required fields present + non-empty after trim; emails match `EMAIL_RE` from `clients.ts`; values truncated to `maxLength`; selects validated against `options`; numbers must be finite. Failures → 422 with per-field errors.
6. **Duplicate-aware insert** in one transaction:
    - Look up an existing client by `normalize_email(email)` OR `normalize_company_name(company) + country`. If found, **link the submission to it** rather than creating a new client. (This is the one place duplicate detection auto-merges instead of hard-blocking — public form submitters can't be expected to click override.)
    - If no match, create a client with `type='prospect'`, `status='active'`, `source=form.title`, `created_by_name='Lead form: ' || form.title`.
    - Create a deal in `pipeline_id = form.pipeline_id` at the first stage (`position = 1`) with `title = company || ' inquiry'`, `value = parsed_budget_midpoint_or_null`, `owner_id = form.created_by`.
    - Insert `form_submissions` row with `client_id`, `deal_id`, `raw_payload = body minus _hp`.
7. Response: 200 `{ ok: true, message: form.thank_you_message, redirect_url: form.redirect_url || null }`.

CORS: allow `*` for `/forms-submit` (intentionally public); allow only the app origin for `/forms-get`.

### E.3 Public frontend routes

Two routes mounted outside the authenticated app layout (no Sidebar, no top nav):

- `/forms/:slug` — full standalone page with one centered `<LeadFormRenderer />`.
- `/forms/:slug/embed` — same renderer with zeroed margins/padding and a transparent body, designed for `<iframe>` blending.

**Embed snippets** generated by the form editor:

```html
<!-- Iframe variant (recommended; CSS-isolated) -->
<iframe src="https://app.taskcalendar.com/forms/acme-newbiz/embed"
        width="100%" height="640" frameborder="0"
        style="border:0;background:transparent;"></iframe>

<!-- Script variant (auto-resizes via postMessage from the iframe) -->
<script async src="https://app.taskcalendar.com/forms.js"
        data-slug="acme-newbiz"></script>
```

The script variant injects the iframe at its position; the iframe `postMessage`s its `scrollHeight` on every render and `forms.js` resizes accordingly. No third-party JS.

`<LeadFormRenderer />` renders fields from the `forms-get` response, lazy-loads the Turnstile widget script when `turnstile_enabled`, submits to `forms-submit`, handles 422 / 403 / 429 inline. On 200 it either shows `thank_you_message` or navigates to `redirect_url`.

### E.4 Form editor (admin UI)

- **Settings → Lead forms** (new tab, admin-only).
- List forms: slug, pipeline, submission count last 7d, status.
- Editor: name, slug (validated `^[a-z0-9-]{3,40}$`, uniqueness checked live), pipeline picker, field drag-reorder with inline edit (label, type, required, options for selects), thank-you message OR redirect URL (mutually exclusive), Turnstile toggle, rate limits.
- "Embed snippets" panel with both code blocks above, pre-filled with the slug.
- "Recent submissions" panel — last 20 rows from `form_submissions`, click through to the linked client.

### E.5 Secrets and config

Supabase secrets (server-only):
- `TURNSTILE_SECRET_KEY` — Cloudflare server secret.
- `TURNSTILE_DAILY_SALT` — 32 random bytes, rotated nightly by a cron Edge Function so `ip_hash` is unlinkable across days.

Public env var (frontend bundle):
- `VITE_TURNSTILE_SITE_KEY` — Cloudflare site key.

### E.6 RLS

- `lead_forms`: read for org members, write for `canManageSettings` admins. Public render goes through the Edge Function with `SECURITY DEFINER` — RLS does not need to relax.
- `form_submissions`: read for org members, no public select; insert only via the Edge Function.
- `form_submission_rate_limits`: no RLS — only the Edge Function reads/writes.

---

## Security

- Public lead-form endpoints are the only un-authenticated paths added. Turnstile + honeypot + per-IP per-minute/hour rate limits stack to defeat the common spam vectors.
- `ip_hash` uses a daily salt so submission IPs aren't linkable across days (privacy + reduces value of a database leak).
- Duplicate-detection partial unique indexes are server-of-truth; frontend warnings are a UX layer, not a guard.
- Lead-scoring rules and pipeline definitions are admin-only writes (RLS + UI gating).
- All new Edge Functions run with explicit allowlist CORS.

## Testing strategy

- **Unit:** `recompute_client_score` (rule matching + clamping + band assignment); `normalize_email` / `normalize_company_name` corner cases; required-field trigger evaluator; rate-limit window math.
- **Integration:** Edge Functions tested via `supabase functions serve` with a seeded test org — submit valid, submit duplicate, submit rate-limited, submit honeypot, Turnstile-failed.
- **End-to-end manual:** documented checklist per feature: create pipeline + stage → drag deal → block on missing field → fix → advance → won-modal → project created with template tasks; admin builds lead-scoring rules → preview → save → score column reflects; admin builds form → publish → submit from incognito → client+deal created → activity feed shows submission.

Tests live under `tests/crm-batch1/`.

## Rollout

| Phase | Work | Calendar |
|---|---|---|
| 1 | Migrations 058–061 + pipeline editor + stage gating + won-handoff modal + score column | Week 1–2 |
| 2 | Lead-scoring rules UI + preview + recompute queue + by-owner forecast table + per-client activity tab | Week 2–3 |
| 3 | Forecast page + org-wide activity page + duplicate-detection UI polish | Week 3–4 |
| 4 | Lead-capture forms (schema + editor + public routes + Edge Functions + embed snippets) | Week 4–5 |

A per-org feature flag `CRM_BATCH1_ENABLED` gates the new Settings tabs and the Forecast/Activity routes during beta. Lead-form public routes are gated only by the form's own `status='active'`.

## Open questions

1. Pipeline editor for end users vs. seeded-only in v1? Spec assumes editor ships in v1; ask for confirmation if scope creeps.
2. Score recompute queue cadence — 60s polling Edge Function vs. on-demand RPC. Spec chooses 60s polling because rule edits aren't latency-critical and it bounds the cost of bulk edits. Revisit if perceived latency is a problem.
3. Forecast period picker default — "This quarter" is the most useful default; "This month" is the simpler default. Spec defaults to "This quarter."

## V2 / Future Work

- Email-dependent features (templates, sequences, mass send, open/click, AI drafting) once the platform-integrations spec is merged.
- Contact and client merge UI (Batch 1 only hard-blocks at insert; merging existing rows is a separate workflow).
- Quotes & invoices.
- Lead-scoring v2: AI-assisted scoring suggestions, custom-field rules.
- Forecasting trend lines backed by a `deal_snapshots` table.
- Materialized `crm_activities` table if the union-all view's performance becomes a problem.
- Conditional / branching fields in lead forms; file-upload fields; A/B testing.
