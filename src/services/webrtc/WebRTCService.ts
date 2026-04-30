import { SignalingChannel } from './SignalingChannel';
import { getIceServers } from './iceServers';
import { acquireUserMedia, acquireScreenMedia, stopAllTracks } from './mediaUtils';
import type {
  CallContext,
  CallMediaType,
  CallParticipant,
  SignalMessage,
} from './types';

export type RTCEventType =
  | 'remote-stream'
  | 'connection-state'
  | 'ice-state'
  | 'error'
  | 'hangup'
  | 'reject';

type RTCEventHandler = (type: RTCEventType, payload?: unknown) => void;

/**
 * Manages a single WebRTC peer connection for 1:1 calls.
 *
 * Lifecycle:
 *   1. Construct with a SignalingChannel + callId
 *   2. Call `createOffer()` (caller) or `handleOffer()` is invoked (callee)
 *   3. ICE candidates flow automatically
 *   4. `hangUp()` to tear down
 */
export class WebRTCService {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private callMediaType: CallMediaType = 'audio';
  /** Call UI context from the initial offer/answer; reused for renegotiation offers. */
  private callContext: CallContext | null = null;
  /** Suppress onnegotiationneeded while applying initial offer/answer locally. */
  private suppressNegotiation = false;
  private eventHandler: RTCEventHandler | null = null;
  private unsubSignaling: (() => void) | null = null;
  private _destroyed = false;

  constructor(
    private callId: string,
    private localParticipant: CallParticipant,
    private signaling: SignalingChannel,
    iceServers: RTCIceServer[] = getIceServers(),
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.setupPCListeners();
    this.setupSignalingListener();
    this.signaling.subscribe();
  }

  // ── Public API ─────────────────────────────────────────────

  /** Current local SDP after createOffer/createAnswer; use for inbox ring payload (not private pc). */
  get localDescription(): RTCSessionDescription | null {
    return this.pc.localDescription;
  }

  /** Set a single event handler for all RTC lifecycle events. */
  onEvent(handler: RTCEventHandler): void {
    this.eventHandler = handler;
  }

  /** Caller: acquire local media, add tracks, create local SDP offer. Signaling send is done by CallProvider (inbox + channel). */
  async createOffer(
    mediaType: CallMediaType,
    context: CallContext,
  ): Promise<MediaStream> {
    this.callMediaType = mediaType;
    this.callContext = context;
    this.suppressNegotiation = true;
    try {
      this.localStream = await acquireUserMedia(mediaType);
      this.cameraTrack =
        this.localStream.getVideoTracks()[0] ?? null;
      this.localStream
        .getTracks()
        .forEach((t) => this.pc.addTrack(t, this.localStream!));

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
    } finally {
      this.suppressNegotiation = false;
    }

    return this.localStream;
  }

  /** Callee: set remote offer, acquire media, create & send answer. */
  async answerOffer(
    offerSdp: RTCSessionDescriptionInit,
    mediaType: CallMediaType,
    context: CallContext,
  ): Promise<MediaStream> {
    this.callMediaType = mediaType;
    this.callContext = context;
    this.suppressNegotiation = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

      this.localStream = await acquireUserMedia(mediaType);
      this.cameraTrack =
        this.localStream.getVideoTracks()[0] ?? null;
      this.localStream
        .getTracks()
        .forEach((t) => this.pc.addTrack(t, this.localStream!));

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.signaling.send({
        type: 'answer',
        sdp: this.pc.localDescription!,
        callId: this.callId,
        from: this.localParticipant,
      });
    } finally {
      this.suppressNegotiation = false;
    }

