import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Pencil, Trash2, Loader2, StickyNote, ArrowRightCircle, Briefcase, Trophy, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  getDeal, updateDeal, deleteDeal, moveDealToStage,
} from '@/services/supabase/crmHub/deals';
import { getCompany } from '@/services/supabase/crmHub/companies';
import { getContact } from '@/services/supabase/crmHub/contacts';
import { listDealStages } from '@/services/supabase/crmHub/dealStages';
import { listActivities } from '@/services/supabase/crmHub/activities';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import type {
  CrmDeal, CrmDealStage, CrmActivity, CrmNote, CrmTask, CrmCompany, CrmContact,
} from '@/types/crmHub';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DealHandoffDialog } from '@/components/crmHub/DealHandoffDialog';

import { useCrmCurrency } from '@/context/CrmCurrencyContext';

export const CrmDealDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { format: fmtCurrency } = useCrmCurrency();

  const [deal, setDeal] = useState<CrmDeal | null>(null);
  const [stages, setStages] = useState<CrmDealStage[]>([]);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    setLoading(true);
    try {
      const d = await getDeal(id);
      if (!d) { setNotFound(true); return; }
      setDeal(d);
      const [stageRows, actRows, noteRows, taskRows] = await Promise.all([
        listDealStages(orgId),
        listActivities(orgId, { dealId: id, limit: 100 }),
        listNotes(orgId, { dealId: id }),
        listTasks(orgId, { dealId: id }),
      ]);
      setStages(stageRows);
      setActivities(actRows);
      setNotes(noteRows);
      setTasks(taskRows);
      setCompany(d.companyId ? await getCompany(d.companyId) : null);
      setContact(d.contactId ? await getContact(d.contactId) : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load deal');
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-deal-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `deal_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `deal_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `deal_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, body: noteBody.trim(), dealId: id }, user?.userId ?? null);
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveStage = async (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || !deal) return;
    setBusy(true);
    try {
      await moveDealToStage(deal.id, stageId, stage.status, stage.name);
      toast.success(`Moved to ${stage.name}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteDeal(id);
      toast.success('Deal deleted');
      navigate('/crm/deals');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
      setBusy(false);
    }
  };

  if (loading) return (
    <main className="flex-1 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </main>
  );

  if (notFound || !deal) return (
    <main className="flex-1 p-8 text-center">
      <p className="text-muted-foreground mb-4">Deal not found.</p>
      <Button asChild variant="outline"><Link to="/crm/deals"><ChevronLeft className="w-4 h-4 mr-1" /> Back to pipeline</Link></Button>
    </main>
  );

  const currentStage = stages.find((s) => s.id === deal.stageId);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-2 sm:px-6">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link to="/crm/deals"><ChevronLeft className="h-4 w-4" />Pipeline</Link>
        </Button>
        <div className="flex items-center gap-2">
          {deal.status === 'won' && !deal.projectId && (
            <Button
              size="sm"
              onClick={() => setShowHandoff(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <Trophy className="mr-1.5 h-4 w-4" />Hand off to PM
            </Button>
          )}
          {deal.projectId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/project/${deal.projectId}`)}
            >
              <Briefcase className="mr-1.5 h-4 w-4" />Open project
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            <Pencil className="mr-1.5 h-4 w-4" />Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDelete(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:gap-6 lg:p-6">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-xl font-bold break-words">{deal.name}</h2>
              <p className="text-3xl font-black text-primary mt-1">{fmtCurrency(deal.value)}</p>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Stage</p>
                <p className="font-semibold">{currentStage?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={deal.status === 'won' ? 'default' : deal.status === 'lost' ? 'destructive' : 'secondary'} className="capitalize">{deal.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Probability</p>
                <p className="font-semibold">{deal.probability}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected close</p>
                <p className="font-semibold">{deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : '—'}</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-1 text-sm">
              <p className="text-xs text-muted-foreground">Company</p>
              <p className="font-semibold">{company ? (
                <Link to={`/crm/companies/${company.id}`} className="hover:text-primary">{company.name}</Link>
              ) : '—'}</p>
              <p className="mt-2 text-xs text-muted-foreground">Contact</p>
              <p className="font-semibold">{contact ? (
                <Link to={`/crm/contacts/${contact.id}`} className="hover:text-primary">{contact.firstName} {contact.lastName ?? ''}</Link>
              ) : '—'}</p>
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowRightCircle className="w-3 h-3" /> Move to stage
              </p>
              <Select value={deal.stageId} onValueChange={handleMoveStage} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {deal.status === 'won' && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> Delivery
                  </p>
                  {deal.projectId ? (
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/project/${deal.projectId}`)}
                        className="w-full text-left rounded-md border border-border p-2 hover:border-primary transition-colors"
                      >
                        <p className="text-sm font-medium flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5 text-primary" />
                          Linked project
                          <ExternalLink className="w-3 h-3 opacity-60" />
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Click to open the project board
                        </p>
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                      onClick={() => setShowHandoff(true)}
                    >
                      <Trophy className="mr-1.5 h-4 w-4" />Hand off to PM
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2 min-w-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Add note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Type a note…" disabled={busy} />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleAddNote} disabled={busy || !noteBody.trim()}>
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save note
                </Button>
              </div>
            </CardContent>
          </Card>

          {notes.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-primary" />Notes ({notes.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {notes.slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Tasks ({tasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              ) : tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.dueDate ? t.dueDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No due date'}</p>
                  </div>
                  <Badge variant="secondary" className="capitalize">{t.status.replace('_', ' ')}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : activities.slice(0, 20).map((a) => (
                <div key={a.id} className="border-l-2 border-primary/40 pl-3">
                  <p className="text-sm">{a.description ?? a.type}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.type.replace(/_/g, ' ')} · {a.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <DealHandoffDialog
        deal={deal}
        open={showHandoff}
        onOpenChange={setShowHandoff}
        onLinked={refresh}
      />

      <EditDealDialog deal={deal} open={showEdit} onOpenChange={setShowEdit} onSaved={refresh} />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              Tasks and notes on this deal will be removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

const EditDealDialog: React.FC<{
  deal: CrmDeal;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ deal, open, onOpenChange, onSaved }) => {
  const [name, setName] = useState(deal.name);
  const [value, setValue] = useState<string>(deal.value.toString());
  const [probability, setProbability] = useState<string>(deal.probability.toString());
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>(deal.expectedCloseDate ?? '');
  const [source, setSource] = useState(deal.source ?? '');
  const [notes, setNotes] = useState(deal.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(deal.name);
      setValue(deal.value.toString());
      setProbability(deal.probability.toString());
      setExpectedCloseDate(deal.expectedCloseDate ?? '');
      setSource(deal.source ?? '');
      setNotes(deal.notes ?? '');
    }
  }, [open, deal]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateDeal(deal.id, {
        name: name.trim(),
        value: Number(value) || 0,
        probability: Number(probability) || 0,
        expectedCloseDate: expectedCloseDate || null,
        source: source.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success('Deal updated');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Value</Label>
              <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Probability (%)</Label>
              <Input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div>
            <Label>Expected close</Label>
            <Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} disabled={busy} />
          </div>
          <div>
            <Label>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmDealDetailPage;
