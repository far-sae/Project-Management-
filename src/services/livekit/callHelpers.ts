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
