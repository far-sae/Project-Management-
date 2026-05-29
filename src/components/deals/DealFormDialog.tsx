import React, { useEffect, useMemo, useState } from 'react';
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
import { Client, ClientContact } from '@/services/supabase/clients';
import {
  DEAL_STAGES, Deal, DealStage, STAGE_DEFAULT_PROBABILITY,
} from '@/services/supabase/deals';
import { toast } from 'sonner';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];
const DEAL_TYPES = ['New Business', 'Existing Business', 'Renewal', 'Other'];
const LEAD_SOURCES = [
  'Advertisement', 'Cold Call', 'Employee Referral', 'External Referral',
  'Online Store', 'Partner', 'Public Relations', 'Sales Email Alias',
  'Seminar Partner', 'Internal Seminar', 'Trade Show', 'Web Download',
  'Web Research', 'Chat', 'Other',
];

interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When provided, the form opens in edit mode. */
  deal?: Deal | null;
  clients: Client[];
  /** Optional pre-filtered contacts (e.g., contacts of the selected
   *  account). When the user changes Account, the parent can refilter and
   *  pass a fresh array. */
  contacts?: ClientContact[];
  defaultStage?: DealStage;
  defaultClientId?: string | null;
}

/**
 * Full Zoho-style two-column create / edit form for a Deal.
 *
 * Left column: Deal Owner (read-only — set to current user), Deal Name,
 * Account Name, Type, Next Step, Lead Source, Contact Name.
 * Right column: Amount, Closing Date, Stage, Probability (%),
 * Expected Revenue (read-only — computed), Campaign Source.
 * Bottom section: Description.
 */
