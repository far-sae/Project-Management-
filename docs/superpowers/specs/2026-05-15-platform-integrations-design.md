# Platform Integrations — Google Meet, Gmail, Slack

**Date:** 2026-05-15
**Status:** Draft — pending user review
**Scope:** Add three external platform integrations to TaskCalendar, with a shared framework so future integrations (Zoom, Outlook, Notion, etc.) reuse the same plumbing.

---

## Goals

1. Users can connect Google (Meet), Gmail, and Slack from a single **Settings → Integrations** tab.
2. Google Meet links can be generated from any task with a date/time and attached to the task.
3. Task notifications (assignments, mentions, comments) can be sent from the actor's own Gmail account; recipients' replies become task comments and are forwarded back to the sender's Gmail inbox.
4. Slack workspaces can be connected at the organization level; projects can be linked to channels for activity broadcasts; tasks can be created from Slack via slash command or message action.
5. All UI matches the existing shadcn/ui + Tailwind + Lucide pattern already in use.

## Non-Goals (V1)

- Native Gmail thread sync into the sender's inbox — requires `gmail.readonly` (restricted scope, CASA audit, ~3 month delay, $15k+). Deferred to V2.
- Two-way Google Calendar sync of task due dates — out of scope for this spec.
- Outlook, Zoom, Teams, GitHub, Jira, Notion, Dropbox — deferred. The framework is designed to make them cheap to add later.
- Multi-account Gmail per user. One connected Gmail per TaskCalendar user.
- Customizable Slack message templates in V1. Default templates only.

## Constraints

- Frontend is React 18 + Vite + TypeScript, no SSR. All secrets handled server-side in Supabase Edge Functions.
- Auth is Firebase; primary data store is Supabase Postgres. Existing Edge Functions live in `supabase/functions/`.
- Tokens MUST be encrypted at rest (Supabase `pgsodium` or app-layer AES-GCM with a key from environment).
- All inbound webhooks MUST be signature-verified (Slack signing secret, SendGrid/Postmark inbound signature, Google push token).
- Google brand verification is required for `gmail.send` and `calendar.events` scopes (~1–3 weeks). Spec assumes this is a known prerequisite; engineering work can proceed during review.

---

## Architecture Overview

```
                              ┌──────────────────────┐
                              │  React app (Vite)    │
                              │  Settings →          │
                              │  Integrations tab    │
                              └──────┬──────┬────────┘
                                     │      │
                                     │      │ useIntegration(provider)
                                     │      │
                  ┌──────────────────┴──┐   │
                  │  Supabase Postgres  │   │
                  │  - integrations     │◄──┘
                  │  - integration_events│
                  │  - tasks (extended) │
                  └──────────▲──────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
┌──────┴───────┐    ┌────────┴────────┐   ┌────────┴────────┐
│ oauth-start  │    │  oauth-callback │   │ integrations-   │
│ (Edge Fn)    │    │  (Edge Fn)      │   │ webhook         │
└──────┬───────┘    └────────▲────────┘   │ (Edge Fn)       │
       │                     │            └────────▲────────┘
       │ redirect            │ code              │
       ▼                     │                   │
   Google/Slack          Google/Slack       Slack events,
   consent screen        token endpoint     SendGrid Inbound

  Two additional Edge Functions (not shown in diagram, called from
  the React app over authenticated RPC):
    - integrations-disconnect  (revoke + mark row revoked)
    - integrations-action      (send-email, create-meet, slack-post)
```

---

## Shared Integration Framework

### Database schema

```sql
-- New tables (Supabase migration)

create table integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references organizations(organization_id) on delete cascade,
  provider text not null check (provider in ('google','gmail','slack')),
  scopes text[] not null default '{}',
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  status text not null default 'active'
      check (status in ('active','revoked','error','pending')),
  metadata jsonb not null default '{}'::jsonb, -- e.g. slack team_id, gmail address
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index integrations_org_provider_idx
  on integrations(org_id, provider);

create table integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,          -- idempotency key
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

-- Row-level security:
--   - Users see their own (user-level) integrations: provider in ('google','gmail')
--   - Org members see org-level integrations (Slack) for their org
--   - Only org admins (canManageSettings) can insert/update/delete org-level rows;
--     enforced in the Edge Functions, not RLS, since admin status lives in a
--     separate table the policy can read via a SECURITY DEFINER helper.
alter table integrations enable row level security;

create policy "users read own user-level integrations"
  on integrations for select
  using (auth.uid() = user_id and org_id is null);

create policy "org members read org-level integrations"
  on integrations for select
  using (org_id is not null and public.is_org_member(org_id));
-- is_org_member() is defined in migration 036_time_tracking_and_expenses.sql
-- and reads the JSONB members array on the organizations table.
```

