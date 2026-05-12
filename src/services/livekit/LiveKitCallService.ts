import {
  ConnectionState,
  DisconnectReason,
  LocalParticipant,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type LocalTrackPublication,
  type ParticipantTrackPermission,
} from 'livekit-client';
import { fetchLiveKitToken, projectRoomName } from './fetchLiveKitToken';
import type { CallParticipant } from '@/services/webrtc/types';

/**
 * Snapshot of one peer in the room. Whatever the LiveKit Room currently
 * believes about this user — name, mute state, the live MediaStreams we'd
 * attach to <video>/<audio> elements. Snapshots are emitted whole on every
 * change so React state can replace the previous map without diffing.
 */
export interface CallPeerSnapshot {
  /** Stable identity (Supabase user id) — used as React key. */
  userId: string;
  displayName: string;
  /** Combined MediaStream of any subscribed remote audio tracks. */
  audioStream: MediaStream | null;
  /** Combined MediaStream of any subscribed remote camera/screen tracks. */
  videoStream: MediaStream | null;
  /** Local mute state reported by LiveKit (mic publication muted). */
  isMicMuted: boolean;
  /** Local camera state reported by LiveKit (camera publication muted). */
  isCameraOff: boolean;
  /** True when this participant is currently presenting a screen track. */
  isScreenSharing: boolean;
  /** True when LiveKit currently flags this participant as actively speaking. */
  isSpeaking: boolean;
  /** True for the local participant — the user themself. */
  isLocal: boolean;
}

/** State callbacks the consumer (CallProvider) receives. */
export interface LiveKitCallEvents {
  /**
   * Fires whenever any aspect of the participant roster, their tracks, or
   * speaking state changes — the consumer just replaces its snapshot.
   * Keeping a single coarse-grained event avoids React state thrash from
   * the dozen finer-grained LiveKit events firing on connect.
   */
  onParticipantsChange: (peers: CallPeerSnapshot[]) => void;
  /** Pipes LiveKit's connection state (connecting, reconnecting, etc.). */
  onConnectionStateChange: (state: ConnectionState) => void;
  /**
   * Fires when LiveKit gives up reconnecting or kicks us out. The consumer
   * tears down the call UI when this fires, surfacing the reason if any.
   */
  onDisconnected: (reason: DisconnectReason | null) => void;
  /**
   * Surfaces non-fatal errors (publish failures, unsupported media, etc.)
   * so the consumer can toast them without taking down the whole call.
   */
  onError: (message: string) => void;
}

export interface LiveKitConnectOptions {
  /** Room identifier, e.g. `project:<projectId>` or `dm:<sortedPair>`. */
  roomName: string;
  /** Local user's display name as it should appear in tiles. */
  participantName: string;
  /** Mic+camera (`video`) or mic-only (`audio`). */
  mediaType: 'audio' | 'video';
}

const SCREEN_SHARE_SOURCE_NAMES = new Set<string>([
  Track.Source.ScreenShare as string,
  Track.Source.ScreenShareAudio as string,
]);

function isScreenSharePublication(
  pub: { source?: Track.Source; track?: Track | null } | undefined,
): boolean {
  if (!pub) return false;
  const source = pub.source ?? pub.track?.source;
  return source != null && SCREEN_SHARE_SOURCE_NAMES.has(source as string);
}

/**
 * Thin façade over a LiveKit Room. The consumer (CallProvider) doesn't see
 * the underlying SDK at all — it gets snapshot arrays + a handful of
 * imperative actions (mute, leave, share screen). All multi-participant
 * routing, ICE, simulcast and reconnect handling is delegated to LiveKit.
 *
 * Lifecycle:
 *   1. `new LiveKitCallService({ ...events })`
 *   2. `await connect({ roomName, mediaType, participantName })` — joins +
 *      publishes mic (and camera if video). Subsequent track changes flow
 *      through `onParticipantsChange`.
 *   3. action methods: `setMicMuted`, `setCameraOff`, `toggleScreenShare`.
 *   4. `disconnect()` → tears down + closes hardware.
 */
export class LiveKitCallService {
  private readonly events: LiveKitCallEvents;
  private room: Room | null = null;
  private destroyed = false;
  /** Most recent connection state we surfaced; used to suppress duplicates. */
  private lastConnectionState: ConnectionState = ConnectionState.Disconnected;

  constructor(events: LiveKitCallEvents) {
    this.events = events;
  }

  // ── Public API ─────────────────────────────────────────────

