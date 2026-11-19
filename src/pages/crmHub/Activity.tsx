import React, { useMemo, useState } from 'react';
import {
  Loader2, StickyNote, Phone, Mail, CalendarClock, CheckCircle2,
  UserPlus, Building2, Handshake, ArrowRightCircle, Trophy, XCircle, Activity, Waypoints,
} from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import {
  useCrmActivities, useCrmContacts, useCrmCompanies, useCrmDeals, useWorkspaceForCreate,
} from '@/hooks/useCrmHub';
import { logActivity } from '@/services/supabase/crmHub/activities';
import { MANUAL_ACTIVITY_TYPES } from '@/types/crmHub';
import type { ActivityType, CrmActivity } from '@/types/crmHub';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ACTIVITY_LABEL } from '@/lib/crmActivityLabel';

const ACTIVITY_TYPES = Object.keys(ACTIVITY_LABEL) as ActivityType[];

const iconMap: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: CalendarClock,
  task_completed: CheckCircle2,
  contact_created: UserPlus,
  company_created: Building2,
  deal_created: Handshake,
  deal_updated: Handshake,
  deal_stage_changed: ArrowRightCircle,
  deal_won: Trophy,
  deal_lost: XCircle,
};

/** Icons are grey; only a won or a lost deal gets a colour. */
const QUIET_ICON = 'bg-secondary text-muted-foreground';
const iconTone: Partial<Record<ActivityType, string>> = {
  deal_won: 'bg-success-soft text-success-soft-foreground',
  deal_lost: 'bg-destructive-soft text-destructive-soft-foreground',
};

/** Select value standing in for "nothing chosen" (Radix has no empty value). */
const NONE = '__none__';

const groupByDay = (items: CrmActivity[]): [string, CrmActivity[]][] => {
  const map = new Map<string, CrmActivity[]>();
  for (const item of items) {
    const key = item.createdAt.toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries());
};

const humanTimestamp = (d: Date) => {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const CrmActivityPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: activities, loading, refresh } = useCrmActivities(200);
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: deals } = useCrmDeals();
  const workspaceId = useWorkspaceForCreate();

  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logType, setLogType] = useState<ActivityType>('note');
  const [description, setDescription] = useState('');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dealId, setDealId] = useState('');

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName ?? ''}`.trim()])),
    [contacts],
  );
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d.name])), [deals]);

  const filtered = useMemo(
    () => (filter === 'all' ? activities : activities.filter((a) => a.type === filter)),
    [activities, filter],
  );
  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const resetForm = () => {
    setLogType('note'); setDescription('');
    setContactId(''); setCompanyId(''); setDealId('');
  };

  const handleLog = async () => {
    if (!organization) return;
    if (!description.trim()) { toast.error('Description required'); return; }
    setBusy(true);
    try {
      await logActivity(
        {
          organizationId: organization.organizationId,
          workspaceId,
          type: logType,
          description: description.trim(),
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
        },
        user?.userId ?? null,
      );
      toast.success('Activity logged');
      resetForm();
      setShowLog(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log activity');
    } finally {
      setBusy(false);
    }
  };

  const linkedLabel = (a: CrmActivity): string | null => {
    if (a.dealId) return `Deal · ${dealById.get(a.dealId) ?? '(deleted)'}`;
    if (a.contactId) return `Lead · ${contactById.get(a.contactId) ?? '(deleted)'}`;
    if (a.companyId) return `Company · ${companyById.get(a.companyId) ?? '(deleted)'}`;
    return null;
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Activity"
          description="Everything that has happened in your CRM, logged automatically and by hand."
          actions={
            <>
              <Select value={filter} onValueChange={(v) => setFilter(v as ActivityType | 'all')}>
                <SelectTrigger className="w-48" aria-label="Filter activity by type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All activity</SelectItem>
                  {ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ACTIVITY_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => setShowLog(true)}>
                <Activity aria-hidden />
                Log activity
              </Button>
            </>
          }
        />

        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex min-h-11 items-center border-b border-border px-4">
            <h2 className="text-sm font-semibold text-foreground">
              <span className="tabular-nums">{filtered.length}</span> event{filtered.length === 1 ? '' : 's'}
            </h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading activity…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
              <Waypoints className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              {filter === 'all' ? (
                <>
                  <p className="text-sm font-medium">No activity yet.</p>
                  <p className="text-xs text-muted-foreground">
                    It fills in as you add leads, companies and deals, or log a call or note.
                  </p>
                  <Button className="mt-3" onClick={() => setShowLog(true)}>
                    <Activity aria-hidden />
                    Log activity
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Nothing of this type yet.</p>
                  <Button variant="outline" className="mt-3" onClick={() => setFilter('all')}>
                    Show all activity
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6 p-4">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                    {day === new Date().toDateString() ? 'Today' : day}
                  </h3>
                  <div className="relative">
                    <div className="absolute bottom-2 left-3.5 top-2 w-px bg-border" aria-hidden />
                    <div className="space-y-3">
                      {items.map((a) => {
                        const Icon = iconMap[a.type];
                        const linked = linkedLabel(a);
                        return (
                          <div key={a.id} className="relative flex items-start gap-3">
                            <div
                              className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background',
                                iconTone[a.type] ?? QUIET_ICON,
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <div className="flex flex-wrap items-center gap-x-2">
                                <span className="text-sm font-medium text-foreground">{ACTIVITY_LABEL[a.type]}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">{humanTimestamp(a.createdAt)}</span>
                              </div>
                              {a.description && (
                                <p className="mt-0.5 max-w-3xl break-words text-sm text-muted-foreground">{a.description}</p>
                              )}
                              {linked && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{linked}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={showLog} onOpenChange={(o) => { setShowLog(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="atype">Type</Label>
              <Select value={logType} onValueChange={(v) => setLogType(v as ActivityType)} disabled={busy}>
                <SelectTrigger id="atype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ACTIVITY_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adesc">Description *</Label>
              <Textarea id="adesc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} rows={3} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="alead">Lead</Label>
                <Select value={contactId || NONE} onValueChange={(v) => setContactId(v === NONE ? '' : v)} disabled={busy}>
                  <SelectTrigger id="alead"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName ?? ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acompany">Company</Label>
                <Select value={companyId || NONE} onValueChange={(v) => setCompanyId(v === NONE ? '' : v)} disabled={busy}>
                  <SelectTrigger id="acompany"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adeal">Deal</Label>
                <Select value={dealId || NONE} onValueChange={(v) => setDealId(v === NONE ? '' : v)} disabled={busy}>
                  <SelectTrigger id="adeal"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLog(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleLog} disabled={busy || !description.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default CrmActivityPage;
