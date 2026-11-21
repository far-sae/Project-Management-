import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  COMPANY_MAX, EMAIL_MAX, FORM_FAILED_MESSAGE, FORM_GONE_MESSAGE, MESSAGE_MAX, NAME_MAX, PHONE_MAX,
  type PublicForm, type SubmitReply,
} from '../../api/_leadForm/shared/types';

/**
 * A web form's own page (/f/<form id>): what a visitor fills in to become a
 * lead. It is public, needs no sign-in, and is the page an owner links to or
 * shows inside their own website. It talks to /api/lead-form only.
 */

const endpoint = (formId: string) => `/api/lead-form?id=${encodeURIComponent(formId)}`;

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    throw new Error(FORM_FAILED_MESSAGE);
  }
  let reply: unknown = null;
  try {
    reply = await response.json();
  } catch {
    reply = null;
  }
  if (!response.ok) {
    const sentence = (reply as { error?: unknown } | null)?.error;
    throw new Error(typeof sentence === 'string' && sentence.trim() ? sentence : FORM_FAILED_MESSAGE);
  }
  return reply as T;
}

export const LeadFormPage: React.FC = () => {
  const { formId = '' } = useParams();
  const fieldId = useId();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  /** A field people never see. Whatever fills it in is not a person. */
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setForm(null);
    setGone(null);
    ask<PublicForm>(endpoint(formId))
      .then((found) => { if (live) setForm(found); })
      .catch((err) => { if (live) setGone(publicMessage(err, FORM_GONE_MESSAGE)); });
    return () => { live = false; };
  }, [formId]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const reply = await ask<SubmitReply>(endpoint(formId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, company, message, website }),
      });
      setThanks(reply.thankYou);
    } catch (err) {
      setProblem(publicMessage(err, FORM_FAILED_MESSAGE));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md">
        {gone ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">{gone}</p>
        ) : !form ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading…
          </p>
        ) : thanks ? (
          <div role="status" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
            <p className="text-sm font-medium">{thanks}</p>
          </div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:p-6" noValidate>
            {(form.heading || form.intro) && (
              <div>
                {form.heading && <h1 className="text-lg font-semibold tracking-tight">{form.heading}</h1>}
                {form.intro && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{form.intro}</p>}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-name`}>Your name</Label>
              <Input id={`${fieldId}-name`} autoComplete="name" required maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-email`}>Email</Label>
              <Input id={`${fieldId}-email`} type="email" autoComplete="email" required maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
            {form.askPhone && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-phone`}>Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id={`${fieldId}-phone`} type="tel" autoComplete="tel" maxLength={PHONE_MAX} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
            )}
            {form.askCompany && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-company`}>Company <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id={`${fieldId}-company`} autoComplete="organization" maxLength={COMPANY_MAX} value={company} onChange={(e) => setCompany(e.target.value)} disabled={busy} />
              </div>
            )}
            {form.askMessage && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-message`}>How can we help? <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id={`${fieldId}-message`} rows={4} maxLength={MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
              </div>
            )}
            {/* Off-screen, out of the tab order and hidden from screen readers: only a robot fills it. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
            <Button type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}{form.buttonLabel || 'Send'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
};

export default LeadFormPage;
