import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Upload, LayoutGrid, List, TrendingUp, Loader2, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDeals } from '@/hooks/useDeals';
import { useClients } from '@/hooks/useClients';
import { useContacts } from '@/hooks/useContacts';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { DealsKanban } from '@/components/clients/DealsKanban';
import { DealFormDialog } from '@/components/deals/DealFormDialog';
import { DEAL_STAGES, DealStage } from '@/services/supabase/deals';
import { toast } from 'sonner';

type ViewMode = 'kanban' | 'list';

const fmtMoney = (v: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString()}`;
  }
};

const fmtDate = (d: Date | null | undefined) => {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Zoho-style dedicated Deals page. Empty state CTA when no deals, kanban
 * "STAGEVIEW" by default once deals exist, list view as an alternative.
 * Clicking a deal navigates to /dashboard/deals/:dealId for the full detail
 * page.
 */
const Deals: React.FC = () => {
  const navigate = useNavigate();
  const { deals, analytics, loading, canManage } = useDeals();
  const { clients } = useClients();
  const { contacts } = useContacts();
  const orgCurrency = useOrgCurrency();

  const [view, setView] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | DealStage>('all');
  const [openCreate, setOpenCreate] = useState(false);

  const filtered = useMemo(() => {
    let rows = deals;
    if (stageFilter !== 'all') rows = rows.filter((d) => d.stage === stageFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => {
        const hay = [
          d.title, d.clientName, d.ownerName, d.dealType, d.nextStep,
          d.leadSource, d.campaignSource,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [deals, stageFilter, search]);

  const hasAnyDeal = deals.length > 0;

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!hasAnyDeal) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-md text-center space-y-5">
          <h1 className="text-2xl font-semibold">How do you monitor your sales?</h1>
          <ul className="space-y-2 text-left mx-auto inline-block">
            <li className="text-sm flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5">›</span>
              <span>Define your sales cycle <span className="text-primary">- Configure Stages</span></span>
            </li>
            <li className="text-sm flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5">›</span>
              <span>Track your sales pipeline <span className="text-primary">- Create Dashboard</span></span>
            </li>
          </ul>
          <div className="flex items-center gap-3 justify-center pt-2">
            {canManage && (
              <Button onClick={() => setOpenCreate(true)}>Create a Deal</Button>
            )}
            <span className="text-sm text-muted-foreground">or</span>
            <Button
              variant="outline"
              onClick={() => toast.info('Import flow coming soon — for now create deals individually.')}
            >
              Import Deals
            </Button>
          </div>
        </div>

        <div className="mt-10 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500/15 via-cyan-500/15 to-blue-500/15 text-foreground">
          <TrendingUp className="w-4 h-4" /> <span className="font-semibold">Deals (Sales Pipeline)</span>
        </div>

        <DealFormDialog
          open={openCreate}
          onOpenChange={setOpenCreate}
          clients={clients}
          contacts={contacts}
        />
      </div>
    );
  }

  // ─── Header ──────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">All Deals</h1>
          <Badge variant="outline">{filtered.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56 hidden md:block">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals"
              className="pl-7 h-9"
            />
          </div>
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as typeof stageFilter)}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {DEAL_STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={view === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setView('list')}
              title="List view"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={view === 'kanban' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setView('kanban')}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>

          {canManage && (
            <Button onClick={() => setOpenCreate(true)} size="sm">
              <Plus className="w-3.5 h-3.5 mr-1" /> Create
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info('Import flow coming soon — for now create deals individually.')}
          >
            <Upload className="w-3.5 h-3.5 mr-1" /> Import
          </Button>
        </div>
      </div>

      {/* ─── STAGEVIEW (Kanban) ─────────────────────────────────────────── */}
      {view === 'kanban' && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <span className="uppercase font-semibold tracking-wide">STAGEVIEW</span>
            <span>·</span>
            <span>
              Weighted: <span className="font-semibold text-foreground tabular-nums">
                {fmtMoney(analytics.weightedOpenValue ?? 0, orgCurrency)}
              </span>
            </span>
          </div>
          <DealsKanban
            clients={clients}
            onSelectDeal={(d) => navigate(`/dashboard/deals/${d.dealId}`)}
          />
        </div>
      )}

      {/* ─── List view ──────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Deal Name</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium text-right">Probability</th>
                <th className="px-3 py-2 font-medium">Closing Date</th>
                <th className="px-3 py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                    No deals match your filters.
                  </td>
                </tr>
              ) : filtered.map((d) => {
                const stageMeta = DEAL_STAGES.find((s) => s.id === d.stage);
                return (
                  <tr
                    key={d.dealId}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/dashboard/deals/${d.dealId}`)}
                  >
                    <td className="px-3 py-2 font-medium">{d.title}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.clientName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: stageMeta?.color ?? '#999' }} />
                        {stageMeta?.label ?? d.stage}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.probability}%</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(d.expectedCloseDate)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{d.ownerName ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DealFormDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        clients={clients}
        contacts={contacts}
      />
    </div>
  );
};

export default Deals;
