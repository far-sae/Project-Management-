import { publicMessage } from '@/lib/publicError';
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { moveDealToStage } from '@/services/supabase/crmHub/deals';
import { probabilityAfterMove } from '@/lib/crmFlow';
import type { CrmDeal, CrmDealStage } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { DealHandoffDialog } from './DealHandoffDialog';

const LOST_REASONS = ['Price', 'Went with a competitor', 'No budget', 'Bad timing', 'No reply'];

interface Options {
  stages: CrmDealStage[];
  /** Called after the deal changed (moved, lost, or handed off). */
  onChanged: () => void | Promise<void>;
}

/**
 * One place for "move this deal to that stage", used by the board and the
 * deal page so both behave the same:
 *  - a Lost stage asks why first,
 *  - a Won stage moves the deal and then opens the hand-off to a project,
 *  - the chance of winning follows the stage.
 * Render `dialogs` once on the page.
 */
export function useDealMove({ stages, onChanged }: Options) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [losing, setLosing] = useState<{ deal: CrmDeal; stage: CrmDealStage } | null>(null);
  const [reason, setReason] = useState('');
  const [handoff, setHandoff] = useState<CrmDeal | null>(null);

  const move = useCallback(
    async (deal: CrmDeal, stage: CrmDealStage, lostReason?: string): Promise<boolean> => {
      const from = stages.find((s) => s.id === deal.stageId);
      setBusy(true);
      try {
        const moved = await moveDealToStage(deal.id, stage.id, stage.status, stage.name, {
          probability: probabilityAfterMove(deal.probability, from, stage),
          lostReason,
          actorId: user?.userId ?? null,
        });
        await onChanged();
        if (stage.status === 'won') {
          if (moved.projectId) toast.success(`“${deal.name}” marked as won`);
          else setHandoff(moved);
        } else if (stage.status === 'lost') {
          toast.success(`“${deal.name}” marked as lost`);
        } else {
          toast.success(`Moved to ${stage.name}`);
        }
        return true;
      } catch (err) {
        toast.error(publicMessage(err, 'Could not move the deal'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged, stages, user?.userId],
  );

  /** Ask to move a deal. Lost stages open the reason dialog instead of moving straight away. */
  const requestMove = useCallback(
    (deal: CrmDeal, stageId: string) => {
      const stage = stages.find((s) => s.id === stageId);
      if (!stage || stage.id === deal.stageId) return;
      if (stage.status === 'lost') {
        setReason('');
        setLosing({ deal, stage });
        return;
      }
      void move(deal, stage);
    },
    [move, stages],
  );

  const confirmLost = async () => {
    if (!losing) return;
    if (!reason.trim()) return;
    const ok = await move(losing.deal, losing.stage, reason.trim());
    if (ok) setLosing(null);
  };

  const dialogs = (
    <>
      <Dialog open={losing !== null} onOpenChange={(open) => !open && !busy && setLosing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark “{losing?.deal.name}” as lost</DialogTitle>
            <DialogDescription>
              Say why in a few words. The reasons add up on the CRM dashboard, so you can see what keeps losing deals.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lost-reason">Reason</Label>
            <div className="flex flex-wrap gap-1.5">
              {LOST_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={`h-7 rounded-full border px-2.5 text-xs font-medium transition-colors ${
                    reason === r
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <Textarea
              id="lost-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Or write your own…"
              disabled={busy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLosing(null)} disabled={busy}>Cancel</Button>
            {/* Required: a deal lost with no reason leaves the "Why deals are lost" panel empty. */}
            <Button variant="destructive" onClick={confirmLost} disabled={busy || !reason.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Mark as lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DealHandoffDialog
        deal={handoff}
        open={handoff !== null}
        onOpenChange={(open) => !open && setHandoff(null)}
        onLinked={onChanged}
      />
    </>
  );

  return { requestMove, openHandoff: setHandoff, busy, dialogs };
}
