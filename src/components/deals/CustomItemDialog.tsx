import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useDeals } from '@/hooks/useDeals';
import { DEAL_STAGES, Deal, DealStage } from '@/services/supabase/deals';
import {
  CustomFieldsBuilder, readFields, writeFields, type CustomFieldDef,
} from '@/components/deals/CustomFieldsBuilder';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { toast } from 'sonner';

const makeFieldId = (): string => {
  try { return crypto.randomUUID(); } catch { return `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }
};

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
 * Fields: Title (required) + a fully freeform CustomFieldsBuilder over the
 * item's customFields. Custom items are NOT bound to money — there is no fixed
 * Value/Currency; money is just one optional field type the user can add. When
 * a "Money" field is present its amount/currency back the stored deal's
 * value/currency so the item still shows money in the pipeline; otherwise the
 * value is 0. Custom items are also NOT bound to a pipeline stage — the stored
 * deal's stage is defaulted internally purely to satisfy the deals table.
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
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!open) return;
    if (deal) {
      setTitle(deal.title ?? '');
      let fields = deal.customFields ?? {};
      // Back-compat: a custom item created before money became a field stored
      // its amount in deal.value with no Money field. Surface it as an
      // editable Money field so it stays visible and editing doesn't drop it.
      const defs = readFields(fields);
      if (deal.value && !defs.some((f) => f.type === 'money')) {
        const moneyField: CustomFieldDef = {
          id: makeFieldId(),
          label: 'Value',
          type: 'money',
          currency: deal.currency || orgCurrency,
          value: deal.value,
        };
        fields = writeFields(fields, [moneyField, ...defs]);
      }
      setCustomFields(fields);
      return;
    }
    setTitle('');
    setCustomFields({});
  }, [open, deal, orgCurrency]);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) { toast.error('Title is required'); return; }
    // Money is optional now — derive the stored deal value/currency from the
    // first Money field if the user added one, else 0 / org currency.
    const moneyField = readFields(customFields).find((f) => f.type === 'money');
    const numericValue = moneyField && moneyField.value != null ? Number(moneyField.value) : 0;
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      toast.error('Money amount must be a non-negative number');
      return;
    }
    const resolvedCurrency = moneyField?.currency || orgCurrency;
    setBusy(true);
    try {
      const payload = {
        title: trimmed,
        clientId: clientId ?? deal?.clientId ?? null,
        value: numericValue,
        currency: resolvedCurrency,
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

          <div className="border-t pt-3">
            <CustomFieldsBuilder
              fields={customFields}
              onChange={(next) => setCustomFields(next)}
              defaultCurrency={orgCurrency}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Define whatever fields you need. Add a <strong>Money</strong> field
              only if this item has a value — it'll then show in the pipeline.
            </p>
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
