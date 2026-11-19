import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import {
  useCrmDeals, useCrmDealStages, useCrmContacts, useCrmCompanies, useWorkspaceForCreate,
} from '@/hooks/useCrmHub';
import { useDealMoney, type DealMoneyTools } from '@/hooks/useDealMoney';
import { currencyNotSaved } from '@/lib/crmDealMoney';
import { createDeal } from '@/services/supabase/crmHub/deals';
import { dealBadge, dealNeedsHandoff, leadName, weightedDealValue } from '@/lib/crmFlow';
import type { CrmDeal, CrmDealStage } from '@/types/crmHub';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { useDealMove } from '@/components/crmHub/useDealMove';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const NONE = '__none__';

const DealCard: React.FC<{
  deal: CrmDeal;
  contactName: string | null;
  companyName: string | null;
  money: DealMoneyTools;
  onHandoff: (deal: CrmDeal) => void;
}> = ({ deal, contactName, companyName, money, onHandoff }) => {
  const converted = money.formatDealConverted(deal);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : {};
  const needsHandoff = dealNeedsHandoff(deal);
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-handoff={needsHandoff || undefined}
      className={cn(
        'rounded-lg border bg-card p-2.5 transition-colors',
        needsHandoff ? 'border-warning/50' : 'border-border hover:border-foreground/25',
        isDragging && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          {...listeners}
          {...attributes}
          className="-ml-1 mt-0.5 cursor-grab rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag ${deal.name}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            to={`/crm/deals/${deal.id}`}
            className="block truncate text-sm font-medium text-foreground hover:underline"
          >
            {deal.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <span className="text-sm font-semibold">{money.formatDeal(deal)}</span>
            {converted && <span className="text-xs text-muted-foreground">{converted}</span>}
          </div>
          {(companyName || contactName) && (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {[companyName, contactName].filter(Boolean).join(' · ')}
            </div>
          )}
          {deal.status === 'lost' && deal.lostReason && (
            <div className="mt-1 truncate text-xs text-muted-foreground" title={deal.lostReason}>
              Lost: {deal.lostReason}
            </div>
          )}
          {deal.status === 'won' && (
            <div className="mt-2 flex items-center justify-between gap-2">
              {deal.projectId ? (
                <Link to={`/project/${deal.projectId}`} className="text-xs font-medium text-foreground hover:underline">
                  Open project
                </Link>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onHandoff(deal)}>
                  Hand off to project
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StageColumn: React.FC<{
  stage: CrmDealStage;
  deals: CrmDeal[];
  contactById: Map<string, string>;
  companyById: Map<string, string>;
  money: DealMoneyTools;
  onHandoff: (deal: CrmDeal) => void;
}> = ({ stage, deals, contactById, companyById, money, onHandoff }) => {
  const { format: fmtCurrency } = useCrmCurrency();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // Deals can be in different currencies; the column adds up in the company currency.
  const totalValue = deals.reduce((sum, d) => sum + money.inCompany(d), 0);
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      data-stage-status={stage.status}
      className={cn(
        'flex min-w-56 max-w-80 flex-1 flex-col rounded-lg border bg-secondary/40',
        isOver ? 'border-foreground/40 bg-secondary' : 'border-border',
      )}
    >
      <header className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <span
              aria-hidden
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                stage.status === 'won' ? 'bg-success' : stage.status === 'lost' ? 'bg-destructive' : 'bg-muted-foreground/50',
              )}
            />
            <span className="truncate">{stage.name}</span>
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{deals.length}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
          <span>{fmtCurrency(totalValue)}</span>
          {stage.status === 'open' && <span>{stage.probability}% chance</span>}
        </div>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {deals.map((d) => (
          <DealCard
            key={d.id}
            deal={d}
            contactName={d.contactId ? contactById.get(d.contactId) ?? null : null}
            companyName={d.companyId ? companyById.get(d.companyId) ?? null : null}
            money={money}
            onHandoff={onHandoff}
          />
        ))}
        {deals.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {stage.status === 'won' ? 'Drop a deal here when it is won' : stage.status === 'lost' ? 'Drop a deal here when it is lost' : 'No deals'}
          </div>
        )}
      </div>
    </section>
  );
};

export const CrmDealsPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: deals, loading: dealsLoading, refresh: refreshDeals } = useCrmDeals();
  const { items: stages, loading: stagesLoading } = useCrmDealStages();
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { format: fmtCurrency } = useCrmCurrency();
  // Read once here and handed down, so the board does not look up rates once per card.
  const money = useDealMoney();
  const { companyCurrency, allInCompany } = money;
  const workspaceId = useWorkspaceForCreate();
  const { requestMove, openHandoff, dialogs } = useDealMove({ stages, onChanged: refreshDeals });

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'won' | 'lost'>('all');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(companyCurrency);
  const [stageId, setStageId] = useState('');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, leadName(c)])), [contacts]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const filteredDeals = useMemo(
    () => deals.filter((d) => statusFilter === 'all' || d.status === statusFilter),
    [deals, statusFilter],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    for (const s of stages) map.set(s.id, []);
    for (const d of filteredDeals) map.get(d.stageId)?.push(d);
    return map;
  }, [filteredDeals, stages]);

  const stats = useMemo(() => {
    // Every figure is in the company currency, whatever currency each deal is in.
    const converted = allInCompany(deals);
    const open = converted.filter((d) => d.status === 'open');
    const won = converted.filter((d) => d.status === 'won');
    return {
      openCount: open.length,
      openValue: open.reduce((s, d) => s + d.value, 0),
      forecast: open.reduce((s, d) => s + weightedDealValue(d, stageById), 0),
      wonValue: won.reduce((s, d) => s + d.value, 0),
      wonCount: won.length,
      needHandoff: won.filter(dealNeedsHandoff).length,
    };
  }, [deals, stageById, allInCompany]);

  const handleDragEnd = (e: DragEndEvent) => {
    const deal = deals.find((d) => d.id === String(e.active.id));
    if (deal && e.over) requestMove(deal, String(e.over.id));
  };

  const openCreate = () => {
    setName(''); setValue(''); setContactId(''); setCompanyId('');
    setCurrency(companyCurrency);
    setStageId(stages.find((s) => s.status === 'open')?.id ?? '');
    setShowCreate(true);
  };

  const handleCreate = async () => {
    const stage = stageById.get(stageId);
    if (!organization || !name.trim() || !stage) return;
    setBusy(true);
    try {
      const deal = await createDeal(
        {
          organizationId: organization.organizationId,
          workspaceId,
          name: name.trim(),
          stageId,
          value: Number(value) || 0,
          currency: currency || companyCurrency,
          probability: stage.probability,
          status: stage.status,
          contactId: contactId || null,
          companyId: companyId || null,
        },
        user?.userId ?? null,
      );
      if (currencyNotSaved(currency, deal, companyCurrency)) {
        toast.warning(`Saved, but in ${companyCurrency}. This database cannot keep a deal in another currency until migration 182 has been run.`);
      } else {
        toast.success('Deal created');
      }
      setShowCreate(false);
      await refreshDeals();
      if (dealNeedsHandoff(deal)) openHandoff(deal);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the deal');
    } finally {
      setBusy(false);
    }
  };

  const loading = dealsLoading || stagesLoading;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-col gap-6 px-4 pt-6 lg:px-6">
        <PageHeader
          title="Deals"
          description="Drag a deal from stage to stage. Dropping it on Won starts the hand-off to a project; Lost asks why."
          actions={
            <Button onClick={openCreate} disabled={stages.length === 0}>
              <Plus /> New deal
            </Button>
          }
        />
        <StatStrip
          items={[
            { label: 'Open pipeline', value: fmtCurrency(stats.openValue), note: `${stats.openCount} open deal${stats.openCount === 1 ? '' : 's'}` },
            { label: 'Forecast', value: fmtCurrency(stats.forecast), note: 'Value × chance of winning' },
            { label: 'Won', value: fmtCurrency(stats.wonValue), note: `${stats.wonCount} deal${stats.wonCount === 1 ? '' : 's'}`, tone: 'success' },
            {
              label: 'Waiting for hand-off',
              value: stats.needHandoff,
              note: stats.needHandoff === 0 ? 'Every won deal has a project' : 'Won, but no project yet',
              tone: stats.needHandoff > 0 ? 'danger' : 'muted',
            },
          ]}
        />
      </div>

      {loading && deals.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : stages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>This pipeline has no stages yet.</p>
          <Button asChild variant="outline">
            <Link to="/crm/settings">Set up the pipeline</Link>
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="board" className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-2 px-4 lg:px-6">
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="mb-1.5 w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All deals</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TabsContent value="board" className="m-0 min-h-0 flex-1">
            <div className="h-full overflow-x-auto overflow-y-hidden px-4 py-4 lg:px-6">
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="flex h-full min-h-full gap-3">
                  {stages.map((stage) => (
                    <StageColumn
                      key={stage.id}
                      stage={stage}
                      deals={dealsByStage.get(stage.id) ?? []}
                      contactById={contactById}
                      companyById={companyById}
                      money={money}
                      onHandoff={openHandoff}
                    />
                  ))}
                </div>
              </DndContext>
            </div>
          </TabsContent>

          <TabsContent value="list" className="m-0 min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 py-4 lg:px-6">
              {filteredDeals.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No deals match this filter.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Deal</th>
                        <th className="px-3 py-2 text-left font-medium">Company</th>
                        <th className="px-3 py-2 text-left font-medium">Lead</th>
                        <th className="px-3 py-2 text-right font-medium">Value</th>
                        <th className="px-3 py-2 text-right font-medium">Chance</th>
                        <th className="px-3 py-2 text-left font-medium">Stage</th>
                        <th className="px-3 py-2 text-left font-medium">Expected close</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDeals.map((d) => {
                        const badge = dealBadge(d);
                        const converted = money.formatDealConverted(d);
                        return (
                          <tr key={d.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                            <td className="px-3 py-2">
                              <Link to={`/crm/deals/${d.id}`} className="font-medium text-foreground hover:underline">
                                {d.name}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {d.companyId ? companyById.get(d.companyId) ?? '—' : '—'}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {d.contactId ? contactById.get(d.contactId) ?? '—' : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              <span className="font-medium">{money.formatDeal(d)}</span>
                              {converted && <span className="block text-xs text-muted-foreground">{converted}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {d.status === 'open' ? `${d.probability || stageById.get(d.stageId)?.probability || 0}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{stageById.get(d.stageId)?.name ?? '—'}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={showCreate} onOpenChange={(o) => !busy && setShowCreate(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
            <DialogDescription>
              Usually a deal starts from a lead: open the lead and choose “Convert to deal”. Use this for a deal with no lead yet.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dname">Deal name</Label>
              <Input id="dname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dval">Value</Label>
                <Input id="dval" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dcur">Currency</Label>
                {/* A currency that is not in the list still shows, as the placeholder. */}
                <CurrencySelect
                  id="dcur"
                  value={COMMON_CURRENCIES.includes(currency) ? currency : ''}
                  placeholder={currency}
                  onValueChange={setCurrency}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Stage</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Pick a stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Company</Label>
              <Select value={companyId || NONE} onValueChange={(v) => setCompanyId(v === NONE ? '' : v)} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No company</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Lead</Label>
              <Select value={contactId || NONE} onValueChange={(v) => setContactId(v === NONE ? '' : v)} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No lead</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{leadName(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim() || !stageId}>
              {busy && <Loader2 className="animate-spin" />} Create deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialogs}
    </main>
  );
};

export default CrmDealsPage;
