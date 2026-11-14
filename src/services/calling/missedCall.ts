import type { CallContext, CallMediaType, CallParticipant } from '@/services/webrtc/types';
import { NOTIFICATION_ICON, appIsInFront } from './incomingAlert';
import { callWorkerRegistration } from './callWorker';

/**
 * Teams-style "Missed call" — when a ring times out or the caller hangs up
 * before you answer, tell the person and let them call back.
 */

/** Where "Call back" should ring: the caller directly, or the same project. */
export function callBackContext(ring: { context: CallContext; from: CallParticipant }): CallContext {
  if (ring.context.type === 'project') return ring.context;
  return { type: 'dm', targetId: ring.from.userId, label: ring.from.displayName || 'Teammate' };
}

/** Desktop notification for a missed call while the app is in the background. */
export function showMissedCallNotification(p: {
  callerName: string;
  mediaType: CallMediaType;
  contextLabel?: string;
  callId?: string;
}): void {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N || N.permission !== 'granted' || appIsInFront()) return;
  const kind = p.mediaType === 'video' ? 'Video call' : 'Voice call';
  const title = `Missed call from ${p.callerName}`;
  const body = p.contextLabel ? `${kind} · ${p.contextLabel}` : kind;
  const reg = callWorkerRegistration();
  if (reg) {
    void reg
      .showNotification(title, {
        body,
        tag: 'taskcalendar-missed-call',
        icon: NOTIFICATION_ICON,
        data: { kind: 'missed', callId: p.callId },
        actions: [{ action: 'call-back', title: 'Call back' }],
      } as NotificationOptions)
      .catch(() => undefined);
    return;
  }
  try {
    const n = new N(title, {
      body,
      tag: 'taskcalendar-missed-call',
      icon: NOTIFICATION_ICON,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}
