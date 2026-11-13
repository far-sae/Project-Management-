/**
 * Turn the browser's / LiveKit's raw call errors into plain words that say
 * what to do. Most "calls don't work on this one laptop" reports are the
 * machine, not the app: a blocked permission, a camera switched off with a
 * keyboard key, a device held by Zoom/Teams, or a firewall/VPN.
 */

export type MediaKind = 'microphone' | 'camera' | 'both';

const LABEL: Record<MediaKind, string> = {
  microphone: 'microphone',
  camera: 'camera',
  both: 'camera and microphone',
};

function nameOf(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

export function explainMediaError(err: unknown, kind: MediaKind): string {
  const device = LABEL[kind];
  const Device = device.charAt(0).toUpperCase() + device.slice(1);
  const name = nameOf(err);
  const message = messageOf(err);

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    if (/system/i.test(message)) {
      return `Windows is blocking the ${device}. Open Windows Settings → Privacy & security → ${
        kind === 'microphone' ? 'Microphone' : 'Camera'
      } and turn on access for apps and desktop apps, then reload this page.`;
    }
    return `${Device} access is blocked. Click the lock icon next to the address bar, set ${
      kind === 'both' ? 'Camera and Microphone' : Device
    } to Allow, then reload this page.`;
  }

  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError'
  ) {
    return `No ${device} found. If your laptop has a ${device} on/off key or a privacy shutter, turn it on — you can still join without it.`;
  }

  if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    name === 'AbortError' ||
    /could not start (video|audio) source/i.test(message)
  ) {
    return `Your ${device} is being used by another app (Zoom, Teams, the Camera app…) or was switched off. Close the other app and try again.`;
  }

  return message ? `Couldn't use your ${device}: ${message}` : `Couldn't use your ${device}.`;
}

export function explainConnectError(err: unknown): string {
  const message = messageOf(err);
  if (/pc connection|peer ?connection|\bice\b/i.test(message)) {
    return "Connected, but audio and video were blocked — usually a firewall, VPN or antivirus web protection. Turn off the VPN or try another network, then call again.";
  }
  if (!message || /signal connection|websocket|failed to fetch|network ?error|timed? ?out|timeout/i.test(message)) {
    return "Can't reach the call server. Check your internet connection; on office Wi-Fi, a VPN or antivirus firewall, try another network.";
  }
  return message;
}
