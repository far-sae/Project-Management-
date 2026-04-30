import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Minimize2, Maximize2, PhoneOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CallControls } from './CallControls';
import { IncomingCallModal } from './IncomingCallModal';
import { useCall } from '@/hooks/useCall';
import { cn } from '@/lib/utils';

// ── Outgoing ringtone (Teams-style) ──────────────────────────

function useOutgoingRingtone(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) return;

    const getOrCreateCtx = (): AudioContext | null => {
      try {
        if (ctxRef.current && ctxRef.current.state !== 'closed') return ctxRef.current;
        const Ctor = window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctxRef.current = new Ctor();
        return ctxRef.current;
      } catch { return null; }
    };

    const playRingback = () => {
      const ctx = getOrCreateCtx();
      if (!ctx) return;
      try {
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.12, ctx.currentTime);
        master.connect(ctx.destination);

        // Standard ringback: 440Hz + 480Hz for 2s, then 4s silence (US pattern)
        // We play a shorter pattern to feel more like Teams
        const playTone = (freq: number, start: number, dur: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + start + 0.05);
          gain.gain.setValueAtTime(0.08, ctx.currentTime + start + dur - 0.1);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
          osc.connect(gain);
          gain.connect(master);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur + 0.01);
        };

        // Ring-ring pattern: two short bursts
        playTone(440, 0, 0.8);
        playTone(480, 0, 0.8);
        playTone(440, 1.2, 0.8);
        playTone(480, 1.2, 0.8);
      } catch { /* audio blocked */ }
    };

    playRingback();
    intervalRef.current = setInterval(playRingback, 4000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const ctx = ctxRef.current;
      ctxRef.current = null;
      void ctx?.close().catch(() => {});
    };
  }, [active]);
}

// ── Draggable window (PiP) ──────────────────────────────────

interface DragPosition {
  x: number;
  y: number;
}

/**
 * Pointer-based drag for a fixed-position element. Returns the current top/left
 * style and a `bind` object to spread onto the drag handle. The element clamps
 * itself within the viewport on drag and on window resize, so it stays
 * accessible even if the user shrinks the window after positioning.
 */
function useDraggable(initial: () => DragPosition) {
  const [pos, setPos] = useState<DragPosition>(initial);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);

  const clamp = useCallback((next: DragPosition): DragPosition => {
    const el = elementRef.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 200;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - w - margin);
    const maxY = Math.max(margin, window.innerHeight - h - margin);
    return {
      x: Math.min(Math.max(next.x, margin), maxX),
      y: Math.min(Math.max(next.y, margin), maxY),
    };
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't start drag from interactive controls (buttons, links, inputs).
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [role="button"]')) {
        return;
      }
      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragRef.current = {
        pointerId: e.pointerId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setPos(clamp({ x: e.clientX - drag.offsetX, y: e.clientY - drag.offsetY }));
    },
    [clamp],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    elementRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  return {
    ref: elementRef,
    style: { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } as React.CSSProperties,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    setPos,
  };
}

// ── Call duration timer ──────────────────────────────────────

