/**
 * Teams-style call pop-ups with buttons.
 *
 * A plain `new Notification()` can't have buttons. Notifications shown
 * through a service worker can ("Accept" / "Decline" / "Call back"), and
 * the operating system slides them in from the side even when the browser
 * is minimised or behind another window. public/call-sw.js handles the
 * clicks and posts them back to the open TaskCalendar tab.
 */

export const CALL_WORKER_URL = '/call-sw.js';

export type CallNotificationAction = 'accept' | 'decline' | 'call-back' | 'open';

export interface CallNotificationClick {
  action: CallNotificationAction;
  callId?: string;
}

let registration: ServiceWorkerRegistration | null = null;

function defaultContainer(): ServiceWorkerContainer | undefined {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined;
}

/** Register the call worker once per page. Resolves null if unsupported. */
export async function registerCallWorker(
  container: ServiceWorkerContainer | undefined = defaultContainer(),
): Promise<ServiceWorkerRegistration | null> {
  if (!container) return null;
  try {
    registration = await container.register(CALL_WORKER_URL, { scope: '/' });
    return registration;
  } catch {
    return null;
  }
}

/** The registered worker, or null (then callers fall back to plain notifications). */
export function callWorkerRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

/** Test hook. */
export function __setCallWorkerForTests(reg: ServiceWorkerRegistration | null): void {
  registration = reg;
}

/** Listen for button clicks on call pop-ups. Returns stop(). */
export function listenForCallNotificationClicks(
  onClick: (click: CallNotificationClick) => void,
  container: ServiceWorkerContainer | undefined = defaultContainer(),
): () => void {
  if (!container) return () => {};
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; action?: CallNotificationAction; callId?: string } | null;
    if (!data || data.type !== 'call-notification' || !data.action) return;
    onClick({ action: data.action, callId: data.callId });
  };
  container.addEventListener('message', handler);
  // Messages to a page that isn't controlled by the worker yet (first
  // visit) are queued until this is called.
  container.startMessages?.();
  return () => container.removeEventListener('message', handler);
}
