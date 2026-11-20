// "They replied": tells a run that the lead answered somewhere the agents cannot see.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Run } from '../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import { errorSentence } from '@/services/automation/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const NOTE_MAX = 1000;

const ANSWERS: ReadonlyArray<{ positive: boolean; label: string; note: string }> = [
  { positive: true, label: 'Positive', note: 'They are interested or want to talk.' },
  { positive: false, label: 'Not positive', note: 'They said no, or not now.' },
];

const Form: React.FC<{
  run: { id: string; subject: string };
  onSaved: (run: Run) => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}> = ({ run, onSaved, onClose, onBusy }) => {
  const id = useId();
  const { client } = useAutomation();
  const [positive, setPositive] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (positive === null || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      const text = note.trim();
      const next = await client.call<Run>(`runs/${run.id}/replied`, text ? { positive, note: text } : { positive });
      toast.success('Reply logged on the lead. The run goes on from here.');
      onSaved(next);
    } catch (e) {
      toast.error(errorSentence(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <DialogHeader>
        <DialogTitle className="pr-8">They replied</DialogTitle>
        <DialogDescription>
          Use this when {run.subject} answered somewhere the agents cannot see, such as a phone call. The reply is
          logged on the lead and the run goes on.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-2 text-sm font-medium text-foreground">How did they answer?</legend>
        {ANSWERS.map((answer) => (
          <label key={answer.label} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
            <input
              type="radio"
              name={`${id}-answer`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={positive === answer.positive}
              onChange={() => setPositive(answer.positive)}
            />
            <span className="min-w-0">
              <span className="font-medium">{answer.label}</span>
              <span className="block text-xs text-muted-foreground">{answer.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-note`}>Note (optional)</Label>
        <Textarea
          id={`${id}-note`} rows={3} value={note} maxLength={NOTE_MAX} disabled={busy}
          placeholder="What they said, in a line or two"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <DialogFooter className="gap-y-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || positive === null}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Log the reply
        </Button>
      </DialogFooter>
    </form>
  );
};

/**
 * Open while `run` is set. Saving posts `{ positive, note? }` to the run and
 * hands the run, as the server now has it, to `onSaved`.
 */
export const RepliedDialog: React.FC<{
  run: { id: string; subject: string } | null;
  onClose: () => void;
  onSaved: (run: Run) => void;
}> = ({ run, onClose, onSaved }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={run !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {run && <Form key={run.id} run={run} onSaved={onSaved} onClose={onClose} onBusy={setBusy} />}
      </DialogContent>
    </Dialog>
  );
};

export default RepliedDialog;
