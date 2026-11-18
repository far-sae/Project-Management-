import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Maximize2,
  Minus,
  PhoneOff,
  PictureInPicture2,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { bestGridLayout } from './gridLayout';
import { GuestAdmitBanners, type GuestDecision } from './GuestAdmitBanners';
import {
  CALL_BAR_BUTTON,
  CALL_BORDER,
  CALL_HAIRLINE,
  CALL_MUTED_TEXT,
  CALL_RECORDING_BADGE,
  CALL_ROUND,
  CALL_ROUND_DANGER,
  CALL_ROUND_IDLE,
  CALL_STAGE,
  CALL_SURFACE,
} from './callTheme';
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

const GRID_GAP = 12;

/**
 * Everyone's video, sized to fit the stage (Meet / Teams style): the
 * biggest 16:9 tiles that fit in both directions, rows centred, an odd
 * tile out centred on the last row. Before the stage is measured (first
 * frame, tests) it falls back to two columns.
 */
const VideoGrid: React.FC<{ tiles: CallPeerSnapshot[] }> = ({ tiles }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout =
    size && size.w > 0 && size.h > 0
      ? bestGridLayout(tiles.length, size.w, size.h, GRID_GAP)
      : null;
  const cols = layout?.cols ?? Math.min(2, tiles.length);
  const rows: CallPeerSnapshot[][] = [];
  for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols));

  return (
    <div
      ref={ref}
      data-testid="call-grid"
      data-cols={cols}
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 self-stretch"
    >
      {rows.map((row, r) => (
        <div key={r} className="flex w-full justify-center gap-3">
          {row.map((p) => (
            <ParticipantTile
              key={p.userId}
              snap={p}
              className={layout ? 'shrink-0' : 'aspect-video min-w-0 flex-1'}
              style={
                layout ? { width: layout.tileWidth, height: layout.tileHeight } : undefined
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
};

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
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 p-4 text-white">
          <div
            className={cn(
              'flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border p-6 text-center animate-in fade-in duration-200 motion-reduce:animate-none',
              CALL_BORDER,
              CALL_STAGE,
            )}
          >
            <p className="text-base font-semibold">Call ended</p>
            {state.error && (
              <p className={cn('text-sm text-pretty', CALL_MUTED_TEXT)}>{state.error}</p>
            )}
            {state.connectFailed && (
              <a href="/call-check" className={cn(CALL_BAR_BUTTON, 'px-3')}>
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
        className={cn('fixed inset-0 z-[250] flex flex-col items-center justify-center p-4', CALL_STAGE)}
        role="dialog"
        aria-label="Outgoing call"
      >
        {admitBanners(false, 'absolute top-4 inset-x-4 mx-auto max-w-md z-10')}
        <div
          className={cn(
            'flex w-full max-w-xs flex-col items-center gap-4 rounded-xl border p-6 animate-in fade-in duration-200 motion-reduce:animate-none',
            CALL_BORDER,
            CALL_SURFACE,
          )}
        >
          {isMultiParty ? (
            <div className="flex items-center -space-x-2">
              {state.remoteParticipants.slice(0, 4).map((p) => (
                <Avatar key={p.userId} className="h-12 w-12 ring-2 ring-[#1c1c1c]">
                  <AvatarImage src={p.photoURL} alt={p.displayName} />
                  <AvatarFallback className="bg-[#3a3a3a] text-lg font-semibold text-white">
                    {(p.displayName || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
              {state.remoteParticipants.length > 4 && (
                <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#3a3a3a] text-sm font-medium text-white ring-2 ring-[#1c1c1c] tabular-nums">
                  +{state.remoteParticipants.length - 4}
                </span>
              )}
            </div>
          ) : (
            <Avatar className="h-16 w-16">
              <AvatarImage src={state.remoteParticipant?.photoURL} alt={remoteName} />
              <AvatarFallback className="bg-[#3a3a3a] text-2xl font-semibold text-white">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="w-full min-w-0 text-center">
            <p className="truncate text-base font-semibold">{remoteName}</p>
            <p className={cn('text-sm', CALL_MUTED_TEXT)}>
              {isMultiParty
                ? `Ringing ${state.remoteParticipants.length} teammates…`
                : 'Calling…'}{' '}
              {state.mediaType === 'video' ? 'video' : 'audio'} call
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {showInviteGuest && (
              <button
                type="button"
                className={cn(CALL_BAR_BUTTON, 'px-3 md:h-10')}
                onClick={() => void handleInviteGuest()}
                disabled={inviting}
                title="Copy a guest link that works for 24 hours"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Invite guest
              </button>
            )}
            <button
              type="button"
              className={cn(CALL_ROUND, CALL_ROUND_DANGER, 'h-10 gap-1.5 px-5 text-sm font-semibold')}
              onClick={actions.hangUp}
              aria-label="Cancel call"
            >
              <PhoneOff className="h-4 w-4" aria-hidden />
              Cancel
            </button>
          </div>
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
          'overflow-hidden rounded-xl border shadow-[0_12px_32px_rgba(0,0,0,0.24)]',
          CALL_HAIRLINE,
          CALL_STAGE,
          'cursor-grab active:cursor-grabbing',
        )}
        role="dialog"
        aria-label="Active call (drag to move)"
      >
        {remoteSnaps.map((p) => (
          <RemoteAudioSink key={p.userId} snap={p} />
        ))}
        <div className={cn('relative', CALL_SURFACE)} style={{ height: PIP_VIDEO_HEIGHT }}>
          {pipSnap ? (
            <ParticipantTile snap={pipSnap} compact className="h-full w-full rounded-none" />
          ) : (
            <div className={cn('flex h-full items-center justify-center text-xs', CALL_MUTED_TEXT)}>
              Waiting…
            </div>
          )}
          {remoteSnaps.length > 1 && (
            <span className="absolute right-2 top-2 z-[3] inline-flex h-5 items-center rounded-md bg-black/70 px-1.5 text-xs font-medium text-white tabular-nums">
              +{remoteSnaps.length - 1} more
            </span>
          )}
          {someoneRecording && (
            <div
              className={cn(
                CALL_RECORDING_BADGE,
                'pointer-events-none absolute left-2 top-2 z-[3] h-5 px-2 text-xs',
              )}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              Recording
            </div>
          )}
        </div>
        {admitBanners(true, 'px-2 pt-2')}
        <div className="flex items-center gap-1.5 py-2 pl-3 pr-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-[18px]">{headlineLabel}</p>
            <p className={cn('truncate text-xs leading-4 tabular-nums', CALL_MUTED_TEXT)}>
              {statusLabel}
            </p>
          </div>
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
          <button
            type="button"
            className={cn(CALL_ROUND, CALL_ROUND_IDLE, 'h-9 w-9')}
            onClick={() => setMinimized(false)}
            aria-label="Expand call"
            title="Expand call"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
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
      className={cn('fixed inset-0 z-[250] flex flex-col', CALL_STAGE)}
      role="dialog"
      aria-label="Active call"
    >
      {remoteSnaps.map((p) => (
        <RemoteAudioSink key={p.userId} snap={p} />
      ))}

      {/* Top bar */}
      <div className="flex min-h-14 flex-wrap items-center gap-2 py-2 pl-4 pr-3">
        <div className="min-w-0 flex-1 basis-[200px]">
          <p className="truncate text-sm font-semibold leading-[18px]">{headlineLabel}</p>
          <p className={cn('truncate text-xs leading-4 tabular-nums', CALL_MUTED_TEXT)}>
            {statusLabel}
            {shownPeers.length > 0 &&
              ` · ${shownPeers.length} ${shownPeers.length === 1 ? 'person' : 'people'}`}
            {state.isScreenSharing ? ' · Screen sharing' : ''}
          </p>
        </div>
        {someoneRecording && (
          <div className={cn(CALL_RECORDING_BADGE, 'h-6 px-2.5 text-xs')}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            Recording
          </div>
        )}
        {showInviteGuest && (
          <button
            type="button"
            className={cn(CALL_BAR_BUTTON, 'px-3')}
            onClick={() => void handleInviteGuest()}
            disabled={inviting}
            aria-label="Invite guest"
            title="Invite guest — copy a link that works for 24 hours"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Invite guest
          </button>
        )}
        {floating.support !== 'none' && (
          <button
            type="button"
            className={cn(CALL_BAR_BUTTON, 'w-10 md:w-8')}
            onClick={() => void handlePopOut()}
            aria-label="Pop out call"
            title="Pop out — keep the call on top of other windows"
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(CALL_BAR_BUTTON, 'w-10 md:w-8')}
          onClick={() => setMinimized(true)}
          aria-label="Minimize call"
          title="Minimize call"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 gap-3 overflow-hidden px-3 pb-3 pt-1">
        {allTiles.length === 0 ? (
          // After Accept but before LiveKit's first snapshot arrives — usually
          // <500ms but on flaky networks can stretch longer. Show a clear
          // "connecting" affordance instead of an empty black box.
          <div className={cn('flex flex-1 flex-col items-center justify-center gap-3', CALL_MUTED_TEXT)}>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3a3a3a] border-t-white" />
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
          <VideoGrid tiles={allTiles} />
        )}

        {state.error && (
          <div className="absolute left-1/2 top-3 z-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground">
            {state.error}
          </div>
        )}

        {admitBanners(
          false,
          'absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(28rem,calc(100%-1.5rem))]',
        )}
      </div>

      {/* Controls */}
      <div className={cn('border-t', CALL_HAIRLINE)}>
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

      {reviewModal}
      {floatingPortal}
    </div>
  );
};
