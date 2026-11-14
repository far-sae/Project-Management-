import { afterEach, describe, expect, it, vi } from 'vitest';
import { callBackContext, showMissedCallNotification } from '@/services/calling/missedCall';
import { __setCallWorkerForTests } from '@/services/calling/callWorker';

const SAM = { userId: 'sam', displayName: 'Sam' };

describe('callBackContext', () => {
  it('calls the person back directly after a missed 1:1 call', () => {
    expect(callBackContext({ context: { type: 'dm', targetId: 'me', label: 'Me' }, from: SAM })).toEqual({
      type: 'dm',
      targetId: 'sam',
      label: 'Sam',
    });
  });

  it('calls back into the same project after a missed project call', () => {
    const project = { type: 'project' as const, targetId: 'p1', label: 'Website' };
    expect(callBackContext({ context: project, from: SAM })).toEqual(project);
  });
});

describe('showMissedCallNotification', () => {
  const realNotification = (window as { Notification?: unknown }).Notification;
  afterEach(() => {
    (window as { Notification?: unknown }).Notification = realNotification;
    vi.restoreAllMocks();
  });

  const fakeNotification = (permission: NotificationPermission) => {
    const created: Array<{ title: string; opts: NotificationOptions }> = [];
    class N {
      static permission = permission;
      onclick: (() => void) | null = null;
      constructor(title: string, opts: NotificationOptions) {
        created.push({ title, opts });
      }
      close() {}
    }
    (window as { Notification?: unknown }).Notification = N;
    return created;
  };

  it('pops a desktop notification when TaskCalendar is in the background', () => {
    const created = fakeNotification('granted');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    showMissedCallNotification({ callerName: 'Sam', mediaType: 'video', contextLabel: 'Website' });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('Missed call from Sam');
    expect(created[0].opts.body).toBe('Video call · Website');
  });

  it('stays quiet when the app is in front (the in-app alert is enough)', () => {
    const created = fakeNotification('granted');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    showMissedCallNotification({ callerName: 'Sam', mediaType: 'audio' });
    expect(created).toHaveLength(0);
  });

  it('offers Call back right on the pop-up', () => {
    fakeNotification('granted');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const showNotification = vi.fn(async () => undefined);
    __setCallWorkerForTests({ showNotification } as unknown as ServiceWorkerRegistration);
    showMissedCallNotification({ callerName: 'Sam', mediaType: 'audio', callId: 'c9' });
    __setCallWorkerForTests(null);
    expect(showNotification).toHaveBeenCalledWith(
      'Missed call from Sam',
      expect.objectContaining({
        data: { kind: 'missed', callId: 'c9' },
        actions: [{ action: 'call-back', title: 'Call back' }],
      }),
    );
  });
});
