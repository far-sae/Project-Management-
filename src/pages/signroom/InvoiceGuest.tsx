// The public page a customer opens from an emailed invoice or receipt link (/invoice#billing=<token>).
// No sign-in and no app sidebar: the emailed code is the proof, and the server keeps the session in a cookie.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, Lock, Mail } from 'lucide-react';
import { signroomClient } from '@/services/signroom/client';
import { errorSentence, formatMinor, shortDate } from '@/lib/signroom/billing';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PdfFrame } from '@/components/signroom/billing/PdfFrame';

const ARTIFACT = 'billing-guest/artifact';
const guest = signroomClient(null);

/** The token in `#billing=<token>`, or "". */
const readToken = (): string => new URLSearchParams(window.location.hash.slice(1)).get('billing') ?? '';

/**
 * What the document is, when the server says so after the code is accepted.
 * Today its reply is only `{ ok: true }`, and the figures are in the PDF itself.
 */
interface DocumentSummary {
  kind: 'invoice' | 'receipt';
  number: string;
  currency: string;
  totalMinor: number;
  balanceMinor: number;
  dueDate: string;
}

function summaryOf(reply: unknown): DocumentSummary | null {
  const d = (reply as { document?: Partial<DocumentSummary> } | null)?.document;
  if (!d || typeof d.number !== 'string' || typeof d.currency !== 'string') return null;
  if (typeof d.totalMinor !== 'number' || typeof d.balanceMinor !== 'number' || typeof d.dueDate !== 'string') return null;
  return { kind: d.kind === 'receipt' ? 'receipt' : 'invoice', number: d.number, currency: d.currency, totalMinor: d.totalMinor, balanceMinor: d.balanceMinor, dueDate: d.dueDate };
}

const Step: React.FC<{ n: number; label: string; state: 'now' | 'done' | 'next' }> = ({ n, label, state }) => (
  <li
    aria-current={state === 'now' ? 'step' : undefined}
    className={cn(
      'flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
      state === 'now' ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
    )}
  >
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[0.6875rem] tabular-nums">
      {state === 'done' ? <Check className="h-3 w-3" aria-label="Done" /> : n}
    </span>
    <span className="truncate">{label}</span>
  </li>
);

export const InvoiceGuestPage: React.FC = () => {
  const id = useId();
  // Read once, then take it out of the address bar: a re-render must not lose it.
  const found = useRef<string | null>(null);
  if (found.current === null) found.current = readToken();
  const access = found.current;

  const [sender, setSender] = useState('the sender');
  const [gone, setGone] = useState(false);
  const [requested, setRequested] = useState(false);
  const [verified, setVerified] = useState(false);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!access) return;
    let alive = true;
    guest.call<{ sender?: string }>('billing-guest/intro', { access })
      .then((reply) => { if (alive && reply.sender) setSender(reply.sender); })
      .catch((err) => {
        if (!alive) return;
        setGone(true);
        setError(errorSentence(err));
      });
    return () => { alive = false; };
  }, [access]);

  const act = async (kind: 'code' | 'verify') => {
    setBusy(true);
    setError('');
    try {
      const reply = await guest.call<unknown>(`billing-guest/${kind}`, kind === 'verify' ? { access, code } : { access });
      if (kind === 'code') setRequested(true);
      else {
        setSummary(summaryOf(reply));
        setVerified(true);
      }
    } catch (err) {
      setError(errorSentence(err));
    } finally {
      setBusy(false);
    }
  };

  const usable = Boolean(access) && !gone;
  const box = 'flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Only the person this was emailed to can open it.
        </div>
        <PageHeader
          title="Private financial document"
          description={usable ? `From ${sender}. Verify the invited email before viewing the invoice or receipt.` : undefined}
        />

        {!access ? (
          <p role="alert" className={cn(box, 'text-sm text-destructive')}>
            This link is incomplete. Please open the link from your email again.
          </p>
        ) : gone ? (
          <div className={box}>
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <p className="text-sm text-muted-foreground">Ask {sender} to send the document again if you still need it.</p>
          </div>
        ) : (
          <>
            <ol className="flex gap-2" aria-label="Steps">
              <Step n={1} label="Confirm your email" state={verified ? 'done' : 'now'} />
              <Step n={2} label="Your document" state={verified ? 'now' : 'next'} />
            </ol>

            {!verified ? (
              <section className={box} aria-labelledby={`${id}-step-1`}>
                <div className="flex flex-col gap-1">
                  <h2 id={`${id}-step-1`} className="text-sm font-semibold">Confirm your email</h2>
                  <p className="text-sm text-muted-foreground">
                    We send a 6-digit code to the email address this document was sent to. The code works for ten minutes.
                  </p>
                </div>
                <div>
                  <Button variant={requested ? 'outline' : 'default'} size="lg" disabled={busy} onClick={() => void act('code')}>
                    {busy && !requested ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
                    Email me a code
                  </Button>
                </div>
                {requested && (
                  <form
                    className="flex flex-col gap-3 border-t border-border pt-4"
                    onSubmit={(event) => { event.preventDefault(); void act('verify'); }}
                  >
                    <p className="text-sm text-muted-foreground" role="status">The code is on its way. Check your inbox, then type it here.</p>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${id}-code`}>Verification code</Label>
                      <Input
                        id={`${id}-code`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        required
                        autoFocus
                        className="h-12 max-w-48 text-center font-medium tabular-nums tracking-[0.3em] md:h-11"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    <div>
                      <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
                        {busy && <Loader2 className="animate-spin" aria-hidden />}
                        View document
                      </Button>
                    </div>
                  </form>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              </section>
            ) : (
              <section className={box} aria-labelledby={`${id}-step-2`}>
                <div className="flex flex-col gap-1">
                  <h2 id={`${id}-step-2`} className="text-sm font-semibold">
                    {summary ? `${summary.kind === 'receipt' ? 'Receipt for invoice' : 'Invoice'} ${summary.number}` : 'Your document'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    From {sender}. The amount to pay and the date it is due are on the document. Download it to keep a copy.
                  </p>
                </div>
                {summary && (
                  <StatStrip
                    items={[
                      { label: 'Amount due', value: formatMinor(summary.balanceMinor, summary.currency) },
                      { label: 'Due date', value: shortDate(summary.dueDate) },
                      { label: 'Invoice total', value: formatMinor(summary.totalMinor, summary.currency), tone: 'muted' },
                    ]}
                  />
                )}
                <PdfFrame
                  load={() => guest.pdf(ARTIFACT)}
                  sourceKey={access}
                  title="Financial document"
                  filename={summary ? `${summary.number}.pdf` : 'document.pdf'}
                />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default InvoiceGuestPage;
