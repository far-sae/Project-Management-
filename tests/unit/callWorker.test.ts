import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CALL_WORKER_URL,
  __setCallWorkerForTests,
  listenForCallNotificationClicks,
  registerCallWorker,
} from '@/services/calling/callWorker';

afterEach(() => __setCallWorkerForTests(null));

const fakeContainer = () => {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    register: vi.fn(async () => ({ scope: '/' }) as unknown as ServiceWorkerRegistration),
    addEventListener: vi.fn((_t: string, l: (e: MessageEvent) => void) => listeners.add(l)),
    removeEventListener: vi.fn((_t: string, l: (e: MessageEvent) => void) => listeners.delete(l)),
    startMessages: vi.fn(),
    emit: (data: unknown) => listeners.forEach((l) => l({ data } as MessageEvent)),
  };
};

describe('registerCallWorker', () => {
  it('registers the call worker for the whole site', async () => {
    const c = fakeContainer();
    const reg = await registerCallWorker(c as unknown as ServiceWorkerContainer);
    expect(c.register).toHaveBeenCalledWith(CALL_WORKER_URL, { scope: '/' });
    expect(reg).toBeTruthy();
  });

  it('returns null when the browser has no service workers or registering fails', async () => {
    expect(await registerCallWorker(undefined)).toBeNull();
    const c = fakeContainer();
    c.register.mockRejectedValueOnce(new Error('blocked'));
    expect(await registerCallWorker(c as unknown as ServiceWorkerContainer)).toBeNull();
  });
});

describe('listenForCallNotificationClicks', () => {
  it('passes Accept / Decline / Call back clicks from the pop-up to the app', () => {
    const c = fakeContainer();
    const onClick = vi.fn();
    const stop = listenForCallNotificationClicks(onClick, c as unknown as ServiceWorkerContainer);
    expect(c.startMessages).toHaveBeenCalled();
    c.emit({ type: 'call-notification', action: 'accept', callId: 'c1' });
    c.emit({ type: 'something-else' });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({ action: 'accept', callId: 'c1' });
    stop();
    c.emit({ type: 'call-notification', action: 'decline', callId: 'c1' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ── The worker script itself (public/call-sw.js) ─────────────────────────
function loadWorker(clients: Array<{ url: string }>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const windows = clients.map((c) => {
    const w = { ...c, focus: vi.fn(), postMessage: vi.fn() };
    w.focus.mockImplementation(async () => w);
    return w;
  });
  const self = {
    addEventListener: (t: string, h: (e: unknown) => void) => {
      handlers[t] = h;
    },
    skipWaiting: vi.fn(),
    registration: { scope: 'https://taskcalendar.co.uk/' },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
      claim: vi.fn(async () => undefined),
    },
  };
  const code = readFileSync(resolve(__dirname, '../../public/call-sw.js'), 'utf8');
  new Function('self', code)(self);
  const click = async (action: string, data: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    const notification = { data, close: vi.fn() };
    handlers.notificationclick({
      action,
      notification,
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
    return notification;
  };
  return { self, windows, click };
}

describe('call-sw.js', () => {
  it('Accept brings TaskCalendar to the front and answers in one tab', async () => {
    const { windows, click } = loadWorker([
      { url: 'https://taskcalendar.co.uk/projects' },
      { url: 'https://taskcalendar.co.uk/inbox' },
    ]);
    const n = await click('accept', { kind: 'incoming', callId: 'c1' });
    expect(n.close).toHaveBeenCalled();
    expect(windows[0].focus).toHaveBeenCalled();
    expect(windows[0].postMessage).toHaveBeenCalledWith({
      type: 'call-notification',
      action: 'accept',
      callId: 'c1',
    });
    expect(windows[1].postMessage).not.toHaveBeenCalled();
  });

  it('Decline tells every tab without stealing focus', async () => {
    const { windows, click } = loadWorker([
      { url: 'https://taskcalendar.co.uk/a' },
      { url: 'https://taskcalendar.co.uk/b' },
    ]);
    await click('decline', { kind: 'incoming', callId: 'c1' });
    for (const w of windows) {
      expect(w.focus).not.toHaveBeenCalled();
      expect(w.postMessage).toHaveBeenCalledWith({
        type: 'call-notification',
        action: 'decline',
        callId: 'c1',
      });
    }
  });

  it('clicking the pop-up itself just opens TaskCalendar', async () => {
    const { windows, click } = loadWorker([{ url: 'https://taskcalendar.co.uk/a' }]);
    await click('', { kind: 'incoming', callId: 'c1' });
    expect(windows[0].focus).toHaveBeenCalled();
    expect(windows[0].postMessage).toHaveBeenCalledWith({
      type: 'call-notification',
      action: 'open',
      callId: 'c1',
    });
  });

  it('opens TaskCalendar when no tab is open', async () => {
    const { self, click } = loadWorker([]);
    await click('call-back', { kind: 'missed', callId: 'c1' });
    expect(self.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
