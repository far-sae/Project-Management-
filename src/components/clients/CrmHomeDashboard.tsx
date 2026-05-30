import React, { useEffect, useMemo, useState } from 'react';
import { format, isToday, startOfMonth, endOfMonth, addDays, isBefore } from 'date-fns';
import {
  Plus, RefreshCw, ArrowUp, ArrowDown, Maximize2, Minimize2,
  ListTodo, Building2, Trophy, TrendingUp, Activity as ActivityIcon,
  Sparkles, GripVertical, ChevronDown, X, Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Client } from '@/services/supabase/clients';
import type { Deal } from '@/services/supabase/deals';
import { formatDealMoney } from '@/services/supabase/deals';
import { useClientTasks } from '@/hooks/useClientTasks';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

// ─── Widget catalog ───────────────────────────────────────────────────────

type WidgetType =
  | 'open_tasks'
  | 'todays_new_accounts'
  | 'closing_this_month'
  | 'this_week_tasks'
  | 'won_this_month'
  | 'top_accounts'
  | 'recent_accounts';

interface CatalogEntry {
  type: WidgetType;
  module: 'Activities' | 'Accounts' | 'Deals';
  defaultName: string;
  emptyHint: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATALOG: Record<WidgetType, CatalogEntry> = {
  open_tasks: {
    type: 'open_tasks',
    module: 'Activities',
    defaultName: 'Open Tasks',
    emptyHint: 'No tasks open right now.',
    icon: ListTodo,
  },
  todays_new_accounts: {
    type: 'todays_new_accounts',
    module: 'Accounts',
    defaultName: "Today's New Accounts",
    emptyHint: 'No accounts added today.',
    icon: Building2,
  },
  closing_this_month: {
    type: 'closing_this_month',
    module: 'Deals',
    defaultName: 'Closing This Month',
    emptyHint: 'No deals expected to close this month.',
    icon: TrendingUp,
  },
  this_week_tasks: {
    type: 'this_week_tasks',
    module: 'Activities',
    defaultName: 'This Week’s Tasks',
    emptyHint: 'No tasks due this week.',
    icon: ListTodo,
  },
  won_this_month: {
    type: 'won_this_month',
    module: 'Deals',
    defaultName: 'Won This Month',
    emptyHint: 'No deals won this month yet.',
    icon: Trophy,
  },
  top_accounts: {
    type: 'top_accounts',
    module: 'Accounts',
    defaultName: 'Top Accounts (by revenue)',
    emptyHint: 'No revenue data on any account yet.',
    icon: Building2,
  },
  recent_accounts: {
    type: 'recent_accounts',
    module: 'Accounts',
    defaultName: 'Recently Added Accounts',
    emptyHint: 'No accounts added recently.',
    icon: ActivityIcon,
  },
};

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w1', type: 'open_tasks', title: 'Open Tasks' },
  { id: 'w2', type: 'todays_new_accounts', title: "Today's New Accounts" },
  { id: 'w3', type: 'closing_this_month', title: 'Closing This Month' },
];

interface Widget {
  id: string;
  type: WidgetType;
  title: string;
}

// ─── Public layout component ──────────────────────────────────────────────

interface CrmHomeDashboardProps {
  clients: Client[];
  deals: Deal[];
  workspaceClientIds: Set<string> | null;
  workspaceName: string | null;
  displayCurrency: string;
  onOpenAccount: (c: Client) => void;
  onOpenDeal: (d: Deal) => void;
  onGoToTab: (tab: 'accounts' | 'pipeline' | 'tasks' | 'forecast') => void;
}

