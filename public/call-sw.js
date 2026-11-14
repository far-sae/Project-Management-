/*
 * TaskCalendar call pop-ups.
 *
 * Only job: handle clicks on call notifications (Teams-style pop-ups that
 * Windows/macOS slide in from the side even when the browser is minimised).
 * It does NOT cache or intercept any page requests.
 *
 *   Accept   → bring a TaskCalendar tab to the front and answer there
 *   Decline  → tell every TaskCalendar tab, without stealing focus
 *   Call back→ bring TaskCalendar to the front and ring the caller
 *   (click on the pop-up itself) → bring TaskCalendar to the front
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || 'open';
  notification.close();

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const message = { type: 'call-notification', action, callId: data.callId };

      if (action === 'decline') {
        windows.forEach((w) => w.postMessage(message));
        return;
      }

      const target = windows.find((w) => w.focused) || windows[0];
      if (!target) {
        await self.clients.openWindow('/');
        return;
      }
      const focused = await target.focus().catch(() => target);
      (focused || target).postMessage(message);
    })(),
  );
});
