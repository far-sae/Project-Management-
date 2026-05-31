import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageSquare, CheckCircle2, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase/config';
import { useOrganization } from '@/context/OrganizationContext';

const ENV_VARS = [
  { name: 'TWILIO_ACCOUNT_SID',  hint: "Starts with AC… — find it on your Twilio Console homepage" },
  { name: 'TWILIO_AUTH_TOKEN',   hint: "The 'Auth Token' shown next to the SID on the Console" },
  { name: 'TWILIO_FROM_NUMBER',  hint: "An E.164 sender, e.g. +15551234567 — must be a Twilio-owned number" },
] as const;

/**
 * Twilio (SMS) configuration card. Unlike Gmail / Slack / etc.,
 * Twilio credentials don't go through OAuth — they're server-side
 * secrets the sms-send edge function reads from its env. So there's
 * no in-app "Connect" button; the rep has to set them in the
 * Supabase Dashboard. This card surfaces the exact three env var
 * names + a probe button so they can confirm the function actually
 * sees the secrets without having to send a real SMS.
 */
export const TwilioSmsConfigCard: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [probing, setProbing] = useState(false);
  // 'unknown' = never probed; the colored badge only appears after a
  // probe so we don't pretend to know the status before then.
  const [status, setStatus] = useState<'unknown' | 'configured' | 'missing'>('unknown');
  const [detail, setDetail] = useState<string | null>(null);

  // Quick auto-probe on mount so the card shows the actual state
  // without the rep having to click Probe.
  useEffect(() => { if (orgId) void probe(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

  const probe = async () => {
    if (!orgId) return;
    setProbing(true);
    try {
      // Hit sms-send with a deliberately invalid payload. The function
      // checks env-var presence FIRST (returns 503 + descriptive
      // "Twilio is not configured" when missing) before validating
      // the body, so a deliberate body error means "Twilio IS
      // configured but the body was bad" — i.e. configured state.
      const res = await supabase.functions.invoke('sms-send', {
        body: { __probe: true },
      });
      const data = res.data as { ok?: boolean; error?: string } | null;
      const errMsg = String(res.error?.message ?? data?.error ?? '');
      if (/twilio is not configured/i.test(errMsg)) {
        setStatus('missing');
        setDetail(errMsg);
      } else {
        // Any other response (even an error about a bad payload)
        // means the env vars are set — the function got past the
        // env-presence check.
        setStatus('configured');
        setDetail('Function can see all three TWILIO_* secrets.');
      }
    } catch (err) {
      setStatus('missing');
      setDetail(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setProbing(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-sky-600" />
          SMS (Twilio)
          {status === 'configured' && (
            <Badge variant="outline" className="ml-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 gap-1">
              <CheckCircle2 className="w-3 h-3" /> Configured
            </Badge>
          )}
          {status === 'missing' && (
            <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-700 dark:text-amber-300 gap-1">
              <AlertCircle className="w-3 h-3" /> Not configured
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          SMS sends through the <code>sms-send</code> edge function. Twilio credentials
          are server-side <strong>Supabase Edge Function secrets</strong>, not in-app
          settings — set them once on the function, every org member can then send.
        </p>

        <div className="space-y-1.5">
          {ENV_VARS.map((v) => (
            <div key={v.name} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs font-mono font-semibold">{v.name}</code>
                <button
                  type="button" onClick={() => copy(v.name)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Copy variable name"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{v.hint}</p>
            </div>
          ))}
        </div>

        {canManageSettings && (
          <div className="rounded-md border border-dashed p-2.5 bg-muted/30 text-xs space-y-1">
            <p className="font-medium">How to set them</p>
            <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
              <li>Open the Supabase dashboard for this project.</li>
              <li>Project Settings → Edge Functions → Manage secrets.</li>
              <li>Add the three variables above with the values from your Twilio Console.</li>
              <li>Redeploy or just re-run sms-send — secrets are live on the next invocation.</li>
            </ol>
            <p className="text-[11px] text-muted-foreground pt-1">
              CLI shortcut: <code>npx supabase secrets set TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… TWILIO_FROM_NUMBER=+1…</code>
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={probe} disabled={probing}>
            {probing ? 'Probing…' : 'Test configuration'}
          </Button>
          <a
            href="https://supabase.com/docs/guides/functions/secrets"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Supabase secrets docs <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://console.twilio.com/"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-auto"
          >
            Twilio Console <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {detail && status !== 'unknown' && (
          <p className={`text-[11px] ${status === 'missing' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
            {detail}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
