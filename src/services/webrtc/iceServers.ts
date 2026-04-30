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

/**
 * Chromium rejects some ICE URL shapes (e.g. `turns:...?transport=tcp` — TLS relay does not
 * use the same transport query as `turn:`). Normalize `transport` to lowercase udp|tcp,
 * drop invalid values, strip transport on `stun:` / `turns:` where it breaks parsing.
 */
function sanitizeSingleIceUrl(url: string): string {
  const trimmed = url.trim();
  const q = trimmed.indexOf('?');
  if (q < 0) return trimmed;

  const base = trimmed.slice(0, q);
  const search = trimmed.slice(q + 1);
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return trimmed;
  }
  if (!params.has('transport')) return trimmed;

  const isStun = /^stun:/i.test(base);
  const isTurns = /^turns:/i.test(base);
  const raw = (params.get('transport') || '').trim().toLowerCase();

  if (isStun || isTurns) {
    params.delete('transport');
  } else if (raw !== 'udp' && raw !== 'tcp') {
    params.delete('transport');
  } else {
    params.set('transport', raw);
  }

  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

function sanitizeUrlsField(urls: string | string[]): string | string[] {
  const list = typeof urls === 'string' ? [urls] : urls;
  const out = list.map(sanitizeSingleIceUrl).filter((u) => u.length > 0);
  if (out.length === 0) return typeof urls === 'string' ? '' : [];
  return out.length === 1 ? out[0]! : out;
}

function sanitizeIceServersList(list: RTCIceServer[]): RTCIceServer[] {
  return list
    .map((entry) => ({
      ...entry,
      urls: sanitizeUrlsField(
        typeof entry.urls === 'string' ? entry.urls : [...entry.urls],
      ) as string | string[],
    }))
    .filter((e) =>
      typeof e.urls === 'string' ? e.urls.length > 0 : e.urls.length > 0,
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
        return sanitizeIceServersList(parsed as RTCIceServer[]);
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
      .map((s: string) => sanitizeSingleIceUrl(s.trim()))
      .filter(Boolean);
    if (urls.length) {
      servers.push({ urls, username, credential });
    }
  }

  return sanitizeIceServersList(servers);
}
