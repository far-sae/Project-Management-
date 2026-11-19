const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
type RequestContext = { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined };

/**
 * Runs `task` without anyone waiting for it: handed to Vercel's waitUntil when
 * the runtime provides it (so the function stays up until it ends), and every
 * failure, thrown or rejected, is swallowed.
 */
export function runInBackground(task: () => unknown): void {
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(task()).catch(() => undefined);
  } catch {
    return;
  }
  try {
    const ctx = (globalThis as unknown as Record<symbol, RequestContext | undefined>)[REQUEST_CONTEXT];
    ctx?.get?.()?.waitUntil?.(p);
  } catch {
    /* the work still runs; only the keep-alive hint failed */
  }
}
