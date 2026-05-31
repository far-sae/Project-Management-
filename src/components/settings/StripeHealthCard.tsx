import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CreditCard, CheckCircle2, AlertCircle, ExternalLink, Copy, RefreshCw, Loader2, Clock,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase/config';
import { useAuth } from '@/context/AuthContext';

type ProbeState = 'unknown' | 'reachable' | 'unreachable';

const STRIPE_ENV_VARS = [
  { name: 'STRIPE_SECRET_KEY',     hint: "Stripe Dashboard → Developers → API keys (starts with sk_…)" },
  { name: 'STRIPE_WEBHOOK_SECRET', hint: "Created when you add the webhook endpoint in Stripe (starts with whsec_…)" },
] as const;

/**
 * Stripe wiring smoke + actionable diagnostic for the Subscription
 * settings tab. v2 — answers the "I set the secrets but it still
 * doesn't work" question with the most-likely causes spelled out.
 *
 * Probes (in order, each independently):
 *   1. Webhook reachable    — GET → expect 405
 *   2. Checkout reachable   — GET → expect 405/401
 *   3. Env vars set         — POST stripe-webhook with bogus sig.
 *                              500 'configuration' → missing secrets
 *                              400 'signature'     → secrets present
 *   4. Webhook URL          — surfaces the exact URL to paste into
 *                              Stripe Dashboard → Developers → Webhooks
 *   5. Last activity        — subscriptions.updated_at for this user
 *                              (proxy for "webhook actually fired")
 *
 * Common gotchas accordion explains the four reasons users typically
 * hit this dead-end after setting secrets:
 *   - secrets set but function not redeployed (cold start cache)
 *   - wrong env var names (typo / wrong case)
 *   - webhook endpoint never registered in Stripe Dashboard
 *   - whsec_ value pasted from wrong webhook endpoint
 */
