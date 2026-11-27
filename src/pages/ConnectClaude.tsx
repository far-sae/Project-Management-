// The page Claude sends a person to when they connect TaskCalendar in the
// Claude app (/connect/authorize). It says who is asking and what Claude will
// be able to do, and nothing is connected until the person presses Allow.
// It stands alone, with no menu: the person is in the middle of a step that
// started in Claude and ends there.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SetupHint } from '@/components/common/SetupHint';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { ALLOW_AFTER_MS, allowConsent, checkConsent, errorSentence, goToClaude, isClaudeAddress, isFramed, type ConnectParams, type ConsentCheck } from '@/services/claudeConnector';

const CAN = [
  'See your mailboxes, groups, leads with an email address, templates and campaigns',
  'Write emails, save templates and prepare campaigns',
  'Send a campaign from your mailboxes, after it asked you in the chat',
  'Pause a campaign and let it go on',
];
const CANNOT = [
  'See a password, or add or change a mailbox',
  'Change your sending hours, daily limits or do-not-email list',
  'Email anybody who unsubscribed or bounced',
];

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
    <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6">{children}</div>
  </main>
);

const Waiting: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Shell>
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{children}
    </p>
  </Shell>
);

export const ConnectClaude: React.FC = () => {
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { organization, loading: orgLoading } = useOrganization();
  const params = useMemo<ConnectParams>(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);
  const orgId = organization?.organizationId ?? null;

  const [check, setCheck] = useState<ConsentCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const framed = useMemo(() => isFramed(), []);
  // Allow can be pressed a moment after what is asked is on the screen, not before.
  const [settled, setSettled] = useState(false);
  const asking = check?.ok === true && check.allowed;
  useEffect(() => {
    if (!asking) return;
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), ALLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);

  useEffect(() => {
    if (!user || !orgId || framed) return;
    let live = true;
    setCheck(null);
    setProblem(null);
    checkConsent(params, orgId)
      .then((reply) => { if (live) setCheck(reply); })
      .catch((err) => { if (live) setProblem(errorSentence(err)); });
    return () => { live = false; };
  }, [user, orgId, params, framed]);

  if (framed) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Open this page on its own</h1>
        <p className="mt-2 text-sm text-muted-foreground">For your safety, Claude can only be connected from this page when it is opened directly, not inside another website. Start again from Claude.</p>
      </Shell>
    );
  }

  if (authLoading) return <Waiting>Loading…</Waiting>;

  if (!user) {
    const back = `${location.pathname}${location.search}`;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Sign in to connect Claude</h1>
        <p className="mt-2 text-sm text-muted-foreground">Claude is asking to use Email in TaskCalendar. Sign in first; you then see what it asks for and can say yes or no.</p>
        <Button asChild className="mt-4"><Link to={`/login?redirect=${encodeURIComponent(back)}`}>Sign in</Link></Button>
      </Shell>
    );
  }

  if (orgLoading) return <Waiting>Loading…</Waiting>;

  if (!orgId) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Nothing to connect yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">This account is not in an organisation, so there is no Email to connect Claude to.</p>
      </Shell>
    );
  }

  if (problem) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Claude could not be connected</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">{problem}</p>
      </Shell>
    );
  }

  if (!check) return <Waiting>Checking what Claude asks for…</Waiting>;

  if (!check.ok) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Claude could not be connected</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {check.notSetUp
            ? <SetupHint other="Connecting Claude is not switched on yet. Please contact support.">Connecting Claude is not set up yet: run supabase/crm_setup.sql in the Supabase SQL editor, then press Connect in Claude again.</SetupHint>
            : check.problem}
        </p>
        {check.redirect && isClaudeAddress(check.redirect) && (
          <Button variant="outline" className="mt-4" onClick={() => goToClaude(check.redirect as string)}>Back to Claude</Button>
        )}
      </Shell>
    );
  }

  if (!check.allowed) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">You cannot connect Claude here</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          Claude works in the Email page for you, and your account in {organization?.name ?? 'this organisation'} does not have the Email page. Ask the owner to switch it on for you on the Team page.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => goToClaude(check.deny)}>Back to Claude</Button>
      </Shell>
    );
  }

  const allow = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const out = await allowConsent(params, orgId);
      // On the way to Claude the button stays busy: a second press must not make a second code.
      if (out.ok && goToClaude(out.redirect)) return;
      setCheck(out.ok ? { ok: false, problem: 'Claude could not be reached from here. Start again from Claude.', redirect: null } : out);
      setBusy(false);
    } catch (err) {
      setProblem(errorSentence(err));
      setBusy(false);
    }
  };

  const places = check.workspaces ?? [];

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground"><Mail className="h-4 w-4" aria-hidden /></span>
        <h1 className="text-lg font-semibold text-foreground">Let Claude send email for you?</h1>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {check.from === 'claude'
          ? <>The Claude app is asking to use Email in <span className="font-medium text-foreground">{organization?.name}</span> as you ({user.email}).</>
          : <>A program on this computer that calls itself “{check.clientName}” is asking to use Email in <span className="font-medium text-foreground">{organization?.name}</span> as you ({user.email}). Say yes only when you started this yourself, for example in Claude Code.</>}
      </p>

      <section aria-label="What Claude will be able to do" className="mt-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Claude will be able to</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-foreground">
          {CAN.map((line) => (
            <li key={line} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          {places.length === 0
            ? 'You have no workspace with Email yet, so Claude will find nothing to send from until you have one.'
            : `In ${places.length === 1 ? 'the workspace' : 'the workspaces'} ${places.slice(0, 6).join(', ')}${places.length > 6 ? ` and ${places.length - 6} more` : ''}.`}
        </p>
      </section>

      <section aria-label="What Claude will not be able to do" className="mt-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Claude will not be able to</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {CANNOT.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Every email goes out from your own mailboxes, with their daily limits, your sending hours and an unsubscribe link. You can disconnect Claude at any time in Email, Settings.
      </p>
      <p className="mt-2 text-xs font-medium text-foreground">Press Allow only if you pressed Connect in Claude yourself just now.</p>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => goToClaude(check.deny)}>Cancel</Button>
        <Button disabled={busy || !settled} onClick={() => void allow()}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}Allow
        </Button>
      </div>
    </Shell>
  );
};

export default ConnectClaude;
