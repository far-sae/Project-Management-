import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight, Check, CheckCheck, ChevronRight, Download, Loader2, Mail, PenLine, ShieldCheck,
} from 'lucide-react';
import { signroomClient } from '@/services/signroom/client';
import { missingGuestFields } from '@/lib/signroom/agreementFields';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import PdfViewer from '@/components/signroom/PdfViewer';
import SignaturePad from '@/components/signroom/SignaturePad';
import type { Field, PageInfo } from '../../../../api/_signroom/shared/types';
import { CheckRow, Notice } from './Card';
import { downloadGuestExport, downloadGuestPdf, messageOf } from './files';

/** What the server shows a verified guest (guest/document). */
type GuestDocument = {
  id: string;
  title: string;
  status: string;
  sender: string;
  logo?: string;
  name: string;
  email: string;
  purpose: string;
  fields: Field[];
  pages: PageInfo[];
  consent: { text: string; version: string };
  content: string;
  sourceHash: string;
  othersPending: number;
  artifacts: string[];
};

type Stage = 'loading' | 'entry' | 'code' | 'document' | 'signed' | 'declined' | 'unavailable';

/** Guests have no account: the server keeps their session in an HttpOnly cookie after the emailed code. */
const guest = signroomClient(null);

const PANEL = 'rounded-lg border border-border bg-card';

