// Who takes the calls that come in when a lead calls back: a short list of
// people and their phone numbers (anywhere in the world), rung one after the
// other. Each phone rings for a set time (12 seconds unless changed); when it
// is not answered, the next person is rung.
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SetupHint } from '@/components/common/SetupHint';
import { callBacks, errorSentence, saveCallBacks } from '@/services/voice/client';
import type { CallBackPerson, CallBackSettings } from '../../../api/_voice/shared/types';

interface Props {
  open: boolean;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
}

export const PEOPLE_MAX = 5;
/** A number in international form: +, country code, number (spaces and dashes are fine while typing). */
export const looksInternational = (typed: string): boolean => /^\+[1-9]\d{7,14}$/.test(typed.replace(/[\s().-]/g, ''));

export const CallBacksDialog: React.FC<Props> = ({ open, workspaceId, onOpenChange }) => {
  const [settings, setSettings] = useState<CallBackSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [people, setPeople] = useState<CallBackPerson[]>([]);
  const [ringSeconds, setRingSeconds] = useState('12');
  const [screen, setScreen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** After a save: the provider could not be told, so the owner does it by hand. */
  const [byHand, setByHand] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let alive = true;
    setSettings(null);
    setProblem(null);
    setByHand(null);
    callBacks(workspaceId)
      .then((now) => {
        if (!alive) return;
        setSettings(now);
        setEnabled(now.enabled);
        setPeople(now.people.length ? now.people : [{ name: '', number: '' }]);
        setRingSeconds(String(now.ringSeconds));
        setScreen(now.screen);
      })
      .catch((error) => { if (alive) setProblem(errorSentence(error)); });
    return () => { alive = false; };
  }, [open, workspaceId]);

  const change = (index: number, patch: Partial<CallBackPerson>) => setPeople((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const move = (index: number, by: -1 | 1) => setPeople((list) => {
    const next = [...list];
    const to = index + by;
    if (to < 0 || to >= next.length) return list;
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });

  const filled = people.filter((p) => p.name.trim() || p.number.trim());
  const wrong = filled.find((p) => !looksInternational(p.number));
  const blocked = wrong
    ? `The number of ${wrong.name.trim() || 'one person'} must start with + and the country code, for example +91 98123 45678.`
    : enabled && filled.length === 0 ? 'Add at least one person before switching call-backs on.' : null;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveCallBacks(workspaceId, { enabled, people: filled, ringSeconds: Number(ringSeconds) || 12, screen });
      if (saved.enabled && saved.linked === false) {
        // Saved, but the phone provider was not told: the owner sets the address there by hand.
        setByHand(saved.address ?? '');
        toast.success('Saved. One more step is needed: see the note in the window.');
      } else {
        toast.success(saved.enabled ? 'Saved. Calls to your number now ring these people.' : 'Saved. Call-backs are off.');
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(errorSentence(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>When somebody calls back</DialogTitle>
          <DialogDescription>
            A call to your number rings these people one after the other. When one does not answer in time, the next one is rung.
            {settings?.numbers.length ? ` Your ${settings.numbers.length === 1 ? 'number' : 'numbers'}: ${settings.numbers.join(', ')}.` : ''}
          </DialogDescription>
        </DialogHeader>

        {problem ? (
          <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{problem}</p>
        ) : !settings ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden /></div>
        ) : !settings.ready ? (
          <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
            <SetupHint>Call-backs are not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then open this window again.</SetupHint>
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span><span className="font-medium text-foreground">Take call-backs</span><br /><span className="text-muted-foreground">Off: a caller hears that nobody is free, and the call is logged as missed.</span></span>
            </label>

            <fieldset>
              <legend className="text-sm font-medium">Who is rung, in this order</legend>
              <ol className="mt-2 flex flex-col gap-2">
                {people.map((person, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2" aria-label={`Person ${index + 1}`}>
                    <span className="w-5 shrink-0 text-center text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                    <Input aria-label={`Name of person ${index + 1}`} placeholder="Name" className="w-36" maxLength={60} value={person.name} onChange={(e) => change(index, { name: e.target.value })} />
                    <Input aria-label={`Phone number of person ${index + 1}`} placeholder="+91 98123 45678" className="min-w-0 flex-1" inputMode="tel" value={person.number} onChange={(e) => change(index, { number: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Ring person ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp aria-hidden /></Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Ring person ${index + 1} later`} disabled={index === people.length - 1} onClick={() => move(index, 1)}><ArrowDown aria-hidden /></Button>
                    <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={`Remove person ${index + 1}`} onClick={() => setPeople((list) => (list.length === 1 ? [{ name: '', number: '' }] : list.filter((_, i) => i !== index)))}><Trash2 aria-hidden /></Button>
                  </li>
                ))}
              </ol>
              {people.length < PEOPLE_MAX && (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setPeople((list) => [...list, { name: '', number: '' }])}><Plus aria-hidden />Add a person</Button>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Write each number with + and the country code. A number in another country works too. Ringing it is a call your phone provider charges you for, at its price for that country, and that country must be allowed in the provider&apos;s settings.
              </p>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="cb-seconds">Each phone rings for (seconds)</Label>
                <Input id="cb-seconds" type="number" min={5} max={60} step={1} value={ringSeconds} onChange={(e) => setRingSeconds(e.target.value)} />
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={screen} onChange={(e) => setScreen(e.target.checked)} />
              <span>
                <span className="font-medium text-foreground">Press a key to take the call</span><br />
                <span className="text-muted-foreground">The person who picks up hears who is calling and presses any key. Without this, a phone&apos;s voicemail would take the call and the next person would never be rung.</span>
              </span>
            </label>

            {blocked && <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{blocked}</p>}
            {byHand !== null && (
              <div role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                <p className="font-medium">Saved, but your phone provider was not told yet.</p>
                <SetupHint other="Please ask the person who set up calling to finish this step.">
                  <p className="mt-1">
                    In the provider&apos;s console open Phone Numbers, choose your number, and under “A call comes in” choose Webhook, POST, with this address:
                  </p>
                  <code className="mt-1 block break-all rounded bg-background px-2 py-1 text-foreground">{byHand}</code>
                </SetupHint>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{byHand !== null ? 'Close' : 'Cancel'}</Button>
          {settings?.ready && !problem && (
            <Button disabled={busy || blocked !== null} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" aria-hidden />}Save</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CallBacksDialog;
