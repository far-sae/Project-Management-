import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  VIEW_NAME_LIMIT, readViews, sameView, withView, withoutView, writeViews,
} from '@/lib/crmSavedViews';
import type { LeadViewState, SavedView } from '@/lib/crmSavedViews';
import { publicMessage } from '@/lib/publicError';
import { createSharedView, deleteSharedView, listSharedViews } from '@/services/supabase/crmHub/savedViews';

/**
 * Saved views of the Leads list: choose one to get its search, filters and
 * sorting back; save the ones in use under a name. A view is yours (kept in
 * this browser) or shared with the team (kept with the workspace).
 */

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

interface Props {
  /** Where this person's own views for this workspace are kept. */
  storageKey: string;
  /** The workspace the shared views belong to. */
  organizationId: string;
  workspaceId: string;
  /** The search, filters and sorting on the page now. */
  current: LeadViewState;
  onApply: (state: LeadViewState) => void;
}

export const LeadViews: React.FC<Props> = ({ storageKey, organizationId, workspaceId, current, onApply }) => {
  const [mine, setMine] = useState<SavedView[]>([]);
  const [team, setTeam] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => { setMine(readViews(storage(), storageKey)); }, [storageKey]);

  const loadTeam = useCallback(async () => {
    try {
      setTeam(await listSharedViews(workspaceId));
    } catch {
      // The team's views are an extra: without them the person still has their own.
      setTeam([]);
    }
  }, [workspaceId]);
  useEffect(() => { void loadTeam(); }, [loadTeam]);

  const views = useMemo(() => [...mine, ...team], [mine, team]);
  // The view that matches what is on the page. Changing a filter by hand un-selects it by itself.
  const active = useMemo(() => views.find((v) => sameView(v.state, current)) ?? null, [views, current]);

  const keepMine = (next: SavedView[]): boolean => {
    setMine(next);
    return writeViews(storage(), storageKey, next);
  };

  const open = () => { setName(''); setShare(false); setProblem(''); setNaming(true); };

  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    setProblem('');
    if (!share) {
      const kept = keepMine(withView(mine, clean, current, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
      if (kept) toast.success(`View “${clean}” saved`);
      else toast.error('This browser would not keep the view. It works until you close the page.');
      setNaming(false);
      return;
    }
    setBusy(true);
    try {
      const made = await createSharedView(organizationId, workspaceId, clean, current);
      setTeam((list) => [...list, made]);
      toast.success(`View “${made.name}” shared with the team`);
      setNaming(false);
    } catch (err) {
      setProblem(publicMessage(err, 'The view could not be shared.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: SavedView) => {
    if (!view.shared) {
      keepMine(withoutView(mine, view.id));
      toast.success(`View “${view.name}” deleted`);
      return;
    }
    setBusy(true);
    try {
      await deleteSharedView(view.id);
      setTeam((list) => list.filter((v) => v.id !== view.id));
      toast.success(`View “${view.name}” removed for the team`);
    } catch (err) {
      toast.error(publicMessage(err, 'The view could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  const taken = (share ? team : mine).some((v) => v.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <>
      {views.length > 0 && (
        <Select
          value={active?.id ?? ''}
          onValueChange={(id) => { const view = views.find((v) => v.id === id); if (view) onApply(view.state); }}
        >
          <SelectTrigger className="w-44" aria-label="Saved view"><SelectValue placeholder="Saved views" /></SelectTrigger>
          <SelectContent>
            {mine.length > 0 && (
              <SelectGroup>
                {team.length > 0 && <SelectLabel>Mine</SelectLabel>}
                {mine.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectGroup>
            )}
            {team.length > 0 && (
              <SelectGroup>
                <SelectLabel>Team</SelectLabel>
                {team.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      )}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => void remove(active)}
          disabled={busy}
          aria-label={active.shared ? `Remove the team view ${active.name}` : `Delete the view ${active.name}`}
          title={active.shared ? 'Remove this view for the team' : 'Delete this view'}
        >
          <Trash2 aria-hidden />
        </Button>
      ) : (
        <Button variant="outline" onClick={open}>Save view</Button>
      )}

      <Dialog open={naming} onOpenChange={(next) => { if (!busy) setNaming(next); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Keeps the search, step, owner, category and sorting you have now.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input id="view-name" value={name} maxLength={VIEW_NAME_LIMIT} onChange={(e) => setName(e.target.value)} placeholder="For example: My hot leads" autoFocus disabled={busy} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={share} onChange={(e) => setShare(e.target.checked)} disabled={busy} />
              <span>
                Share with the team
                <span className="block text-xs text-muted-foreground">
                  {share ? 'Everybody in this workspace finds it in their list.' : 'Only you, in this browser.'}
                </span>
              </span>
            </label>
            {taken && <p className="text-xs text-muted-foreground">{share ? 'The team has a view with this name already.' : 'A view with this name exists. Saving replaces it.'}</p>}
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
