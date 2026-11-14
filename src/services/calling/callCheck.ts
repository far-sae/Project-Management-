import { explainConnectError, explainMediaError } from '@/lib/callTroubleshoot';

/**
 * "Call check": runs the same things a real call needs, one at a time, and
 * says in plain words which one fails on this machine. Dependencies are
 * injected so the steps can be tested without a browser.
 */

export type CallCheckStepId = 'browser' | 'microphone' | 'camera' | 'server' | 'ringing' | 'alerts';
export type CallCheckStatus = 'pending' | 'running' | 'ok' | 'warn' | 'fail' | 'skipped';

export interface CallCheckResult {
  id: CallCheckStepId;
  label: string;
  status: CallCheckStatus;
  detail?: string;
}

export interface CallCheckDeps {
  browserSupported: () => boolean;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Join a private test room on the call server. Throws on token/sign-in errors. */
  checkServer: () => Promise<{ websocket: boolean; webrtc: boolean }>;
  /** Send a message to ourselves over the channel incoming calls ring on. */
  checkRinging: () => Promise<boolean>;
  /** Desktop notification permission, so calls pop up when the app is minimised. */
  notificationPermission: () => NotificationPermission | 'unsupported';
}

const STEPS: Array<{ id: CallCheckStepId; label: string }> = [
  { id: 'browser', label: 'Browser' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'camera', label: 'Camera' },
  { id: 'server', label: 'Call connection' },
  { id: 'ringing', label: 'Incoming calls' },
  { id: 'alerts', label: 'Pop-ups when minimised' },
];

/** Result of the "Pop-ups when minimised" step for a notification permission. */
export function alertsStepResult(
  permission: NotificationPermission | 'unsupported',
): { status: CallCheckStatus; detail: string } {
  if (permission === 'granted') {
    return {
      status: 'ok',
      detail:
        'Calls pop up in the corner of your screen with Accept and Decline, even when TaskCalendar is minimised. If nothing appears, check Windows Settings → System → Notifications: your browser must be On and Do not disturb Off.',
    };
  }
  if (permission === 'denied') {
    return {
      status: 'warn',
      detail:
        'Pop-ups are blocked, so you only see calls while TaskCalendar is on screen. Click the padlock left of the address bar → Notifications → Allow, then reload.',
    };
  }
  if (permission === 'unsupported') {
    return {
      status: 'warn',
      detail: 'This browser can’t show call pop-ups when it’s minimised. Use Chrome or Edge.',
    };
  }
  return {
    status: 'warn',
    detail:
      'Pop-ups are off, so you won’t see calls while TaskCalendar is minimised or behind another window. Turn them on below.',
  };
}

const MISSING_DEVICE = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);

export async function runCallCheck(
  deps: CallCheckDeps,
  onUpdate: (results: CallCheckResult[]) => void,
): Promise<CallCheckResult[]> {
  let results: CallCheckResult[] = STEPS.map((s) => ({ ...s, status: 'pending' }));
  const set = (id: CallCheckStepId, status: CallCheckStatus, detail?: string) => {
    results = results.map((r) => (r.id === id ? { ...r, status, detail } : r));
    onUpdate(results);
  };

  set('browser', 'running');
  if (!deps.browserSupported()) {
    set(
      'browser',
      'fail',
      'This browser can’t make calls. Use the latest Chrome, Edge or Safari, and open the site with https://.',
    );
    for (const s of STEPS.slice(1)) set(s.id, 'skipped');
    return results;
  }
  set('browser', 'ok', 'Calls are supported.');

  const device = async (id: 'microphone' | 'camera') => {
    set(id, 'running');
    try {
      const stream = await deps.getUserMedia(id === 'microphone' ? { audio: true } : { video: true });
      const tracks = stream.getTracks();
      const name = tracks[0]?.label;
      tracks.forEach((t) => t.stop());
      set(id, 'ok', name ? `Working — ${name}` : 'Working.');
    } catch (err) {
      const missing = err && typeof err === 'object' && MISSING_DEVICE.has(String((err as Error).name));
      set(
        id,
        missing && id === 'camera' ? 'warn' : 'fail',
        explainMediaError(err, id) + (missing && id === 'camera' ? ' Audio calls still work.' : ''),
      );
    }
  };
  await device('microphone');
  await device('camera');

  set('server', 'running');
  try {
    const { websocket, webrtc } = await deps.checkServer();
    if (!websocket) set('server', 'fail', explainConnectError(new Error('could not establish signal connection')));
    else if (!webrtc) set('server', 'fail', explainConnectError(new Error('could not establish pc connection')));
    else set('server', 'ok', 'Connected to the call server with audio and video.');
  } catch (err) {
    set('server', 'fail', explainConnectError(err));
  }

  set('ringing', 'running');
  let ringing = false;
  try {
    ringing = await deps.checkRinging();
  } catch {
    ringing = false;
  }
  set(
    'ringing',
    ringing ? 'ok' : 'fail',
    ringing
      ? 'Incoming calls can reach this browser. Keep a TaskCalendar tab open to get rung.'
      : 'Incoming calls can’t reach this browser. A firewall, VPN, antivirus web shield or ad-blocker extension is likely blocking it — try turning them off or another network.',
  );

  const alerts = alertsStepResult(deps.notificationPermission());
  set('alerts', alerts.status, alerts.detail);

  return results;
}
