import React, { useMemo, useState } from 'react';
import { Plus, Loader2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  useCrmDeals, useCrmDealStages, useCrmContacts, useCrmCompanies,
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

const fmtCurrency = (n: number) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  } catch { return `$${n.toFixed(0)}`; }
};

const DealCard: React.FC<{
  deal: CrmDeal;
  contactName: string | null;
  companyName: string | null;
}> = ({ deal, contactName, companyName }) => {
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
          <div className="font-medium text-sm text-foreground truncate">{deal.name}</div>
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

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const dealsByStage = useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    for (const s of stages) map.set(s.id, []);
    for (const d of deals) map.get(d.stageId)?.push(d);
    return map;
  }, [deals, stages]);

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
      toast.error(err instanceof Error ? err.message : 'Could not create deal');
    } finally {
      setBusy(false);
    }
  };

  const loading = dealsLoading || stagesLoading;

  return (
    <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-background">
      <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-between gap-4 flex-wrap border-b border-border">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Drag a card to move it between stages.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={stages.length === 0}>
          <Plus className="w-4 h-4 mr-2" /> New deal
        </Button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : stages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No pipeline stages. (Default stages are seeded automatically.)
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-6">
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
      )}

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
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
