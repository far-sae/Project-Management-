import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDeals } from '@/hooks/useDeals';
import { DEAL_STAGES, Deal, DealStage } from '@/services/supabase/deals';
import { CustomFieldsBuilder } from '@/components/deals/CustomFieldsBuilder';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { toast } from 'sonner';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Account this custom item belongs to. Created items are scoped here. */
  clientId?: string | null;
  /** Initial stage in create mode (e.g. the kanban column it was added from).
   *  Defaults to the first stage. */
  defaultStage?: DealStage;
  /** When provided, the dialog opens in edit mode for this custom item. */
  deal?: Deal | null;
}

/**
 * Minimal create/edit dialog for a "custom item" — a freeform pipeline record
 * stored as a deal with `dealType: 'custom'` + arbitrary `customFields`. No new
 * table: it reuses the deals table so it shows up in the rail/board/pipeline
 * tab alongside standard deals.
 *
 * Fields: Title (required), optional Value + currency, and a rich
 * CustomFieldsBuilder over the item's customFields. Custom items are NOT bound
 * to a pipeline stage — there is no Stage field; the stored deal's stage is
 * defaulted internally (first stage, e.g. 'lead') purely so it satisfies the
 * deals table.
 */
export const CustomItemDialog: React.FC<Props> = ({
  open, onOpenChange, clientId = null, defaultStage, deal = null,
}) => {
  const { create, update } = useDeals();
  const orgCurrency = useOrgCurrency();
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(deal);

  // Custom items aren't shown a Stage field. The stored deal still needs a
  // stage for the table, so we default it internally (preserve the existing
  // stage on edit, otherwise the first stage / caller-provided default).
  const internalStage: DealStage = deal?.stage ?? defaultStage ?? DEAL_STAGES[0].id;

  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(orgCurrency);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!open) return;
    if (deal) {
      setTitle(deal.title ?? '');
      setValue(deal.value ? String(deal.value) : '');
      setCurrency(deal.currency || orgCurrency);
      setCustomFields(deal.customFields ?? {});
      return;
    }
    setTitle('');
    setValue('');
    setCurrency(orgCurrency);
    setCustomFields({});
  }, [open, deal, orgCurrency, defaultStage]);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) { toast.error('Title is required'); return; }
    const numericValue = value ? Number(value) : 0;
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      toast.error('Value must be a non-negative number');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: trimmed,
        clientId: clientId ?? deal?.clientId ?? null,
        value: numericValue,
        currency,
        stage: internalStage,
        dealType: 'custom',
        customFields,
      };
      if (isEdit && deal) {
        await update(deal.dealId, payload);
        toast.success('Custom item updated');
      } else {
        await create(payload);
        toast.success(`Custom item "${trimmed}" created`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save custom item');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit custom item' : 'New custom item'}</DialogTitle>
          <DialogDescription>
            A freeform pipeline item with your own fields. It lives in the
            pipeline alongside deals.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ci-title">Title *</Label>
            <Input
              id="ci-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Retainer review"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ci-value">Value</Label>
              <Input
                id="ci-value"
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ci-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-3">
            <CustomFieldsBuilder
              fields={customFields}
              onChange={(next) => setCustomFields(next)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CustomItemDialog;
