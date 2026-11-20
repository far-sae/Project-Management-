// "Add an agent to the chain": pick an agent that is in no chain, or a new one, and when it starts.
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { StartControl } from '@/components/automation/assistant/StartControl';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StepStart } from '../../../../api/_automation/shared/types';

const NEW = '__new__';

export interface AddToChainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The automation the agent joins. */
  automationName: string;
  /** Agents that can be added: the ones in no chain. */
  candidates: Array<{ id: string; name: string }>;
  busy: boolean;
  /** The server's sentence when the chain could not be saved. */
  error: string;
  /** `agentId` is null for a new agent, which is made first and then joins. */
  onAdd: (agentId: string | null, starts: StepStart) => void;
}

export const AddToChainDialog: React.FC<AddToChainDialogProps> = ({
  open, onOpenChange, automationName, candidates, busy, error, onAdd,
}) => {
  const [choice, setChoice] = useState<string>(NEW);
  const [starts, setStarts] = useState<StepStart>({ type: 'after_previous' });

  // Each time it opens it starts from the first agent that is free, straight away.
  useEffect(() => {
    if (!open) return;
    setChoice(candidates[0]?.id ?? NEW);
    setStarts({ type: 'after_previous' });
  }, [open]);

  const isNew = choice === NEW;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an agent to the chain</DialogTitle>
          <DialogDescription>
            It joins the end of “{automationName}”. You can move it up afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Agent</span>
            <Select value={choice} onValueChange={setChoice} disabled={busy}>
              <SelectTrigger aria-label="Agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}
                <SelectItem value={NEW}>A new agent</SelectItem>
              </SelectContent>
            </Select>
            {isNew && (
              <p className="text-xs text-muted-foreground">
                You describe the new agent next. It joins the chain when you save it.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">When it starts</span>
            <StartControl value={starts} onChange={setStarts} label="When it starts" disabled={busy} />
            <p className="text-xs text-muted-foreground">
              “Straight away” means as soon as the step before it has finished.
            </p>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => onAdd(isNew ? null : choice, starts)} disabled={busy}>
            {busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {isNew ? 'Continue' : 'Add to the chain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddToChainDialog;
