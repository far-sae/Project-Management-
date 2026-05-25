import React, { useEffect, useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Star, Trash2, ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { ClientStatus, ClientType } from '@/services/supabase/clients';

export interface ClientListViewFilters {
  search: string;
  typeFilter: ClientType | 'all';
  statusFilter: ClientStatus | 'all';
  bandFilter: 'all' | 'hot' | 'warm' | 'cold';
  categoryFilter: string;
  groupByCategory: boolean;
}

export interface ClientListView {
  id: string;
  name: string;
  filters: ClientListViewFilters;
  isDefault?: boolean;
  createdAt: number;
}

const storageKey = (orgId: string) => `pm_client_list_views_${orgId}`;

export const loadViews = (orgId: string): ClientListView[] => {
  try {
    const raw = localStorage.getItem(storageKey(orgId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ClientListView[];
  } catch {
    return [];
  }
};

const saveViews = (orgId: string, views: ClientListView[]) => {
  try {
    localStorage.setItem(storageKey(orgId), JSON.stringify(views));
  } catch {
    /* ignore */
  }
};

const summarize = (f: ClientListViewFilters): string => {
  const parts: string[] = [];
  if (f.search.trim()) parts.push(`"${f.search.trim()}"`);
  if (f.typeFilter !== 'all') parts.push(f.typeFilter);
  if (f.statusFilter !== 'all') parts.push(f.statusFilter);
  if (f.bandFilter !== 'all') parts.push(f.bandFilter);
  if (f.categoryFilter !== 'all') parts.push(`cat: ${f.categoryFilter}`);
  if (f.groupByCategory) parts.push('grouped');
  return parts.length === 0 ? 'All clients' : parts.join(' · ');
};

interface SavedListViewsProps {
  organizationId: string | null;
  currentFilters: ClientListViewFilters;
  onApply: (filters: ClientListViewFilters) => void;
}

export const SavedListViews: React.FC<SavedListViewsProps> = ({
  organizationId, currentFilters, onApply,
}) => {
  const [views, setViews] = useState<ClientListView[]>([]);
  const [openSave, setOpenSave] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) {
      setViews([]);
      return;
    }
    const loaded = loadViews(organizationId);
    setViews(loaded);
    const def = loaded.find((v) => v.isDefault);
    if (def) {
      setActiveViewId(def.id);
      onApply(def.filters);
    }
    // Intentionally only react to org changes — we don't want to re-apply
    // the default every time the user tweaks filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const persist = (next: ClientListView[]) => {
    setViews(next);
    if (organizationId) saveViews(organizationId, next);
  };

  const handleApply = (v: ClientListView) => {
    setActiveViewId(v.id);
    onApply(v.filters);
  };

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    const view: ClientListView = {
      id: crypto.randomUUID(),
      name,
      filters: currentFilters,
      createdAt: Date.now(),
    };
    persist([view, ...views]);
    setActiveViewId(view.id);
    setNewName('');
    setOpenSave(false);
  };

  const handleDelete = (id: string) => {
    persist(views.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(null);
  };

  const handleSetDefault = (id: string) => {
    persist(views.map((v) => ({ ...v, isDefault: v.id === id })));
  };

  const handleClearDefault = (id: string) => {
    persist(views.map((v) => (v.id === id ? { ...v, isDefault: false } : v)));
  };

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  if (!organizationId) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              <Bookmark className="w-4 h-4 mr-2" />
              {activeView ? activeView.name : 'List view'}
              <ChevronDown className="w-3 h-3 ml-1.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">
              Saved views
              {activeView && (
                <Badge variant="outline" className="ml-2 text-[10px]">active</Badge>
              )}
            </DropdownMenuLabel>
            {views.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No saved views yet. Configure the filters and choose
                "Save current view" below.
              </div>
            ) : (
              views.map((v) => (
                <div
                  key={v.id}
                  className={
                    'group flex items-start gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm cursor-pointer ' +
                    (activeViewId === v.id ? 'bg-muted/40' : '')
                  }
                  onClick={() => handleApply(v)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApply(v);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate">
                        {v.name}
                      </span>
                      {v.isDefault && (
                        <Badge variant="secondary" className="text-[9px]">default</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {summarize(v.filters)}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title={v.isDefault ? 'Remove default' : 'Make default'}
                      className="p-1 rounded hover:bg-background"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (v.isDefault) handleClearDefault(v.id);
                        else handleSetDefault(v.id);
                      }}
                    >
                      <Star
                        className={
                          'w-3 h-3 ' +
                          (v.isDefault ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground')
                        }
                      />
                    </button>
                    <button
                      type="button"
                      title="Delete view"
                      className="p-1 rounded hover:bg-background"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(v.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                </div>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setOpenSave(true)}>
              <BookmarkPlus className="w-4 h-4 mr-2" /> Save current view…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={openSave} onOpenChange={(o) => { if (!o) setNewName(''); setOpenSave(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save list view</DialogTitle>
            <DialogDescription>
              Capture the current filter combination so you can reopen it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="e.g. Hot US prospects"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Filters: </span>
              {summarize(currentFilters)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSave(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!newName.trim()}>Save view</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
