import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { completeGoogleSignIn } from '@/services/supabase/googleSignIn';

/** Google sends people back here (taskcalendar.co.uk/auth/google) after choosing an account. */
export const GoogleCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the token is single-use.
    started.current = true;
    completeGoogleSignIn(window.location.hash)
      .then((next) => navigate(next, { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Google sign-in failed.'));
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      {error ? (
        <>
          <p className="text-base font-semibold">Couldn’t sign you in</p>
          <p className="max-w-sm text-sm text-muted-foreground text-pretty">{error}</p>
          <Link
            to="/login"
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </>
      )}
    </div>
  );
};