export const DealFormDialog: React.FC<DealFormDialogProps> = ({
  open, onOpenChange, deal = null, clients, contacts = [],
  defaultStage = 'lead', defaultClientId = null,
}) => {
  const { create, update } = useDeals();
  const orgCurrency = useOrgCurrency();
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(deal);

  const [form, setForm] = useState({
    title: '',
    description: '',
    clientId: defaultClientId ?? 'none',
    contactId: 'none',
    stage: defaultStage,
    value: '',
    currency: orgCurrency,
    expectedCloseDate: '',
    probability: STAGE_DEFAULT_PROBABILITY[defaultStage],
    dealType: 'none',
    nextStep: '',
    leadSource: 'none',
    campaignSource: '',
  });

  useEffect(() => {
    if (!open) return;
    if (deal) {
      setForm({
        title: deal.title ?? '',
        description: deal.description ?? '',
        clientId: deal.clientId ?? 'none',
        contactId: deal.contactId ?? 'none',
        stage: deal.stage,
        value: String(deal.value ?? ''),
        currency: deal.currency || orgCurrency,
        expectedCloseDate: deal.expectedCloseDate
          ? deal.expectedCloseDate.toISOString().slice(0, 10)
          : '',
        probability: deal.probability ?? STAGE_DEFAULT_PROBABILITY[deal.stage],
        dealType: deal.dealType ?? 'none',
        nextStep: deal.nextStep ?? '',
        leadSource: deal.leadSource ?? deal.source ?? 'none',
        campaignSource: deal.campaignSource ?? '',
      });
      return;
    }
    setForm({
      title: '',
      description: '',
      clientId: defaultClientId ?? 'none',
      contactId: 'none',
      stage: defaultStage,
      value: '',
      currency: orgCurrency,
      expectedCloseDate: '',
      probability: STAGE_DEFAULT_PROBABILITY[defaultStage],
      dealType: 'none',
      nextStep: '',
      leadSource: 'none',
      campaignSource: '',
    });
  }, [open, deal, defaultStage, defaultClientId, orgCurrency]);

  // Re-sync probability when stage changes (Zoho behavior).
  useEffect(() => {
    setForm((f) => ({ ...f, probability: STAGE_DEFAULT_PROBABILITY[f.stage] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.stage]);

  const expectedRevenue = useMemo(() => {
    const v = Number(form.value);
    if (!Number.isFinite(v)) return 0;
    return Math.round((v * form.probability) / 100);
  }, [form.value, form.probability]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) { toast.error('Deal Name is required'); return; }
    const numericValue = form.value ? Number(form.value) : 0;
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      toast.error('Amount must be a non-negative number');
      return;
    }
    const client = clients.find((c) => c.clientId === form.clientId);
    if (!client && form.clientId !== 'none') {
      toast.error('Account no longer exists — pick another');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title,
        description: form.description.trim() || null,
        clientId: client?.clientId ?? null,
        clientName: client?.name ?? null,
        contactId: form.contactId !== 'none' ? form.contactId : null,
        stage: form.stage,
        value: numericValue,
        currency: form.currency,
        expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate) : null,
        dealType: form.dealType !== 'none' ? form.dealType : null,
        nextStep: form.nextStep.trim() || null,
        leadSource: form.leadSource !== 'none' ? form.leadSource : null,
        campaignSource: form.campaignSource.trim() || null,
      };
      if (isEdit && deal) {
        await update(deal.dealId, payload);
        toast.success('Deal updated');
      } else {
        await create(payload);
        toast.success(`Deal "${title}" created`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save deal');
    } finally {
      setBusy(false);
    }
  };

  // Contacts filter: only show contacts whose clientId matches the selected
  // account, plus any contact already linked to the deal (so editing doesn't
  // hide a legacy selection).
  const eligibleContacts = useMemo(() => {
    if (form.clientId === 'none') return contacts;
    return contacts.filter(
      (c) => c.clientId === form.clientId || c.contactId === deal?.contactId,
    );
  }, [contacts, form.clientId, deal?.contactId]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Deal' : 'Create Deal'}</DialogTitle>
          <DialogDescription>
            Track this opportunity in your sales pipeline.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-1">
            Deal Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {/* LEFT COLUMN */}
            <div>
              <Label className="text-xs text-muted-foreground">Deal Name *</Label>
              <Input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Website Design (Standard)"
                maxLength={200}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Amount</Label>
              <div className="flex gap-2">
                <Select value={form.currency} onValueChange={(v) => set('currency', v)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder="10000"
                  className="flex-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Account Name</Label>
              <Select value={form.clientId} onValueChange={(v) => set('clientId', v)}>
                <SelectTrigger><SelectValue placeholder="Select an account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No account —</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.clientId} value={c.clientId}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Closing Date</Label>
              <Input
                type="date"
                value={form.expectedCloseDate}
                onChange={(e) => set('expectedCloseDate', e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.dealType} onValueChange={(v) => set('dealType', v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {DEAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Stage</Label>
              <Select value={form.stage} onValueChange={(v) => set('stage', v as DealStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Next Step</Label>
              <Input
                value={form.nextStep}
                onChange={(e) => set('nextStep', e.target.value)}
                placeholder="e.g. Closing meeting"
                maxLength={200}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Probability (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.probability}
                onChange={(e) => set('probability', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Lead Source</Label>
              <Select value={form.leadSource} onValueChange={(v) => set('leadSource', v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Expected Revenue</Label>
              <Input
                value={`${form.currency} ${expectedRevenue.toLocaleString()}`}
                readOnly
                className="bg-muted/40 cursor-not-allowed"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Contact Name</Label>
              <Select
                value={form.contactId}
                onValueChange={(v) => set('contactId', v)}
                disabled={form.clientId === 'none' && eligibleContacts.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No primary contact —</SelectItem>
                  {eligibleContacts.map((c) => (
                    <SelectItem key={c.contactId} value={c.contactId}>
                      {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '(unnamed)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Campaign Source</Label>
              <Input
                value={form.campaignSource}
                onChange={(e) => set('campaignSource', e.target.value)}
                placeholder="e.g. Spring Outreach 2026"
                maxLength={200}
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-1">
            Description Information
          </h3>
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Notes the rep wants to keep with the deal record"
          />
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : isEdit ? 'Save changes' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
