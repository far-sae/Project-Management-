import { supabase } from '@/services/supabase/config';

/**
 * Response from the `livekit-token` Supabase Edge Function.
 *
 * The function signs a short-lived JWT bound to the requested room and to
 * the calling Supabase user's id (used as the LiveKit "identity"). Anything
 * else returned is informational so the client doesn't need to also store
 * VITE_LIVEKIT_URL — the server-side value is the source of truth.
 */
export interface LiveKitTokenResponse {
  /** HS256 JWT to pass into `Room.connect(url, token)`. */
  token: string;
  /** wss:// LiveKit URL (the server-configured one). */
  url: string;
  /** Echoed-back LiveKit identity (the Supabase user id). */
  identity: string;
  /** Echoed-back room the token authorises. */
  roomName: string;
}

/**
 * Mint a LiveKit access token for the currently authenticated Supabase user.
 *
 * Throws with a clear, actionable message if:
 *  - the user isn't logged in (no session);
 *  - the Edge Function isn't deployed or its LIVEKIT_* secrets aren't set;
 *  - the requested room name isn't on the allowlist enforced server-side.
 */
export async function fetchLiveKitToken(args: {
  roomName: string;
  participantName: string;
}): Promise<LiveKitTokenResponse> {
  // The client may pass VITE_LIVEKIT_URL too, but the server's value wins —
  // keeps the URL in lock-step with the API key/secret it signs against.
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: {
      roomName: args.roomName,
      participantName: args.participantName,
    },
  });
  if (error) {
    const msg = error.message || '';
    if (/not.*found|404/i.test(msg)) {
      throw new Error(
        'livekit-token Edge Function is not deployed. Run: supabase functions deploy livekit-token',
      );
    }
    throw new Error(msg || 'Failed to mint LiveKit token');
  }
  const body = data as Partial<LiveKitTokenResponse> & { error?: string; code?: string };
  if (body?.error) {
    if (body.code === 'MISSING_LIVEKIT_CONFIG') {
      throw new Error(
        'LiveKit secrets are not configured on Supabase. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL in Edge Function secrets, then redeploy livekit-token.',
      );
    }
    throw new Error(body.error);
  }
  if (!body?.token || !body?.url) {
    throw new Error('Malformed livekit-token response (missing token or url)');
  }
  return {
    token: body.token,
    url: body.url,
    identity: body.identity ?? '',
    roomName: body.roomName ?? args.roomName,
  };
}

/**
 * Build the canonical LiveKit room name for a project call. Mirrors the
 * `project:<projectId>` shape the Edge Function's allowlist accepts.
 */
export function projectRoomName(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Build the canonical LiveKit room name for a 1:1 DM call. The user ids
 * are sorted so both sides converge on the same name regardless of who
 * dialed first — mirrors the `dm:<a>__<b>` shape in the allowlist.
 */
export function dmRoomName(userIdA: string, userIdB: string): string {
  const [a, b] = [userIdA, userIdB].sort();
  return `dm:${a}__${b}`;
}
