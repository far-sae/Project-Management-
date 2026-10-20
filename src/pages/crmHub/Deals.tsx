import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, GripVertical, LayoutGrid, List } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  useCrmDeals, useCrmDealStages, useCrmContacts, useCrmCompanies, useWorkspaceForCreate,
} from '@/hooks/useCrmHub';
import { createDeal, moveDealToStage } from '@/services/supabase/crmHub/deals';
import type { CrmDeal, CrmDealStage } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { useCrmCurrency } from '@/context/CrmCurrencyContext';

const DealCard: React.FC<{
  deal: CrmDeal;
  contactName: string | null;
  companyName: string | null;
}> = ({ deal, contactName, companyName }) => {
  const { format: fmtCurrency } = useCrmCurrency();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, opacity: isDragging ? 0.5 : 1 }
    : {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-card p-3 shadow-sm hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start gap-2">
        <button
          {...listeners}
          {...attributes}
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing mt-0.5"
          aria-label="Drag deal"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link to={`/crm/deals/${deal.id}`} className="block">
            <div className="font-medium text-sm text-foreground truncate hover:text-primary">{deal.name}</div>
          </Link>
          <div className="text-xs text-primary font-semibold mt-1">{fmtCurrency(deal.value)}</div>
          {(companyName || contactName) && (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {[companyName, contactName].filter(Boolean).join(' · ')}
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
}> = ({ stage, deals, contactById, companyById }) => {
  const { format: fmtCurrency } = useCrmCurrency();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-lg border ${isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'} p-3 flex flex-col gap-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground truncate">{stage.name}</h3>
        <span className="text-xs text-muted-foreground shrink-0">{deals.length}</span>
      </div>
      <div className="text-xs text-muted-foreground">{fmtCurrency(totalValue)} total</div>
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto min-h-24">
        {deals.map((d) => (
          <DealCard
            key={d.id}
            deal={d}
            contactName={d.contactId ? contactById.get(d.contactId) ?? null : null}
            companyName={d.companyId ? companyById.get(d.companyId) ?? null : null}
          />
        ))}
        {deals.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">No deals</div>
        )}
      </div>
    </div>
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
  const workspaceId = useWorkspaceForCreate();

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'won' | 'lost'>('all');
  const [name, setName] = useState('');
  const [value, setValue] = useState('0');
  const [stageId, setStageId] = useState('');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName ?? ''}`.trim()])),
    [contacts],
  );
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

  const totalOpenValue = filteredDeals.filter((d) => d.status === 'open').reduce((s, d) => s + d.value, 0);
  const forecast = filteredDeals.filter((d) => d.status === 'open').reduce((s, d) => s + (d.value * d.probability) / 100, 0);

  const handleDragEnd = async (e: DragEndEvent) => {
    const dealId = String(e.active.id);
    const targetStageId = e.over ? String(e.over.id) : null;
    if (!targetStageId) return;
    const deal = deals.find((d) => d.id === dealId);
    const targetStage = stageById.get(targetStageId);
    if (!deal || !targetStage || deal.stageId === targetStageId) return;
    try {
      await moveDealToStage(dealId, targetStageId, targetStage.status, targetStage.name);
      await refreshDeals();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move deal');
    }
  };

  const resetForm = () => {
    setName(''); setValue('0'); setStageId(''); setContactId(''); setCompanyId('');
  };

  const handleCreate = async () => {
    if (!organization) return;
    if (!name.trim()) { toast.error('Deal name is required'); return; }
    if (!stageId) { toast.error('Pick a stage'); return; }
    setBusy(true);
    try {
      await createDeal(
        {
          organizationId: organization.organizationId,
          workspaceId,
          name: name.trim(),
          stageId,
          value: Number(value) || 0,
          contactId: contactId || null,
          companyId: companyId || null,
        },
        user?.userId ?? null,
      );
      toast.success('Deal created');
      resetForm();
      setShowCreate(false);
      await refreshDeals();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create contract');
    } finally {
      setBusy(false);
    }
  };

  const loading = dealsLoading || stagesLoading;

  return (
    <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-background">
      <div className="p-4 sm:p-6 flex items-center justify-between gap-4 flex-wrap border-b border-border">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pipeline {fmtCurrency(totalOpenValue)} · Forecast {fmtCurrency(forecast)}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={stages.length === 0}>
          <Plus className="w-4 h-4 mr-2" /> New contract
        </Button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : stages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <p>No pipeline stages yet.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/crm/settings">Set up pipeline</Link>
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="board" className="flex-1 flex flex-col min-h-0">
          <div className="px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap border-b border-border">
            <TabsList>
              <TabsTrigger value="board"><LayoutGrid className="w-4 h-4 mr-1.5" />Board</TabsTrigger>
              <TabsTrigger value="list"><List className="w-4 h-4 mr-1.5" />List</TabsTrigger>
            </TabsList>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TabsContent value="board" className="flex-1 min-h-0 m-0">
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-6 h-full">
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="flex gap-3 min-h-full">
                  {stages.map((stage) => (
                    <StageColumn
                      key={stage.id}
                      stage={stage}
                      deals={dealsByStage.get(stage.id) ?? []}
                      contactById={contactById}
                      companyById={companyById}
                    />
                  ))}
                </div>
              </DndContext>
            </div>
          </TabsContent>

          <TabsContent value="list" className="flex-1 min-h-0 m-0 overflow-y-auto">
            <div className="p-4 sm:p-6">
              {filteredDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No deals match the filter.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/40">
                        <th className="text-left py-2 px-3 font-medium">Deal</th>
                        <th className="text-left py-2 px-3 font-medium">Company</th>
                        <th className="text-left py-2 px-3 font-medium">Contact</th>
                        <th className="text-right py-2 px-3 font-medium">Value</th>
                        <th className="text-right py-2 px-3 font-medium">Prob.</th>
                        <th className="text-left py-2 px-3 font-medium">Stage</th>
                        <th className="text-left py-2 px-3 font-medium">Close</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDeals.map((d) => (
                        <tr key={d.id} className="border-b border-border/60 hover:bg-muted/40">
                          <td className="py-2 px-3">
                            <Link to={`/crm/deals/${d.id}`} className="font-medium text-foreground hover:text-primary">
                              {d.name}
                            </Link>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {d.companyId ? companyById.get(d.companyId) ?? '—' : '—'}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {d.contactId ? contactById.get(d.contactId) ?? '—' : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold">{fmtCurrency(d.value)}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{d.probability}%</td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {stageById.get(d.stageId)?.name ?? '—'}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2 px-3">
                            <Badge
                              variant={d.status === 'won' ? 'default' : d.status === 'lost' ? 'destructive' : 'secondary'}
                              className="capitalize"
                            >{d.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New contract</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="dname">Deal name *</Label>
              <Input id="dname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dval">Value</Label>
                <Input id="dval" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label>Stage *</Label>
                <Select value={stageId} onValueChange={setStageId} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="Pick a stage" /></SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Company</Label>
              <Select value={companyId || '__none__'} onValueChange={(v) => setCompanyId(v === '__none__' ? '' : v)} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="No company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Primary contact</Label>
              <Select value={contactId || '__none__'} onValueChange={(v) => setContactId(v === '__none__' ? '' : v)} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="No contact" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName ?? ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim() || !stageId}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default CrmDealsPage;