export const CrmHomeDashboard: React.FC<CrmHomeDashboardProps> = ({
  clients, deals, workspaceClientIds, workspaceName,
  displayCurrency, onOpenAccount, onOpenDeal, onGoToTab,
}) => {
  const { user } = useAuth();
  const storageKey = `pm_crm_home_widgets_${user?.userId ?? 'anon'}`;

  const [widgets, setWidgets] = useState<Widget[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // De-dupe by widget type on load so any historical layout with
          // accidental duplicates (e.g. two "Today's New Accounts") collapses
          // to a single instance on next render.
          const seen = new Set<string>();
          const unique = (parsed as Widget[]).filter((w) => {
            if (!w?.type || seen.has(w.type)) return false;
            seen.add(w.type);
            return true;
          });
          if (unique.length > 0) return unique;
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_WIDGETS;
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widgets)); }
    catch { /* ignore */ }
  }, [storageKey, widgets]);

  const [openAdd, setOpenAdd] = useState(false);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refreshAll = () => setNonce((n) => n + 1);

  const move = (id: string, delta: -1 | 1) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === id);
      if (idx < 0) return prev;
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const remove = (id: string) => setWidgets((prev) => prev.filter((w) => w.id !== id));
  const add = (w: Widget) => setWidgets((prev) => [...prev, w]);

  // ── Header ──────────────────────────────────────────────────────────────
  const headerName = user?.displayName?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 pb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Welcome
            </p>
            <h2 className="text-xl font-semibold mt-1">
              Welcome {headerName}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Your CRM Home for the
              <strong className="text-foreground"> {workspaceName ?? 'current'} </strong>
              workspace. Add widgets, jump to a tab, and pin the views you check every day.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll} title="Refresh all">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpenAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add component
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Layout <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onGoToTab('accounts')}>
                  Open Accounts list
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onGoToTab('pipeline')}>
                  Open Pipeline kanban
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onGoToTab('tasks')}>
                  Open Tasks tab
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onGoToTab('forecast')}>
                  Open Forecast
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setWidgets(DEFAULT_WIDGETS);
                  }}
                >
                  Reset to default
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <div
        className={cn(
          'grid gap-3',
          fullscreen ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2',
        )}
      >
        {widgets
          .filter((w) => !fullscreen || fullscreen === w.id)
          .map((w, i) => (
            <WidgetFrame
              key={w.id}
              widget={w}
              first={i === 0}
              last={i === widgets.length - 1}
              fullscreen={fullscreen === w.id}
              onMoveUp={() => move(w.id, -1)}
              onMoveDown={() => move(w.id, 1)}
              onRemove={() => remove(w.id)}
              onToggleFullscreen={() =>
                setFullscreen((cur) => (cur === w.id ? null : w.id))
              }
              onRefresh={() => setNonce((n) => n + 1)}
            >
              <WidgetBody
                key={`${w.id}-${nonce}`}
                type={w.type}
                clients={clients}
                deals={deals}
                workspaceClientIds={workspaceClientIds}
                displayCurrency={displayCurrency}
                onOpenAccount={onOpenAccount}
                onOpenDeal={onOpenDeal}
                onGoToTab={onGoToTab}
              />
            </WidgetFrame>
          ))}
      </div>

      <AddComponentDialog
        open={openAdd}
        onOpenChange={setOpenAdd}
        existing={widgets}
        onAdd={(w) => add(w)}
      />
    </div>
  );
};

// ─── Widget shell ─────────────────────────────────────────────────────────

const WidgetFrame: React.FC<{
  widget: Widget;
  first: boolean;
  last: boolean;
  fullscreen: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onToggleFullscreen: () => void;
  onRefresh: () => void;
  children: React.ReactNode;
}> = ({ widget, first, last, fullscreen, onMoveUp, onMoveDown, onRemove, onToggleFullscreen, onRefresh, children }) => {
  const Icon = CATALOG[widget.type].icon;
  return (
    <Card className={cn('flex flex-col', fullscreen && 'lg:row-span-2')}>
      <div className="px-4 pt-3 pb-2 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold truncate">{widget.title}</span>
          <Badge variant="outline" className="text-[9px]">{CATALOG[widget.type].module}</Badge>
        </div>
        <div className="flex items-center gap-0.5 opacity-80">
          <IconBtn title="Move up" disabled={first} onClick={onMoveUp}><ArrowUp className="w-3 h-3" /></IconBtn>
          <IconBtn title="Move down" disabled={last} onClick={onMoveDown}><ArrowDown className="w-3 h-3" /></IconBtn>
          <IconBtn title="Refresh" onClick={onRefresh}><RefreshCw className="w-3 h-3" /></IconBtn>
          <IconBtn title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullscreen}>
            {fullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </IconBtn>
          <IconBtn title="Remove" onClick={onRemove} tone="destructive"><X className="w-3 h-3" /></IconBtn>
        </div>
      </div>
      <CardContent className="pt-3 pb-3 flex-1 min-h-[160px]">
        {children}
      </CardContent>
    </Card>
  );
};

const IconBtn: React.FC<{
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'destructive';
}> = ({ children, title, onClick, disabled, tone }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'p-1 rounded hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent',
      tone === 'destructive' && 'hover:text-destructive hover:bg-destructive/10',
    )}
  >
    {children}
  </button>
);

