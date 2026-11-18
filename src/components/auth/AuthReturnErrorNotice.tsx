import { useEffect } from 'react';
import { toast } from 'sonner';
import { readAuthReturnError, stripAuthReturnError } from '@/lib/authReturnError';
import { GOOGLE_CALLBACK_PATH } from '@/services/supabase/googleSignIn';

// Read once, when the app's code first loads: the router may redirect (and
// drop the query string) before any component gets to look at the address.
const initialError =
  typeof window !== 'undefined' && window.location.pathname !== GOOGLE_CALLBACK_PATH
    ? readAuthReturnError(window.location.search, window.location.hash)
    : null;

let shown = false;

/**
 * Tells the person why a sign-in did not complete. Without this, a failed
 * Google / link sign-in just lands back on the login page with no message.
 */
export function AuthReturnErrorNotice(): null {
  useEffect(() => {
    if (!initialError || shown) return;
    shown = true;
    toast.error('Sign-in did not complete', { description: initialError, duration: 20000 });
    const { pathname, search, hash } = window.location;
    const cleaned = stripAuthReturnError(pathname, search, hash);
    if (cleaned !== `${pathname}${search}${hash}`) {
      window.history.replaceState(window.history.state, '', cleaned);
    }
  }, []);
  return null;
}

export default AuthReturnErrorNotice;