Tasks table gets two optional columns:

```sql
alter table tasks
  add column google_meet_link text,
  add column google_event_id text;
```

### Edge Functions

| Function | Purpose | Auth |
|---|---|---|
| `oauth-start` | Returns the provider's OAuth URL with a signed `state` param containing `user_id`, `org_id`, `provider`, nonce | Firebase JWT |
| `oauth-callback` | Receives `?code&state`, verifies state signature, exchanges code, encrypts tokens, upserts row in `integrations` | Public (state-signed) |
| `integrations-webhook` | Routes inbound events by `provider` query param (`?provider=slack`, `?provider=gmail-inbound`, etc.). Verifies provider signature. Writes to `integration_events`, fires handler. | Provider-signature-verified |
| `integrations-disconnect` | Revokes token at provider, marks row `revoked` | Firebase JWT |
| `integrations-action` | Internal RPC used by frontend: "send email", "create meet", "post to slack". Loads token, refreshes if expired, executes. | Firebase JWT |

### Token handling

- Tokens encrypted using AES-256-GCM. Key stored in Supabase secret `INTEGRATION_TOKEN_KEY` (32 random bytes, base64).
- A shared `getProviderClient(userId, provider)` helper:
  1. Loads row from `integrations`
  2. Decrypts access token
  3. If `token_expires_at` is in the past, refreshes via provider, writes new tokens
  4. Returns an authenticated SDK client
- All Edge Functions use this helper. Frontend never sees tokens.

### Frontend shared pieces

- `src/services/integrations/` — new folder
  - `types.ts` — `Provider`, `IntegrationStatus`, `ProviderConfig`
  - `useIntegration.ts` — hook: `{status, connect, disconnect, lastError}`
  - `providers.ts` — registry: `{id, label, description, icon, scopes, color}` for each
- `src/components/integrations/`
  - `ProviderCard.tsx` — reusable card (logo, status badge, Connect/Disconnect, scope list)
  - `IntegrationsTab.tsx` — Settings tab body, lists provider cards
- Routing: OAuth callback handled by a thin React route `/integrations/callback` that calls `oauth-callback` and redirects back to `/settings?tab=integrations`.

---

## Google Meet Integration

### User-facing behavior

- Settings → Integrations → "Connect Google" → OAuth consent → returns to Settings, card shows ● Connected with the connected email.
- On any task that has a due date AND a start time, a `<Button variant="outline">` with the `Video` Lucide icon labeled **"Add Google Meet"** appears in the task detail panel.
- Clicking it:
  - Calls `integrations-action` with `{action: 'create-meet', taskId}`
  - Edge Function creates a Google Calendar event matching the task title, start time, attendees (task assignees with email), and `conferenceData.createRequest`
  - Stores `meet_link` and `google_event_id` on the task
  - Updates the task UI to show a `<Card>` banner: `📹 Google Meet — [Join meeting] [Copy link]`
- If the task is rescheduled or assignees change, the user sees a "Sync to Google Calendar" button to update the event.

### Implementation details

- OAuth scope: `https://www.googleapis.com/auth/calendar.events` (sensitive tier).
- Edge Function action `create-meet`:
  - Builds event payload from task data
  - `POST https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1`
  - Returns `event.hangoutLink` and `event.id`
- Failure modes:
  - Token expired → refresh path
  - Refresh failed → mark integration `status='error'`, surface "Reconnect Google" in Settings
  - Calendar event creation failed → toast error, do not save partial state

### UI fit

- Task detail panel: new `<MeetingPanel task={...} />` component using existing `Card`, `Button`, `Badge` from shadcn/ui.
- Lucide `Video` icon for the connect button, `Link2` for copy.

---

## Gmail Integration (V1 — send-only)

### User-facing behavior

- Settings → Integrations → "Connect Gmail" → OAuth consent (scope: `gmail.send` only) → card shows ● Connected with the Gmail address.
- A new notification preference toggle in Settings → Notifications: **"Send my outgoing notifications via my Gmail"** (off by default).
- When ON, any time the user triggers an outbound notification (assigning a task, @mentioning, leaving a comment that should email someone), the email is sent through that user's Gmail account.
- Recipient sees a real "From: User Name <user@gmail.com>" — not a `noreply@taskcalendar.app` address. Email appears in the user's Gmail Sent folder automatically.
- Recipient replies normally to the email. The reply:
  1. Is captured by the inbound email service via the `Reply-To` header
  2. Becomes a comment on the original task, attributed to the recipient's email address
  3. Is forwarded as a regular email to the original sender's Gmail inbox so they see the response without opening TaskCalendar
