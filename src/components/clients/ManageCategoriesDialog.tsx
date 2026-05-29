import React, { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Edit2, Check, X, Layers, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ClientCategory,
  CreateClientCategoryInput,
  UpdateClientCategoryInput,
} from '@/services/supabase/clientCategories';
import type { Client } from '@/services/supabase/clients';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ClientCategory[];
  /** All accounts in scope — used to show how many use each category and to
   *  surface free-text "derived" categories alongside the registered list. */
  clients: Client[];
  canManage: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  onCreate: (input: CreateClientCategoryInput) => Promise<ClientCategory>;
  onUpdate: (categoryId: string, input: UpdateClientCategoryInput) => Promise<ClientCategory>;
  onDelete: (categoryId: string) => Promise<void>;
}

const PALETTE = [
  '#f97316', '#10b981', '#0ea5e9', '#8b5cf6',
  '#ec4899', '#f59e0b', '#06b6d4', '#6366f1',
];

export const ManageCategoriesDialog: React.FC<ManageCategoriesDialogProps> = ({
  open, onOpenChange, categories, clients, canManage,
  workspaceId, workspaceName,
  onCreate, onUpdate, onDelete,
}) => {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PALETTE[0]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClientCategory | null>(null);

  // Count accounts per category (case-insensitive match against
  // client.category). Empty registered categories show a "0 accounts" badge
  // and a hint to start tagging accounts with them.
  const usageByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clients) {
      const key = c.category?.trim().toLowerCase() ?? '';
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [clients]);

  // Free-text categories on existing accounts that aren't yet registered —
  // surface them so reps can promote them into the managed list with one click.
  const derivedCategories = useMemo(() => {
    const registered = new Set(
      categories.map((c) => c.name.toLowerCase()),
    );
    const seen = new Map<string, { displayName: string; count: number }>();
    for (const c of clients) {
      const raw = c.category?.trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (registered.has(k)) continue;
      const prev = seen.get(k);
      if (prev) prev.count += 1;
      else seen.set(k, { displayName: raw, count: 1 });
    }
    return Array.from(seen.entries())
      .map(([k, v]) => ({ key: k, displayName: v.displayName, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }, [clients, categories]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !workspaceId) return;
    setCreating(true);
    try {
      await onCreate({ workspaceId, name, color: newColor });
      setNewName('');
      setNewColor(PALETTE[0]);
      toast.success(`Created category "${name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (c: ClientCategory) => {
    setEditingId(c.categoryId);
    setEditName(c.name);
    setEditColor(c.color ?? PALETTE[0]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('');
  };

  const handleSaveEdit = async (c: ClientCategory) => {
    const name = editName.trim();
    if (!name) {
      toast.error('Name cannot be empty');
      return;
    }
    setBusyId(c.categoryId);
    try {
      await onUpdate(c.categoryId, { name, color: editColor });
      toast.success(`Renamed to "${name}"`);
      cancelEdit();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const c = pendingDelete;
    if (!c) return;
    setBusyId(c.categoryId);
    try {
      await onDelete(c.categoryId);
      toast.success(`Deleted category "${c.name}"`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const handlePromoteDerived = async (name: string) => {
    if (!workspaceId) return;
    setCreating(true);
    try {
      await onCreate({ workspaceId, name, color: PALETTE[derivedCategories.length % PALETTE.length] });
      toast.success(`Promoted "${name}" into the registered list`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to promote');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words">
            <Layers className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">Manage account categories</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Set up the buckets you want to organise accounts into.
            Categories live in the{' '}
            <strong className="text-foreground">{workspaceName ?? 'Default'}</strong>
            {' '}workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!workspaceId ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
              <p className="font-semibold text-destructive inline-flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Pick a workspace
              </p>
              <p className="mt-1">
                You're on "All workspaces". Switch the sidebar to a specific
                workspace so we know where to file new categories.
              </p>
            </div>
          ) : !canManage ? (
            <p className="text-xs text-muted-foreground">
              Viewers can't create or edit categories. Ask an owner or admin.
            </p>
          ) : (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Add a category
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Enterprise, Reseller, NGO"
                  maxLength={80}
                  className="flex-1 min-w-[200px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) void handleCreate();
                  }}
                />
                <PaletteSwatch value={newColor} onChange={setNewColor} />
                <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Add
                </Button>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Registered categories ({categories.length})
            </p>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No categories yet. Add one above to start grouping your accounts.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {categories.map((c) => {
                  const usage = usageByName.get(c.name.toLowerCase()) ?? 0;
                  const isEditing = editingId === c.categoryId;
                  return (
                    <li
                      key={c.categoryId}
                      className="rounded-md border p-2 flex items-center gap-2"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: isEditing ? editColor : (c.color ?? '#999') }}
                      />
                      {isEditing ? (
                        <>
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            maxLength={80}
                            className="flex-1 min-w-0 h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveEdit(c);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                          <PaletteSwatch value={editColor} onChange={setEditColor} />
                          <Button size="sm" variant="ghost" onClick={() => handleSaveEdit(c)}
                            disabled={busyId === c.categoryId}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium text-sm truncate flex-1 min-w-0">{c.name}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {usage} account{usage === 1 ? '' : 's'}
                          </Badge>
                          {canManage && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => startEdit(c)} disabled={busyId === c.categoryId}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(c)}
                                disabled={busyId === c.categoryId}
                                className="text-destructive hover:text-destructive">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {derivedCategories.length > 0 && canManage && (
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Found on existing accounts
              </p>
              <p className="text-[11px] text-muted-foreground">
                These category names are typed on accounts but not in the
                registered list yet. Promote them with one click so they show
                up on the landing.
              </p>
              <ul className="space-y-1.5">
                {derivedCategories.map((d) => (
                  <li
                    key={d.key}
                    className={cn(
                      'rounded-md border bg-muted/30 p-2 flex items-center gap-2',
                    )}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0 bg-muted" />
                    <span className="font-medium text-sm truncate flex-1 min-w-0">
                      {d.displayName}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {d.count} account{d.count === 1 ? '' : 's'}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePromoteDerived(d.displayName)}
                      disabled={creating || !workspaceId}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Promote
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (() => {
                const inUse = usageByName.get(pendingDelete.name.toLowerCase()) ?? 0;
                if (inUse > 0) {
                  return (
                    <>
                      <strong>"{pendingDelete.name}"</strong> is still tagged on{' '}
                      {inUse} account{inUse === 1 ? '' : 's'}. The category text stays on
                      those accounts so nothing is lost — you can re-categorise them later.
                    </>
                  );
                }
                return <>Delete <strong>"{pendingDelete.name}"</strong>?</>;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === pendingDelete?.categoryId}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              disabled={busyId === pendingDelete?.categoryId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyId === pendingDelete?.categoryId ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting…</>
              ) : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

const PaletteSwatch: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <div className="flex items-center gap-1">
    {PALETTE.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(c)}
        title={c}
        className={cn(
          'w-5 h-5 rounded-full border-2 transition-all',
          value === c ? 'border-foreground scale-110' : 'border-border opacity-70 hover:opacity-100',
        )}
        style={{ background: c }}
      />
    ))}
  </div>
);
