import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { newVersionAvailable, reloadOnce, somethingIsOpen } from '@/lib/appVersion';

/** How often an open tab asks whether the site was updated. */
export const VERSION_CHECK_MS = 5 * 60_000;
const TOAST_ID = 'app-new-version';

/**
 * Keeps an open tab from running an old version of the app.
 *
 *  - It asks every few minutes, and whenever the tab is looked at again,
 *    whether the site was updated.
 *  - When it was, the next move to another page loads the new version by
 *    itself (never while a window or a call is open over the page), and a
 *    small notice offers "Reload" for somebody who stays on one page.
 *  - A page that fails to load because its old file is gone from the server
 *    reloads once, instead of showing an error.
 */
export function useAppVersion(check: () => Promise<boolean> = newVersionAvailable): void {
  const stale = useRef(false);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const look = async () => {
      if (stale.current || document.visibilityState !== 'visible') return;
      if (!(await check()) || !alive) return;
      stale.current = true;
      toast('A new version of TaskCalendar is ready.', {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: 'Reload', onClick: () => window.location.reload() },
      });
    };
    const timer = window.setInterval(() => void look(), VERSION_CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void look(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // An old tab asking for a page whose file was replaced by the update.
    const onMissingFile = (event: Event) => {
      if (reloadOnce()) event.preventDefault();
    };
    window.addEventListener('vite:preloadError', onMissingFile);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('vite:preloadError', onMissingFile);
    };
  }, [check]);

  // Going to another page is the natural moment to take the new version:
  // nothing typed is lost, because the page is being left anyway.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (stale.current && !somethingIsOpen()) reloadOnce();
  }, [location.pathname]);
}