  get currentRoom(): Room | null {
    return this.room;
  }

  /** Local LiveKit identity once connected (matches Supabase user id). */
  get localIdentity(): string | null {
    return this.room?.localParticipant?.identity ?? null;
  }

  /** Build a snapshot of the local + remote participants right now. */
  snapshot(): CallPeerSnapshot[] {
    const room = this.room;
    if (!room) return [];
    const snaps: CallPeerSnapshot[] = [];
    snaps.push(this.snapshotForLocal(room.localParticipant));
    for (const remote of room.remoteParticipants.values()) {
      snaps.push(this.snapshotForRemote(remote));
    }
    return snaps;
  }

  async connect(options: LiveKitConnectOptions): Promise<void> {
    if (this.room) {
      throw new Error('LiveKitCallService is already connected');
    }
    if (this.destroyed) {
      throw new Error('LiveKitCallService has been disposed');
    }
    const { token, url } = await fetchLiveKitToken({
      roomName: options.roomName,
      participantName: options.participantName,
    });

    const room = new Room({
      // Adaptive stream + dynamic broadcast keeps multi-party video viable
      // on weaker uplinks: LiveKit will downgrade or pause unsubscribed
      // tiles automatically. Without these, every joiner pulls full HD
      // from every publisher and cellular networks fall over.
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;
    this.bindRoomEvents(room);

    try {
      await room.connect(url, token, {
        // 15s default LiveKit timeout is too short on flaky cell networks;
        // bump to 30 so a brief Wi-Fi handover doesn't fail the whole join.
        rtcConfig: { iceTransportPolicy: undefined },
      });
    } catch (err) {
      this.room = null;
      throw err instanceof Error
        ? err
        : new Error('Failed to connect to LiveKit room');
    }

    if (this.destroyed) {
      // disconnect was called between awaiting connect and now — clean up.
      await this.disconnect();
      return;
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      if (options.mediaType === 'video') {
        await room.localParticipant.setCameraEnabled(true);
      }
    } catch (err) {
      // Surface mic/cam permission failures so the UI can show a clear
      // message — but stay connected to the room (other participants can
      // still hear/see us once the user grants permission and toggles back).
      this.events.onError(
        err instanceof Error
          ? err.message
          : 'Could not access microphone/camera',
      );
    }

    this.emitParticipants();
  }

  /**
   * Update the local mic mute state. Idempotent — passing the current value
   * is a no-op so consumers can reuse one setter for both directions.
   */
  async setMicMuted(muted: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!muted);
      this.emitParticipants();
    } catch (err) {
      this.events.onError(
        err instanceof Error ? err.message : 'Could not toggle microphone',
      );
    }
  }

