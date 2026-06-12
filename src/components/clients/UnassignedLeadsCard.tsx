import React, { useEffect, useMemo, useState } from 'react';
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
import type { Client } from '@/services/supabase/clients';
import {
  Lead, leadDisplayName, leadStatusLabel, listUnassignedLeads,
} from '@/services/supabase/leads';
import { toast } from 'sonner';

interface Props {
  organizationId: string | null;
  /** Active workspace — scopes the unassigned list so other workspaces' leads
   *  don't leak in. Null = all workspaces. */
  workspaceId?: string | null;
  /** Accounts the lead can be moved into (workspace-scoped list from the page). */
  accounts: Client[];
  canEdit: boolean;
  /** Re-fetch trigger — bump to reload the unassigned list. */
  refreshKey?: number;
  /** Move a lead into an account + category. */
  onMove: (lead: Lead, accountId: string, category: string | null) => Promise<void>;
  /** Create a new account (name + optional category) so a lead can be moved
   *  into a fresh account straight from the move dialog. */
  onCreateAccount?: (name: string, category: string | null, workspaceId: string | null) => Promise<Client>;
  /** Permanently delete an unassigned lead. */
  onDelete?: (lead: Lead) => Promise<void>;
  /** Open the lead CSV importer. */
  onImport?: () => void;
}

const NONE = '__none__';
const NEW_ACCOUNT = '__new_account__';

/**
 * "Unassigned leads" for the Accounts tab. Lists leads with no owning account
 * (bot/agent/CSV-created) and lets a rep move each into an account + category —
 * picking an existing account OR creating a new one right in the move dialog.
 */
export const UnassignedLeadsCard: React.FC<Props> = ({
  organizationId, workspaceId, accounts, canEdit, refreshKey = 0, onMove, onCreateAccount,
  onDelete, onImport,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  // Move dialog state.
  const [moving, setMoving] = useState<Lead | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string>(NONE);
  const [newAccountName, setNewAccountName] = useState('');
  const [targetCategory, setTargetCategory] = useState<string>(NONE);
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

  const targetAccount = useMemo(
    () => accounts.find((a) => a.clientId === targetAccountId) ?? null,
    [accounts, targetAccountId],
  );

  const startMove = (lead: Lead) => {
    setMoving(lead);
    setTargetAccountId(NONE);
    setNewAccountName('');
    setTargetCategory(NONE);
    setCustomCategory('');
  };

  const confirmMove = async () => {
    if (!moving) return;
    if (targetAccountId === NONE) {
      toast.error('Pick an account (or create one) to move this lead into');
      return;
    }
    const creatingNew = targetAccountId === NEW_ACCOUNT;
    if (creatingNew && !newAccountName.trim()) {
      toast.error('Name the new account');
      return;
    }
    const category = targetCategory === NONE ? (customCategory.trim() || null) : targetCategory;
    setBusy(true);
    try {
      let accountId = targetAccountId;
      let accountName = targetAccount?.name ?? 'account';
      if (creatingNew) {
        if (!onCreateAccount) throw new Error('Cannot create accounts here');
        const created = await onCreateAccount(newAccountName.trim(), category, workspaceId ?? null);
        accountId = created.clientId;
        accountName = created.name;
      }
      await onMove(moving, accountId, category);
      toast.success(`Moved ${leadDisplayName(moving)} into ${accountName}`);
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

  // Hide the card when there are no unassigned leads (unless import is offered).
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
              Created by the bot, agent, or CSV import. Move each into an account
              (pick one or create a new one) and a category.
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
        ) : (
          <ul className="border rounded-md divide-y">
            {leads.map((l) => (
              <li key={l.leadId} className="px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{leadDisplayName(l)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {l.company} · {l.leadNumber} · {leadStatusLabel(l.leadStatus)}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startMove(l)}>
                      <ArrowRight className="w-4 h-4 mr-1" /> Move to account
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
            <DialogTitle>Move lead to an account</DialogTitle>
            <DialogDescription>
              {moving && (
                <>Move <strong>{leadDisplayName(moving)}</strong> into an account
                  (pick one or create a new one) and a category.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Account</Label>
              <Select
                value={targetAccountId}
                onValueChange={(v) => { setTargetAccountId(v); setTargetCategory(NONE); setCustomCategory(''); }}
              >
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Pick an account —</SelectItem>
                  {onCreateAccount && (
                    <SelectItem value={NEW_ACCOUNT}>＋ Create new account</SelectItem>
                  )}
                  {accounts.map((a) => (
                    <SelectItem key={a.clientId} value={a.clientId}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetAccountId === NEW_ACCOUNT && (
                <Input
                  className="mt-2"
                  placeholder="New account name"
                  value={newAccountName}
                  maxLength={120}
                  onChange={(e) => setNewAccountName(e.target.value)}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Category (optional)</Label>
              <Select value={targetCategory} onValueChange={setTargetCategory}>
                <SelectTrigger><SelectValue placeholder="— Uncategorized —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Uncategorized / new —</SelectItem>
                  {(targetAccount?.leadCategories ?? []).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetCategory === NONE && (
                <Input
                  className="mt-2"
                  placeholder="Or type a new category (leave blank for uncategorized)"
                  value={customCategory}
                  maxLength={80}
                  onChange={(e) => setCustomCategory(e.target.value)}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirmMove} disabled={busy || targetAccountId === NONE}>
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
