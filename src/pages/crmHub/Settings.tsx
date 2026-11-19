import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2, Save, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { CurrencySelect } from '@/components/ui/currency-select';
import { useCrmDealStages } from '@/hooks/useCrmHub';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  createDealStage, updateDealStage, deleteDealStage,
} from '@/services/supabase/crmHub/dealStages';
import type { CrmDealStage, DealStatus } from '@/types/crmHub';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import type { StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** One settings box: a titled, bordered section. The column is capped, not centred. */
const SettingsSection: React.FC<{
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
    <div className="flex min-h-11 flex-col justify-center border-b border-border px-4 py-2.5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-1 text-pretty text-xs text-muted-foreground">{description}</p>}
    </div>
    {children}
  </section>
);

export const CrmSettingsPage: React.FC = () => {
  const { selected } = useSelectedWorkspace();

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="CRM settings"
          description={
            <>
              Pipeline stages and CRM defaults for{' '}
              <span className="font-medium text-foreground">{selected?.name ?? 'this workspace'}</span>.
            </>
          }
        />

        <Tabs defaultValue="general">
          <div className="overflow-x-auto overflow-y-hidden">
            <TabsList className="flex w-max min-w-full">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="pipeline">Pipeline stages</TabsTrigger>
              <TabsTrigger value="workspace">Workspace</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="general"><GeneralSettings /></TabsContent>
          <TabsContent value="pipeline"><PipelineSettings /></TabsContent>
          <TabsContent value="workspace"><WorkspaceSettings /></TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

const STATUS_OPTIONS: DealStatus[] = ['open', 'won', 'lost'];

const STAGE_STATUS_LABEL: Record<DealStatus, string> = { open: 'Open', won: 'Won', lost: 'Lost' };
const STAGE_STATUS_TONE: Record<DealStatus, StatusTone> = { open: 'neutral', won: 'success', lost: 'danger' };

const GeneralSettings: React.FC = () => {
  const { code, loading, setCurrency, format } = useCrmCurrency();
  const [busy, setBusy] = useState(false);

  const handleChange = async (next: string) => {
    setBusy(true);
    try {
      await setCurrency(next);
      toast.success(`Currency changed to ${next} everywhere`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="General">
      <div className="p-4">
        <div className="grid max-w-md gap-1.5">
          <Label htmlFor="crm-currency">Company currency</Label>
          <CurrencySelect
            id="crm-currency"
            value={code}
            onValueChange={(v) => void handleChange(v)}
            disabled={loading || busy}
            showLabels
          />
          <p className="text-xs text-muted-foreground">
            One currency for the whole company. Changing it here also changes it in HR, payroll,
            expenses and contracts. Preview: <span className="tabular-nums">{format(1234567)}</span>
          </p>
        </div>
      </div>
    </SettingsSection>
  );
};

const PipelineSettings: React.FC = () => {
  const { organization } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const { items: stages, loading, refresh } = useCrmDealStages();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CrmDealStage | null>(null);

  const [drafts, setDrafts] = useState<Record<string, { name: string; probability: number; status: DealStatus }>>({});

  useEffect(() => {
    const d: Record<string, { name: string; probability: number; status: DealStatus }> = {};
    for (const s of stages) d[s.id] = { name: s.name, probability: s.probability, status: s.status };
    setDrafts(d);
  }, [stages]);

  const handleAdd = async () => {
    if (!organization || !selected || !newName.trim()) return;
    setBusy(true);
    try {
      const sortOrder = (stages.length ? Math.max(...stages.map((s) => s.sortOrder)) : 0) + 1;
      await createDealStage(organization.organizationId, selected.workspaceId, { name: newName.trim(), sortOrder });
      toast.success('Stage added');
      setNewName('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add stage');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (stage: CrmDealStage) => {
    const d = drafts[stage.id];
    if (!d) return;
    if (d.name === stage.name && d.probability === stage.probability && d.status === stage.status) return;
    setBusy(true);
    try {
      await updateDealStage(stage.id, { name: d.name, probability: d.probability, status: d.status });
      toast.success('Stage updated');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save stage');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (stage: CrmDealStage) => {
    setBusy(true);
    try {
      await deleteDealStage(stage.id);
      toast.success('Stage removed');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete stage');
    } finally {
      setBusy(false);
    }
  };

  const handleReorder = async (stage: CrmDealStage, direction: -1 | 1) => {
    const idx = stages.findIndex((s) => s.id === stage.id);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= stages.length) return;
    const target = stages[targetIdx];
    setBusy(true);
    try {
      await Promise.all([
        updateDealStage(stage.id, { sortOrder: target.sortOrder }),
        updateDealStage(target.id, { sortOrder: stage.sortOrder }),
      ]);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Pipeline stages"
      description="Each stage has a chance of winning (%), which is used for the forecast. A stage marked Won or Lost closes the deal."
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading stages…
        </div>
      ) : (
        <>
          {stages.map((s, i) => {
            const d = drafts[s.id] ?? { name: s.name, probability: s.probability, status: s.status };
            const changed = d.name !== s.name || d.probability !== s.probability || d.status !== s.status;
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5"
              >
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    onClick={() => void handleReorder(s, -1)}
                    disabled={busy || i === 0}
                    title="Move up"
                    aria-label={`Move ${s.name} up`}
                  >
                    <ChevronUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    onClick={() => void handleReorder(s, 1)}
                    disabled={busy || i === stages.length - 1}
                    title="Move down"
                    aria-label={`Move ${s.name} down`}
                  >
                    <ChevronDown aria-hidden />
                  </Button>
                </div>
                <Input
                  className="w-56 max-w-full"
                  value={d.name}
                  onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, name: e.target.value } })}
                  disabled={busy}
                  aria-label="Stage name"
                />
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`stage-chance-${s.id}`} className="text-xs font-normal text-muted-foreground">
                    Chance of winning
                  </Label>
                  <Input
                    id={`stage-chance-${s.id}`}
                    type="number"
                    min={0}
                    max={100}
                    className="w-20 tabular-nums"
                    value={d.probability}
                    onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, probability: Number(e.target.value) || 0 } })}
                    disabled={busy}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Select value={d.status} onValueChange={(v) => setDrafts({ ...drafts, [s.id]: { ...d, status: v as DealStatus } })} disabled={busy}>
                  <SelectTrigger className="w-28" aria-label={`What ${s.name} means for a deal`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((st) => (
                      <SelectItem key={st} value={st}>{STAGE_STATUS_LABEL[st]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <StatusPill tone={STAGE_STATUS_TONE[s.status]}>{STAGE_STATUS_LABEL[s.status]}</StatusPill>
                <div className="ml-auto flex items-center gap-1">
                  {changed && (
                    <Button onClick={() => void handleSave(s)} disabled={busy || !d.name.trim()}>
                      <Save aria-hidden />
                      Save
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                    onClick={() => setConfirmDelete(s)}
                    disabled={busy}
                    title="Delete stage"
                    aria-label={`Delete stage ${s.name}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
          {stages.length === 0 && (
            <div className="border-b border-border/60 px-4 py-8 text-center">
              <p className="text-sm font-medium">No pipeline stages yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Add your first one below.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 bg-surface-2 px-4 py-3">
            <Input
              className="min-w-0 flex-1 basis-48"
              placeholder="New stage name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
              aria-label="New stage name"
            />
            <Button onClick={handleAdd} disabled={busy || !newName.trim()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              Add stage
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Deals in this stage will need to be reassigned. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => confirmDelete && void handleDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
};

const WorkspaceSettings: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  const { selected } = useSelectedWorkspace();
  return (
    <SettingsSection title="Workspace">
      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Workspace name</p>
          <p className="mt-1 text-sm font-medium text-foreground">{selected?.name ?? 'Not selected'}</p>
        </div>
        <p className="text-pretty text-xs text-muted-foreground">
          This CRM, its pipeline stages, currency, leads, companies, deals and follow-ups belong to{' '}
          <span className="font-medium text-foreground">{selected?.name}</span>. Organization settings for{' '}
          <span className="font-medium text-foreground">{organization?.name}</span> live under{' '}
          <Link to="/settings" className="text-primary hover:underline">Settings</Link>
          {canManageSettings ? '.' : ' (owner and admins only).'}
        </p>
      </div>
    </SettingsSection>
  );
};

export default CrmSettingsPage;