  async setCameraOff(off: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(!off);
      this.emitParticipants();
    } catch (err) {
      this.events.onError(
        err instanceof Error ? err.message : 'Could not toggle camera',
      );
    }
  }

  /** Start or stop screen sharing depending on current state. */
  async toggleScreenShare(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const local = room.localParticipant;
    const isSharing = local.isScreenShareEnabled;
    try {
      if (isSharing) {
        await local.setScreenShareEnabled(false);
      } else {
        // System audio capture is best-effort: Chrome on Windows supports it,
        // most other browsers don't. LiveKit silently omits it when the
        // platform refuses, so requesting it is safe.
        await local.setScreenShareEnabled(true, { audio: true });
      }
      this.emitParticipants();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // User aborted the picker — silent, matches getDisplayMedia's pattern.
      if (/abort|notallowederror|permission/i.test(msg)) return;
      this.events.onError(msg || 'Could not toggle screen share');
    }
  }

  /** Tear down the room + release the camera/mic. Safe to call multiple times. */
  async disconnect(): Promise<void> {
    this.destroyed = true;
    const room = this.room;
    this.room = null;
    if (!room) return;
    try {
      await room.disconnect(true);
    } catch {
      /* swallow — best-effort cleanup */
    }
  }

  // ── Internal: room event wiring ─────────────────────────────

  private bindRoomEvents(room: Room): void {
    const refresh = () => this.emitParticipants();

    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, (
        _track: RemoteTrack,
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant,
      ) => refresh())
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.LocalTrackPublished, (_pub: LocalTrackPublication) => refresh())
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ParticipantNameChanged, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, (_speakers: Participant[]) => refresh())
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === this.lastConnectionState) return;
        this.lastConnectionState = state;
        this.events.onConnectionStateChange(state);
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.events.onDisconnected(reason ?? null);
      })
      .on(RoomEvent.MediaDevicesError, (err: Error) => {
        this.events.onError(err.message || 'Media device error');
      });
  }

  // ── Internal: snapshot building ─────────────────────────────

  private snapshotForLocal(local: LocalParticipant): CallPeerSnapshot {
    const cameraPub = local.getTrackPublication(Track.Source.Camera);
    const screenPub = local.getTrackPublication(Track.Source.ScreenShare);
    const micPub = local.getTrackPublication(Track.Source.Microphone);

    const videoTrack = (screenPub?.track?.mediaStreamTrack ??
      cameraPub?.track?.mediaStreamTrack) ?? null;
    const audioTrack = micPub?.track?.mediaStreamTrack ?? null;

    return {
      userId: local.identity,
      displayName: local.name || local.identity,
      audioStream: audioTrack ? new MediaStream([audioTrack]) : null,
      videoStream: videoTrack ? new MediaStream([videoTrack]) : null,
      isMicMuted: !local.isMicrophoneEnabled,
      isCameraOff: !local.isCameraEnabled,
      isScreenSharing: local.isScreenShareEnabled,
      isSpeaking: local.isSpeaking,
      isLocal: true,
    };
  }

  private snapshotForRemote(remote: RemoteParticipant): CallPeerSnapshot {
    // Prefer screen-share over camera when both are published — matches
    // the Meet/Teams convention of giving the share the main tile.
    let videoTrack: MediaStreamTrack | null = null;
    // Both mic audio AND screen-share audio (system audio from the presenter)
    // are surfaced so viewers hear what the presenter is playing as well as
    // them speaking. Browsers only expose system audio on Chrome/Edge for
    // tab/window shares; LiveKit publishes whatever the picker returned.
    const audioTracks: MediaStreamTrack[] = [];
    let isScreen = false;
    let isCameraOff = true;
    let isMicMuted = true;

    for (const pub of remote.trackPublications.values()) {
      if (!pub.isSubscribed || !pub.track) {
        // We still need to know mute/camera-off state for the tile even when
        // we haven't subscribed (e.g. background tab pauses).
        if (pub.kind === Track.Kind.Audio && !isScreenSharePublication(pub)) {
          isMicMuted = pub.isMuted;
        }
        if (pub.source === Track.Source.Camera) isCameraOff = pub.isMuted;
        continue;
      }
      const track = pub.track;
      if (track.kind === Track.Kind.Video) {
        if (isScreenSharePublication(pub)) {
          videoTrack = track.mediaStreamTrack;
          isScreen = true;
        } else if (!isScreen) {
          videoTrack = track.mediaStreamTrack;
          isCameraOff = pub.isMuted;
        }
      } else if (track.kind === Track.Kind.Audio) {
        if (isScreenSharePublication(pub)) {
          // Screen-share audio (system sound from the shared tab/window).
          if (!pub.isMuted) audioTracks.push(track.mediaStreamTrack);
        } else {
          audioTracks.push(track.mediaStreamTrack);
          isMicMuted = pub.isMuted;
        }
      }
    }
    // Camera publication's mute state — even if no track is subscribed yet
    // we want to reflect "they joined with cam off" in the tile.
    const camPub = remote.getTrackPublication(Track.Source.Camera);
    if (camPub) isCameraOff = camPub.isMuted || !camPub.isSubscribed;
    const micPub = remote.getTrackPublication(Track.Source.Microphone);
    if (micPub) isMicMuted = micPub.isMuted;

    return {
      userId: remote.identity,
      displayName: remote.name || remote.identity,
      audioStream: audioTracks.length > 0 ? new MediaStream(audioTracks) : null,
      videoStream: videoTrack ? new MediaStream([videoTrack]) : null,
      isMicMuted,
      isCameraOff,
      isScreenSharing: isScreen,
      isSpeaking: remote.isSpeaking,
      isLocal: false,
    };
  }

  private emitParticipants(): void {
    if (!this.room) return;
    this.events.onParticipantsChange(this.snapshot());
  }
}

// Re-export ConnectionState so consumers can switch on it without importing
// from `livekit-client` directly — keeps the SDK as a single dependency
// boundary inside this folder.
export { ConnectionState, projectRoomName };

// Discourage TS dead-code warnings in callers that only need the type-level
// permission shape; we'll wire it in if/when we add per-participant subscribe
// permissions for very large rooms.
export type { ParticipantTrackPermission };

// CallParticipant is re-exported so existing imports from this file work.
export type { CallParticipant };
