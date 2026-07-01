import React, { useMemo, useState } from 'react';
import {
  Loader2, StickyNote, Phone, Mail, CalendarClock, CheckCircle2,
  UserPlus, Building2, Handshake, ArrowRightCircle, Trophy, XCircle, Activity,
} from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import {
  useCrmActivities, useCrmContacts, useCrmCompanies, useCrmDeals,
} from '@/hooks/useCrmHub';
import { logActivity } from '@/services/supabase/crmHub/activities';
import { MANUAL_ACTIVITY_TYPES } from '@/types/crmHub';
import type { ActivityType, CrmActivity } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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

const iconColor: Record<ActivityType, string> = {
  note: 'text-slate-500 bg-slate-500/10',
  call: 'text-blue-500 bg-blue-500/10',
  email: 'text-sky-500 bg-sky-500/10',
  meeting: 'text-violet-500 bg-violet-500/10',
  task_completed: 'text-emerald-500 bg-emerald-500/10',
  contact_created: 'text-primary bg-primary/10',
  company_created: 'text-primary bg-primary/10',
  deal_created: 'text-primary bg-primary/10',
  deal_updated: 'text-primary bg-primary/10',
  deal_stage_changed: 'text-amber-500 bg-amber-500/10',
  deal_won: 'text-emerald-500 bg-emerald-500/10',
  deal_lost: 'text-destructive bg-destructive/10',
};

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
    if (a.contactId) return `Contact · ${contactById.get(a.contactId) ?? '(deleted)'}`;
    if (a.companyId) return `Company · ${companyById.get(a.companyId) ?? '(deleted)'}`;
    return null;
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Activity</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Everything that's happened across your CRM — auto-logged and manual.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as ActivityType | 'all')}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activity</SelectItem>
                {Object.keys(iconMap).map((t) => (
                  <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setShowLog(true)}>
              <Activity className="w-4 h-4 mr-2" /> Log activity
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {filtered.length} event{filtered.length === 1 ? '' : 's'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                Nothing to show — create a contact, company, or deal, or log a call/note above.
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([day, items]) => (
                  <div key={day}>
                    <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
                      {day === new Date().toDateString() ? 'Today' : day}
                    </h3>
                    <div className="relative">
                      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                      <div className="space-y-3">
                        {items.map((a) => {
                          const Icon = iconMap[a.type];
                          const linked = linkedLabel(a);
                          return (
                            <div key={a.id} className="relative flex items-start gap-3 pl-1">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-4 ring-background ${iconColor[a.type]}`}>
                                <Icon className="w-3.5 h-3.5" />
                              </div>
                              <div className="flex-1 min-w-0 pt-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-foreground">{humanize(a.type)}</span>
                                  <span className="text-xs text-muted-foreground">{humanTimestamp(a.createdAt)}</span>
                                </div>
                                {a.description && (
                                  <p className="text-sm text-muted-foreground mt-0.5">{a.description}</p>
                                )}
                                {linked && (
                                  <p className="text-xs text-muted-foreground/70 mt-0.5">{linked}</p>
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
          </CardContent>
        </Card>
      </div>

      <Dialog open={showLog} onOpenChange={(o) => { setShowLog(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={logType} onValueChange={(v) => setLogType(v as ActivityType)} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="adesc">Description *</Label>
              <Textarea id="adesc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} rows={3} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Contact</Label>
                <Select value={contactId || '__none__'} onValueChange={(v) => setContactId(v === '__none__' ? '' : v)} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName ?? ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Company</Label>
                <Select value={companyId || '__none__'} onValueChange={(v) => setCompanyId(v === '__none__' ? '' : v)} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Deal</Label>
                <Select value={dealId || '__none__'} onValueChange={(v) => setDealId(v === '__none__' ? '' : v)} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
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
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default CrmActivityPage;