- If the user disconnects Gmail or the toggle is off, the existing EmailJS path is used as fallback.

### Implementation details

**Outbound:**
- OAuth scope: `https://www.googleapis.com/auth/gmail.send`
- Email composition (in Edge Function action `send-email`):
  - `From: User Name <user@gmail.com>` (the connected account)
  - `Reply-To: reply+task_{taskId}_{hmac}@{INBOUND_DOMAIN}`
  - `Message-ID:` generated by Gmail
  - HTML body uses existing `src/services/email/` templates
- Sent via `POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send` with raw RFC 2822 payload (base64url).
- HMAC token in reply address signs `(taskId, senderUserId, recipientEmail)` to prevent forgery and enable reply routing.

**Inbound replies:**
- Inbound provider: **SendGrid Inbound Parse** (default). MX record on `inbound.{appdomain}` → SendGrid → POST to `integrations-webhook?provider=gmail-inbound`.
  - Postmark Inbound is an interchangeable alternative; switch is config-only.
- Webhook handler:
  1. Verify SendGrid signature
  2. Parse `to` field, extract `task_{id}_{hmac}`, verify HMAC
  3. Idempotency check via `integration_events`
  4. Strip quoted text using `email-reply-parser` (handles Gmail "On ... wrote:", Outlook, Apple Mail patterns)
  5. Persist attachments to Supabase Storage
  6. Insert a comment on the task, attributed to the reply's `from` address (creates a "guest" attribution if no matching TaskCalendar user)
  7. Forward a copy to the original sender's Gmail using their own `gmail.send` token (so they see the reply in their inbox)

**Failure modes:**
- HMAC mismatch → log, ignore (likely spam/forgery)
- Original sender token revoked → fall back to a system-sent notification email from EmailJS
- SendGrid signature invalid → 401, do not process

### What V1 explicitly does NOT do

- Read the sender's Gmail mailbox — no `gmail.readonly` scope, no CASA audit needed.
- Thread the reply natively into the sender's Gmail conversation. The forward arrives as a fresh message from `notifications@taskcalendar.app`.
- Sync historical email threads.

### UI fit

- Settings tab: provider card identical to Google Meet card.
- Notifications tab: new switch row, using existing `Switch` component pattern from `Settings.tsx`.
- Task comment from email reply: same comment bubble UI, with a subtle `<Badge variant="secondary">via email</Badge>` next to the author.

---

## Slack Integration

### User-facing behavior

- Settings → Integrations → "Connect Slack" — admin-only at the **organization** level (not per-user).
- After OAuth, organization gets a single `slack` row in `integrations` with `org_id` set and `user_id` set to the connecting admin.
- In **Project Settings** (existing per-project settings panel), a new section "Slack channel" appears:
  - Channel picker (`Select` component) populated by `conversations.list`
  - Event toggles (`Switch` rows): task created, task assigned, task completed, comment added — admin chooses which broadcast
- **Slash command** `/taskcalendar new <title>` — creates a task in the project linked to that channel (or the org's default project if the channel isn't linked).
- **Message action** "Create TaskCalendar task" — right-click any Slack message → opens a modal that pre-fills task title with the message text and links the new task to the message permalink.

### Implementation details

- Slack scopes: `chat:write`, `commands`, `channels:read`, `users:read`, optionally `chat:write.public` for posting in channels the bot isn't in.
- Outbound posts:
  - When our app emits a task event, the existing notification pipeline fans out a new "Slack channel" delivery path
  - Edge Function action `slack-post` loads org's token, calls `chat.postMessage` with a Block Kit message including task title, assignee, link
- Inbound events / commands:
  - Slack hits `integrations-webhook?provider=slack`
  - Signature verified via `X-Slack-Signature` header + signing secret
  - Slash command → 200 OK with ephemeral acknowledgement, then `response_url` POST after task is created
  - Message action → opens modal via `views.open`, modal submit → creates task

**Per-project link table:**

```sql
create table project_slack_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  org_id uuid not null,
  channel_id text not null,
  channel_name text,
  events jsonb not null default '{"created":true,"assigned":true,"completed":true,"comment":false}'::jsonb,
  created_at timestamptz default now(),
  unique (project_id, channel_id)
);
```

### UI fit

- Settings tab card: same `ProviderCard` pattern, with "Workspace-level" badge to indicate it's admin-controlled.
- Project settings: new `<SlackProjectSection />` using `Select`, `Switch`, `Label` exactly like the existing Notification preferences section.

---

## Settings UI Layout

