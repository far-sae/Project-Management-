import React, { useEffect, useState } from 'react';
import { Loader2, UserPlus, ArrowRight, ChevronDown, ChevronRight, Trash2, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Lead, leadDisplayName, leadStatusLabel, listUnassignedLeads,
} from '@/services/supabase/leads';
import { toast } from 'sonner';

interface Props {
  organizationId: string | null;
  /** Active workspace — scopes the unassigned list. Null = all workspaces. */
  workspaceId?: string | null;
  /** Known category names for the move dropdown (the org's categories). */
  categories: string[];
  canEdit: boolean;
  /** Re-fetch trigger — bump to reload the list. */
  refreshKey?: number;
  /** Move a lead into a category (leads are organised by category). */
  onMove: (lead: Lead, category: string) => Promise<void>;
  /** Permanently delete an unassigned lead. */
  onDelete?: (lead: Lead) => Promise<void>;
  /** Open the lead CSV importer. */
  onImport?: () => void;
  /** Open the lead's detail record. */
  onOpen?: (lead: Lead) => void;
}

const NEW = '__new__';

/**
 * "Unassigned leads" for the Accounts tab — leads that don't have a category
 * yet (bot/agent/CSV-created). Each can be moved into a category (pick an
 * existing one or type a new one); leads are organised by category, not by a
 * company account.
 */
export const UnassignedLeadsCard: React.FC<Props> = ({
  organizationId, workspaceId, categories, canEdit, refreshKey = 0,
  onMove, onDelete, onImport, onOpen,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  // Move dialog state.
  const [moving, setMoving] = useState<Lead | null>(null);
  const [targetCategory, setTargetCategory] = useState<string>(NEW);
  const [customCategory, setCustomCategory] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!organizationId) { setLeads([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listUnassignedLeads(organizationId, workspaceId ?? null)
      .then((rows) => { if (!cancelled) setLeads(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId, workspaceId, refreshKey]);

  const startMove = (lead: Lead) => {
    setMoving(lead);
    setTargetCategory(categories.length > 0 ? categories[0] : NEW);
    setCustomCategory('');
  };

  const confirmMove = async () => {
    if (!moving) return;
    const category = targetCategory === NEW ? customCategory.trim() : targetCategory;
    if (!category) { toast.error('Pick an existing category or type a new one'); return; }
    setBusy(true);
    try {
      await onMove(moving, category);
      toast.success(`Moved ${leadDisplayName(moving)} into ${category}`);
      setLeads((prev) => prev.filter((l) => l.leadId !== moving.leadId));
      setMoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move lead');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (lead: Lead) => {
    if (!onDelete) return;
    if (!confirm(`Delete lead "${leadDisplayName(lead)}"? This cannot be undone.`)) return;
    try {
      await onDelete(lead);
      setLeads((prev) => prev.filter((l) => l.leadId !== lead.leadId));
      toast.success('Lead deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete lead');
    }
  };

  // Hide the card when there's nothing to show (and no import affordance).
  if (!loading && leads.length === 0 && !onImport) return null;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-2 flex-1 min-w-0 text-left flex-wrap"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
            <UserPlus className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-semibold">Unassigned leads</span>
            <Badge variant="outline" className="text-[10px]">{loading ? '…' : leads.length}</Badge>
            <span className="ml-1 text-xs text-muted-foreground">
              No category yet (bot, agent, or CSV import). Move each into a category.
            </span>
          </button>
          {canEdit && onImport && (
            <Button size="sm" variant="outline" className="shrink-0" onClick={onImport}>
              <Upload className="w-4 h-4 mr-1" /> Import leads
            </Button>
          )}
        </div>

        {open && (loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : leads.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No uncategorised leads. Import leads or wait for the bot/agent to create some.
          </p>
        ) : (
          <ul className="border rounded-md divide-y">
            {leads.map((l) => (
              <li key={l.leadId} className="px-3 py-2 flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left hover:text-primary disabled:cursor-default disabled:hover:text-foreground"
                  onClick={() => onOpen?.(l)}
                  disabled={!onOpen}
                >
                  <span className="font-medium">{leadDisplayName(l)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {l.company} · {l.leadNumber} · {leadStatusLabel(l.leadStatus)}
                  </span>
                </button>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startMove(l)}>
                      <ArrowRight className="w-4 h-4 mr-1" /> Move to category
                    </Button>
                    {onDelete && (
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label="Delete lead"
                        onClick={() => handleDelete(l)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}
      </CardContent>

      <Dialog open={!!moving} onOpenChange={(o) => { if (!o && !busy) setMoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move lead to a category</DialogTitle>
            <DialogDescription>
              {moving && (
                <>Put <strong>{leadDisplayName(moving)}</strong> into a category
                  (pick an existing one or type a new one).</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={targetCategory} onValueChange={setTargetCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value={NEW}>＋ New category…</SelectItem>
                </SelectContent>
              </Select>
              {targetCategory === NEW && (
                <Input
                  className="mt-2"
                  placeholder="New category name (e.g. Enterprise, SMB)"
                  value={customCategory}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setCustomCategory(e.target.value)}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)} disabled={busy}>Cancel</Button>
            <Button
              onClick={confirmMove}
              disabled={busy || (targetCategory === NEW && !customCategory.trim())}
            >
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
