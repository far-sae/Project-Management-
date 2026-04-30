import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Minimize2, Maximize2, PhoneOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CallControls } from './CallControls';
import { IncomingCallModal } from './IncomingCallModal';
import { MeetingNotesReviewModal } from './MeetingNotesReviewModal';
import { useCall } from '@/hooks/useCall';
import { useMeetingRecorder, type MeetingRecording } from '@/hooks/useMeetingRecorder';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { uploadFileWithProgress } from '@/services/supabase/storage';
import { insertProjectChatMessage } from '@/services/supabase/database';

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
  const { user } = useAuth();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  /** Local screen-share preview shown to the sharer themselves, Meet-style:
   *  the screen takes the main stage and the camera faces shrink into a
   *  thumbnail strip on the right. */
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  /** Blurred backdrop video that fills the screen behind the crisp remote feed. */
  const remoteBackdropRef = useRef<HTMLVideoElement>(null);
  /** Dedicated audio sink — single source of truth for remote sound. */
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [pip, setPip] = useState(false);
  const pipDrag = useDraggable(initialPipPosition);

  const recorder = useMeetingRecorder(state.localStream, state.remoteStream);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Guard so a single recording is never persisted twice — both the manual
  // stop and the auto-stop-on-call-end paths can settle in close succession.
  const persistedIdsRef = useRef<Set<string>>(new Set());

  /** Save the audio blob to Supabase Storage and post a "call recording"
   *  message into the project chat so teammates can replay or skim the
   *  transcript without leaving their inbox. Failures are non-fatal — the
   *  user still has the local audio in the review modal regardless. */
  const persistRecordingToChat = useCallback(
    async (rec: MeetingRecording) => {
      if (!rec.audioBlob || !user?.userId) return;
      const ctx = state.context;
      // We currently only have a chat surface for project-context calls. DM
      // calls just stay in the review modal; that's a separate ticket if
      // direct-message chats want call cards too.
      if (!ctx || ctx.type !== 'project') return;
      const orgId = user.organizationId;
      if (!orgId) return;

      // De-dupe across the manual + auto-stop effects.
      const dedupeKey = `${rec.startedAt ?? ''}-${rec.durationSec}`;
      if (persistedIdsRef.current.has(dedupeKey)) return;
      persistedIdsRef.current.add(dedupeKey);

      try {
        const stamp = (rec.startedAt || new Date().toISOString())
          .replace(/[:T.]/g, '-')
          .slice(0, 19);
        const fileName = `call-${stamp}.webm`;
        const file = new File([rec.audioBlob], fileName, {
          type: rec.audioBlob.type || 'audio/webm',
        });
        // Upload via the same path tasks/files use so the recording also
        // surfaces on the Files page automatically.
        const uploaded = await uploadFileWithProgress(
          user.userId,
          user.displayName || user.email || 'User',
          orgId,
          { projectId: ctx.targetId, file, scope: 'project' },
        );

        // Embed structured data in the chat body so the message renderer
        // can show a play/download card instead of dumping the URL as text.
        const card = {
          _kind: 'call_recording' as const,
          url: uploaded.fileUrl,
          fileId: uploaded.fileId,
          fileName,
          durationSec: rec.durationSec,
          startedAt: rec.startedAt,
          transcript: rec.transcript || '',
        };
        await insertProjectChatMessage({
          projectId: ctx.targetId,
          organizationId: orgId,
          userId: user.userId,
          displayName: user.displayName || user.email || 'User',
          photoURL: user.photoURL,
          body: JSON.stringify(card),
        });
        toast.success('Recording saved to project chat');
      } catch {
        // Soft-fail: the local audio is still in the review modal, so the
        // user can download it manually if persistence flaked.
        toast.warning(
          'Recording stayed local — could not upload to project storage.',
        );
      }
    },
    [user, state.context],
  );

  const handleToggleRecording = useCallback(() => {
    if (recorder.isRecording) {
      void recorder.stop().then((rec) => {
        if (rec && (rec.audioBlob || rec.transcript)) {
          setReviewOpen(true);
        }
        if (rec) void persistRecordingToChat(rec);
      });
    } else {
      void recorder.start().then((res) => {
        if (res.outcome === 'failed') {
          toast.error(res.error);
        } else if (res.outcome === 'started') {
          toast.success('Recording started');
        }
      });
    }
  }, [recorder, persistRecordingToChat]);

  // If the call ends while we're still recording, finalise the file so the
  // user gets the audio + transcript instead of losing it on hangup.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    wasRecordingRef.current = recorder.isRecording;
  }, [recorder.isRecording]);
  useEffect(() => {
    if (state.status === 'ended' && wasRecordingRef.current) {
      void recorder.stop().then((rec) => {
        if (rec && (rec.audioBlob || rec.transcript)) {
          setReviewOpen(true);
        }
        if (rec) void persistRecordingToChat(rec);
      });
    }
  }, [state.status, recorder, persistRecordingToChat]);

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

  // Attach the local screen-capture stream to the dedicated <video>. We use
  // `state.screenStream` (not the peer-side video sender) so the sharer sees
  // the same screen they're presenting — without it, the local screen-share
  // surface is invisible to the user themselves.
  useEffect(() => {
    attachStream(screenVideoRef.current, state.screenStream);
  }, [state.screenStream, pip]);

  // The dedicated <audio> element is the single source of truth for remote
  // sound, since the visible <video> elements are muted to prevent the
  // backdrop+foreground duplication from echoing. Include `pip` so we
  // re-attach when the DOM element is re-created by the PiP toggle.
  useEffect(() => {
    attachStream(remoteAudioRef.current, state.remoteStream);
  }, [state.remoteStream, pip]);

  // The recording-review modal must outlive the call itself: when status hits
  // 'ended' the user still needs to see/save their recording. So render it
  // alongside whatever we'd otherwise return — including a bare modal-only
  // tree when the call has fully gone idle.
  const reviewModal = (
    <MeetingNotesReviewModal
      open={reviewOpen}
      onOpenChange={(next) => {
        setReviewOpen(next);
        if (!next) recorder.reset();
      }}
      recording={recorder.lastRecording}
      userId={user?.userId}
      meetingLabel={state.context?.label || 'meeting'}
    />
  );

  // Nothing to render when idle, except a still-open recording review.
  if (state.status === 'idle') {
    return reviewOpen ? reviewModal : null;
  }

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
      <>
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 text-white">
          <div className="flex flex-col items-center gap-3 animate-in fade-in duration-200">
            <p className="text-lg font-semibold">Call ended</p>
            {state.error && (
              <p className="text-sm text-white/60">{state.error}</p>
            )}
          </div>
        </div>
        {reviewModal}
      </>
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
        {isVideo && (state.remoteStream || state.screenStream) && (
          <div
            className="relative w-full bg-black overflow-hidden"
            style={{ height: PIP_VIDEO_HEIGHT }}
          >
            {state.isScreenSharing && state.screenStream ? (
              // Local screen-share priority layout: screen fills the stage,
              // remote face goes to the corner — matches Google Meet's PiP.
              <>
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                {state.remoteStream && (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute bottom-2 right-2 w-16 h-12 rounded-md object-cover border border-white/30 shadow z-10"
                  />
                )}
              </>
            ) : (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-contain bg-black"
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
              </>
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
            compact
          />
        </div>
        {recorder.isRecording && (
          <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-medium text-white shadow">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            REC
          </div>
        )}
        {reviewModal}
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
        {isVideo && state.isScreenSharing && state.screenStream ? (
          // ── Local screen-share is primary ──
          // The shared screen takes the main stage, and the people's faces
          // (remote in front, your own camera below) move to a thumbnail
          // strip on the right — same shape as Google Meet's screen-share.
          <>
            <video
              ref={screenVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain bg-black z-[1]"
            />
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-3">
              {state.remoteStream && (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-48 h-32 rounded-lg object-cover border-2 border-white/20 shadow-xl"
                />
              )}
              {state.localStream && !state.isCameraOff && (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-32 h-20 rounded-lg object-cover border-2 border-white/20 shadow-xl"
                />
              )}
            </div>
            <div className="absolute top-4 left-4 z-10 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/90 shadow-lg ring-1 ring-white/10">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
              You're presenting
            </div>
          </>
        ) : isVideo && state.remoteStream ? (
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
            {/* Remote video — uses object-contain so a desktop screen-share
                arriving on a phone (or any aspect mismatch) fits fully
                without cropping the sides. The blurred backdrop above fills
                whatever dead space the contain leaves with an ambient tint
                — same trick Meet/Zoom use to avoid letterbox black bars. */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain z-[1]"
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
          isRecording={recorder.isRecording}
          onToggleRecording={handleToggleRecording}
        />
      </div>

      {recorder.isRecording && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
          <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
          Recording
        </div>
      )}

      {reviewModal}
    </div>
  );
};
