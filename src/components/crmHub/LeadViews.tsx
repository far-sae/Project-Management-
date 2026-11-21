import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  VIEW_NAME_LIMIT, readViews, sameView, withView, withoutView, writeViews,
} from '@/lib/crmSavedViews';
import type { LeadViewState, SavedView } from '@/lib/crmSavedViews';

/**
 * Saved views of the Leads list: choose one to get its search, filters and
 * sorting back; save the ones in use under a name. Kept in this browser.
 */

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

interface Props {
  /** Where this person's views for this workspace are kept. */
  storageKey: string;
  /** The search, filters and sorting on the page now. */
  current: LeadViewState;
  onApply: (state: LeadViewState) => void;
}

export const LeadViews: React.FC<Props> = ({ storageKey, current, onApply }) => {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => { setViews(readViews(storage(), storageKey)); }, [storageKey]);

  // The view that matches what is on the page. Changing a filter by hand un-selects it by itself.
  const active = useMemo(() => views.find((v) => sameView(v.state, current)) ?? null, [views, current]);

  const keep = (next: SavedView[]): boolean => {
    setViews(next);
    return writeViews(storage(), storageKey, next);
  };

  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    const kept = keep(withView(views, clean, current, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
    if (kept) toast.success(`View “${clean}” saved`);
    else toast.error('This browser would not keep the view. It works until you close the page.');
    setNaming(false);
    setName('');
  };

  const remove = (view: SavedView) => {
    keep(withoutView(views, view.id));
    toast.success(`View “${view.name}” deleted`);
  };

  return (
    <>
      {views.length > 0 && (
        <Select
          value={active?.id ?? ''}
          onValueChange={(id) => { const view = views.find((v) => v.id === id); if (view) onApply(view.state); }}
        >
          <SelectTrigger className="w-44" aria-label="Saved view"><SelectValue placeholder="Saved views" /></SelectTrigger>
          <SelectContent>
            {views.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {active ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => remove(active)} aria-label={`Delete the view ${active.name}`} title="Delete this view">
          <Trash2 aria-hidden />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => { setName(''); setNaming(true); }}>Save view</Button>
      )}

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Keeps the search, step, owner, category and sorting you have now. Saved in this browser, only for you.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Label htmlFor="view-name">Name</Label>
            <Input id="view-name" value={name} maxLength={VIEW_NAME_LIMIT} onChange={(e) => setName(e.target.value)} placeholder="For example: My hot leads" autoFocus />
            {views.some((v) => v.name.toLowerCase() === name.trim().toLowerCase()) && (
              <p className="text-xs text-muted-foreground">A view with this name exists. Saving replaces it.</p>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(false)}>Cancel</Button>
            <Button onClick={save} disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
