import { SignalingChannel } from './SignalingChannel';
import { getIceServers } from './iceServers';
import { acquireUserMedia, acquireScreenMedia, stopAllTracks } from './mediaUtils';
import {
  BackgroundProcessor,
  isBackgroundEffectSupported,
  type VideoEffect,
} from './BackgroundProcessor';
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
  | 'reject'
  /**
   * Fires the moment we have proof the remote side is engaged with the call:
   * the caller has received the SDP answer, or the callee has sent theirs.
   * Lets the UI cancel "didn't answer" timers before ICE has even finished.
   */
  | 'answered';

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
  private readonly signalingReady: Promise<void>;
  /**
   * True once we know the remote peer is subscribed to the call channel and
   * therefore able to receive our broadcasts. Until then, ICE candidates are
   * buffered locally and flushed once the peer is reachable.
   *
   * Why this matters: Supabase Realtime broadcasts are fire-and-forget — any
   * ICE candidate the caller emits before the callee taps "Accept" (and thus
   * subscribes to `call:{callId}`) is silently dropped, which prevents the
   * peer connection from ever completing. Buffering closes that race.
   */
  private peerReachable = false;
  private bufferedCandidates: RTCIceCandidateInit[] = [];
  /** Number of ICE-restart attempts already made for the current connection. */
  private iceRestartAttempts = 0;
  /** Pending timer for an ICE restart so we can debounce/cancel on recovery. */
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Active background-effect pipeline (segmentation + blur composite). When
   * set, the track on the wire is the processor's output, NOT the raw camera.
   */
  private bgProcessor: BackgroundProcessor | null = null;
  private currentVideoEffect: VideoEffect = 'none';

  constructor(
    private callId: string,
    private localParticipant: CallParticipant,
    private signaling: SignalingChannel,
    iceServers: RTCIceServer[] = getIceServers(),
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.setupPCListeners();
    this.setupSignalingListener();
    this.signalingReady = this.signaling.subscribe().catch((err) => {
      if (!this._destroyed) {
        this.emit(
          'error',
          err instanceof Error ? err.message : String(err),
        );
      }
      throw err;
    });
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

      await this.signalingSend({
        type: 'answer',
        sdp: this.pc.localDescription!,
        callId: this.callId,
        from: this.localParticipant,
      });

      // Caller has been subscribed to the call channel since startCall, so any
      // candidates we emit from here on can flow live; flush anything that was
      // gathered between setLocalDescription and now.
      this.markPeerReachable();
      this.emit('answered');
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

  /**
   * Apply a Microsoft Teams-style visual effect to the local camera. The
   * processed stream replaces the raw camera track on the peer connection
   * via `RTCRtpSender.replaceTrack`, so the remote side sees the effect.
   *
   * Setting effect to `'none'` tears the processor down and restores the raw
   * camera track. No-op for audio-only calls (no camera track exists).
   */
  async setVideoEffect(effect: VideoEffect): Promise<void> {
    if (this._destroyed) return;
    if (!this.cameraTrack) return; // audio-only call — nothing to process
    if (effect === this.currentVideoEffect && this.bgProcessor) return;

    const sender = this.pc
      .getSenders()
      .find((s) => s.track?.kind === 'video');

    // Turn the effect off entirely.
    if (effect === 'none') {
      this.currentVideoEffect = 'none';
      if (this.bgProcessor) {
        if (sender) {
          try {
            await sender.replaceTrack(this.cameraTrack);
          } catch {
            /* sender may be in a transient state during renegotiation */
          }
        }
        this.bgProcessor.destroy();
        this.bgProcessor = null;
      }
      return;
    }

    // Bail out gracefully on browsers that don't support canvas.captureStream.
    if (!isBackgroundEffectSupported()) {
      throw new Error(
        'Background effects are not supported on this browser.',
      );
    }

    // First-time activation — build the processor and swap the track.
    if (!this.bgProcessor) {
      const sourceStream = this.localStream ?? new MediaStream([this.cameraTrack]);
      const processor = new BackgroundProcessor(sourceStream);
      processor.setEffect(effect);
      try {
        await processor.ready();
      } catch (err) {
        processor.destroy();
        throw err;
      }
      const processedTrack = processor.outputStream.getVideoTracks()[0];
      if (!processedTrack) {
        processor.destroy();
        throw new Error('Background processor produced no video track');
      }
      if (sender) {
        await sender.replaceTrack(processedTrack);
      }
      this.bgProcessor = processor;
    } else {
      this.bgProcessor.setEffect(effect);
    }

    this.currentVideoEffect = effect;
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
    void (async () => {
      try {
        await this.signalingSend({
          type: 'hangup',
          callId: this.callId,
          from: this.localParticipant,
        });
      } catch {
        /* channel unavailable */
      } finally {
        if (!this._destroyed) this.destroy();
      }
    })();
  }

  /** Reject an incoming call. */
  reject(): void {
    if (this._destroyed) return;
    void (async () => {
      try {
        await this.signalingSend({
          type: 'reject',
          callId: this.callId,
          from: this.localParticipant,
        });
      } catch {
        /* channel unavailable */
      } finally {
        if (!this._destroyed) this.destroy();
      }
    })();
  }

  /** Release everything without sending a hangup signal (used internally). */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
    if (this.bgProcessor) {
      this.bgProcessor.destroy();
      this.bgProcessor = null;
    }
    stopAllTracks(this.localStream);
    stopAllTracks(this.screenStream);
    this.localStream = null;
    this.screenStream = null;
    this.cameraTrack = null;
    this.callContext = null;
    this.bufferedCandidates = [];
    this.peerReachable = false;
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

  /**
   * Attempt to recover from a `disconnected` / `failed` connection state by
   * triggering an ICE restart. The browser regathers candidates and
   * `onnegotiationneeded` fires, which our existing `runNegotiationNeeded`
   * handler turns into a fresh offer to the peer.
   *
   * Capped at a few attempts so we don't flood signaling on a permanently
   * broken network.
   */
  private scheduleIceRestart(): void {
    if (this._destroyed || this.iceRestartTimer) return;
    if (this.iceRestartAttempts >= 3) return;
    const delayMs = 1500 * (this.iceRestartAttempts + 1);
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = null;
      if (this._destroyed) return;
      // If we recovered while waiting, do nothing.
      const cs = this.pc.connectionState;
      if (cs === 'connected' || cs === 'closed') return;
      this.iceRestartAttempts += 1;
      try {
        this.pc.restartIce();
      } catch {
        /* older browsers without restartIce — fall back to onnegotiationneeded */
      }
    }, delayMs);
  }

  /**
   * Mark the remote peer as subscribed to our call channel and flush every
   * ICE candidate gathered while we were waiting. Idempotent.
   */
  private markPeerReachable(): void {
    if (this.peerReachable || this._destroyed) return;
    this.peerReachable = true;
    if (this.bufferedCandidates.length === 0) return;
    const pending = this.bufferedCandidates;
    this.bufferedCandidates = [];
    for (const candidate of pending) {
      void this.signalingSend({
        type: 'ice-candidate',
        candidate,
        callId: this.callId,
      });
    }
  }

  /** Await Realtime subscription before sending (PostgREST broadcast requires SUBSCRIBED). */
  private async signalingSend(msg: SignalMessage): Promise<void> {
    if (this._destroyed) return;
    try {
      await this.signalingReady;
    } catch {
      if (this._destroyed) return;
      return;
    }
    if (this._destroyed) return;
    this.signaling.send(msg);
  }

  private setupPCListeners(): void {
    this.pc.onicecandidate = (e) => {
      if (!e.candidate || this._destroyed) return;
      const candidate = e.candidate.toJSON();
      if (this.peerReachable) {
        void this.signalingSend({
          type: 'ice-candidate',
          candidate,
          callId: this.callId,
        });
      } else {
        // Buffer until the remote peer subscribes; otherwise the broadcast is dropped.
        this.bufferedCandidates.push(candidate);
      }
    };

    this.pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) this.emit('remote-stream', stream);
    };

    this.pc.onconnectionstatechange = () => {
      this.emit('connection-state', this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        // Healthy again — clear any pending recovery work.
        this.iceRestartAttempts = 0;
        if (this.iceRestartTimer) {
          clearTimeout(this.iceRestartTimer);
          this.iceRestartTimer = null;
        }
      } else if (
        this.pc.connectionState === 'disconnected' ||
        this.pc.connectionState === 'failed'
      ) {
        // Transient blips (Snipping Tool overlay, brief Wi-Fi loss, etc.) often
        // resolve on their own. Wait briefly, then trigger ICE restart so the
        // call self-heals instead of leaving the user staring at a frozen frame.
        this.scheduleIceRestart();
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      this.emit('ice-state', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this.scheduleIceRestart();
      }
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
      await this.signalingSend({
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
            await this.signalingSend({
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
          // Receiving an answer proves the callee is subscribed; flush any
          // ICE candidates that were buffered during the ringing phase.
          this.markPeerReachable();
          this.emit('answered');
          break;

        case 'ice-candidate':
          // Receiving a candidate from the peer also implies they are
          // subscribed and can hear us — useful for renegotiation flows.
          this.markPeerReachable();
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
