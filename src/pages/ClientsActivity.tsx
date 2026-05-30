// src/pages/ClientsActivity.tsx
//
// Activities hub — the Zoho-style top-level surface that aggregates
// Tasks (client_tasks), Meetings, and Calls across the org into one
// filterable, switchable view. Wired to /clients/activity in App.tsx;
// kept the same route so existing bookmarks / nav links keep working.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, LayoutGrid, List, Plus, Phone, Calendar, ListTodo, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listActivities, applyActivityFilter, ACTIVITY_FILTERS,
  type Activity, type ActivityFilterView,
} from '@/services/supabase/activities';
import { onCallsChanged } from '@/services/supabase/calls';
import { onMeetingsChanged } from '@/services/supabase/meetings';
import { getOrganizationDeals } from '@/services/supabase/deals';
import { getOrganizationClients } from '@/services/supabase/clients';
import { ActivitiesKanban } from '@/components/activities/ActivitiesKanban';
import { ActivitiesList } from '@/components/activities/ActivitiesList';
import { ActivityDetailDialog } from '@/components/activities/ActivityDetailDialog';
import { CreateTaskDialog } from '@/components/activities/CreateTaskDialog';
import { CreateMeetingDialog } from '@/components/activities/CreateMeetingDialog';
import { CreateCallDialog } from '@/components/activities/CreateCallDialog';

type ViewMode = 'kanban' | 'list';

export const ClientsActivity: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filterView, setFilterView] = useState<ActivityFilterView>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');

  // Open-state for the three quick-create dialogs + the detail drawer.
  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [detail, setDetail] = useState<Activity | null>(null);

  // Fetch the union + the supporting deal/client status sets that the
  // aggregator needs for kanban categorization.
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    (async () => {
      try {
        const [deals, clients] = await Promise.all([
          getOrganizationDeals(orgId).catch(() => []),
          getOrganizationClients(orgId).catch(() => []),
        ]);
        const openDealIds = new Set(
          deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').map((d) => d.dealId),
        );
        const customerClientIds = new Set(
          clients.filter((c) => c.type === 'customer').map((c) => c.clientId),
        );
        const rows = await listActivities(orgId, { openDealIds, customerClientIds });
        setActivities(rows);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load activities');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, reloadKey]);

  // Refetch when any of the source tables fire their change event.
  useEffect(() => {
    if (!orgId) return;
    const offMeetings = onMeetingsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    const offCalls    = onCallsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    return () => { offMeetings(); offCalls(); };
  }, [orgId]);

  // Apply the picked filter view, then the free-text search.
  const filtered = useMemo(() => {
    const filteredByView = applyActivityFilter(activities, filterView, user?.userId ?? null);
    const q = search.trim().toLowerCase();
    if (!q) return filteredByView;
    return filteredByView.filter((a) => {
      const hay = [a.title, a.description, a.ownerName, a.relatedToLabel].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [activities, filterView, user?.userId, search]);

  const onAnyCreated = () => setReloadKey((k) => k + 1);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl md:text-2xl font-bold flex-1 min-w-0">Activities</h1>
          <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> <ListTodo className="w-3.5 h-3.5 mr-1 text-rose-600" /> Task
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMeetingOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> <Calendar className="w-3.5 h-3.5 mr-1 text-violet-600" /> Meeting
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCallOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> <Phone className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Call
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterView} onValueChange={(v) => setFilterView(v as ActivityFilterView)}>
            <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>All</SelectLabel>
                {ACTIVITY_FILTERS.filter((f) => f.group === 'all').map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Tasks</SelectLabel>
                {ACTIVITY_FILTERS.filter((f) => f.group === 'tasks').map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Meetings</SelectLabel>
                {ACTIVITY_FILTERS.filter((f) => f.group === 'meetings').map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Calls</SelectLabel>
                {ACTIVITY_FILTERS.filter((f) => f.group === 'calls').map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities by title, owner, related…"
              className="h-9 pl-7"
            />
          </div>

          <span className="text-xs text-muted-foreground">
            {filtered.length} of {activities.length}
          </span>

          <div className="ml-auto inline-flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2 py-1 rounded ${viewMode === 'list' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`px-2 py-1 rounded ${viewMode === 'kanban' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
              title="Kanban view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-md border p-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading activities…
          </div>
        ) : viewMode === 'kanban' ? (
          <ActivitiesKanban activities={filtered} onSelect={setDetail} />
        ) : (
          <ActivitiesList activities={filtered} onSelect={setDetail} />
        )}
      </div>

      <CreateTaskDialog open={taskOpen} onOpenChange={setTaskOpen} onCreated={onAnyCreated} />
      <CreateMeetingDialog open={meetingOpen} onOpenChange={setMeetingOpen} onCreated={onAnyCreated} />
      <CreateCallDialog open={callOpen} onOpenChange={setCallOpen} onCreated={onAnyCreated} />
      <ActivityDetailDialog
        activity={detail}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        onChanged={onAnyCreated}
      />
    </main>
  );
};

export default ClientsActivity;
