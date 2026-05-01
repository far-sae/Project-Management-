import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDeals } from '@/hooks/useDeals';
import { Client } from '@/services/supabase/clients';
import { DEAL_STAGES, DealStage } from '@/services/supabase/deals';
import { toast } from 'sonner';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];
const SOURCES = ['Inbound', 'Referral', 'Outbound', 'Event', 'Other'];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultStage?: DealStage;
  defaultClientId?: string | null;
  clients: Client[];
}

export const NewDealDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  defaultStage = 'lead',
  defaultClientId = null,
  clients,
}) => {
  const { create } = useDeals();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    clientId: defaultClientId ?? 'none',
    stage: defaultStage,
    value: '',
    currency: 'USD',
    expectedCloseDate: '',
    source: 'none',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      title: '',
      description: '',
      clientId: defaultClientId ?? 'none',
      stage: defaultStage,
      value: '',
      currency: 'USD',
      expectedCloseDate: '',
      source: 'none',
    });
  }, [open, defaultStage, defaultClientId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    const value = Number(form.value || 0);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Value must be a positive number');
      return;
    }
    setBusy(true);
    try {
      const client =
        form.clientId !== 'none'
          ? clients.find((c) => c.clientId === form.clientId)
          : null;
      await create({
        title: form.title.trim(),
        description: form.description.trim() || null,
        clientId: client?.clientId ?? null,
        clientName: client?.name ?? null,
        stage: form.stage,
        value,
        currency: form.currency,
        expectedCloseDate: form.expectedCloseDate
          ? new Date(form.expectedCloseDate)
          : null,
        source: form.source !== 'none' ? form.source : null,
      });
      toast.success('Deal created');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create deal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>
            Track a sales opportunity through your pipeline.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Q3 expansion — Acme Corp"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="d-client">Client</Label>
            <Select
              value={form.clientId}
              onValueChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            >
              <SelectTrigger id="d-client"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.clientId} value={c.clientId}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-value">Value</Label>
              <Input
                id="d-value"
                type="number"
                min="0"
                step="0.01"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-currency">Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              >
                <SelectTrigger id="d-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-stage">Stage</Label>
              <Select
                value={form.stage}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, stage: v as DealStage }))
                }
              >
                <SelectTrigger id="d-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-close">Expected close</Label>
              <Input
                id="d-close"
                type="date"
                value={form.expectedCloseDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="d-source">Source</Label>
            <Select
              value={form.source}
              onValueChange={(v) => setForm((f) => ({ ...f, source: v }))}
            >
              <SelectTrigger id="d-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Notes</Label>
            <Textarea
              id="d-desc"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewDealDialog;
