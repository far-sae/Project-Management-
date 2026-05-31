import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CreditCard, CheckCircle2, AlertCircle, ExternalLink, Copy, RefreshCw, Loader2, Clock,
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
 * Stripe wiring smoke for the Subscription settings tab.
 * Three things at a glance:
 *   1. Is stripe-webhook deployed and reachable? (probe with GET → 405)
 *   2. Has a real webhook event landed recently? (latest
 *      subscriptions.updated_at across the org)
 *   3. Are the two required env vars set on the function? (env probe
 *      via POST with an invalid signature — the function returns
 *      500 "Server configuration error" when secrets are missing,
 *      400 "Missing stripe-signature" / "Invalid signature" when
 *      they're set)
 *
 * Read-only — actual credential changes happen in the Supabase
 * dashboard. This card just answers "is my Stripe setup alive?".
 */
export const StripeHealthCard: React.FC = () => {
  const { user } = useAuth();
  const [webhookProbe, setWebhookProbe] = useState<ProbeState>('unknown');
  const [checkoutProbe, setCheckoutProbe] = useState<ProbeState>('unknown');
  const [envState, setEnvState] = useState<'unknown' | 'configured' | 'missing'>('unknown');
  const [envDetail, setEnvDetail] = useState<string | null>(null);
  const [lastWebhookAt, setLastWebhookAt] = useState<Date | null>(null);
  const [probing, setProbing] = useState(false);

  const base = (import.meta as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL ?? '';

  const probe = async () => {
    if (!base) return;
    setProbing(true);
    try {
      // 1. Webhook reachability — GET should return 405 "Method not
      //    allowed" if the function is deployed. Anything else (404,
      //    network failure) means not deployed / DNS issue.
      try {
        const res = await fetch(`${base}/functions/v1/stripe-webhook`, { method: 'GET' });
        setWebhookProbe(res.status === 405 ? 'reachable' : 'unreachable');
      } catch {
        setWebhookProbe('unreachable');
      }

      // 2. Checkout-session reachability — same pattern.
      try {
        const res = await fetch(`${base}/functions/v1/create-checkout-session`, { method: 'GET' });
        // create-checkout-session is verify_jwt=false but POST-only,
        // so GET should hit a 405 or 401 wrapper.
        setCheckoutProbe(res.status === 405 || res.status === 401 ? 'reachable' : 'unreachable');
      } catch {
        setCheckoutProbe('unreachable');
      }

      // 3. Env-var probe — POST a deliberately invalid signature.
      //    The function checks env presence first and returns 500
      //    "Server configuration error" if missing; otherwise 400 with
      //    a signature error. The distinction tells us whether
      //    secrets are configured.
      try {
        const res = await fetch(`${base}/functions/v1/stripe-webhook`, {
          method: 'POST',
          headers: { 'stripe-signature': 'probe', 'content-type': 'application/json' },
          body: '{}',
        });
        const text = await res.text();
        if (res.status === 500 && /configuration/i.test(text)) {
          setEnvState('missing');
          setEnvDetail(text);
        } else {
          // 400 from signature verification = secrets ARE set
          setEnvState('configured');
          setEnvDetail('Function got past the env check (signature rejection is expected).');
        }
      } catch (err) {
        setEnvState('missing');
        setEnvDetail(err instanceof Error ? err.message : 'env probe failed');
      }

      // 4. Last webhook timestamp — use the user's own subscription
      //    row as a proxy. Webhooks update updated_at when they
      //    process a Stripe event for this user.
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
            Function not deployed. Run:{' '}
            <code>npx supabase functions deploy stripe-webhook create-checkout-session</code>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href="https://dashboard.stripe.com/test/webhooks"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Stripe webhooks <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://supabase.com/docs/guides/functions/secrets"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Set Supabase secrets <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {envDetail && envState === 'configured' && (
          <p className="text-[11px] text-muted-foreground">{envDetail}</p>
        )}
      </CardContent>
    </Card>
  );
};