// ─── Widget bodies ────────────────────────────────────────────────────────

interface BodyProps {
  type: WidgetType;
  clients: Client[];
  deals: Deal[];
  workspaceClientIds: Set<string> | null;
  displayCurrency: string;
  onOpenAccount: (c: Client) => void;
  onOpenDeal: (d: Deal) => void;
  /** Lets empty states offer a one-click jump to the relevant tab so the
   *  rep can create the missing data without hunting for it. */
  onGoToTab: (tab: 'accounts' | 'pipeline' | 'tasks' | 'forecast') => void;
}

const WidgetBody: React.FC<BodyProps> = (props) => {
  switch (props.type) {
    case 'open_tasks':         return <OpenTasksBody {...props} />;
    case 'this_week_tasks':    return <ThisWeekTasksBody {...props} />;
    case 'todays_new_accounts':return <TodaysNewAccountsBody {...props} />;
    case 'recent_accounts':    return <RecentAccountsBody {...props} />;
    case 'top_accounts':       return <TopAccountsBody {...props} />;
    case 'closing_this_month': return <ClosingThisMonthBody {...props} />;
    case 'won_this_month':     return <WonThisMonthBody {...props} />;
  }
};

const EmptyHint: React.FC<{
  message: string;
  /** Optional action — when supplied, the empty state offers a one-click
   *  way to fill the widget (e.g. "Add a task" → opens the Tasks tab). */
  actionLabel?: string;
  onAction?: () => void;
}> = ({ message, actionLabel, onAction }) => (
  <div className="h-full grid place-items-center text-center gap-2">
    <p className="text-sm text-muted-foreground">{message}</p>
    {actionLabel && onAction && (
      <Button size="sm" variant="outline" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

const OpenTasksBody: React.FC<BodyProps> = ({ workspaceClientIds, clients, onGoToTab }) => {
  const { tasks, loading } = useClientTasks();
  const visible = useMemo(() => {
    const inWs = workspaceClientIds
      ? tasks.filter((t) => !t.clientId || workspaceClientIds.has(t.clientId))
      : tasks;
    return inWs.filter((t) => t.status === 'pending').slice(0, 10);
  }, [tasks, workspaceClientIds]);
  if (loading) return <Loading />;
  if (visible.length === 0) {
    return (
      <EmptyHint
        message={CATALOG.open_tasks.emptyHint}
        actionLabel="Open Tasks tab"
        onAction={() => onGoToTab('tasks')}
      />
    );
  }
  return (
    <ul className="space-y-1">
      {visible.map((t) => {
        const client = t.clientId ? clients.find((c) => c.clientId === t.clientId) : null;
        const overdue = t.dueAt && isBefore(t.dueAt, new Date());
        return (
          <li key={t.taskId} className="flex items-center gap-2 text-sm py-1">
            <span className={cn('w-1.5 h-1.5 rounded-full', overdue ? 'bg-red-500' : 'bg-orange-400')} />
            <span className="flex-1 min-w-0 truncate">{t.title}</span>
            {client && (
              <span className="text-xs text-muted-foreground truncate max-w-[140px]">{client.name}</span>
            )}
            {t.dueAt && (
              <span className={cn('text-[11px] tabular-nums', overdue && 'text-red-500')}>
                {format(t.dueAt, 'MMM d')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const ThisWeekTasksBody: React.FC<BodyProps> = ({ workspaceClientIds, clients }) => {
  const { tasks, loading } = useClientTasks();
  const visible = useMemo(() => {
    const cutoff = addDays(new Date(), 7);
    const inWs = workspaceClientIds
      ? tasks.filter((t) => !t.clientId || workspaceClientIds.has(t.clientId))
      : tasks;
    return inWs
      .filter((t) => t.status === 'pending' && t.dueAt && isBefore(t.dueAt, cutoff))
      .slice(0, 10);
  }, [tasks, workspaceClientIds]);
  if (loading) return <Loading />;
  if (visible.length === 0) return <EmptyHint message={CATALOG.this_week_tasks.emptyHint} />;
  return (
    <ul className="space-y-1">
      {visible.map((t) => {
        const client = t.clientId ? clients.find((c) => c.clientId === t.clientId) : null;
        return (
          <li key={t.taskId} className="flex items-center gap-2 text-sm py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span className="flex-1 min-w-0 truncate">{t.title}</span>
            {client && <span className="text-xs text-muted-foreground truncate max-w-[140px]">{client.name}</span>}
            {t.dueAt && <span className="text-[11px] tabular-nums">{format(t.dueAt, 'EEE d')}</span>}
          </li>
        );
      })}
    </ul>
  );
};

const TodaysNewAccountsBody: React.FC<BodyProps> = ({ clients, onOpenAccount, onGoToTab }) => {
  const visible = useMemo(
    () => clients.filter((c) => isToday(c.createdAt)).slice(0, 10),
    [clients],
  );
  if (visible.length === 0) {
    return (
      <EmptyHint
        message={
          clients.length > 0
            ? `No accounts added today. You have ${clients.length} in total — switch this widget to "Recent Accounts" for the full list.`
            : CATALOG.todays_new_accounts.emptyHint
        }
        actionLabel={clients.length > 0 ? 'Open Accounts tab' : 'Add an account'}
        onAction={() => onGoToTab('accounts')}
      />
    );
  }
  return (
    <ul className="space-y-1">
      {visible.map((c) => (
        <li
          key={c.clientId}
          onClick={() => onOpenAccount(c)}
          className="flex items-center gap-2 text-sm py-1 hover:bg-muted/40 px-1 rounded cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
          <Badge variant="outline" className="text-[9px] capitalize">{c.type}</Badge>
        </li>
      ))}
    </ul>
  );
};

const RecentAccountsBody: React.FC<BodyProps> = ({ clients, onOpenAccount }) => {
  const visible = useMemo(
    () => [...clients].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10),
    [clients],
  );
  if (visible.length === 0) return <EmptyHint message={CATALOG.recent_accounts.emptyHint} />;
  return (
    <ul className="space-y-1">
      {visible.map((c) => (
        <li
          key={c.clientId}
          onClick={() => onOpenAccount(c)}
          className="flex items-center gap-2 text-sm py-1 hover:bg-muted/40 px-1 rounded cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
          <span className="text-[11px] text-muted-foreground">{format(c.createdAt, 'MMM d')}</span>
        </li>
      ))}
    </ul>
  );
};

const TopAccountsBody: React.FC<BodyProps> = ({ clients, onOpenAccount }) => {
  const visible = useMemo(
    () =>
      clients
        .filter((c) => c.annualRevenue != null && c.annualRevenue > 0)
        .sort((a, b) => (b.annualRevenue ?? 0) - (a.annualRevenue ?? 0))
        .slice(0, 10),
    [clients],
  );
  if (visible.length === 0) return <EmptyHint message={CATALOG.top_accounts.emptyHint} />;
  return (
    <ul className="space-y-1">
      {visible.map((c) => (
        <li
          key={c.clientId}
          onClick={() => onOpenAccount(c)}
          className="flex items-center gap-2 text-sm py-1 hover:bg-muted/40 px-1 rounded cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
          <span className="text-[11px] tabular-nums">
            {new Intl.NumberFormat(undefined, { notation: 'compact' }).format(c.annualRevenue ?? 0)}
          </span>
        </li>
      ))}
    </ul>
  );
};

const ClosingThisMonthBody: React.FC<BodyProps> = ({
  deals, workspaceClientIds, displayCurrency, onOpenDeal, onGoToTab,
}) => {
  const visible = useMemo(() => {
    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());
    const inWs = workspaceClientIds
      ? deals.filter((d) => !d.clientId || workspaceClientIds.has(d.clientId))
      : deals;
    return inWs
      .filter((d) => {
        const close = d.expectedCloseDate ?? null;
        if (!close) return false;
        return close >= start && close <= end;
      })
      .sort((a, b) => (a.expectedCloseDate?.getTime() ?? 0) - (b.expectedCloseDate?.getTime() ?? 0))
      .slice(0, 10);
  }, [deals, workspaceClientIds]);

  if (visible.length === 0) {
    return (
      <EmptyHint
        message={
          deals.length > 0
            ? `No deals closing this month. You have ${deals.length} open — check the Pipeline tab.`
            : CATALOG.closing_this_month.emptyHint
        }
        actionLabel="Open Pipeline"
        onAction={() => onGoToTab('pipeline')}
      />
    );
  }

  const total = visible.reduce((s, d) => s + d.value, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{visible.length} deal{visible.length === 1 ? '' : 's'}</span>
        <span className="tabular-nums">Total {formatDealMoney(total, displayCurrency)}</span>
      </div>
      <ul className="space-y-1">
        {visible.map((d) => (
          <li
            key={d.dealId}
            onClick={() => onOpenDeal(d)}
            className="flex items-center gap-2 text-sm py-1 hover:bg-muted/40 px-1 rounded cursor-pointer"
          >
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="flex-1 min-w-0 truncate font-medium">{d.title}</span>
            <span className="text-[11px] tabular-nums">{formatDealMoney(d.value, d.currency)}</span>
            {d.expectedCloseDate && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(d.expectedCloseDate, 'MMM d')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const WonThisMonthBody: React.FC<BodyProps> = ({
  deals, workspaceClientIds, displayCurrency, onOpenDeal,
}) => {
  const visible = useMemo(() => {
    const start = startOfMonth(new Date());
    const inWs = workspaceClientIds
      ? deals.filter((d) => !d.clientId || workspaceClientIds.has(d.clientId))
      : deals;
    return inWs
      .filter((d) => d.actualCloseDate && d.actualCloseDate >= start && (d.stage as string) === 'won')
      .sort((a, b) => (b.actualCloseDate?.getTime() ?? 0) - (a.actualCloseDate?.getTime() ?? 0))
      .slice(0, 10);
  }, [deals, workspaceClientIds]);
  if (visible.length === 0) return <EmptyHint message={CATALOG.won_this_month.emptyHint} />;
  const total = visible.reduce((s, d) => s + d.value, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{visible.length} won this month</span>
        <span className="tabular-nums">Total {formatDealMoney(total, displayCurrency)}</span>
      </div>
      <ul className="space-y-1">
        {visible.map((d) => (
          <li
            key={d.dealId}
            onClick={() => onOpenDeal(d)}
            className="flex items-center gap-2 text-sm py-1 hover:bg-muted/40 px-1 rounded cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5 text-emerald-500" />
            <span className="flex-1 min-w-0 truncate font-medium">{d.title}</span>
            <span className="text-[11px] tabular-nums">{formatDealMoney(d.value, d.currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Loading: React.FC = () => (
  <div className="h-full grid place-items-center text-muted-foreground">
    <Loader2 className="w-4 h-4 animate-spin" />
  </div>
);

// ─── Add Component dialog ─────────────────────────────────────────────────

const AddComponentDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Widget[];
  onAdd: (w: Widget) => void;
}> = ({ open, onOpenChange, existing, onAdd }) => {
  const [module, setModule] = useState<'Activities' | 'Accounts' | 'Deals'>('Activities');
  const [type, setType] = useState<WidgetType>('open_tasks');
  const [name, setName] = useState('');

  // Hide widget types already on the dashboard. Without this, reps would
  // double-add the same widget (e.g. two "Today's New Accounts" tiles) and
  // the duplicate would silently shadow the original.
  const existingTypes = useMemo(
    () => new Set(existing.map((w) => w.type)),
    [existing],
  );
  const choicesForModule = useMemo(
    () => Object.values(CATALOG).filter(
      (c) => c.module === module && !existingTypes.has(c.type),
    ),
    [module, existingTypes],
  );
  const noFreeChoices = choicesForModule.length === 0;

  useEffect(() => {
    if (!open) return;
    const first = choicesForModule[0];
    if (first) {
      setType(first.type);
      setName(first.defaultName);
    }
  }, [open, choicesForModule]);

  const handleSave = () => {
    const id = `w_${Date.now().toString(36)}`;
    onAdd({ id, type, title: name.trim() || CATALOG[type].defaultName });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Add component
          </DialogTitle>
          <DialogDescription>
            Pick a module and a view to pin on your CRM Home.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Select Module</Label>
            <Select value={module} onValueChange={(v) => setModule(v as typeof module)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Activities">Activities</SelectItem>
                <SelectItem value="Accounts">Accounts</SelectItem>
                <SelectItem value="Deals">Deals</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Custom View</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                const t = v as WidgetType;
                setType(t);
                setName(CATALOG[t].defaultName);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {choicesForModule.map((c) => (
                  <SelectItem key={c.type} value={c.type}>{c.defaultName}</SelectItem>
                ))}
                {noFreeChoices && (
                  <SelectItem value="__none__" disabled>
                    Every {module} widget is already on your home
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Component Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          {noFreeChoices && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              All {module} widgets are already on your dashboard. Pick a different module.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={noFreeChoices}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
