// src/components/activities/ActivitiesHubPanel.tsx
//
// Inline-friendly version of the Activities hub. Extracted from
// ClientsActivity (the standalone /clients/activity page) so the
// same hub can be embedded inside the CRM page's Tabs without
// rendering a nested <main> wrapper. Behaviour is identical to the
// standalone page: filter views, quick-create dialogs, kanban/list
// toggle, search, detail dialog.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, LayoutGrid, List, Plus, Phone, Calendar, ListTodo, Loader2, Clock,
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
  isToday,
  type Activity, type ActivityFilterView,
} from '@/services/supabase/activities';
import { onCallsChanged } from '@/services/supabase/calls';
import { onMeetingsChanged } from '@/services/supabase/meetings';
import { getOrganizationDeals } from '@/services/supabase/deals';
import { getOrganizationClients } from '@/services/supabase/clients';
import { ActivitiesKanban } from './ActivitiesKanban';
import { ActivitiesStatusKanban } from './ActivitiesStatusKanban';
import { ActivitiesKindKanban } from './ActivitiesKindKanban';
import { ActivitiesList } from './ActivitiesList';
import { ActivitiesTimeline } from './ActivitiesTimeline';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CreateMeetingDialog } from './CreateMeetingDialog';
import { CreateCallDialog } from './CreateCallDialog';
import { QuickLogComposer } from './QuickLogComposer';

type ViewMode = 'status' | 'kind' | 'category' | 'list' | 'timeline';

interface ActivitiesHubPanelProps {
  /** Initial filter view. Useful when the panel is mounted on a
   *  context-specific tab (e.g. "Tasks" tab pre-selects 'my_open_tasks'). */
  initialFilter?: ActivityFilterView;
  /** Page-level pages wrap themselves in <main> with padding; tab-
   *  embedded uses don't. Default keeps the standalone-page max-width;
   *  set false to fill the parent. */
  bounded?: boolean;
}

export const ActivitiesHubPanel: React.FC<ActivitiesHubPanelProps> = ({
  initialFilter = 'all',
  bounded = true,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filterView, setFilterView] = useState<ActivityFilterView>(initialFilter);
  // Default to timeline mode — chronological unified feed (upcoming +
  // day-grouped logged) including notes + emails. The status/kind/category/list
  // modes are still accessible via the view switcher.
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [search, setSearch] = useState('');

  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  // Edit-mode prefills — when set, the matching dialog opens with the
  // row prefilled instead of starting blank. Clicking a card jumps
  // straight here so the user lands in the full editor (matching the
  // project kanban TaskModal experience) instead of a smaller read
  // dialog they then have to click "Edit" on.
  const [editTask, setEditTask] = useState<import('@/services/supabase/clientTasks').ClientTask | null>(null);
  const [editMeeting, setEditMeeting] = useState<import('@/services/supabase/meetings').Meeting | null>(null);
  const [editCall, setEditCall] = useState<import('@/services/supabase/calls').Call | null>(null);

  // Card-click handler: routes to the full edit dialog (the same one
  // + Task / + Meeting / + Call open) so reps land in an editable
  // form with every field, instead of a smaller read view.
  // Notes and emails are read-only logged items — no edit dialog available.
  const openEditor = (a: Activity) => {
    if (a.source.kind === 'task')         setEditTask(a.source.row);
    else if (a.source.kind === 'meeting') setEditMeeting(a.source.row);
    else if (a.source.kind === 'call')    setEditCall(a.source.row);
    // note / email — no edit dialog; clicking them is a no-op for now
  };

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

  useEffect(() => {
    if (!orgId) return;
    const offMeetings = onMeetingsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    const offCalls    = onCallsChanged((o) => { if (o === orgId) setReloadKey((k) => k + 1); });
    return () => { offMeetings(); offCalls(); };
  }, [orgId]);

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
    <div className={bounded ? 'max-w-7xl mx-auto space-y-4' : 'space-y-4'}>
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
        <span className="text-xs text-muted-foreground">
          {filtered.filter((a) => a.open && isToday(a.whenAt)).length} due today · {filtered.filter((a) => a.open && a.overdue).length} overdue
        </span>

        {/* Four view modes:
              status   — drag-droppable Not Started / In Progress / Done /
                         Cancelled. Default — most intuitive for reps
                         actually working through their queue.
              kind     — Tasks / Meetings / Calls columns. "Show me every
                         meeting on my plate" / "every call this week".
              category — Customers / Open Deals / Leads-Contacts / Others.
                         Zoho-style entity grouping.
              list     — sortable flat table. */}
        <div className="ml-auto inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${viewMode === 'timeline' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
            title="Timeline (chronological unified feed)"
          >
            <Clock className="w-3.5 h-3.5" /> Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode('status')}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${viewMode === 'status' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
            title="Status board (drag to change status)"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Status
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kind')}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${viewMode === 'kind' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
            title="Group by Tasks / Meetings / Calls"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Kind
          </button>
          <button
            type="button"
            onClick={() => setViewMode('category')}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${viewMode === 'category' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
            title="Group by linked entity (Customer / Deal / Lead)"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Category
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${viewMode === 'list' ? 'bg-muted' : 'opacity-60 hover:opacity-100'}`}
            title="List view"
          >
            <List className="w-3.5 h-3.5" /> List
          </button>
        </div>
      </div>

      {/* Quick-log composer — hub use, no fixed entity (user picks client/lead). */}
      {viewMode === 'timeline' && (
        <QuickLogComposer onPosted={() => setReloadKey((k) => k + 1)} />
      )}

      {loading ? (
        <div className="rounded-md border p-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading activities…
        </div>
      ) : viewMode === 'timeline' ? (
        <ActivitiesTimeline activities={filtered} onOpen={openEditor} />
      ) : viewMode === 'status' ? (
        <ActivitiesStatusKanban
          activities={filtered}
          onSelect={openEditor}
          onChanged={onAnyCreated}
        />
      ) : viewMode === 'kind' ? (
        <ActivitiesKindKanban activities={filtered} onSelect={openEditor} />
      ) : viewMode === 'category' ? (
        <ActivitiesKanban activities={filtered} onSelect={openEditor} />
      ) : (
        <ActivitiesList activities={filtered} onSelect={openEditor} />
      )}

      {/* Create dialogs (blank state). */}
      <CreateTaskDialog open={taskOpen} onOpenChange={setTaskOpen} onCreated={onAnyCreated} />
      <CreateMeetingDialog open={meetingOpen} onOpenChange={setMeetingOpen} onCreated={onAnyCreated} />
      <CreateCallDialog open={callOpen} onOpenChange={setCallOpen} onCreated={onAnyCreated} />
      {/* Edit dialogs (prefilled with the clicked row). Same components
          as the create flow — the editX prop flips them into edit mode. */}
      <CreateTaskDialog
        open={!!editTask}
        onOpenChange={(o) => { if (!o) { setEditTask(null); onAnyCreated(); } }}
        editTask={editTask}
      />
      <CreateMeetingDialog
        open={!!editMeeting}
        onOpenChange={(o) => { if (!o) { setEditMeeting(null); onAnyCreated(); } }}
        editMeeting={editMeeting}
      />
      <CreateCallDialog
        open={!!editCall}
        onOpenChange={(o) => { if (!o) { setEditCall(null); onAnyCreated(); } }}
        editCall={editCall}
      />
    </div>
  );
};