    return this.localStream;
  }

  /** Toggle local audio mute. */
  toggleMute(muted: boolean): void {
    this.localStream
      ?.getAudioTracks()
      .forEach((t) => {
        t.enabled = !muted;
      });
  }

  /** Toggle local camera on/off. */
  toggleCamera(off: boolean): void {
    this.localStream
      ?.getVideoTracks()
      .forEach((t) => {
        t.enabled = !off;
      });
  }

  /** Start screen sharing — replaces the video track sent to the peer. */
  async startScreenShare(): Promise<MediaStream> {
    this.screenStream = await acquireScreenMedia();
    const screenTrack = this.screenStream.getVideoTracks()[0];

    // Replace the camera video track with the screen track
    const sender = this.pc
      .getSenders()
      .find((s) => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(screenTrack);
    } else {
      // Audio-only call had no video sender — add track and let negotiation complete via onnegotiationneeded
      this.pc.addTrack(screenTrack, this.screenStream);
    }

    // When the user clicks the browser's native "Stop sharing" button
    screenTrack.onended = () => {
      void this.stopScreenShare();
    };

    return this.screenStream;
  }

  /** Stop screen sharing and restore the camera track. */
  async stopScreenShare(): Promise<void> {
    stopAllTracks(this.screenStream);
    this.screenStream = null;

    // Restore camera track
    if (this.cameraTrack) {
      const sender = this.pc
        .getSenders()
        .find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(this.cameraTrack);
      }
    }
  }

  /** End the call, release all resources. */
  hangUp(): void {
    if (this._destroyed) return;
    this.signaling.send({
      type: 'hangup',
      callId: this.callId,
      from: this.localParticipant,
    });
    this.destroy();
  }

  /** Reject an incoming call. */
  reject(): void {
    if (this._destroyed) return;
    this.signaling.send({
      type: 'reject',
      callId: this.callId,
      from: this.localParticipant,
    });
    this.destroy();
  }

  /** Release everything without sending a hangup signal (used internally). */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    stopAllTracks(this.localStream);
    stopAllTracks(this.screenStream);
    this.localStream = null;
    this.screenStream = null;
    this.cameraTrack = null;
    this.callContext = null;
    this.pc.close();
    this.unsubSignaling?.();
    this.signaling.destroy();
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  // ── Private ────────────────────────────────────────────────

  private emit(type: RTCEventType, payload?: unknown): void {
    this.eventHandler?.(type, payload);
  }

  private setupPCListeners(): void {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          candidate: e.candidate.toJSON(),
          callId: this.callId,
        });
      }
    };

    this.pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) this.emit('remote-stream', stream);
    };

    this.pc.onconnectionstatechange = () => {
      this.emit('connection-state', this.pc.connectionState);
      if (
        this.pc.connectionState === 'failed' ||
        this.pc.connectionState === 'disconnected'
      ) {
        this.emit('error', `Connection ${this.pc.connectionState}`);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      this.emit('ice-state', this.pc.iceConnectionState);
    };

    this.pc.onnegotiationneeded = () => {
      void this.runNegotiationNeeded();
    };
  }

  /** Follow-up offers after addTrack etc. Initial offer/answer uses suppressNegotiation. */
  private async runNegotiationNeeded(): Promise<void> {
    if (this._destroyed || this.suppressNegotiation) return;
    if (this.pc.signalingState !== 'stable') return;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signaling.send({
        type: 'offer',
        sdp: this.pc.localDescription!,
        callId: this.callId,
        from: this.localParticipant,
        mediaType: this.callMediaType,
        context:
          this.callContext ?? { type: 'dm', targetId: '', label: '' },
      });
    } catch (err) {
      this.emit(
        'error',
        err instanceof Error ? err.message : 'Renegotiation failed',
      );
    }
  }

  private setupSignalingListener(): void {
    this.unsubSignaling = this.signaling.onMessage((msg: SignalMessage) => {
      if (msg.callId !== this.callId) return;
      void this.handleSignal(msg);
    });
  }

  private async handleSignal(msg: SignalMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'offer': {
          this.callContext = msg.context;
          this.suppressNegotiation = true;
          try {
            await this.pc.setRemoteDescription(
              new RTCSessionDescription(msg.sdp),
            );
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.signaling.send({
              type: 'answer',
              sdp: this.pc.localDescription!,
              callId: this.callId,
              from: this.localParticipant,
            });
          } finally {
            this.suppressNegotiation = false;
          }
          break;
        }

        case 'answer':
          await this.pc.setRemoteDescription(
            new RTCSessionDescription(msg.sdp),
          );
          break;

        case 'ice-candidate':
          if (msg.candidate) {
            await this.pc.addIceCandidate(
              new RTCIceCandidate(msg.candidate),
            );
          }
          break;

        case 'hangup':
          this.emit('hangup', msg.from);
          this.destroy();
          break;

        case 'reject':
          this.emit('reject', msg.from);
          this.destroy();
          break;

        default:
          break;
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : 'Signal error');
    }
  }
}
