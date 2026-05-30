import React, { useEffect, useState } from 'react';
import {
  Activity, Mail, Video, CheckCircle2, AlertCircle, Loader2, RefreshCw, Workflow,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/services/supabase/config';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { cn } from '@/lib/utils';

type Status = 'unknown' | 'connected' | 'missing' | 'error';

interface Row {
  id: 'gmail' | 'google' | 'automations';
  label: string;
  status: Status;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  meta?: string;
}

/**
 * Compact "Is it actually working?" panel above the providers grid. Reads
 * the integrations + automation tables directly (no edge function calls)
 * so a quick refresh tells the user whether their Gmail / Google Meet /
 * automations are live, never connected, or failing.
 */
export const IntegrationsHealthCard: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const next: Row[] = [
      { id: 'gmail',       label: 'Gmail',        status: 'unknown', hint: '', icon: Mail },
      { id: 'google',      label: 'Google Meet',  status: 'unknown', hint: '', icon: Video },
      { id: 'automations', label: 'Automations',  status: 'unknown', hint: '', icon: Workflow },
    ];

    // 1) Gmail + Google Meet — single read of the integrations table for
    // the current user. RLS guarantees we only see our own rows.
    try {
      const { data, error } = await supabase
        .from('integrations')
        .select('provider, status, metadata, connected_at')
        .in('provider', ['gmail', 'google']);
      if (error) throw error;
      for (const row of data ?? []) {
        const target = next.find((r) => r.id === row.provider);
        if (!target) continue;
        if (row.status === 'active') {
          target.status = 'connected';
          const email = (row.metadata as { email?: string } | null)?.email;
          target.hint = email ? `Connected as ${email}` : 'Connected';
          if (row.connected_at) {
            target.meta = `since ${new Date(row.connected_at as string).toLocaleDateString()}`;
          }
        } else {
          target.status = 'error';
          target.hint = `Status: ${row.status}. Reconnect to refresh tokens.`;
        }
      }
    } catch (err) {
      for (const r of next.filter((x) => x.id === 'gmail' || x.id === 'google')) {
        r.status = 'error';
        r.hint = err instanceof Error ? err.message : 'Could not query integrations';
      }
    }

    // Fill in 'missing' for any we didn't get a row for
    for (const r of next) {
      if (r.id !== 'automations' && r.status === 'unknown') {
        r.status = 'missing';
        r.hint = 'Not connected. Click Connect below to start the OAuth flow.';
      }
    }

    // 2) Automations — count enabled recipes + last successful run +
    // pending event queue depth. Gives a 3-number health snapshot.
    if (orgId) {
      try {
        const [{ count: enabledCount }, { data: lastRun }, { count: pendingCount }] = await Promise.all([
          supabase.from('automation_recipes')
            .select('recipe_id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('enabled', true),
          supabase.from('automation_runs')
            .select('finished_at, status')
            .eq('organization_id', orgId)
            .order('finished_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('automation_events')
            .select('event_id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .is('processed_at', null),
        ]);

        const target = next.find((r) => r.id === 'automations')!;
        if ((enabledCount ?? 0) === 0) {
          target.status = 'missing';
          target.hint = 'No enabled recipes. Go to Settings → Automations to enable one.';
        } else if (pendingCount && pendingCount > 50) {
          target.status = 'error';
          target.hint = `${pendingCount} events pending — the worker may not be running. Apply migration 111 and configure app_secrets.`;
          target.meta = `${enabledCount} recipe${enabledCount === 1 ? '' : 's'} enabled`;
        } else if (lastRun) {
          target.status = lastRun.status === 'success' ? 'connected' : 'error';
          target.hint = `Last run ${new Date(lastRun.finished_at as string).toLocaleString()} — ${lastRun.status}`;
          target.meta = `${enabledCount} recipe${enabledCount === 1 ? '' : 's'} enabled${pendingCount ? `, ${pendingCount} pending` : ''}`;
        } else {
          target.status = 'connected';
          target.hint = 'Enabled — waiting for the first event to fire.';
          target.meta = `${enabledCount} recipe${enabledCount === 1 ? '' : 's'} enabled`;
        }
      } catch (err) {
        const target = next.find((r) => r.id === 'automations')!;
        target.status = 'error';
        target.hint = err instanceof Error ? err.message : 'Could not query automation tables';
      }
    }

    setRows(next);
    setLoading(false);
  };

  useEffect(() => {
    if (!user || !orgId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, orgId]);

  if (!user) return null;

  const pill = (s: Status) => {
    if (s === 'connected') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Working</Badge>;
    if (s === 'missing')   return <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>;
    if (s === 'error')     return <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-500/40">Needs attention</Badge>;
    return <Badge variant="outline">Checking…</Badge>;
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Connection health</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const Icon = r.icon;
            const statusIcon = r.status === 'connected'
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              : r.status === 'error'
                ? <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                : null;
            return (
              <li key={r.id} className="flex items-start gap-2 rounded-md border px-2.5 py-2">
                <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium">{r.label}</span>
                    {statusIcon}
                    {pill(r.status)}
                    {r.meta && <span className="text-[10px] text-muted-foreground">· {r.meta}</span>}
                  </div>
                  <p className={cn(
                    'text-[11px] mt-0.5 break-words',
                    r.status === 'error' ? 'text-amber-700 dark:text-amber-400'
                    : r.status === 'missing' ? 'text-muted-foreground'
                    : 'text-muted-foreground',
                  )}>
                    {r.hint}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
