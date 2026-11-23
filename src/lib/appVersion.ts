// Noticing that the site has been updated while this tab was open.
//
// The app is one page that stays loaded for hours or days. Without this, a tab
// opened before an update keeps running the old app until somebody happens to
// reload it: new screens never appear, and a page that was not opened yet can
// fail to load, because the old files are no longer on the server.
//
// Every build names its main script differently ("/assets/index-<hash>.js").
// So the question "is there a new version?" is: does the page the server hands
// out now name another main script than the one this tab is running?

const MAIN_SCRIPT = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/;

/** The main script a page names, or null when it names none (not a built page). */
export const mainScriptOf = (html: string): string | null => html.match(MAIN_SCRIPT)?.[1] ?? null;

/** The main script this tab is running, or null in development. */
export function loadedMainScript(doc: Document = document): string | null {
  const script = doc.querySelector('script[src*="/assets/index-"]');
  const src = script?.getAttribute('src') ?? null;
  if (!src) return null;
  try {
    return new URL(src, doc.baseURI).pathname;
  } catch {
    return src;
  }
}

/**
 * True when the server now hands out another version than this tab runs.
 * False when it is the same, when this is not a built page, and when the
 * answer could not be had: a failed check never bothers anybody.
 */
export async function newVersionAvailable(
  fetchFn: typeof fetch = fetch,
  doc: Document = document,
): Promise<boolean> {
  const running = loadedMainScript(doc);
  if (!running) return false;
  try {
    const response = await fetchFn('/', { cache: 'no-store', credentials: 'omit', headers: { Accept: 'text/html' } });
    if (!response.ok) return false;
    const latest = mainScriptOf(await response.text());
    return latest !== null && latest !== running;
  } catch {
    return false;
  }
}

const RELOADED_AT = 'app.reloadedForVersionAt';
/** A reload for a new version happens at most once in this long, so a reload can never loop. */
export const RELOAD_GAP_MS = 60_000;

/** Reloads the page, unless it was reloaded for the same reason a moment ago. Answers whether it did. */
export function reloadOnce(now: number = Date.now(), win: Pick<Window, 'location' | 'sessionStorage'> = window): boolean {
  try {
    const last = Number(win.sessionStorage.getItem(RELOADED_AT)) || 0;
    if (now - last < RELOAD_GAP_MS) return false;
    win.sessionStorage.setItem(RELOADED_AT, String(now));
  } catch {
    /* No session storage (a private window): reload anyway, once per call. */
  }
  win.location.reload();
  return true;
}