/** The three things a guest does, in order, with where they are now. */
const Progress: React.FC<{ stage: Stage; complete: boolean }> = ({ stage, complete }) => {
  const steps = complete
    ? ['Confirm your email', 'Download your files']
    : ['Confirm your email', 'Review and sign', 'Done'];
  const at = stage === 'entry' || stage === 'code' ? 0
    : stage === 'document' ? 1
      : stage === 'signed' || stage === 'declined' ? 2
        : -1;
  if (at < 0) return null;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5" aria-label="Steps">
      {steps.map((label, i) => (
        <li
          key={label}
          aria-current={i === at ? 'step' : undefined}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
            i === at ? 'border-foreground bg-foreground text-background'
              : i < at ? 'border-success/30 bg-success-soft text-success-soft-foreground'
                : 'border-border text-muted-foreground',
          )}
        >
          <span className="tabular-nums" aria-hidden>{i < at ? <Check className="h-3 w-3" /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
};

/**
 * What an invited person sees from the emailed link: a code sent to the invited
 * address, then the document with their fields, their consent and their
 * signature (or a decline), then a confirmation. A completion link shows the
 * finished files instead.
 */
export const GuestSigning: React.FC<{ access: string }> = ({ access }) => {
  const id = useId();
  const [entryPurpose, setEntryPurpose] = useState('sign');
  const [stage, setStage] = useState<Stage>('loading');
  const [doc, setDoc] = useState<GuestDocument | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [signature, setSignature] = useState('');
  const [drawing, setDrawing] = useState('');
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(0);
  const [selected, setSelected] = useState('');
  const inputs = useRef<Record<string, HTMLElement | null>>({});

  const loadDocument = async () => {
    const d = await guest.call<GuestDocument>('guest/document', { access });
    setDoc(d);
    setValues(Object.fromEntries(d.fields.filter((f) => f.kind === 'full_name').map((f) => [f.id, d.name])));
    setStage('document');
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const intro = await guest.call<{ purpose: string }>('guest/intro', { access });
        if (!active) return;
        setEntryPurpose(intro.purpose);
        try {
          // A session from an earlier visit is still good: go straight to the document.
          await loadDocument();
        } catch {
          if (active) setStage('entry');
        }
      } catch (e) {
        if (active) {
          setError(messageOf(e));
          setStage('unavailable');
        }
      }
    })();
    return () => { active = false; };
  }, [access]);

  const run = async (action: 'code' | 'verify' | 'sign' | 'decline') => {
    setError('');
    setBusy(true);
    try {
      if (action === 'code') {
        await guest.call('guest/code', { access });
        setStage('code');
      }
      if (action === 'verify') {
        await guest.call('guest/verify', { access, code });
        await loadDocument();
      }
      if (action === 'sign') {
        const result = await guest.call<{ pending: number }>('guest/sign', {
          access,
          sourceHash: doc?.sourceHash,
          consentVersion: doc?.consent.version,
          consent,
          signature,
          drawing,
          values,
        });
        setPending(result.pending);
        setStage('signed');
      }
      if (action === 'decline') {
        await guest.call('guest/decline', { access, reason });
        setDeclining(false);
        setStage('declined');
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  /** A failed download shows its message in the page's error line. */
  const download = (task: () => Promise<void>) => {
    setError('');
    task().catch((e) => setError(messageOf(e)));
  };

  const fields = doc?.fields ?? [];
  const missing = missingGuestFields(fields, signature, values);
  const required = fields.filter((f) => f.required).length;
  const done = required - missing.length;

  const focusField = (fieldId: string) => {
    setSelected(fieldId);
    const el = inputs.current[fieldId];
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el?.focus();
  };

  if (stage === 'loading') return (
    <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your invitation…
    </div>
  );

  if (stage !== 'document' || !doc) {
    const complete = entryPurpose === 'complete';
    const heading = stage === 'entry' ? (complete ? 'Your completed agreement is ready' : 'You’re invited to sign')
      : stage === 'code' ? 'Enter the code we emailed you'
        : stage === 'signed' ? 'You’ve signed'
          : stage === 'declined' ? 'Agreement declined'
            : 'This link is unavailable';
    const body = stage === 'entry' ? 'Verify access to your invited email before viewing the agreement or completion files.'
      : stage === 'code' ? 'Enter the six-digit code sent to the originally invited email address.'
        : stage === 'signed'
          ? pending
            ? `Your signature has been recorded. ${pending} other signer${pending === 1 ? ' is' : 's are'} still expected.`
            : 'All signatures are collected. We are preparing the final PDF and completion record. You will receive an email with the completed files.'
          : stage === 'declined' ? 'The sender will see that you declined, along with the reason you chose to share.'
            : 'Ask the sender for a fresh invitation. Completed agreements also support email-bound access recovery.';
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8 sm:py-14">
        <Progress stage={stage} complete={complete} />
        <section className={cn(PANEL, 'flex flex-col gap-4 p-5 sm:p-6')}>
          <span
            aria-hidden
            className={cn(
              'grid h-10 w-10 place-items-center rounded-full',
              stage === 'signed' ? 'bg-success text-success-foreground' : 'bg-secondary text-muted-foreground',
            )}
          >
            {stage === 'signed' ? <CheckCheck className="h-5 w-5" /> : stage === 'code' ? <Mail className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">No account needed</p>
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>

          {stage === 'code' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-code`}>Verification code</Label>
              <Input
                id={`${id}-code`}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                placeholder="000000"
                className="h-12 text-center font-mono tracking-[0.4em] tabular-nums md:h-12"
                onChange={(e) => setCode(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6 && !busy) void run('verify');
                }}
              />
            </div>
          )}

          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</p>}

          {stage === 'entry' ? (
            <Button size="lg" className="w-full" disabled={busy} onClick={() => void run('code')}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Send verification code <ArrowRight aria-hidden />
            </Button>
          ) : stage === 'code' ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" className="w-full" disabled={busy || code.length !== 6} onClick={() => void run('verify')}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Verify and open agreement <ArrowRight aria-hidden />
              </Button>
              <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void run('code')}>Send a new code</Button>
            </div>
          ) : stage === 'unavailable' ? (
            <Recovery />
          ) : null}

          <p className="text-xs text-muted-foreground">
            We verify access to your invited email with a one-time code. This does not verify legal identity.
          </p>
        </section>
      </main>
    );
  }

  const complete = doc.purpose === 'complete';

  return (
    <>
      <main className={cn('mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:py-8', !complete && 'pb-28')}>
        <Progress stage="document" complete={complete} />

        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            {doc.logo ? (
              <img src={doc.logo} width={40} height={40} alt={`${doc.sender} logo`} className="h-10 w-10 rounded-md border border-border object-contain" />
            ) : (
              <span aria-hidden className="grid h-10 w-10 place-items-center rounded-md bg-secondary text-sm font-semibold text-muted-foreground">
                {doc.sender.trim().charAt(0).toUpperCase() || '?'}
              </span>
            )}
            <p className="text-sm">
              <span className="block text-xs text-muted-foreground">Sent by</span>
              <span className="font-medium">{doc.sender}</span>
            </p>
          </div>
          <div>
            <h1 className="break-words text-2xl font-semibold tracking-tight">{doc.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {complete
                ? 'Completed and ready to download.'
                : `Prepared for ${doc.name}. Read the document, complete your fields and give explicit consent.`}
            </p>
          </div>
        </header>

        {complete ? (
          <section className={cn(PANEL, 'flex flex-col gap-4 p-5 sm:p-6')} aria-labelledby={`${id}-files`}>
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success text-success-foreground">
                <CheckCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 id={`${id}-files`} className="text-sm font-semibold">Everyone has signed</h2>
                <p className="text-sm text-muted-foreground">Your downloads are the same immutable files available to the sender.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { title: 'Signed agreement', note: 'Final PDF', icon: <Download aria-hidden />, task: () => downloadGuestPdf(guest, 'final') },
                { title: 'Completion record', note: 'Consent, timeline and digests', icon: <ShieldCheck aria-hidden />, task: () => downloadGuestPdf(guest, 'completion') },
                { title: 'Evidence export', note: 'PDFs and signed manifest', icon: <Download aria-hidden />, task: () => downloadGuestExport(guest) },
              ].map((file) => (
                <button
                  key={file.title}
                  type="button"
                  onClick={() => download(file.task)}
                  className="flex min-h-[44px] flex-col items-start gap-1 rounded-lg border border-border p-4 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground"
                >
                  {file.icon}
                  <span className="text-sm font-medium">{file.title}</span>
                  <span className="text-xs text-muted-foreground">{file.note}</span>
                </button>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Application-level evidence export. All timestamps UTC. No qualification or certification claim is made.
            </p>
          </section>
        ) : (
          <>
            <Notice icon={<PenLine />}>
              <span className="text-foreground">{doc.sender} has asked you to sign this document.</span>{' '}
              Read every page first. You sign by typing your name and ticking the consent box. You can decline instead.
            </Notice>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
              <section className="flex min-w-0 flex-col gap-3" aria-label="Document">
                <PdfViewer
                  guest="source"
                  maxWidth={920}
                  fields={doc.fields}
                  selected={selected}
                  onSelect={focusField}
                  recipientNames={Object.fromEntries(doc.fields.map((f) => [f.participantId, doc.name]))}
                />
                <Button variant="ghost" className="self-start" onClick={() => download(() => downloadGuestPdf(guest, 'source'))}>
                  <Download aria-hidden /> Download the exact PDF to be signed
                </Button>
                {doc.content && (
                  <details className={cn(PANEL, 'px-4 py-3')}>
                    <summary className="cursor-pointer select-none rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Read the agreement as text
                    </summary>
                    <div className="mt-3 whitespace-pre-wrap break-words text-sm">{doc.content}</div>
                  </details>
                )}
                <Notice icon={<ShieldCheck />}>
                  The sender can see verification, document views, your accepted field values, signature, consent and any
                  decline reason. IP addresses and location are not collected.
                </Notice>
              </section>

              <section className={cn(PANEL, 'flex flex-col gap-4 p-4 sm:p-5')} aria-labelledby={`${id}-fields`}>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h2 id={`${id}-fields`} className="text-sm font-semibold">Your fields</h2>
                    <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{done}/{required} complete</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each field below is assigned to you. Fields are also listed here for keyboard and screen-reader use.
                  </p>
                </div>

                <ol className="flex flex-col gap-3">
                  {doc.fields.map((f, i) => {
                    const fieldId = `${id}-f-${f.id}`;
                    const ref = (el: HTMLElement | null) => { inputs.current[f.id] = el; };
                    return (
                      <li
                        key={f.id}
                        className={cn('flex flex-col gap-1.5 rounded-md border p-3', selected === f.id ? 'border-foreground' : 'border-border')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          {f.kind === 'checkbox'
                            // The tick box carries its own label below, so the heading is not a second one.
                            ? <span className="text-sm font-medium"><span className="tabular-nums">{i + 1}.</span> {f.label}</span>
                            : <Label htmlFor={fieldId}><span className="tabular-nums">{i + 1}.</span> {f.label}</Label>}
                          <span className="text-xs text-muted-foreground">
                            {f.required ? 'Required' : 'Optional'} · <span className="tabular-nums">Page {f.page}</span>
                          </span>
                        </div>
                        {f.kind === 'signature' ? (
                          <Input
                            id={fieldId} ref={ref} value={signature} maxLength={150} autoComplete="name" placeholder="Type your full name"
                            onChange={(e) => setSignature(e.target.value)}
                          />
                        ) : f.kind === 'date_signed' ? (
                          <Input
                            id={fieldId} ref={ref} readOnly className="tabular-nums" value={new Date().toISOString().slice(0, 10)}
                            aria-label={`${f.label}, set by the server in UTC`}
                          />
                        ) : f.kind === 'checkbox' ? (
                          <label className="flex min-h-[44px] items-center gap-2.5 text-sm md:min-h-0">
                            <input
                              id={fieldId}
                              ref={ref}
                              type="checkbox"
                              className="h-4 w-4 shrink-0 accent-primary"
                              checked={Boolean(values[f.id])}
                              onChange={(e) => setValues({ ...values, [f.id]: e.target.checked })}
                            />
                            <span>{f.label}</span>
                          </label>
                        ) : (
                          <Input
                            id={fieldId} ref={ref} value={String(values[f.id] || '')} maxLength={500}
                            onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>

                <details className="rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer select-none rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Prefer to draw your signature?
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    <SignaturePad onChange={setDrawing} />
                    <p className="text-xs text-muted-foreground">Your typed name remains required as an accessible fallback.</p>
                  </div>
                </details>

                {signature && (
                  <div aria-label="Signature preview" className="rounded-md border border-dashed border-border px-3 py-3 text-center font-serif text-sm italic">
                    {signature}
                  </div>
                )}

                <div className="rounded-md border border-border bg-secondary/50 px-3">
                  <CheckRow checked={consent} onChange={setConsent}>
                    <span className="font-medium">{doc.consent.text}</span>
                  </CheckRow>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Consent version {doc.consent.version}. Signing date is recorded in UTC by the server.
                </p>

                {error && !declining && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</p>}

                <Button size="lg" className="w-full" disabled={busy || !consent || missing.length > 0} onClick={() => void run('sign')}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <PenLine aria-hidden />}
                  {busy ? 'Recording signature…' : 'Sign agreement'}
                </Button>
                <Button variant="ghost" className="w-full text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeclining(true)}>
                  Decline to sign
                </Button>
              </section>
            </div>
          </>
        )}
      </main>

      {!complete && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <p className="min-w-0 text-sm">
              <span className="block font-medium tabular-nums">{done} of {required} required fields complete</span>
              <span className="block text-xs text-muted-foreground">Review every page before signing.</span>
            </p>
            <Button variant="outline" onClick={() => missing[0] && focusField(missing[0].id)} disabled={missing.length === 0}>
              Next required field <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={declining} onOpenChange={(open) => { if (!busy) setDeclining(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this agreement?</DialogTitle>
            <DialogDescription>The agreement will stop for everyone. The sender can see your reason.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
            <Textarea id={`${id}-reason`} rows={3} maxLength={1000} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeclining(false)}>Keep reviewing</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run('decline')}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Confirm decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** For someone whose link has stopped working: ask for a fresh completion link by email. */
function Recovery() {
  const id = useId();
  const [agreementId, setAgreementId] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    try {
      const reply = await guest.call<{ message: string }>('guest/recover', { agreementId, email });
      setMessage(reply.message);
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-md border border-border px-3 py-2">
      <summary className="cursor-pointer select-none rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Recover completed documents
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-agreement`}>Agreement ID</Label>
          <Input id={`${id}-agreement`} value={agreementId} autoComplete="off" onChange={(e) => setAgreementId(e.target.value.trim())} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>Originally invited email</Label>
          <Input id={`${id}-email`} type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void request()}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Request new access
        </Button>
        <p role="status" className="text-sm text-muted-foreground">{message}</p>
      </div>
    </details>
  );
}

export default GuestSigning;
