import React, { useEffect, useState, useCallback } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Eye, Plus, Save, Trash2, Loader2, Lock, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from '@/services/supabase/savedViews';
import type {
  SavedView,
  SavedViewFilters,
  SavedViewSort,
  SavedViewScope,
} from '@/types/savedView';

interface SavedViewsMenuProps {
  ownerId: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  /** Current filters/sort to capture when saving. */
  currentFilters: SavedViewFilters;
  currentSort: SavedViewSort;
  /** Apply a saved view's filters/sort to the current screen. */
  onApply: (view: SavedView) => void;
}

const scopeLabel = (scope: SavedViewScope): string =>
  scope === 'my' ? 'Just me' : scope === 'project' ? 'Project members' : 'Workspace';

const scopeIcon = (scope: SavedViewScope) =>
  scope === 'my' ? (
    <Lock className="w-3 h-3" />
  ) : scope === 'project' ? (
    <Users className="w-3 h-3" />
  ) : (
    <Users className="w-3 h-3" />
  );

export const SavedViewsMenu: React.FC<SavedViewsMenuProps> = ({
  ownerId,
  organizationId,
  projectId,
  currentFilters,
  currentSort,
  onApply,
}) => {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<SavedViewScope>(projectId ? 'project' : 'my');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    try {
      const list = await fetchSavedViews({
        ownerId,
        organizationId: organizationId ?? null,
        projectId: projectId ?? null,
      });
      setViews(list);
    } catch (err) {
      console.error('SavedViewsMenu refresh failed:', err);
      toast.error(
        err instanceof Error ? err.message : 'Could not load saved views',
      );
    } finally {
      setLoading(false);
    }
  }, [ownerId, organizationId, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!ownerId || !name.trim()) return;
    setSaving(true);
    try {
      const created = await createSavedView({
        ownerId,
        organizationId: organizationId ?? null,
        projectId: scope === 'project' ? projectId ?? null : null,
        scope,
        name: name.trim(),
        filters: currentFilters,
        sort: currentSort,
      });
      if (!created) throw new Error('Could not save view (table may be missing)');
      toast.success(`Saved view "${created.name}"`);
      setName('');
      setShowSaveDialog(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save view');
    } finally {
      setSaving(false);
    }
  }, [ownerId, organizationId, projectId, scope, name, currentFilters, currentSort, refresh]);

  const handleUpdateCurrent = useCallback(
    async (view: SavedView) => {
      const ok = await updateSavedView(view.id, {
        filters: currentFilters,
        sort: currentSort,
      });
      if (ok) {
        toast.success(`Updated view "${view.name}"`);
        refresh();
      } else {
        toast.error('Failed to update view');
      }
    },
    [currentFilters, currentSort, refresh],
  );

  const handleDelete = useCallback(
    async (view: SavedView) => {
      const ok = await deleteSavedView(view.id);
      if (ok) {
        toast.success(`Deleted view "${view.name}"`);
        refresh();
      } else {
        toast.error('Failed to delete view');
      }
    },
    [refresh],
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Eye className="w-4 h-4 mr-2" />
            Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {loading && (
            <DropdownMenuItem disabled className="justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
            </DropdownMenuItem>
          )}
          {!loading && views.length === 0 && (
            <DropdownMenuItem disabled className="text-muted-foreground text-xs">
              No saved views yet
            </DropdownMenuItem>
          )}
          {!loading && views.map((v) => (
            <DropdownMenuItem
              key={v.id}
              onClick={() => onApply(v)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex-1 truncate">{v.name}</span>
              <span
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                title={scopeLabel(v.scope)}
              >
                {scopeIcon(v.scope)}
                {scopeLabel(v.scope)}
              </span>
              {v.ownerId === ownerId && (
                <>
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-secondary"
                    title="Update with current filters"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpdateCurrent(v);
                    }}
                  >
                    <Save className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-destructive-soft"
                    title="Delete view"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(v);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSaveDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Captures current filters and sort. Available next time you open this page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. High priority, this sprint"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Visible to</Label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as SavedViewScope)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="my">Just me</SelectItem>
                  {projectId && (
                    <SelectItem value="project">Project members</SelectItem>
                  )}
                  {organizationId && (
                    <SelectItem value="org">Workspace</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SavedViewsMenu;
