/** Decoupled refresh so the bell updates even if Realtime is misconfigured. */
const EVENT = "app:notifications-refresh";

export function dispatchNotificationsRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onNotificationsRefresh(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const fn = () => {
    handler();
  };
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
