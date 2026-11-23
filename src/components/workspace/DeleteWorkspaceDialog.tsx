// Delete a workspace together with everything in it. For an organisation that
// wants the old "General" gone with what is inside. The person is first shown
// what will go, counted by the database, and must tick a box. The database
// then does it in one step: all of it, or nothing.
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { publicMessage } from '@/lib/publicError';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { deleteWorkspaceWithData } from '@/services/supabase/workspaces';
import type { Workspace } from '@/types/workspace';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  /** The workspace to delete. Null keeps the window closed. */
  workspace: Workspace | null;
  workspaces: Workspace[];
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/** What a person calls the rows of a table: one, and many. Shown in this order. */
const NAMED: Array<[table: string, one: string, many: string]> = [
  ['projects', 'project', 'projects'],
  ['tasks', 'task', 'tasks'],
  ['crm_contacts', 'lead', 'leads'],
  ['crm_companies', 'company', 'companies'],
  ['crm_deals', 'deal', 'deals'],
  ['crm_tasks', 'follow-up', 'follow-ups'],
  ['email_campaigns', 'email campaign', 'email campaigns'],
  ['social_content', 'social post', 'social posts'],
  ['crm_calls', 'call', 'calls'],
];

/** What will be deleted, as lines a person can read. Everything not named is added up into one line. */
export function deletedSummary(counts: Record<string, number>): Array<{ key: string; text: string }> {
  const lines: Array<{ key: string; text: string }> = [];
  const named = new Set(NAMED.map(([table]) => table));
  for (const [table, one, many] of NAMED) {
    const n = Number(counts[table]) || 0;
    if (n > 0) lines.push({ key: table, text: `${n.toLocaleString()} ${n === 1 ? one : many}` });
  }
  const other = Object.entries(counts).reduce((sum, [table, n]) => (named.has(table) ? sum : sum + (Number(n) || 0)), 0);
  if (other > 0) lines.push({ key: 'other', text: `${other.toLocaleString()} other ${other === 1 ? 'record' : 'records'} (notes, history, settings)` });
  return lines;
}

export const DeleteWorkspaceDialog: React.FC<Props> = ({ workspace, workspaces, onOpenChange, onDeleted }) => {
  const { refreshWorkspaces, select, selectedId } = useSelectedWorkspace();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const id = workspace?.workspaceId ?? null;
  const others = workspaces.filter((w) => w.workspaceId !== id);
  const onlyOne = others.length === 0;
  const name = workspace ? getWorkspaceDisplayName(workspace) : '';

  // Each time it opens: count what is inside. Nothing is deleted by this.
  useEffect(() => {
    setCounts(null);
    setProblem(null);
    setSure(false);
    if (!id || onlyOne) return;
    let alive = true;
    deleteWorkspaceWithData(id, false)
      .then((answer) => { if (alive) setCounts(answer.counts); })
      .catch((err) => { if (alive) setProblem(publicMessage(err, 'What is in this workspace could not be counted. Please try again.')); });
    return () => { alive = false; };
  }, [id, onlyOne]);

  const remove = async () => {
    if (!workspace || !counts || !sure) return;
    setBusy(true);
    try {
      await deleteWorkspaceWithData(workspace.workspaceId, true);
      await refreshWorkspaces();
      // Somebody looking at the deleted workspace is put on one that is left.
      if (selectedId === workspace.workspaceId && others[0]) select(others[0].workspaceId);
      toast.success(`${name} was deleted, with everything in it.`);
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(publicMessage(err, 'The workspace could not be deleted. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  };

  const lines = counts ? deletedSummary(counts) : [];

  return (
    <Dialog open={workspace !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete {name} and everything in it</DialogTitle>
          <DialogDescription>
            The workspace is removed together with all that belongs to it. This cannot be brought back.
          </DialogDescription>
        </DialogHeader>

        {onlyOne ? (
          <p className="text-sm text-muted-foreground">This is your only workspace. Make another one first, then delete this one.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-border">
              <p className="border-b border-border px-3 py-2 text-sm font-medium">This will be deleted</p>
              {problem ? (
                <p role="alert" className="px-3 py-3 text-sm text-destructive">{problem}</p>
              ) : counts === null ? (
                <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Counting what is inside…</p>
              ) : lines.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">{name} has nothing in it.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-3 text-sm tabular-nums">
                  {lines.map((line) => <li key={line.key} className={line.key === 'other' ? 'col-span-2 text-muted-foreground' : ''}>{line.text}</li>)}
                </ul>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              To keep what is inside and only lose the workspace, close this and choose “Move everything to another workspace” instead.
            </p>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={sure} disabled={busy || counts === null} onChange={(event) => setSure(event.target.checked)}
              />
              <span>I understand that {name} and everything listed above is deleted for good.</span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          {!onlyOne && (
            <Button variant="destructive" disabled={busy || counts === null || !sure} onClick={() => void remove()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Delete {name} and everything in it
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteWorkspaceDialog;
