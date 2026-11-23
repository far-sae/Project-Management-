// Put everything of one workspace into another, then remove the first. For an
// organisation that still has the old "General" beside the workspace it really
// uses. The work is done by the database in one step: all of it, or nothing.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { publicMessage } from '@/lib/publicError';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import { mergeWorkspace } from '@/services/supabase/workspaces';
import type { Workspace } from '@/types/workspace';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Props {
  /** The workspace to empty and remove. Null keeps the window closed. */
  workspace: Workspace | null;
  workspaces: Workspace[];
  onOpenChange: (open: boolean) => void;
  /** Called after the merge, with the workspace everything went into. */
  onMerged?: (intoId: string) => void;
}

export const MergeWorkspaceDialog: React.FC<Props> = ({ workspace, workspaces, onOpenChange, onMerged }) => {
  const id = useId();
  const { refreshWorkspaces, select } = useSelectedWorkspace();
  const [into, setInto] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const others = workspaces.filter((w) => w.workspaceId !== workspace?.workspaceId);
  // Each time it opens: nothing chosen, unless there is only one place it could go.
  useEffect(() => {
    if (!workspace) return;
    setSure(false);
    setInto(others.length === 1 ? others[0].workspaceId : '');
  }, [workspace?.workspaceId]);

  const from = workspace ? getWorkspaceDisplayName(workspace) : '';
  const target = others.find((w) => w.workspaceId === into) ?? null;
  const to = target ? getWorkspaceDisplayName(target) : '';

  const merge = async () => {
    if (!workspace || !target || !sure) return;
    setBusy(true);
    try {
      await mergeWorkspace(workspace.workspaceId, target.workspaceId);
      await refreshWorkspaces();
      select(target.workspaceId);
      toast.success(`Everything from ${from} is now in ${to}. ${from} was removed.`);
      onMerged?.(target.workspaceId);
      onOpenChange(false);
    } catch (err) {
      toast.error(publicMessage(err, 'The workspaces could not be put together. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={workspace !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move everything out of {from}</DialogTitle>
          <DialogDescription>
            Its projects, leads, companies, deals, follow-ups and everything else go into another workspace. Then {from} is removed.
          </DialogDescription>
        </DialogHeader>

        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There is no other workspace to move it into. Create one first, or rename this one instead.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-into`}>Move it into</Label>
              <Select value={into} onValueChange={(value) => { setInto(value); setSure(false); }} disabled={busy}>
                <SelectTrigger id={`${id}-into`}><SelectValue placeholder="Choose a workspace" /></SelectTrigger>
                <SelectContent>
                  {others.map((w) => <SelectItem key={w.workspaceId} value={w.workspaceId}>{getWorkspaceDisplayName(w)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {target && (
              <>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  <li>Nothing is deleted. Every project, lead and deal of {from} is in {to} afterwards.</li>
                  <li>A tag or a deal stage with the same name in both becomes one.</li>
                  <li>It is done in one step: if any part cannot be moved, nothing is changed and you are told why.</li>
                  <li>A workspace that holds agreements or invoices cannot be moved: those keep their own numbers.</li>
                </ul>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={sure} disabled={busy} onChange={(event) => setSure(event.target.checked)}
                  />
                  <span>I understand that {from} is removed afterwards, and that this cannot be undone.</span>
                </label>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          {others.length > 0 && (
            <Button variant="destructive" disabled={busy || !target || !sure} onClick={() => void merge()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {target ? `Move everything into ${to}` : 'Move everything'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MergeWorkspaceDialog;
