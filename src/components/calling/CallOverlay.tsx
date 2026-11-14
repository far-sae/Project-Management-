import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GripVertical,
  Maximize2,
  Minimize2,
  PhoneOff,
  PictureInPicture2,
  UserPlus,
} from 'lucide-react';
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
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { transcribeRecording } from '@/services/ai/transcribeRecording';
import { ParticipantTile, RemoteAudioSink } from './CallTiles';
import { MiniCallView } from './MiniCallView';
import { GuestAdmitBanners, type GuestDecision } from './GuestAdmitBanners';
import { usePipWindow } from '@/hooks/usePipWindow';
import { requestVideoPipFor } from '@/services/calling/pip';
import {
  anyoneRecording,
  pickMiniMainTile,
  visiblePeers,
  waitingGuests,
} from '@/services/livekit/callHelpers';

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

// ── Draggable PiP window ─────────────────────────────────────

interface DragPosition {
  x: number;
  y: number;
}

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

// ── Grid layout helpers ──────────────────────────────────────

/**
 * Pick a tailwind grid-cols class based on tile count. We prefer "fewer
 * but bigger" tiles over packing into a wide grid, so 4 participants
 * stays 2x2 instead of 1x4.
 */
function gridColsFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-3';
  if (count <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

// ── Picture-in-picture dimensions ────────────────────────────

const PIP_WIDTH = 280;
const PIP_VIDEO_HEIGHT = 180;
const PIP_INSET = 20;

const initialPipPosition = (): DragPosition => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const approxHeight = PIP_VIDEO_HEIGHT + 80;
  return {
    x: Math.max(PIP_INSET, window.innerWidth - PIP_WIDTH - PIP_INSET),
    y: Math.max(PIP_INSET, window.innerHeight - approxHeight - PIP_INSET * 4),
  };
};

// ── Component ────────────────────────────────────────────────

