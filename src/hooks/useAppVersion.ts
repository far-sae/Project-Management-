import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { newVersionAvailable, reloadOnce } from '@/lib/appVersion';

/** How often an open tab asks whether the site was updated. */
export const VERSION_CHECK_MS = 5 * 60_000;
const TOAST_ID = 'app-new-version';

/**
 * Tells a person when their open tab runs an old version of the app.
 *
 *  - It asks every few minutes, and whenever the tab is looked at again,
 *    whether the site was updated.
 *  - When it was, a small notice offers "Reload". The page is never reloaded
 *    by itself: a person moving from page to page must not have the app
 *    reload under them. They press Reload when it suits them.
 *  - One exception, because the other choice is an error screen: a page whose
 *    file is gone from the server (it was replaced by the update) reloads once.
 */
export function useAppVersion(check: () => Promise<boolean> = newVersionAvailable): void {
  const stale = useRef(false);

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
}
