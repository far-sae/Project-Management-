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
