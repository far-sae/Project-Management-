import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DEAL_STAGES, Deal, DealStage } from '@/services/supabase/deals';
import { toast } from 'sonner';

interface DealVerifyDetailsDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deal: Deal | null;
  /** Stage the rep just clicked on the Path. The dialog opens pre-loaded
   *  with this stage selected but the rep can still change it. */
  targetStage: DealStage | null;
  /** When the rep saves, fire this with the verified patch — the parent owns
   *  the actual update + toast. */
  onConfirm: (patch: { stage: DealStage; value: number; expectedCloseDate: Date | null }) => Promise<void>;
}

/**
 * Zoho's "Verify Details" popup that fires when a rep advances a deal via
 * the Stage Path. Asks for Amount, Closing Date, and confirms the Stage.
 * Prevents reps from accidentally walking a deal forward without making sure
 * the numbers and dates still reflect reality.
 */
export const DealVerifyDetailsDialog: React.FC<DealVerifyDetailsDialogProps> = ({
  open, onOpenChange, deal, targetStage, onConfirm,
}) => {
  const [stage, setStage] = useState<DealStage>('lead');
  const [amount, setAmount] = useState<string>('');
  const [closeDate, setCloseDate] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !deal) return;
    setStage(targetStage ?? deal.stage);
    setAmount(String(deal.value ?? ''));
    setCloseDate(
      deal.expectedCloseDate ? deal.expectedCloseDate.toISOString().slice(0, 10) : '',
    );
  }, [open, deal, targetStage]);

  const handleSave = async () => {
    if (!deal) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      toast.error('Amount must be a non-negative number');
      return;
    }
    setBusy(true);
    try {
      await onConfirm({
        stage,
        value: numericAmount,
        expectedCloseDate: closeDate ? new Date(closeDate) : null,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>Verify Details</DialogTitle>
          <DialogDescription>
            Confirm the amount, closing date, and stage before moving the deal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="vd-amount" className="text-right text-sm">Amount</Label>
            <Input
              id="vd-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10000"
            />
          </div>

          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="vd-close" className="text-right text-sm">Closing Date</Label>
            <Input
              id="vd-close"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <Label htmlFor="vd-stage" className="text-right text-sm">Stage</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as DealStage)}>
              <SelectTrigger id="vd-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
