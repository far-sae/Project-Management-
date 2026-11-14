import type { CallContext, CallMediaType, CallParticipant } from '@/services/webrtc/types';
import { appIsInFront } from './incomingAlert';

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
}): void {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N || N.permission !== 'granted' || appIsInFront()) return;
  try {
    const kind = p.mediaType === 'video' ? 'Video call' : 'Voice call';
    const n = new N(`Missed call from ${p.callerName}`, {
      body: p.contextLabel ? `${kind} · ${p.contextLabel}` : kind,
      tag: 'taskcalendar-missed-call',
      icon: '/favicon.ico',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}
