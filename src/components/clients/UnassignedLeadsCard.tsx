import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, UserPlus, ArrowRight,
} from 'lucide-react';
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
  /** Re-fetch trigger — bump to reload the unassigned list (e.g. after a move
   *  or after a bot/import created new leads). */
  refreshKey?: number;
  /** Move a lead into an account + category. */
  onMove: (lead: Lead, accountId: string, category: string | null) => Promise<void>;
  /** Open the lead form prefilled to this account + category. */
  onAddLead?: (accountId: string, category: string | null, accountName: string, workspaceId: string | null) => void;
  /** Open the lead CSV import prefilled to this account + category. */
  onImportLeads?: (accountId: string, category: string | null, accountName: string, workspaceId: string | null) => void;
}

const NONE = '__none__';

/**
 * Collapsible "Unassigned leads" affordance for the Accounts tab. Lists leads
 * with no owning account (bot/agent/CSV-created ones land here) and lets a rep
 * move each into an account + category.
 */
export const UnassignedLeadsCard: React.FC<Props> = ({
  organizationId, workspaceId, accounts, canEdit, refreshKey = 0, onMove,
  onAddLead, onImportLeads,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [orphansOpen, setOrphansOpen] = useState(false);

  // Category-first add form: pick an account + category, then add/import leads.
  const [formAccountId, setFormAccountId] = useState<string>(NONE);
  const [formCategory, setFormCategory] = useState<string>(NONE);
  const [formCustomCategory, setFormCustomCategory] = useState('');

  // Move dialog state (for orphan leads created by the bot/agent/CSV).
  const [moving, setMoving] = useState<Lead | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string>(NONE);
  const [targetCategory, setTargetCategory] = useState<string>(NONE);
  const [customCategory, setCustomCategory] = useState('');
  const [busy, setBusy] = useState(false);

  const formAccount = useMemo(
    () => accounts.find((a) => a.clientId === formAccountId) ?? null,
    [accounts, formAccountId],
  );
  const resolvedFormCategory = (): string | null =>
    formCategory === NONE ? (formCustomCategory.trim() || null) : formCategory;

  const triggerAdd = () => {
    if (!formAccount) { toast.error('Pick an account first'); return; }
    onAddLead?.(formAccount.clientId, resolvedFormCategory(), formAccount.name, formAccount.workspaceId ?? null);
  };
  const triggerImport = () => {
    if (!formAccount) { toast.error('Pick an account first'); return; }
    onImportLeads?.(formAccount.clientId, resolvedFormCategory(), formAccount.name, formAccount.workspaceId ?? null);
  };

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
    setTargetCategory(NONE);
    setCustomCategory('');
  };

  const confirmMove = async () => {
    if (!moving) return;
    if (targetAccountId === NONE) {
      toast.error('Pick an account to move this lead into');
      return;
    }
    const category =
      targetCategory === NONE
        ? (customCategory.trim() || null)
        : targetCategory;
    setBusy(true);
    try {
      await onMove(moving, targetAccountId, category);
      toast.success(`Moved ${leadDisplayName(moving)} into ${targetAccount?.name ?? 'account'}`);
      setLeads((prev) => prev.filter((l) => l.leadId !== moving.leadId));
      setMoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move lead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* ── Category-first add form (primary) ───────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <UserPlus className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-semibold">Add leads</span>
            <span className="text-xs text-muted-foreground">
              Pick an account and category first, then add or import leads into it.
            </span>
          </div>

          {!canEdit ? (
            <p className="text-xs text-muted-foreground">You don't have permission to add leads.</p>
          ) : accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Create an account first — leads are added into an account + category.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Account</Label>
                <Select
                  value={formAccountId}
                  onValueChange={(v) => { setFormAccountId(v); setFormCategory(NONE); setFormCustomCategory(''); }}
                >
                  <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Pick an account —</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.clientId} value={a.clientId}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue placeholder="— Uncategorized —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Uncategorized / new —</SelectItem>
                    {(formAccount?.leadCategories ?? []).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formCategory === NONE && (
                  <Input
                    className="mt-1.5"
                    placeholder="Or type a new category (optional)"
                    value={formCustomCategory}
                    maxLength={80}
                    onChange={(e) => setFormCustomCategory(e.target.value)}
                  />
                )}
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <Button size="sm" onClick={triggerAdd} disabled={formAccountId === NONE}>
                  <UserPlus className="w-4 h-4 mr-1" /> Add lead
                </Button>
                <Button size="sm" variant="outline" onClick={triggerImport} disabled={formAccountId === NONE}>
                  <ArrowRight className="w-4 h-4 mr-1" /> Import leads
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Orphan leads (bot/agent/CSV with no account) — secondary ─────── */}
        {(loading || leads.length > 0) && (
          <div className="border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-2 w-full text-left"
              onClick={() => setOrphansOpen((v) => !v)}
            >
              {orphansOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              <span className="text-sm font-medium">Leads waiting for an account</span>
              <Badge variant="outline" className="text-[10px]">{loading ? '…' : leads.length}</Badge>
              <span className="ml-1 text-xs text-muted-foreground truncate">
                Created by the bot, agent, or CSV import — move each into an account.
              </span>
            </button>

            {orphansOpen && (
              <ul className="border rounded-md divide-y mt-2">
                {leads.map((l) => (
                  <li key={l.leadId} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{leadDisplayName(l)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {l.company} · {l.leadNumber} · {leadStatusLabel(l.leadStatus)}
                      </span>
                    </div>
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => startMove(l)}>
                        <ArrowRight className="w-4 h-4 mr-1" /> Move to account
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={!!moving} onOpenChange={(o) => { if (!o && !busy) setMoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move lead to an account</DialogTitle>
            <DialogDescription>
              {moving && <>Move <strong>{leadDisplayName(moving)}</strong> into an account and (optionally) a category.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Account</Label>
              <Select value={targetAccountId} onValueChange={(v) => { setTargetAccountId(v); setTargetCategory(NONE); }}>
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Pick an account —</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.clientId} value={a.clientId}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
