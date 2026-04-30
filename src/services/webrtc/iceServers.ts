/**
 * ICE server list for RTCPeerConfiguration.
 *
 * STUN is always included (public Google STUN). TURN is optional and read from Vite env so
 * calls work behind symmetric / corporate NAT when you add a relay provider.
 *
 * Security: VITE_* values are embedded in the client bundle. Use time-limited TURN credentials
 * from your provider’s API when possible, not long-lived static passwords in public repos.
 */
const DEFAULT_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function isValidIceServer(obj: unknown): obj is RTCIceServer {
  if (!obj || typeof obj !== 'object') return false;
  const urls = (obj as { urls?: unknown }).urls;
  return (
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.every((url) => typeof url === 'string'))
  );
}

export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [...DEFAULT_STUN];

  const rawJson = import.meta.env.VITE_WEBRTC_ICE_SERVERS_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(isValidIceServer)
      ) {
        return parsed as RTCIceServer[];
      }
      throw new Error('Expected a non-empty RTCIceServer[] with valid urls');
    } catch {
      console.warn('[WebRTC] VITE_WEBRTC_ICE_SERVERS_JSON is invalid JSON; using STUN + optional TURN env');
    }
  }

  const turnUrls = import.meta.env.VITE_WEBRTC_TURN_URLS?.trim();
  const username = import.meta.env.VITE_WEBRTC_TURN_USERNAME?.trim();
  const credential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL?.trim();

  if (turnUrls && username && credential) {
    const urls = turnUrls
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (urls.length) {
      servers.push({ urls, username, credential });
    }
  }

  return servers;
}
