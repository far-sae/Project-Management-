import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Save, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { CURRENCIES, type CurrencyCode } from '@/lib/crmCurrency';
import { useCrmDealStages } from '@/hooks/useCrmHub';
import {
  createDealStage, updateDealStage, deleteDealStage,
} from '@/services/supabase/crmHub/dealStages';
import type { CrmDealStage, DealStatus } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export const CrmSettingsPage: React.FC = () => {
  const { organization } = useOrganization();

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">CRM Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure your pipeline and CRM defaults for <strong>{organization?.name ?? 'this workspace'}</strong>.
          </p>
        </div>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="mt-4"><GeneralSettings /></TabsContent>
          <TabsContent value="pipeline" className="mt-4"><PipelineSettings /></TabsContent>
          <TabsContent value="workspace" className="mt-4"><WorkspaceSettings /></TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

const STATUS_OPTIONS: DealStatus[] = ['open', 'won', 'lost'];

const GeneralSettings: React.FC = () => {
  const { code, loading, setCurrency, format } = useCrmCurrency();
  const [busy, setBusy] = useState(false);

  const handleChange = async (next: CurrencyCode) => {
    setBusy(true);
    try {
      await setCurrency(next);
      toast.success('Currency updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5 max-w-md">
          <Label>Currency</Label>
          <Select value={code} onValueChange={(v) => void handleChange(v as CurrencyCode)} disabled={loading || busy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.symbol} · {c.code} · {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Applies to every money amount in the CRM (deals, dashboards, reports, company revenue).
            Preview: {format(1234567)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

const PipelineSettings: React.FC = () => {
  const { organization } = useOrganization();
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
    if (!organization || !newName.trim()) return;
    setBusy(true);
    try {
      const sortOrder = (stages.length ? Math.max(...stages.map((s) => s.sortOrder)) : 0) + 1;
      await createDealStage(organization.organizationId, { name: newName.trim(), sortOrder });
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline stages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" /></div>
        ) : (
          <>
            {stages.map((s, i) => {
              const d = drafts[s.id] ?? { name: s.name, probability: s.probability, status: s.status };
              const changed = d.name !== s.name || d.probability !== s.probability || d.status !== s.status;
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => void handleReorder(s, -1)}
                      disabled={busy || i === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs"
                      title="Move up"
                    >▲</button>
                    <span className="text-muted-foreground"><GripVertical className="w-3 h-3" /></span>
                    <button
                      type="button"
                      onClick={() => void handleReorder(s, 1)}
                      disabled={busy || i === stages.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs"
                      title="Move down"
                    >▼</button>
                  </div>
                  <Input
                    className="w-56"
                    value={d.name}
                    onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, name: e.target.value } })}
                    disabled={busy}
                  />
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Prob.</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="w-20"
                      value={d.probability}
                      onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, probability: Number(e.target.value) || 0 } })}
                      disabled={busy}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <Select value={d.status} onValueChange={(v) => setDrafts({ ...drafts, [s.id]: { ...d, status: v as DealStatus } })} disabled={busy}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((st) => (
                        <SelectItem key={st} value={st} className="capitalize">{st}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className="capitalize">{s.status}</Badge>
                  <div className="ml-auto flex items-center gap-1">
                    {changed && (
                      <Button size="sm" onClick={() => void handleSave(s)} disabled={busy || !d.name.trim()}>
                        <Save className="w-4 h-4 mr-1" />Save
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setConfirmDelete(s)} disabled={busy}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {stages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No pipeline stages yet. Add your first one below.
              </p>
            )}
            <div className="flex gap-2 pt-2 border-t border-border">
              <Input
                placeholder="New stage name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
              />
              <Button onClick={handleAdd} disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                Add stage
              </Button>
            </div>
          </>
        )}
      </CardContent>

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
    </Card>
  );
};

const WorkspaceSettings: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <Label>Organization name</Label>
          <p className="text-sm mt-1">{organization?.name ?? '—'}</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Organization-level settings (name, members, plan) live in the main app under <a href="/settings" className="text-primary hover:underline">Settings</a>
          {canManageSettings ? '' : ' — owner/admin only.'}
        </div>
      </CardContent>
    </Card>
  );
};

export default CrmSettingsPage;
