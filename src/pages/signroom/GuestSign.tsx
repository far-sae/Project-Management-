import React, { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { GuestSigning } from '@/components/signroom/agreements/GuestSigning';

/** The token in `#access=<token>`, or "". It travels in the fragment so it never reaches a server log. */
const readAccess = (): string => new URLSearchParams(window.location.hash.slice(1)).get('access') ?? '';

/**
 * Where an invited person lands from the emailed link (`/sign#access=<token>`).
 * No sign-in and no app sidebar: this page is the whole screen.
 */
export const GuestSignPage: React.FC = () => {
  // Read once, then take it out of the address bar. A re-render or a strict-mode re-run must not lose it.
  const found = useRef<string | null>(null);
  if (found.current === null) found.current = readAccess();
  const access = found.current;

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> Private signing
          </span>
          <span className="text-xs text-muted-foreground">No account needed</span>
        </div>
      </header>
      {access ? (
        <GuestSigning access={access} />
      ) : (
        <main className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 py-14">
          <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            This link is incomplete. Please open the link from your email again.
          </p>
        </main>
      )}
    </div>
  );
};

export default GuestSignPage;