function useCallTimer(connected: boolean) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (connected) {
      setSeconds(0);
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      setSeconds(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [connected]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────

/**
 * Attach a MediaStream to a media element and explicitly start playback.
 *
 * iOS Safari (and some Android browsers) will not auto-play a freshly assigned
 * `srcObject` without an explicit `.play()` call, even when the assignment
 * happened during a user gesture (e.g. tapping Accept). Calling `.play()` here
 * surfaces the playback promise so we can swallow benign autoplay rejections
 * without breaking the call.
 */
function attachStream(
  el: HTMLMediaElement | null,
  stream: MediaStream | null,
): void {
  if (!el) return;
  if (el.srcObject !== stream) {
    el.srcObject = stream;
  }
  if (!stream) return;
  const playResult = el.play();
  if (playResult && typeof playResult.then === 'function') {
    playResult.catch(() => {
      /* Autoplay blocked — user can tap to retry; harmless. */
    });
  }
}

// Fixed PiP dimensions — explicit numbers so portrait/landscape source video
// never stretches the window vertically.
const PIP_WIDTH = 280;
const PIP_VIDEO_HEIGHT = 180;
const PIP_INSET = 20;

const initialPipPosition = (): DragPosition => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  // Approximate full PiP height (drag strip + video/avatar + controls).
  const approxHeight = PIP_VIDEO_HEIGHT + 80;
  return {
    x: Math.max(PIP_INSET, window.innerWidth - PIP_WIDTH - PIP_INSET),
    y: Math.max(PIP_INSET, window.innerHeight - approxHeight - PIP_INSET * 4),
  };
};

export const CallOverlay: React.FC = () => {
  const { state, actions } = useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  /** Blurred backdrop video that fills the screen behind the crisp remote feed. */
  const remoteBackdropRef = useRef<HTMLVideoElement>(null);
  /** Dedicated audio sink — single source of truth for remote sound. */
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [pip, setPip] = useState(false);
  const pipDrag = useDraggable(initialPipPosition);

  // Re-anchor the PiP to its default spot every time the user enters PiP
  // mode, so it doesn't reappear off-screen if the window has been resized.
  useEffect(() => {
    if (pip) pipDrag.setPos(initialPipPosition());
    // pipDrag.setPos is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pip]);

  const isOutgoingRinging = state.status === 'ringing' && state.direction === 'outgoing';
  const isConnected = state.status === 'connected';

  useOutgoingRingtone(isOutgoingRinging);
  const callDuration = useCallTimer(isConnected);

  useEffect(() => {
    attachStream(localVideoRef.current, state.localStream);
  }, [state.localStream, pip]);

  useEffect(() => {
    attachStream(remoteVideoRef.current, state.remoteStream);
    attachStream(remoteBackdropRef.current, state.remoteStream);
  }, [state.remoteStream, pip]);

  // The dedicated <audio> element is the single source of truth for remote
  // sound, since the visible <video> elements are muted to prevent the
  // backdrop+foreground duplication from echoing. Include `pip` so we
  // re-attach when the DOM element is re-created by the PiP toggle.
  useEffect(() => {
    attachStream(remoteAudioRef.current, state.remoteStream);
  }, [state.remoteStream, pip]);

  // Nothing to render when idle
  if (state.status === 'idle') return null;

  // Always-mounted audio sink for the remote stream. The visible <video>
  // elements (foreground + blurred backdrop) are all muted, so this sink is
  // the only thing that actually emits sound for both video and audio-only
  // calls — guaranteeing no echo and no missing audio.
  //
  // We deliberately *do not* use `display: none` (Tailwind's `hidden`),
  // because some browser configurations refuse to play media from a
  // display:none element. Pinning it off-screen with zero size keeps the
  // element visually invisible while still allowing reliable playback.
  const remoteAudioSink = (
    <audio
      ref={remoteAudioRef}
      autoPlay
      aria-hidden="true"
      style={{
        position: 'fixed',
        width: 1,
        height: 1,
        left: -9999,
        top: -9999,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );

  // ── "No answer" / error end screen ─────────────────────────

  if (state.status === 'ended') {
    return (
      <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 text-white">
        <div className="flex flex-col items-center gap-3 animate-in fade-in duration-200">
          <p className="text-lg font-semibold">Call ended</p>
          {state.error && (
            <p className="text-sm text-white/60">{state.error}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Incoming call ring screen ──────────────────────────────

  if (state.status === 'ringing' && state.direction === 'incoming') {
    return (
      <IncomingCallModal
        caller={state.remoteParticipant!}
        mediaType={state.mediaType}
        onAccept={() => void actions.acceptCall()}
        onReject={actions.rejectCall}
      />
    );
  }

  // ── Outgoing ringing screen ────────────────────────────────

  if (isOutgoingRinging) {
    const remoteName = state.remoteParticipant?.displayName || 'Participant';
    return (
      <div
        className="fixed inset-0 z-[250] flex flex-col items-center justify-center bg-black/95 text-white"
        role="dialog"
        aria-label="Outgoing call"
      >
        <div className="flex flex-col items-center gap-5 animate-in fade-in duration-200">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" />
            <Avatar className="h-24 w-24 ring-4 ring-white/20 relative">
              <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
              <AvatarFallback className="text-3xl bg-white/10 text-white">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold">{remoteName}</p>
            <p className="text-sm text-white/50 mt-1">
              Calling… {state.mediaType === 'video' ? 'video' : 'audio'} call
            </p>
          </div>
          <Button
            variant="destructive"
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg mt-4"
            onClick={actions.hangUp}
            aria-label="Cancel call"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Active call ────────────────────────────────────────────

  const isVideo = state.mediaType === 'video';
  const remoteName = state.remoteParticipant?.displayName || 'Participant';
  const statusLabel =
    state.status === 'connecting'
      ? 'Connecting…'
      : state.status === 'reconnecting'
        ? 'Reconnecting…'
        : callDuration;

  // PiP mode
  if (pip) {
    return (
      <div
        ref={pipDrag.ref}
        style={{ ...pipDrag.style, width: PIP_WIDTH }}
        {...pipDrag.handlers}
        className={cn(
          'fixed z-[250] flex flex-col items-stretch select-none touch-none',
          'rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl overflow-hidden',
          'cursor-grab active:cursor-grabbing',
        )}
        role="dialog"
        aria-label="Active call (drag to move)"
      >
        {/* Drag affordance strip + expand button */}
        <div className="flex w-full items-center justify-between px-2 py-1 text-muted-foreground/60">
          <GripVertical className="h-3 w-3 rotate-90" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => setPip(false)}
            aria-label="Expand call"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {remoteAudioSink}
        {isVideo && state.remoteStream && (
          <div
            className="relative w-full bg-black overflow-hidden"
            style={{ height: PIP_VIDEO_HEIGHT }}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {state.localStream && !state.isCameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-2 right-2 w-16 h-12 rounded-md object-cover border border-white/30 shadow z-10"
              />
            )}
          </div>
        )}

        {!isVideo && (
          <div className="flex items-center gap-3 px-4 py-3 w-full">
            <Avatar className="h-9 w-9">
              <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{remoteName}</p>
              <p className="text-[11px] text-muted-foreground">{statusLabel}</p>
            </div>
          </div>
        )}

        <div className="w-full px-1 pb-1">
          <CallControls
            isMuted={state.isMuted}
            isCameraOff={state.isCameraOff}
            isScreenSharing={state.isScreenSharing}
            videoEffect={state.videoEffect}
            isApplyingEffect={state.isApplyingEffect}
            mediaType={state.mediaType}
            onToggleMute={actions.toggleMute}
            onToggleCamera={actions.toggleCamera}
            onToggleScreenShare={() => void actions.toggleScreenShare()}
            onToggleBackgroundEffect={() =>
              void actions.setVideoEffect(
                state.videoEffect === 'blur' ? 'none' : 'blur',
              )
            }
            onHangUp={actions.hangUp}
          />
        </div>
      </div>
    );
  }

  // Full-screen overlay
  return (
    <div
      className="fixed inset-0 z-[250] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-label="Active call"
    >
      {remoteAudioSink}
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-black/60">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-white/20">
            <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
            <AvatarFallback className="text-sm bg-white/10 text-white">
              {remoteName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold">{remoteName}</p>
            <p className="text-xs text-white/60">
              {statusLabel}
              {state.isScreenSharing ? ' · Screen sharing' : ''}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10"
          onClick={() => setPip(true)}
          aria-label="Minimize call"
        >
          <Minimize2 className="h-5 w-5" />
        </Button>
      </div>

      {/* Video area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {isVideo && state.remoteStream ? (
          <>
            {/* Blurred backdrop — fills the screen so portrait phone video
                doesn't leave black bars, without zooming the actual frame. */}
            <video
              ref={remoteBackdropRef}
              autoPlay
              playsInline
              muted
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60 pointer-events-none"
            />
            {/* Remote video — fills the entire screen area. */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover z-[1]"
            />
            {state.localStream && !state.isCameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-4 right-4 w-40 h-28 rounded-lg object-cover border-2 border-white/20 shadow-xl z-10"
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-28 w-28 ring-4 ring-white/10">
              <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
              <AvatarFallback className="text-4xl bg-white/10 text-white">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <p className="text-lg font-semibold">{remoteName}</p>
            <p className="text-sm text-white/50">{statusLabel}</p>
          </div>
        )}

        {state.error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg bg-destructive/90 px-4 py-2 text-sm text-white shadow-lg">
            {state.error}
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-black/60 backdrop-blur">
        <CallControls
          isMuted={state.isMuted}
          isCameraOff={state.isCameraOff}
          isScreenSharing={state.isScreenSharing}
          videoEffect={state.videoEffect}
          isApplyingEffect={state.isApplyingEffect}
          mediaType={state.mediaType}
          onToggleMute={actions.toggleMute}
          onToggleCamera={actions.toggleCamera}
          onToggleScreenShare={() => void actions.toggleScreenShare()}
          onToggleBackgroundEffect={() =>
            void actions.setVideoEffect(
              state.videoEffect === 'blur' ? 'none' : 'blur',
            )
          }
          onHangUp={actions.hangUp}
        />
      </div>
    </div>
  );
};
