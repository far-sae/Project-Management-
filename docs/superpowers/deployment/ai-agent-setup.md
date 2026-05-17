# AI Sales Agent — deployment & external setup

External setup required before the AI Sales Agent can enrich leads and
draft outreach emails.

## Prereqs
- Batch 2c (Sequences) shipped — provides the shared Gmail send helper
  (`supabase/functions/_shared/gmailSend.ts`) and Reply-To rewriting
  the agent reuses for sent drafts.
- `ANTHROPIC_API_KEY` Supabase secret already set (from Batch 2b).

## 1. Sign up for Apollo

1. https://www.apollo.io → create an account.
2. Plan: **Basic — $49/mo** (~500 credits/month, sufficient for the
   default 20/day cap once the 30-day cache warms up).
3. Get an API key:
   Apollo dashboard → **Settings → Integrations → API → Create new API key**.
   Copy it.

## 2. Set Supabase secrets

```bash
npx supabase secrets set APOLLO_API_KEY=<paste-key-here>
```

(Existing secrets — `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_TOKEN_KEY`,
`SEQUENCE_INBOUND_DOMAIN`, `SENDGRID_INBOUND_WEBHOOK_SECRET` — should
already be set.)

## 3. Apply migration 068

```bash
npx supabase db push
```

This creates `agent_suggestions`, `apollo_lookups`, adds
`pipelines.stale_after_days`, `organizations.ai_agent_*` columns,
`deals.last_activity_at`, and registers two RPCs
(`revive_agent_snoozes`, `find_stale_deals`).

## 4. Deploy Edge Functions

```bash
npx supabase functions deploy ai-agent-suggest
npx supabase functions deploy ai-agent-approve
npx supabase functions deploy crm-stuck-deal-scanner
npx supabase functions deploy crm-agent-snooze-revival
npx supabase functions deploy crm-run-automations
```

The last redeploy picks up the new `agent_intake` trigger branch in
the recipe engine.

## 5. Schedule the cron jobs

In Supabase Dashboard → **Database → Cron jobs** (extension `pg_cron`
+ `pg_net` must be enabled — they were turned on for Batch 2a):

```sql
-- Stuck-deal scanner: daily at 09:00 UTC
select cron.schedule(
  'ai-agent-stuck-scan',
  '0 9 * * *',
  $$select net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/crm-stuck-deal-scanner',
    headers:='{"Authorization":"Bearer <service-role-key>"}'::jsonb
  )$$
);

-- Snooze revival + expire: hourly
select cron.schedule(
  'ai-agent-snooze-revival',
  '0 * * * *',
  $$select net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/crm-agent-snooze-revival',
    headers:='{"Authorization":"Bearer <service-role-key>"}'::jsonb
  )$$
);
```

Replace `<project-ref>` and `<service-role-key>` with actual values
before running.

## 6. Frontend redeploy

The new `/ai-agent` route + sidebar entry ships in the standard Vite
build. Redeploy as usual (Vercel/Netlify autodeploys on push to main).

## 7. Enable the agent per org

Off by default — no Apollo credits or Anthropic tokens burned until
opted in.

Each org owner:
1. Settings → Pipelines → set "stale after N days" for each pipeline
   (default 14).
2. Sidebar → **AI Agent** → **Settings** tab → toggle **Enable**.
3. Optional: lower `ai_agent_apollo_daily_cap` if you're on a smaller
   Apollo plan.

For the intake path to fire, also create one recipe:
- Settings → Automations → **New recipe**
- Trigger: **AI agent: draft outreach for new lead**
- (No actions needed — the trigger itself dispatches to the agent.)
- Save + enable.

## 8. Verify

1. Settings → AI Agent → Settings: cap Apollo + LLM both at 5 (low,
   so a test run can't burn the month).
2. Add a test client with an email at a real company domain (e.g.
   `someone@stripe.com`).
3. Within ~60 seconds:
   - A row appears in `public.agent_suggestions` with `status='pending'`
   - Settings → AI Agent → Queue shows a card with enrichment chips +
     drafted subject + reasoning + confidence bar.
4. Click **Edit** → modify subject → **Send**. Email arrives at the
   test address via your connected Gmail.
5. Manually mark a test deal as stale and trigger the scanner once:
   ```sql
   update deals set last_activity_at = now() - interval '40 days'
   where deal_id = '<your-test-deal-id>';
   ```
   then:
   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/crm-stuck-deal-scanner \
     -H "Authorization: Bearer <service-role-key>"
   ```
   → a re-engagement suggestion appears in the queue.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Suggestions stuck at `status='failed'` with `llm_error` in `rejected_note` | Anthropic key invalid or rate-limited | Check `ANTHROPIC_API_KEY` secret; check Anthropic dashboard for quota |
| `status='cap_reached'` rows piling up | Daily cap hit | Raise caps in Settings → AI Agent, or wait until UTC midnight |
| No enrichment chips on any card | `APOLLO_API_KEY` not set, or Apollo plan inactive | Set the secret; verify Apollo account is paid + active |
| `find_stale_deals` returns 0 for orgs that should have stale deals | `deals.last_activity_at` not populated | Backfill from `updated_at` — the migration does this once, but new deals need a trigger |
| Cron not firing | `pg_cron` job not registered or `pg_net` extension missing | Check `select * from cron.job;` in Supabase SQL editor |
