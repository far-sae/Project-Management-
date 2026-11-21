import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** The usual reasons a lead is not worth pursuing. Any other reason can be typed. */
export const UNQUALIFIED_REASONS = ['Not a fit', 'No budget', 'Not the right time', 'No reply', 'Chose someone else'];

/** What the timeline says when a lead is marked unqualified. */
export const unqualifiedNote = (reason: string): string => `Marked unqualified: ${reason.trim()}`;

/**
 * Asks why before a lead is marked unqualified. The reason is required: a
 * list of leads that were dropped with no reason teaches nothing about which
 * leads to stop chasing.
 */
export const UnqualifiedDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
}> = ({ open, onOpenChange, leadName, busy = false, onConfirm }) => {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {leadName} unqualified</DialogTitle>
          <DialogDescription>Say why, so you can see later which leads are not worth chasing. The lead can be re-opened.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unqualified-reason">Reason</Label>
          <div className="flex flex-wrap gap-1.5">
            {UNQUALIFIED_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                aria-pressed={reason === r}
                className={cn(
                  'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors',
                  reason === r
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Textarea
            id="unqualified-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Or write your own…"
            disabled={busy}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={busy || !reason.trim()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Mark unqualified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