export const CallOverlay: React.FC = () => {
  const { state, actions, canInviteGuests } = useCall();
  const { user } = useAuth();
  const pipDrag = useDraggable(initialPipPosition);
  // The provider rebuilds `actions` every render; read it through a ref so
  // the callbacks below stay stable and never call a stale action.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Waiting guests are in the room but not in the call: they never get a
  // tile, an audio sink or a head count — only the admit prompt.
  const shownPeers = useMemo(
    () => visiblePeers(state.participants),
    [state.participants],
  );
  const waiting = useMemo(
    () => waitingGuests(state.participants),
    [state.participants],
  );

  // Recording streams: local user's media + an aggregate of every remote
  // audio track so the meeting recorder still captures the whole call.
  const { localStream, remoteAudioStream } = useMemo(() => {
    let local: MediaStream | null = null;
    const remoteTracks: MediaStreamTrack[] = [];
    for (const p of shownPeers) {
      if (p.isLocal) {
        const tracks: MediaStreamTrack[] = [];
        if (p.audioStream) tracks.push(...p.audioStream.getAudioTracks());
        if (p.videoStream) tracks.push(...p.videoStream.getVideoTracks());
        local = tracks.length > 0 ? new MediaStream(tracks) : null;
      } else if (p.audioStream) {
        remoteTracks.push(...p.audioStream.getAudioTracks());
      }
    }
    return {
      localStream: local,
      remoteAudioStream:
        remoteTracks.length > 0 ? new MediaStream(remoteTracks) : null,
    };
  }, [shownPeers]);

  const recorder = useMeetingRecorder(localStream, remoteAudioStream);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Guard so a single recording is never persisted twice — both the manual
  // stop and the auto-stop-on-call-end paths can settle in close succession.
  const persistedIdsRef = useRef<Set<string>>(new Set());

  const persistRecordingToChat = useCallback(
    async (rec: MeetingRecording) => {
      if (!rec.audioBlob || !user?.userId) return;
      const ctx = state.context;
      if (!ctx || ctx.type !== 'project') return;
      const orgId = user.organizationId;
      if (!orgId) return;

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
        const uploaded = await uploadFileWithProgress(
          user.userId,
          user.displayName || user.email || 'User',
          orgId,
          { projectId: ctx.targetId, file, scope: 'project' },
        );

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
        toast.warning(
          'Recording stayed local — could not upload to project storage.',
        );
      }
    },
    [user, state.context],
  );

  // Recording shown in the review modal. Starts with the live-caption
  // transcript, then is replaced by the full Whisper transcript (all
  // participants) once the audio has been transcribed.
  const [reviewRecording, setReviewRecording] = useState<MeetingRecording | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const finishRecording = useCallback(
    async (rec: MeetingRecording | null) => {
      if (!rec) return;
      if (rec.audioBlob || rec.transcript) {
        setReviewRecording(rec);
        setReviewOpen(true);
      }
      let finalRec = rec;
      if (rec.audioBlob && rec.audioBlob.size > 0) {
        setTranscribing(true);
        try {
          const text = await transcribeRecording(rec.audioBlob);
          if (text) {
            finalRec = { ...rec, transcript: text };
            setReviewRecording(finalRec);
          } else if (!rec.transcript) {
            toast.message('No speech was detected in the recording.');
          }
        } catch (err) {
          toast.warning(
            `${err instanceof Error ? err.message : 'Transcription failed'}${
              rec.transcript ? ' — showing live captions instead.' : ''
            }`,
          );
        } finally {
          setTranscribing(false);
        }
      }
      void persistRecordingToChat(finalRec);
    },
    [persistRecordingToChat],
  );

  // Mirror the local recorder into the room's `recording` attribute so every
  // participant (guests included) sees the "Recording" badge. Idempotent so
  // the manual toggle and the stop-for-any-reason effect don't double-send.
  const recordingFlagRef = useRef(false);
  const syncRecordingFlag = useCallback((on: boolean) => {
    if (recordingFlagRef.current === on) return;
    recordingFlagRef.current = on;
    void actionsRef.current.setRecordingFlag(on);
  }, []);

  const handleToggleRecording = useCallback(() => {
    if (recorder.isRecording) {
      syncRecordingFlag(false);
      void recorder.stop().then(finishRecording);
    } else {
      void recorder.start().then((res) => {
        if (res.outcome === 'failed') {
          toast.error(res.error);
        } else if (res.outcome === 'started') {
          syncRecordingFlag(true);
          toast.success('Recording started');
        }
      });
    }
  }, [recorder, finishRecording, syncRecordingFlag]);

  // However the recorder stopped (button, call end, track loss), clear the
  // shared flag.
  useEffect(() => {
    if (!recorder.isRecording) syncRecordingFlag(false);
  }, [recorder.isRecording, syncRecordingFlag]);

  const someoneRecording =
    recorder.isRecording || anyoneRecording(state.participants);

  // ── Guests: invite + admit/deny ─────────────────────────────
  const [inviting, setInviting] = useState(false);
  const handleInviteGuest = useCallback(async () => {
    setInviting(true);
    try {
      await actionsRef.current.inviteGuest();
    } finally {
      setInviting(false);
    }
  }, []);

  const [guestBusy, setGuestBusy] = useState<Record<string, boolean>>({});
  const handleGuestDecision = useCallback(
    async (identity: string, decision: GuestDecision) => {
      setGuestBusy((b) => ({ ...b, [identity]: true }));
      try {
        // The provider toasts failures itself.
        if (decision === 'admit') await actionsRef.current.admitGuest(identity);
        else await actionsRef.current.denyGuest(identity);
      } finally {
        setGuestBusy((b) => {
          const next = { ...b };
          delete next[identity];
          return next;
        });
      }
    },
    [],
  );
  const admitBanners = (compact: boolean, className?: string) =>
    canInviteGuests ? (
      <GuestAdmitBanners
        guests={waiting}
        busy={guestBusy}
        onDecide={(id, d) => void handleGuestDecision(id, d)}
        compact={compact}
        className={className}
      />
    ) : null;
  const showInviteGuest = canInviteGuests && !!state.roomName;

  // If the call ends while we're still recording, finalise the file so the
  // user gets the audio + transcript instead of losing it on hangup.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    wasRecordingRef.current = recorder.isRecording;
  }, [recorder.isRecording]);
  useEffect(() => {
    if ((state.status === 'ended' || state.status === 'idle') && wasRecordingRef.current) {
      void recorder.stop().then(finishRecording);
    }
  }, [state.status, recorder, finishRecording]);

  // Re-anchor the in-app minimized box to its default spot every time the
  // user minimizes, so it doesn't reappear off-screen after a resize.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (minimized) pipDrag.setPos(initialPipPosition());
    // pipDrag.setPos is stable across renders.
  }, [minimized]);

  // ── Floating mini window (browser picture-in-picture) ───────
  const callActive =
    state.status === 'connecting' ||
    state.status === 'connected' ||
    state.status === 'reconnecting';
  const floating = usePipWindow({
    callActive,
    isLocalSharing: state.isScreenSharing,
  });

  const handleToggleScreenShare = useCallback(() => {
    const startingShare = !state.isScreenSharing;
    // Open the floating window in the same click as the share (Chrome only
    // allows it from a user gesture) so faces stay visible while presenting.
    if (startingShare && floating.support === 'document' && !floating.pipWindow) {
      void floating.openPip().catch(() => undefined);
    }
    void actions.toggleScreenShare().finally(() => {
      // Share picker cancelled on a visible tab → don't leave the window up.
      if (startingShare) setTimeout(floating.recheck, 500);
    });
  }, [state.isScreenSharing, floating, actions]);

  const handlePopOut = useCallback(async () => {
    try {
      if (floating.support === 'document') {
        await floating.openPip();
        return;
      }
      // Video fallback: no await before the request (Safari needs the click).
      const main = pickMiniMainTile(shownPeers);
      const request = main ? requestVideoPipFor(main.userId) : null;
      if (!request) {
        toast.message('Nothing to show yet');
        return;
      }
      await request;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the floating window');
    }
  }, [floating, shownPeers]);

  const floatingPortal = floating.pipWindow
    ? createPortal(
        <MiniCallView
          participants={shownPeers}
          isRecording={someoneRecording}
          waitingGuests={canInviteGuests ? waiting : []}
          guestBusy={guestBusy}
          onGuestDecision={(id, d) => void handleGuestDecision(id, d)}
          isMuted={state.isMuted}
          isCameraOff={state.isCameraOff}
          isScreenSharing={state.isScreenSharing}
          mediaType={state.mediaType}
          onToggleMute={actions.toggleMute}
          onToggleCamera={actions.toggleCamera}
          onStopSharing={() => void actions.toggleScreenShare()}
          onHangUp={actions.hangUp}
          onBackToCall={() => {
            floating.closePip();
            window.focus();
          }}
        />,
        floating.pipWindow.document.body,
      )
    : null;

  const isOutgoingRinging = state.status === 'ringing' && state.direction === 'outgoing';
  const isConnected = state.status === 'connected';

  useOutgoingRingtone(isOutgoingRinging);
  const callDuration = useCallTimer(isConnected);

  const reviewModal = (
    <MeetingNotesReviewModal
      open={reviewOpen}
      onOpenChange={(next) => {
        setReviewOpen(next);
        if (!next) {
          recorder.reset();
          setReviewRecording(null);
        }
      }}
      recording={reviewRecording}
      transcribing={transcribing}
      userId={user?.userId}
      meetingLabel={state.context?.label || 'meeting'}
    />
  );

  // Nothing to render when idle, except a still-open recording review.
  if (state.status === 'idle') {
    return reviewOpen ? reviewModal : null;
  }

  // ── "No answer" / error end screen ─────────────────────────

  if (state.status === 'ended') {
    return (
      <>
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 text-white">
          <div className="flex flex-col items-center gap-3 animate-in fade-in duration-200">
            <p className="text-lg font-semibold">Call ended</p>
            {state.error && (
              <p className="max-w-md px-6 text-center text-sm text-white/70 text-pretty">{state.error}</p>
            )}
            {state.connectFailed && (
              <a
                href="/call-check"
                className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                Run a call check
              </a>
            )}
          </div>
        </div>
        {reviewModal}
      </>
    );
  }

  // ── Incoming ring screen ───────────────────────────────────

  if (state.status === 'ringing' && state.direction === 'incoming') {
    return (
      <IncomingCallModal
        caller={state.remoteParticipant!}
        mediaType={state.mediaType}
        callId={state.callId}
        contextLabel={
          state.context?.type === 'project' ? state.context.label : undefined
        }
        onAccept={(opts) => void actions.acceptCall(opts)}
        onReject={actions.rejectCall}
      />
    );
  }

  // ── Outgoing ring screen ───────────────────────────────────

  if (isOutgoingRinging) {
    const isMultiParty = state.remoteParticipants.length > 1;
    const remoteName = isMultiParty
      ? state.context?.label || 'team'
      : state.remoteParticipant?.displayName || 'Participant';
    return (
      <div
        className="fixed inset-0 z-[250] flex flex-col items-center justify-center bg-black/95 text-white"
        role="dialog"
        aria-label="Outgoing call"
      >
        {admitBanners(false, 'absolute top-4 inset-x-4 mx-auto max-w-md z-10')}
        <div className="flex flex-col items-center gap-5 animate-in fade-in duration-200">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-white/10 animate-ping" />
            {isMultiParty ? (
              <div className="relative flex -space-x-3 items-center">
                {state.remoteParticipants.slice(0, 4).map((p) => (
                  <Avatar
                    key={p.userId}
                    className="h-16 w-16 ring-4 ring-black/95 relative"
                  >
                    <AvatarImage src={p.photoURL} alt={p.displayName} />
                    <AvatarFallback className="text-xl bg-white/10 text-white">
                      {(p.displayName || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {state.remoteParticipants.length > 4 && (
                  <span className="ml-2 inline-flex items-center justify-center h-16 w-16 rounded-full bg-white/10 text-white text-sm font-medium ring-4 ring-black/95">
                    +{state.remoteParticipants.length - 4}
                  </span>
                )}
              </div>
            ) : (
              <Avatar className="h-24 w-24 ring-4 ring-white/20 relative">
                <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
                <AvatarFallback className="text-3xl bg-white/10 text-white">
                  {remoteName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold">{remoteName}</p>
            <p className="text-sm text-white/50 mt-1">
              {isMultiParty
                ? `Ringing ${state.remoteParticipants.length} teammates…`
                : 'Calling…'}{' '}
              {state.mediaType === 'video' ? 'video' : 'audio'} call
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
          {showInviteGuest && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => void handleInviteGuest()}
              disabled={inviting}
              title="Copy a guest link that works for 24 hours"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Invite guest
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Active call (connecting, connected, reconnecting) ──────

  const remoteSnaps = shownPeers.filter((p) => !p.isLocal);
  const localSnap = shownPeers.find((p) => p.isLocal) ?? null;

  // Anyone screen-sharing? If so, give them the main stage and put the
  // others in a side strip — Meet/Teams convention.
  const screenSharer = shownPeers.find((p) => p.isScreenSharing) ?? null;

  const headlineLabel =
    state.context?.label ??
    state.remoteParticipant?.displayName ??
    'Call';

  const statusLabel =
    state.status === 'connecting'
      ? 'Connecting…'
      : state.status === 'reconnecting'
        ? 'Reconnecting…'
        : callDuration;

  // ── PiP mode ───────────────────────────────────────────────

  if (minimized) {
    // Pick a single tile to show in the PiP — prefer screen share, then
    // active speaker, then the first remote, then local.
    const pipSnap =
      screenSharer ??
      remoteSnaps.find((p) => p.isSpeaking) ??
      remoteSnaps[0] ??
      localSnap;
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
        <div className="flex w-full items-center justify-between px-2 py-1 text-muted-foreground/60">
          <GripVertical className="h-3 w-3 rotate-90" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => setMinimized(false)}
            aria-label="Expand call"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {remoteSnaps.map((p) => (
          <RemoteAudioSink key={p.userId} snap={p} />
        ))}
        <div className="relative bg-black" style={{ height: PIP_VIDEO_HEIGHT }}>
          {pipSnap ? (
            <ParticipantTile snap={pipSnap} compact className="h-full w-full" />
          ) : (
            <div className="flex items-center justify-center h-full text-white/60 text-xs">
              Waiting…
            </div>
          )}
          {remoteSnaps.length > 1 && (
            <span className="absolute top-1.5 right-1.5 z-[3] inline-flex items-center justify-center rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
              +{remoteSnaps.length - 1} more
            </span>
          )}
        </div>
        <div className="px-3 py-2 border-t border-border/60 text-xs text-muted-foreground">
          <span className="font-medium text-foreground truncate block">
            {headlineLabel}
          </span>
          <span>{statusLabel}</span>
        </div>
        {admitBanners(true, 'px-1.5 pb-1.5')}
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
            onToggleScreenShare={handleToggleScreenShare}
            onToggleBackgroundEffect={() =>
              void actions.setVideoEffect(
                state.videoEffect === 'blur' ? 'none' : 'blur',
              )
            }
            onHangUp={actions.hangUp}
            compact
          />
        </div>
        {someoneRecording && (
          <div className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-medium text-white shadow">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            Recording
          </div>
        )}
        {reviewModal}
        {floatingPortal}
      </div>
    );
  }

  // ── Full-screen overlay ────────────────────────────────────

  // Build the tile list. For the grid we want every participant including
  // the local user. For the screen-share layout we pull the sharer out and
  // strip the rest along the right edge.
  const allTiles: CallPeerSnapshot[] = shownPeers;
  const otherTiles = screenSharer
    ? shownPeers.filter((p) => p.userId !== screenSharer.userId)
    : [];

  return (
    <div
      className="fixed inset-0 z-[250] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-label="Active call"
    >
      {remoteSnaps.map((p) => (
        <RemoteAudioSink key={p.userId} snap={p} />
      ))}

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-black/60">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{headlineLabel}</p>
            <p className="text-xs text-white/60 truncate">
              {statusLabel}
              {shownPeers.length > 0 &&
                ` · ${shownPeers.length} ${shownPeers.length === 1 ? 'person' : 'people'}`}
              {state.isScreenSharing ? ' · Screen sharing' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
        {showInviteGuest && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => void handleInviteGuest()}
            disabled={inviting}
            aria-label="Invite guest"
            title="Invite guest — copy a link that works for 24 hours"
          >
            <UserPlus className="h-5 w-5" />
          </Button>
        )}
        {floating.support !== 'none' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => void handlePopOut()}
            aria-label="Pop out call"
            title="Pop out — keep the call on top of other windows"
          >
            <PictureInPicture2 className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/10"
          onClick={() => setMinimized(true)}
          aria-label="Minimize call"
        >
          <Minimize2 className="h-5 w-5" />
        </Button>
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 relative flex overflow-hidden p-3 gap-3">
        {allTiles.length === 0 ? (
          // After Accept but before LiveKit's first snapshot arrives — usually
          // <500ms but on flaky networks can stretch longer. Show a clear
          // "connecting" affordance instead of an empty black box.
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/80">
            <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <p className="text-sm">{statusLabel}</p>
          </div>
        ) : screenSharer ? (
          // Screen-share layout: presenter takes the main stage, others
          // line up on the right strip.
          <>
            <ParticipantTile
              snap={screenSharer}
              showSpeakingRing={false}
              className="flex-1 min-w-0 h-full aspect-video sm:aspect-auto"
            />
            {otherTiles.length > 0 && (
              <div className="hidden sm:flex flex-col gap-3 w-44 lg:w-56 max-h-full overflow-y-auto">
                {otherTiles.map((p) => (
                  <ParticipantTile
                    key={p.userId}
                    snap={p}
                    compact
                    className="aspect-video"
                  />
                ))}
              </div>
            )}
          </>
        ) : allTiles.length === 1 ? (
          // Single-tile state — pre-connect or solo (everyone else left).
          <ParticipantTile
            snap={allTiles[0]}
            className="flex-1 h-full aspect-video sm:aspect-auto"
          />
        ) : (
          // Grid for everyone. CSS grid with a count-aware col template.
          <div
            className={cn(
              'grid gap-3 w-full h-full content-center',
              gridColsFor(allTiles.length),
            )}
          >
            {allTiles.map((p) => (
              <ParticipantTile
                key={p.userId}
                snap={p}
                className="aspect-video w-full"
              />
            ))}
          </div>
        )}

        {state.error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg bg-destructive/90 px-4 py-2 text-sm text-white shadow-lg">
            {state.error}
          </div>
        )}

        {admitBanners(
          false,
          'absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(28rem,calc(100%-1.5rem))]',
        )}
      </div>

      {/* Controls */}
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
          onToggleScreenShare={handleToggleScreenShare}
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

      {someoneRecording && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
          <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
          Recording
        </div>
      )}

      {reviewModal}
      {floatingPortal}
    </div>
  );
};
