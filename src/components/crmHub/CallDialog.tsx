import React, { useEffect, useId, useRef, useState } from 'react';
import { Grip, Loader2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { endCall, errorSentence, startCall } from '@/services/voice/client';
import { openLine, type Line } from '@/services/voice/device';
import {
  COUNTRY_NAME, dialable, formatNumber, guessCountry, type CallCountry,
} from '../../../api/_voice/shared/numbers';
import {
  OUTCOME_LABEL, OUTCOMES, type CallOutcome, type VoiceSetup,
} from '../../../api/_voice/shared/types';

/**
 * Rings a lead's or a company's phone from the browser. The call is recorded
 * (the person called hears a notice first) and logged on the timeline by the
 * server when it ends; here the caller adds how it went.
 */

type Phase = 'ready' | 'connecting' | 'ringing' | 'live' | 'ended';

export interface CallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who is being called, for the title. */
  name: string;
  /** The number on the record, as it was typed there. */
  phone: string;
  target: { contactId: string } | { companyId: string };
  setup: VoiceSetup;
  /** Called once the call is on the timeline. */
  onLogged?: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const clock = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const lasted = (seconds: number): string => {
  if (seconds < 60) return `${seconds} s`;
  return seconds % 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.floor(seconds / 60)} min`;
};

export const CallDialog: React.FC<CallDialogProps> = ({ open, onOpenChange, name, phone, target, setup, onLogged }) => {
  const fieldId = useId();
  const [number, setNumber] = useState(phone);
  const [country, setCountry] = useState<CallCountry | ''>('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [problem, setProblem] = useState<string | null>(null);
  const [display, setDisplay] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome>('no_answer');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const line = useRef<Line | null>(null);
  const callId = useRef<string | null>(null);
  const answeredAt = useRef<number | null>(null);
  /** True once this call's "how it went" has been sent, so closing does not send it twice. */
  const reported = useRef(false);
  /** True when "Hang up" was pressed before the line was open: the line is closed as soon as it exists. */
  const abandoned = useRef(false);

  const active = phase === 'connecting' || phase === 'ringing' || phase === 'live';

  // A fresh window every time it opens.
  useEffect(() => {
    if (!open) return;
    setNumber(phone);
    setCountry('');
    setPhase('ready');
    setProblem(null);
    setDisplay('');
    setSeconds(0);
    setMuted(false);
    setShowKeys(false);
    setOutcome('no_answer');
    setNote('');
    setSaving(false);
    line.current = null;
    callId.current = null;
    answeredAt.current = null;
    reported.current = false;
    abandoned.current = false;
  }, [open, phone]);

  // The clock of a call that was answered.
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = window.setInterval(() => {
      if (answeredAt.current) setSeconds(Math.round((Date.now() - answeredAt.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Leaving the page hangs up.
  useEffect(() => () => line.current?.hangUp(), []);

  const guessed = guessCountry(number);
  const needsCountry = !number.trim().startsWith('+') && !number.trim().startsWith('00') && guessed === null;
  const checked = dialable(number, country || null);
  const noNumber = checked.ok && !setup.numbers[checked.country];
  const blocked = !setup.ready
    ? setup.problem
    : noNumber && checked.ok
      ? `You have no ${COUNTRY_NAME[checked.country]} number to call from yet.`
      : null;

  const report = (extra: { outcome?: CallOutcome; note?: string }) => {
    const id = callId.current;
    if (!id || reported.current) return Promise.resolve();
    reported.current = true;
    const answered = answeredAt.current !== null;
    return endCall(id, { ...extra, seconds: answered ? seconds : 0, answered });
  };

  const place = async () => {
    if (!checked.ok || blocked) return;
    setProblem(null);
    setPhase('connecting');
    try {
      const started = await startCall({ ...target, to: checked.e164, country: checked.country });
      callId.current = started.id;
      setDisplay(started.display);
      if (abandoned.current) {
        setPhase('ended');
        return;
      }
      const opened = await openLine(started.token, started.id, (event, why) => {
        if (event === 'ringing') setPhase((p) => (p === 'connecting' ? 'ringing' : p));
        if (event === 'answered') {
          answeredAt.current = Date.now();
          setOutcome('connected');
          setPhase('live');
        }
        if (event === 'ended') {
          line.current = null;
          if (answeredAt.current) setSeconds(Math.round((Date.now() - answeredAt.current) / 1000));
          if (why) setProblem(why);
          setPhase('ended');
        }
      });
      if (abandoned.current) opened.hangUp();
      else line.current = opened;
    } catch (err) {
      // The line itself reports its own failure through "ended"; this is the server refusing to start.
      if (!callId.current) {
        setProblem(errorSentence(err));
        setPhase('ready');
      }
    }
  };

  const hangUp = () => {
    if (line.current) line.current.hangUp();
    else abandoned.current = true;
  };

  const save = async () => {
    setSaving(true);
    try {
      await report({ outcome, note });
      onLogged?.();
      onOpenChange(false);
    } catch (err) {
      reported.current = false;
      setProblem(errorSentence(err));
    } finally {
      setSaving(false);
    }
  };

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    // A call in progress is ended with its own button, never by clicking away.
    if (active || saving) return;
    if (phase === 'ended') void report({}).then(() => onLogged?.()).catch(() => undefined);
    onOpenChange(false);
  };

  const status = phase === 'connecting' ? 'Connecting…' : phase === 'ringing' ? 'Ringing…' : phase === 'live' ? clock(seconds) : '';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={(e) => { if (active || phase === 'ended') e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (active) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Call {name}</DialogTitle>
          <DialogDescription>
            {phase === 'ready'
              ? 'From your browser, with your microphone.'
              : display || (checked.ok ? formatNumber(checked.e164) : number)}
          </DialogDescription>
        </DialogHeader>

        {phase === 'ready' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-number`}>Number</Label>
              <Input
                id={`${fieldId}-number`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                aria-describedby={`${fieldId}-hint`}
              />
              <p id={`${fieldId}-hint`} className={cn('text-xs', checked.ok ? 'text-muted-foreground' : 'text-destructive')}>
                {checked.ok
                  ? `Rings ${formatNumber(checked.e164)}, ${COUNTRY_NAME[checked.country]}.`
                  : needsCountry && !country && number.trim()
                    ? 'Choose the country of this number, or write it with +1 or +44.'
                    : checked.error}
              </p>
            </div>
            {needsCountry && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-country`}>Country</Label>
                <Select value={country} onValueChange={(v) => setCountry(v as CallCountry)}>
                  <SelectTrigger id={`${fieldId}-country`}><SelectValue placeholder="Choose a country" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">United States (+1)</SelectItem>
                    <SelectItem value="GB">United Kingdom (+44)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {blocked ? (
              <div role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm">
                <p>{blocked}</p>
                <a className="mt-1 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline" href={`tel:${number}`}>
                  Use my phone app instead
                </a>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-destructive" />
                This call is recorded. They hear “This call is being recorded” before you are connected.
              </p>
            )}
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          </div>
        )}

        {active && (
          <div className="flex flex-col items-center gap-4 py-2">
            <p role="status" aria-live="polite" className="text-2xl font-semibold tabular-nums">{status}</p>
            {phase === 'live' && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="size-2 rounded-full bg-destructive" />Recording
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                aria-pressed={muted}
                disabled={phase !== 'live'}
                onClick={() => { const next = !muted; line.current?.mute(next); setMuted(next); }}
              >
                {muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}{muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={showKeys}
                disabled={phase !== 'live'}
                onClick={() => setShowKeys((v) => !v)}
              >
                <Grip aria-hidden />Keypad
              </Button>
            </div>
            {showKeys && phase === 'live' && (
              <div role="group" aria-label="Keypad" className="grid grid-cols-3 gap-2">
                {KEYS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    className="h-11 w-14 text-base tabular-nums"
                    aria-label={`Press ${key === '*' ? 'star' : key === '#' ? 'hash' : key}`}
                    onClick={() => line.current?.press(key)}
                  >
                    {key}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === 'ended' && (
          <div className="flex flex-col gap-4">
            <p role="status" className="text-sm font-medium">
              {answeredAt.current ? `Call ended. ${lasted(seconds)}.` : 'The call was not answered.'}
            </p>
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-outcome`}>How did it go?</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)}>
                <SelectTrigger id={`${fieldId}-outcome`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-note`}>Note</Label>
              <Textarea
                id={`${fieldId}-note`}
                rows={3}
                maxLength={2000}
                placeholder="What was said, and what happens next"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === 'ready' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={place} disabled={!checked.ok || Boolean(blocked)}>
                <Phone aria-hidden />Call
              </Button>
            </>
          )}
          {active && (
            <Button variant="destructive" className="w-full sm:w-auto" onClick={hangUp}>
              <PhoneOff aria-hidden />Hang up
            </Button>
          )}
          {phase === 'ended' && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}Save to timeline
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
