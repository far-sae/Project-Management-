import React, { useMemo, useState } from 'react';
import { Loader2, ListChecks, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Client, ClientStatus, ClientType, UpdateClientInput,
} from '@/services/supabase/clients';

const TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'customer', label: 'Customer' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'partner', label: 'Partner' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const KEEP = '__keep__';
const CLEAR = '__clear__';

const splitTags = (raw: string): string[] =>
  raw.split(',').map((t) => t.trim()).filter(Boolean);

interface BulkEditClientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onApply: (clientId: string, input: UpdateClientInput) => Promise<void>;
  onClear: () => void;
}

export const BulkEditClientsDialog: React.FC<BulkEditClientsDialogProps> = ({
  open, onOpenChange, clients, onApply, onClear,
}) => {
  const [statusChoice, setStatusChoice] = useState<string>(KEEP);
  const [typeChoice, setTypeChoice] = useState<string>(KEEP);
  const [categoryMode, setCategoryMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [categoryValue, setCategoryValue] = useState('');
  const [tagsToAdd, setTagsToAdd] = useState('');
  const [tagsToRemove, setTagsToRemove] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);

  const count = clients.length;
  const summary = useMemo(() => {
    const lines: string[] = [];
    if (statusChoice !== KEEP) lines.push(`Set status → ${statusChoice}`);
    if (typeChoice !== KEEP) lines.push(`Set type → ${typeChoice}`);
    if (categoryMode === 'set' && categoryValue.trim()) {
      lines.push(`Set category → "${categoryValue.trim()}"`);
    }
    if (categoryMode === 'clear') lines.push('Clear category');
    const adds = splitTags(tagsToAdd);
    if (adds.length) lines.push(`Add tags → ${adds.join(', ')}`);
    const removes = splitTags(tagsToRemove);
    if (removes.length) lines.push(`Remove tags → ${removes.join(', ')}`);
    return lines;
  }, [statusChoice, typeChoice, categoryMode, categoryValue, tagsToAdd, tagsToRemove]);

  const hasChanges = summary.length > 0;

  const reset = () => {
    setStatusChoice(KEEP);
    setTypeChoice(KEEP);
    setCategoryMode('keep');
    setCategoryValue('');
    setTagsToAdd('');
    setTagsToRemove('');
    setProgress(null);
  };

  const handleClose = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const buildPatch = (client: Client): UpdateClientInput | null => {
    const patch: UpdateClientInput = {};
    let touched = false;

    if (statusChoice !== KEEP && client.status !== statusChoice) {
      patch.status = statusChoice as ClientStatus;
      touched = true;
    }
    if (typeChoice !== KEEP && client.type !== typeChoice) {
      patch.type = typeChoice as ClientType;
      touched = true;
    }
    if (categoryMode === 'set') {
      const next = categoryValue.trim();
      if (next && next !== (client.category ?? '')) {
        patch.category = next;
        touched = true;
      }
    } else if (categoryMode === 'clear' && client.category) {
      patch.category = null;
      touched = true;
    }

    const adds = splitTags(tagsToAdd);
    const removes = splitTags(tagsToRemove);
    if (adds.length || removes.length) {
      const removeSet = new Set(removes.map((t) => t.toLowerCase()));
      const current = client.tags ?? [];
      const filtered = current.filter((t) => !removeSet.has(t.toLowerCase()));
      const existing = new Set(filtered.map((t) => t.toLowerCase()));
      const merged = [...filtered];
      for (const add of adds) {
        if (!existing.has(add.toLowerCase())) {
          merged.push(add);
          existing.add(add.toLowerCase());
        }
      }
      const changed =
        merged.length !== current.length ||
        merged.some((t, i) => t !== current[i]);
      if (changed) {
        patch.tags = merged;
        touched = true;
      }
    }

    return touched ? patch : null;
  };

  const handleApply = async () => {
    if (!hasChanges || count === 0) return;
    setBusy(true);
    setProgress({ done: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const client of clients) {
      const patch = buildPatch(client);
      if (!patch) {
        done += 1;
        setProgress({ done, failed });
        continue;
      }
      try {
        await onApply(client.clientId, patch);
        done += 1;
      } catch {
        failed += 1;
      }
      setProgress({ done, failed });
    }
    setBusy(false);
    if (failed === 0) {
      reset();
      onOpenChange(false);
      onClear();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" /> Mass edit clients
          </DialogTitle>
          <DialogDescription>
            Apply the same change to <strong>{count}</strong> selected client
            {count === 1 ? '' : 's'}. Empty fields below mean "leave as-is."
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusChoice} onValueChange={setStatusChoice} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={typeChoice} onValueChange={setTypeChoice} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Category</Label>
            <div className="flex gap-2">
              <Select
                value={categoryMode === 'set' ? 'set' : categoryMode === 'clear' ? CLEAR : KEEP}
                onValueChange={(v) => {
                  if (v === KEEP) setCategoryMode('keep');
                  else if (v === CLEAR) { setCategoryMode('clear'); setCategoryValue(''); }
                  else setCategoryMode('set');
                }}
                disabled={busy}
              >
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  <SelectItem value="set">Set to…</SelectItem>
                  <SelectItem value={CLEAR}>Clear</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="e.g. Enterprise"
                value={categoryValue}
                onChange={(e) => setCategoryValue(e.target.value)}
                disabled={busy || categoryMode !== 'set'}
                maxLength={120}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Add tags (comma-separated)</Label>
              <Input
                placeholder="vip, q2-target"
                value={tagsToAdd}
                onChange={(e) => setTagsToAdd(e.target.value)}
                disabled={busy}
                maxLength={400}
              />
            </div>
            <div>
              <Label className="text-xs">Remove tags (comma-separated)</Label>
              <Input
                placeholder="cold-lead, archive"
                value={tagsToRemove}
                onChange={(e) => setTagsToRemove(e.target.value)}
                disabled={busy}
                maxLength={400}
              />
            </div>
          </div>

          {hasChanges && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">Will apply:</p>
              {summary.map((line) => (
                <div key={line} className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">change</Badge>
                  {line}
                </div>
              ))}
            </div>
          )}

          {progress && (
            <div className="rounded-md border bg-background p-3 text-xs">
              Updated {progress.done} of {count}
              {progress.failed > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="w-3 h-3" /> {progress.failed} failed
                </span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={busy || !hasChanges || count === 0}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Apply to {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