```
Settings page (existing Tabs component)
├── Profile
├── Notifications  ── [ ] Send my notifications via my Gmail  (new toggle)
├── Appearance
├── Integrations  ← NEW
│   ├── ProviderCard: Google (Meet + Calendar invites)
│   ├── ProviderCard: Gmail (Send notifications as you)
│   └── ProviderCard: Slack (workspace-level, admin only)
├── Capacity
└── Organization (admin)
```

`ProviderCard` anatomy:

```
┌──────────────────────────────────────────────┐
│ [icon] Provider Name        ● Connected ✓    │
│        One-line description                  │
│        Scopes: calendar.events               │
│        Connected as user@gmail.com           │
│                          [ Disconnect ▼ ]    │
└──────────────────────────────────────────────┘
```

Uses existing `Card`, `CardHeader`, `CardContent`, `Badge`, `Button` from shadcn/ui. Lucide icons: `Video` (Meet), `Mail` (Gmail), `MessageSquare` (Slack).

---

## Error Handling & Edge Cases

- **Token revoked at provider** — `integration_events` handler catches 401 from provider, marks integration `status='error'`, sends in-app notification "Reconnect Google", shows banner on Settings tab.
- **Webhook retries** — `integration_events.external_event_id` is the unique key; duplicate deliveries are skipped silently.
- **OAuth state forged** — signed state contains nonce + user_id + provider; signature verified server-side; mismatch returns 400.
- **User deletes account** — `integrations` cascades on `user_id`; provider tokens are also revoked via outbound API call in the deletion hook.
- **Reply-To HMAC mismatch** — inbound email discarded with log entry, no comment created.
- **Slack event for disconnected workspace** — webhook returns 200 (to stop retries), logs orphan event.
- **Brand verification rejected** — fallback path: EmailJS for outbound notifications continues to work; Meet integration cannot ship until approval. Slack is unaffected.

## Security

- All tokens encrypted at rest (AES-256-GCM, key from environment).
- All webhook endpoints signature-verified.
- OAuth state parameter signed (HMAC) to prevent CSRF.
- HMAC in Reply-To address to prevent forged inbound replies attributing comments to arbitrary tasks.
- Org-level Slack token: only org admins can connect/disconnect; verified via existing `canManageSettings` from `OrganizationContext`.
- RLS on `integrations` table — users see only own rows; admins see org rows.

## Testing Strategy

Per integration, the test pyramid:
1. **Unit:** OAuth state signing/verification; HMAC reply-token; reply parser quoted-text stripping; webhook signature verification (each provider).
2. **Integration:** Edge Function tests using `supabase functions serve` + provider sandbox APIs (Google test users, Slack test workspace).
3. **End-to-end manual:** documented test checklist per integration (connect, action, disconnect, reconnect, revoked-at-provider recovery).

Tests live next to source under `tests/integrations/`.

## Rollout

1. Migration creates new tables (no-op for existing users).
2. New Settings tab visible to all users; provider cards are functional only after the Google brand verification clears (Slack can ship immediately).
3. Feature flag `INTEGRATIONS_ENABLED` (per-org boolean) controls visibility during beta.
4. Beta with 3–5 customer orgs for 1 week before general rollout.

## Build Order

| Phase | Work | Calendar time |
|---|---|---|
| 1 | Shared framework: tables, encryption, oauth-start/callback, Settings tab, ProviderCard | Week 1–2 |
| 2 | Google Meet (smallest, validates the OAuth path end-to-end) | Week 2–3 |
| 3 | Slack (no Google dependency; can run in parallel with Google brand review) | Week 3–4 |
| 4 | Gmail send + SendGrid inbound + reply parsing + forward-to-sender | Week 4–6 |

Total: ~5–6 weeks of engineering, gated on Google brand verification (1–3 weeks, runs in parallel).

## Open Questions

- Inbound email provider: SendGrid Inbound Parse vs Postmark vs Cloudflare Email Workers. Default chosen: SendGrid. To revisit before implementation if pricing or DX preference differs.
- Inbound domain choice: subdomain like `inbound.taskcalendar.app` vs main domain. Recommend subdomain to isolate MX records.
- Encryption key rotation policy: out of scope for V1, but `integrations` schema should leave room for `key_version` if needed later. Decision: NOT adding a column now; rotation will require a one-shot migration if/when needed.

## V2 / Future Work

- `gmail.readonly` + CASA audit → native Gmail thread sync into sender's inbox.
- Google Calendar two-way sync of task due dates.
- Outlook + Microsoft Teams (mirrors Google + Slack).
- Zoom (mirrors Google Meet).
- Notion / Linear / Jira (one-way task export).
- Per-user Slack DMs for personal notifications (currently org/channel only).
