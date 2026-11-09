import type { CallPeerSnapshot } from './LiveKitCallService';

/**
 * Keeps one MediaStream per key (e.g. `<identity>:audio`) for as long as its
 * underlying tracks stay the same.
 *
 * Why: participant snapshots are rebuilt on every LiveKit event — including
 * ActiveSpeakersChanged, which fires many times a second while people talk.
 * Handing React a brand-new MediaStream each time makes every <audio>/<video>
 * element reassign `srcObject`, which restarts playback and causes choppy
 * audio and flickering video. Returning the same object keeps playback steady.
 */
export class MediaStreamCache {
  private readonly entries = new Map<
    string,
    { tracks: MediaStreamTrack[]; stream: MediaStream }
  >();

  constructor(
    private readonly create: (tracks: MediaStreamTrack[]) => MediaStream = (
      tracks,
    ) => new MediaStream(tracks),
  ) {}

  get(key: string, tracks: MediaStreamTrack[]): MediaStream | null {
    if (tracks.length === 0) {
      this.entries.delete(key);
      return null;
    }
    const cached = this.entries.get(key);
    if (
      cached &&
      cached.tracks.length === tracks.length &&
      cached.tracks.every((t, i) => t === tracks[i])
    ) {
      return cached.stream;
    }
    const stream = this.create(tracks);
    this.entries.set(key, { tracks: [...tracks], stream });
    return stream;
  }

  /** Forget every key not in `activeKeys` (participants who left). */
  prune(activeKeys: Set<string>): void {
    for (const key of this.entries.keys()) {
      if (!activeKeys.has(key)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * A live call where everyone else has left should end for the remaining
 * user too — otherwise they sit in an empty "connected" call after the
 * other side hangs up. While ringing/connecting the caller is legitimately
 * alone in the room, and during a network reconnect LiveKit can briefly
 * report no remotes, so those states never auto-end.
 */
export function shouldEndCallWhenAlone(
  status: string,
  remoteCount: number,
): boolean {
  return remoteCount === 0 && status === 'connected';
}

/**
 * Pick the big tile for the floating mini window. Order: a remote person
 * sharing their screen > the remote who is speaking > the first remote >
 * the local user. The local user's own screen share is never chosen (it
 * would just mirror their screen); if they are the only one, their tile is
 * returned without video so the initials show instead.
 */
export function pickMiniMainTile(peers: CallPeerSnapshot[]): CallPeerSnapshot | null {
  const remotes = peers.filter((p) => !p.isLocal);
  const pick =
    remotes.find((p) => p.isScreenSharing) ??
    remotes.find((p) => p.isSpeaking) ??
    remotes[0];
  if (pick) return pick;
  const local = peers.find((p) => p.isLocal);
  if (!local) return null;
  return local.isScreenSharing
    ? { ...local, videoStream: null, isScreenSharing: false }
    : local;
}

/** Role/status the server stamps into participant metadata. */
export function parseParticipantMeta(metadata?: string): {
  role: 'member' | 'guest';
  status: 'waiting' | 'admitted' | null;
} {
  if (!metadata) return { role: 'member', status: null };
  try {
    const m = JSON.parse(metadata) as { role?: unknown; status?: unknown };
    if (m && m.role === 'guest') {
      const status =
        m.status === 'waiting' || m.status === 'admitted' ? m.status : null;
      return { role: 'guest', status };
    }
  } catch {
    /* fall through */
  }
  return { role: 'member', status: null };
}

/** Peers that should get a tile (waiting guests are hidden). */
export function visiblePeers(peers: CallPeerSnapshot[]): CallPeerSnapshot[] {
  return peers.filter((p) => !p.isWaiting);
}

export function waitingGuests(peers: CallPeerSnapshot[]): CallPeerSnapshot[] {
  return peers.filter((p) => p.isWaiting);
}

export function anyoneRecording(peers: CallPeerSnapshot[]): boolean {
  return peers.some((p) => p.isRecording);
}
