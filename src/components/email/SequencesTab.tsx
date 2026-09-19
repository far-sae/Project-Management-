import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2, RefreshCw, Mail, ChevronRight, Plus, Play, PauseCircle, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import {
  listSequences, listStepCounts, listEnrollmentCounts, createSequence,
  countStepsWaitingOnPausedMailbox,
  type SequenceCounts,
} from '@/services/supabase/emailSequences';
import type { EmailSequence, SequenceStatus } from '@/lib/email/types';
import { SequenceEditor } from './SequenceEditor';

interface SequencesTabProps {
  orgId: string;
  workspaceId: string | null;
}

const EMPTY_COUNTS: SequenceCounts = { active: 0, replied: 0, stopped: 0, completed: 0 };

const sequenceStatusBadge = (status: SequenceStatus) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><Play className="w-3 h-3 mr-1" />Active</Badge>;
    case 'paused':
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30"><PauseCircle className="w-3 h-3 mr-1" />Paused</Badge>;
    case 'archived':
      return <Badge variant="outline">Archived</Badge>;
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
};

export const SequencesTab: React.FC<SequencesTabProps> = ({ orgId, workspaceId }) => {
  const { user } = useAuth();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  /**
   * Steps queued behind a mailbox that cannot send. A follow-up is pinned to
   * the mailbox its thread started on, so unlike a campaign message it cannot
   * be picked up by another pool member — it waits, indefinitely and
   * correctly, and no other screen connects the two facts.
   */
  const [waiting, setWaiting] = useState(0);
  const [stepCounts, setStepCounts] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, SequenceCounts>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!orgId) { setSequences([]); setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const list = await listSequences(orgId, workspaceId);
      setSequences(list);
      const ids = list.map((s) => s.id);
      const [steps, enrollments, blocked] = await Promise.all([
        listStepCounts(ids),
        listEnrollmentCounts(ids),
        countStepsWaitingOnPausedMailbox(orgId),
      ]);
      setStepCounts(steps);
      setCounts(enrollments);
      setWaiting(blocked);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load sequences');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !orgId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const sequence = await createSequence({
        organizationId: orgId,
        workspaceId,
        createdBy: user?.userId ?? null,
        name,
      });
      setShowNewDialog(false);
      setNewName('');
      await load(true);
      toast.success('Sequence created');
      // Straight into the editor: a new sequence is one empty step, and
      // there is nothing to look at on the list until it is written.
      setOpenId(sequence.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create sequence');
    } finally {
      setCreating(false);
    }
  };

  if (openId) {
    return (
      <SequenceEditor
        sequenceId={openId}
        orgId={orgId}
        workspaceId={workspaceId}
        onBack={() => { setOpenId(null); void load(true); }}
      />
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Sequences</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Refresh
            </Button>
            <Button size="sm" onClick={() => { setNewName(''); setCreateError(null); setShowNewDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />New sequence
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/*
            Not an error, and not something to fix here: these steps are fine
            and will go out the moment the mailbox does. The banner exists
            because without it the sequence simply looks stalled — the Accounts
            tab knows the mailbox is in trouble, and nothing connected that to
            the mail waiting on it.
          */}
          {waiting > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-800 dark:text-orange-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {waiting === 1 ? '1 follow-up is' : `${waiting} follow-ups are`} waiting on a
                mailbox that is paused or in error. A follow-up has to leave from the mailbox its
                conversation started on, so it cannot move to another one. Fix the mailbox under
                <strong className="font-medium"> Accounts</strong> and they send on their own —
                nothing is lost.
              </span>
            </div>
          )}
          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading sequences...</p>
            </div>
          ) : sequences.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">No sequences yet</p>
              <p className="text-sm">Create one to send a first message and the follow-ups after it.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sequences.map((sequence) => {
                const c = counts[sequence.id] ?? EMPTY_COUNTS;
                const steps = stepCounts[sequence.id] ?? 0;
                return (
                  <div key={sequence.id} className="border border-border rounded-lg overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenId(sequence.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(sequence.id); }}
                      className="flex items-center justify-between gap-4 p-4 bg-secondary/40 hover:bg-secondary/70 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground truncate">{sequence.name}</p>
                            <Badge variant="outline">{steps} step{steps === 1 ? '' : 's'}</Badge>
                            {sequenceStatusBadge(sequence.status)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Created {format(sequence.createdAt, 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm shrink-0">
                        <span title="Active">A {c.active}</span>
                        <span className="text-blue-600 dark:text-blue-400" title="Replied">R {c.replied}</span>
                        <span className="text-muted-foreground" title="Stopped">X {c.stopped}</span>
                        <span className="text-emerald-600 dark:text-emerald-400" title="Completed">C {c.completed}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNewDialog} onOpenChange={(open) => { if (!open) setShowNewDialog(false); else setShowNewDialog(true); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>New sequence</DialogTitle>
            <DialogDescription>
              A first message and the follow-ups after it. It sends nothing until you write the
              steps and activate it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="seq-new-name">Name *</Label>
              <Input
                id="seq-new-name"
                value={newName}
                placeholder="Autumn outreach"
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Create sequence
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SequencesTab;
