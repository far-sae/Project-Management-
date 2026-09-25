import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { AuditEvent, AuditLogError, listAuditEvents } from '@/services/supabase/auditLog';

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: 'all',                       label: 'All events' },
  { value: 'login',                     label: 'Logins' },
  { value: 'role_changed',              label: 'Role changes' },
  { value: 'member_invited',            label: 'Member invites' },
  { value: 'mfa_enabled',               label: 'MFA enrolments' },
  { value: 'mfa_disabled',              label: 'MFA removals' },
  { value: 'integration_connected',     label: 'Integrations connected' },
  { value: 'integration_disconnected',  label: 'Integrations removed' },
  { value: 'bulk_delete',               label: 'Bulk deletes' },
  { value: 'bulk_edit',                 label: 'Bulk edits' },
  { value: 'client_imported',           label: 'CSV imports' },
  { value: 'data_exported',             label: 'Data exports' },
  { value: 'settings_changed',          label: 'Settings changes' },
];

const ACTION_BADGE: Record<string, string> = {
  login:                    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  role_changed:             'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  mfa_enabled:              'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  mfa_disabled:             'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  bulk_delete:              'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  integration_connected:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  integration_disconnected: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
};

const prettyAction = (a: string) =>
  a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const AuditLogSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? user?.organizationId ?? null;

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>('all');
  // Tracks WHY the list is empty so the rep sees "Apply migration 095"
  // or "Only admins can view" instead of the generic "No audit events
  // yet" which used to render in both real-empty and broken cases.
  const [loadError, setLoadError] = useState<
    | { reason: 'local_org' | 'table_missing' | 'permission_denied' | 'network' | 'unknown'; message: string }
    | null
  >(null);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await listAuditEvents(orgId, {
        actionFilter: actionFilter === 'all' ? null : actionFilter,
      });
      setEvents(next);
    } catch (err) {
      setEvents([]);
      if (err instanceof AuditLogError) {
        setLoadError({ reason: err.reason, message: err.message });
      } else {
        setLoadError({
          reason: 'unknown',
          message: err instanceof Error ? err.message : 'Could not load audit events.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [orgId, actionFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, AuditEvent[]>();
    for (const e of events) {
      const day = format(e.occurredAt, 'yyyy-MM-dd');
      const list = map.get(day);
      if (list) list.push(e);
      else map.set(day, [e]);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Security audit log</p>
              <p className="text-xs text-muted-foreground">
                Append-only record of sensitive actions in this workspace.
                Visible to owners and admins only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {loading && events.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground inline-flex items-center gap-2 w-full justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading audit log…
          </div>
        ) : loadError ? (
          <div className={
            'rounded-md border p-3 text-sm flex items-start gap-2 '
            + (loadError.reason === 'permission_denied'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive')
          }>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                {loadError.reason === 'table_missing'
                  ? 'Audit log table missing'
                  : loadError.reason === 'permission_denied'
                    ? 'Permission denied'
                    : loadError.reason === 'local_org'
                      ? 'Audit log is Supabase-only'
                      : "Couldn't load audit events"}
              </p>
              <p className="text-xs mt-0.5 break-words">{loadError.message}</p>
            </div>
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No audit events yet. Sensitive actions like role changes, MFA
            enrolments, and integration changes will appear here.
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {grouped.map(([day, items]) => (
              <section key={day}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  {format(new Date(day), 'PPPP')}
                </h4>
                <div className="rounded-md border divide-y">
                  {items.map((e) => (
                    <div key={e.eventId} className="p-2.5 flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${ACTION_BADGE[e.action] ?? ''}`}
                      >
                        {prettyAction(e.action)}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{e.actorName ?? 'Someone'}</span>
                          {e.targetLabel && (
                            <>
                              {' '}→{' '}
                              <span className="text-muted-foreground">{e.targetLabel}</span>
                            </>
                          )}
                        </p>
                        {Object.keys(e.metadata).length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {Object.entries(e.metadata)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {format(e.occurredAt, 'p')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