export const StripeHealthCard: React.FC = () => {
  const { user } = useAuth();
  const [webhookProbe, setWebhookProbe] = useState<ProbeState>('unknown');
  const [checkoutProbe, setCheckoutProbe] = useState<ProbeState>('unknown');
  const [envState, setEnvState] = useState<'unknown' | 'configured' | 'missing'>('unknown');
  const [envRawResponse, setEnvRawResponse] = useState<string | null>(null);
  const [envHttpStatus, setEnvHttpStatus] = useState<number | null>(null);
  const [lastWebhookAt, setLastWebhookAt] = useState<Date | null>(null);
  const [probing, setProbing] = useState(false);
  const [showGotchas, setShowGotchas] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const base = (import.meta as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL ?? '';
  const webhookUrl = base ? `${base}/functions/v1/stripe-webhook` : '';

  const probe = async () => {
    if (!base) return;
    setProbing(true);
    try {
      // 1 + 2 + 3. All three Stripe-side probes now go through the
      //    purpose-built stripe-health edge function. The previous
      //    direct-fetch approach to stripe-webhook + create-checkout-
      //    session was failing CORS in the browser (those functions
      //    intentionally have no CORS headers — Stripe calls them
      //    server-to-server). The browser saw the CORS block as a
      //    fetch failure and the card falsely reported "unreachable".
      //    stripe-health is browser-callable, returns env-var
      //    presence + the webhook URL.
      try {
        const { data, error } = await supabase.functions.invoke('stripe-health', { body: {} });
        if (error || !data) {
          // Function itself isn't reachable / not deployed.
          setWebhookProbe('unreachable');
          setCheckoutProbe('unreachable');
          setEnvState('missing');
          setEnvHttpStatus(null);
          setEnvRawResponse(`stripe-health invoke failed: ${error?.message ?? 'no response'}`);
        } else {
          const d = data as {
            secretKeySet?: boolean;
            secretKeyMode?: string | null;
            secretKeyPrefix?: string | null;
            webhookSecretSet?: boolean;
            webhookSecretPrefix?: string | null;
            webhookUrl?: string | null;
          };
          // If stripe-health responded, the function gateway is alive
          // — and since stripe-webhook is in the same deploy, treat
          // it as reachable. (Direct probe would be CORS-blocked.)
          setWebhookProbe('reachable');
          setCheckoutProbe('reachable');
          // Env state from the boolean presence flags. Both must be
          // set for the wiring to work end-to-end.
          if (d.secretKeySet && d.webhookSecretSet) setEnvState('configured');
          else setEnvState('missing');
          setEnvHttpStatus(200);
          setEnvRawResponse(JSON.stringify({
            secretKeySet: d.secretKeySet,
            secretKeyMode: d.secretKeyMode,
            secretKeyPrefix: d.secretKeyPrefix,
            webhookSecretSet: d.webhookSecretSet,
            webhookSecretPrefix: d.webhookSecretPrefix,
            webhookUrl: d.webhookUrl,
          }, null, 2));
        }
      } catch (err) {
        setWebhookProbe('unreachable');
        setCheckoutProbe('unreachable');
        setEnvState('missing');
        setEnvRawResponse(err instanceof Error ? err.message : 'probe failed');
      }

      // 4. Last activity timestamp — user's own subscriptions.updated_at.
      if (user?.userId) {
        const { data } = await supabase
          .from('subscriptions')
          .select('updated_at')
          .eq('user_id', user.userId)
          .maybeSingle();
        if (data?.updated_at) setLastWebhookAt(new Date(data.updated_at as string));
      }
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => { void probe(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.userId]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); }
    catch { toast.error('Copy failed'); }
  };

  const Pill = ({ state, label }: { state: ProbeState; label: string }) => {
    if (state === 'reachable') return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300 gap-1">
        <CheckCircle2 className="w-3 h-3" /> {label}: deployed
      </Badge>
    );
    if (state === 'unreachable') return (
      <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
        <AlertCircle className="w-3 h-3" /> {label}: unreachable
      </Badge>
    );
    return <Badge variant="outline">{label}: …</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" />
            Stripe wiring
          </span>
          <Button variant="ghost" size="sm" onClick={probe} disabled={probing}>
            {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Pill state={webhookProbe} label="webhook" />
          <Pill state={checkoutProbe} label="checkout" />
          {envState === 'configured' && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300 gap-1">
              <CheckCircle2 className="w-3 h-3" /> Secrets set
            </Badge>
          )}
          {envState === 'missing' && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300 gap-1">
              <AlertCircle className="w-3 h-3" /> Secrets missing
            </Badge>
          )}
        </div>

        {/* Webhook URL — the most-forgotten step. Paste this into
            Stripe Dashboard → Developers → Webhooks → Add endpoint. */}
        {webhookUrl && (
          <div className="rounded-md border bg-muted/30 p-2.5 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Webhook URL (paste into Stripe)</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono break-all flex-1">{webhookUrl}</code>
              <button type="button" onClick={() => copy(webhookUrl)} className="text-muted-foreground hover:text-foreground" title="Copy">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Subscribe at minimum to: <code>checkout.session.completed</code>, <code>customer.subscription.created</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>.
            </p>
          </div>
        )}

        {lastWebhookAt && (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Last Stripe event for your account {formatDistanceToNow(lastWebhookAt, { addSuffix: true })}
            <span className="opacity-70">({lastWebhookAt.toLocaleString()})</span>
          </p>
        )}

        {envState === 'missing' && (
          <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5 text-xs">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              stripe-webhook can't see its secrets — Stripe events will be rejected.
            </p>
            <p className="text-muted-foreground">Set these on the function:</p>
            <div className="space-y-1">
              {STRIPE_ENV_VARS.map((v) => (
                <div key={v.name} className="rounded border p-1.5 flex items-center justify-between gap-2 bg-background/50">
                  <div className="min-w-0">
                    <code className="text-xs font-mono font-semibold">{v.name}</code>
                    <p className="text-[10px] text-muted-foreground truncate">{v.hint}</p>
                  </div>
                  <button type="button" onClick={() => copy(v.name)} className="opacity-60 hover:opacity-100">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">
              CLI: <code>npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…</code>
            </p>
          </div>
        )}

        {(webhookProbe === 'unreachable' || checkoutProbe === 'unreachable') && (
          <p className="text-xs text-destructive">
            Diagnostic function not deployed yet. Run:{' '}
            <code>npx supabase functions deploy stripe-health stripe-webhook create-checkout-session</code>
            {' '}— then click Refresh.
          </p>
        )}

        {/* "I set the secrets but it still doesn't work" — the four
            classic gotchas. Collapsed by default; expands so reps
            actually read them when they hit the dead-end. */}
        <button
          type="button" onClick={() => setShowGotchas((s) => !s)}
          className="flex items-center gap-1 text-xs text-primary hover:underline w-full text-left"
        >
          {showGotchas ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Set the secrets but it&apos;s still not working?
        </button>
        {showGotchas && (
          <div className="rounded-md border border-dashed p-2.5 space-y-2 text-xs">
            <Gotcha
              n={1}
              title="Did you redeploy the functions after setting the secrets?"
              detail={
                <>Edge functions cache env on cold start. New secrets only take effect on a fresh deploy or after a few minutes of inactivity. Run{' '}
                <code>npx supabase functions deploy stripe-webhook create-checkout-session</code>
                {' '}to force it.</>
              }
            />
            <Gotcha
              n={2}
              title="Are the env var names exactly STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET?"
              detail={
                <>Common typos: <code>STRIPE_KEY</code>, <code>STRIPE_API_KEY</code>, <code>WEBHOOK_SECRET</code>. Case matters. Trailing spaces / newlines from copy-paste matter. Re-set them and click Refresh above.</>
              }
            />
            <Gotcha
              n={3}
              title="Is the webhook endpoint registered in Stripe Dashboard?"
              detail={
                <>Setting <code>STRIPE_WEBHOOK_SECRET</code> in Supabase only configures the function to <em>verify</em> incoming events. You still have to <strong>add the endpoint URL</strong> (shown above) in Stripe Dashboard → Developers → Webhooks → Add endpoint, AND subscribe to the four <code>checkout.*</code> / <code>customer.subscription.*</code> events listed there.</>
              }
            />
            <Gotcha
              n={4}
              title="Did you copy the whsec_ value from the same endpoint?"
              detail={
                <>Each webhook endpoint in Stripe has its own signing secret. If you have multiple endpoints (e.g. test + live, or staging + prod) and you paste the wrong one, every event fails signature verification with <code>StripeSignatureVerificationError</code>. Click the endpoint in Stripe → Reveal → re-copy.</>
              }
            />
            <Gotcha
              n={5}
              title="Are you using the right mode (test vs live)?"
              detail={
                <>If <code>STRIPE_SECRET_KEY</code> starts with <code>sk_test_</code>, the webhook endpoint also needs to be in the <em>test</em> dashboard (and the <code>whsec_</code> from there). Mixing test + live keys gives signature failures.</>
              }
            />
            <Gotcha
              n={6}
              title="Check the function logs for the actual error"
              detail={
                <>Supabase Dashboard → Edge Functions → <code>stripe-webhook</code> → Logs. The function logs each rejection reason (missing config, bad signature, unknown event type, RLS error on subscriptions update). Far faster than guessing.</>
              }
            />
          </div>
        )}

        {/* Raw env-probe response — for the truly stuck. */}
        {envRawResponse && (
          <button
            type="button" onClick={() => setShowRaw((s) => !s)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showRaw ? '− hide' : '+ show'} raw env-probe response
          </button>
        )}
        {showRaw && envRawResponse && (
          <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-x-auto">
{`HTTP ${envHttpStatus ?? '?'}
${envRawResponse}`}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href="https://dashboard.stripe.com/test/webhooks"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Stripe webhooks (test) <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://dashboard.stripe.com/webhooks"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Stripe webhooks (live) <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://supabase.com/docs/guides/functions/secrets"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline ml-auto"
          >
            Set Supabase secrets <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

const Gotcha: React.FC<{ n: number; title: string; detail: React.ReactNode }> = ({ n, title, detail }) => (
  <div className="rounded border bg-background/50 p-2">
    <p className="font-medium">{n}. {title}</p>
    <p className="text-muted-foreground leading-relaxed mt-0.5">{detail}</p>
  </div>
);
