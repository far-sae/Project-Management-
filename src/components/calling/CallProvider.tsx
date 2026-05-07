import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '@/services/supabase/config';
import { useAuth } from '@/context/AuthContext';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import type { VideoEffect } from '@/services/webrtc/BackgroundProcessor';
import {
  ConnectionState,
  LiveKitCallService,
  type CallPeerSnapshot,
} from '@/services/livekit/LiveKitCallService';
import {
  dmRoomName,
  projectRoomName,
} from '@/services/livekit/fetchLiveKitToken';
import {
  INITIAL_CALL_STATE,
  type CallContext,
  type CallMediaType,
  type CallParticipant,
  type CallState,
  type RingMessage,
  type RingOffer,
} from '@/services/webrtc/types';
import { toast } from 'sonner';

// ── Context types ────────────────────────────────────────────

interface CallActions {
  /**
   * Start an outgoing call. Pass a single participant for a 1:1 (DM) call,
   * or an array for a project-wide "ring all" — every teammate is rung
   * simultaneously and the first to accept joins the same LiveKit room.
   */
  startCall: (
    context: CallContext,
    mediaType: CallMediaType,
    remoteParticipant: CallParticipant | CallParticipant[],
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  /**
   * Background camera effect (Teams-style blur). Currently a no-op while we
   * wire LiveKit track processors — kept on the action surface so UI
   * doesn't have to branch.
   */
  setVideoEffect: (effect: VideoEffect) => Promise<void>;
}

interface CallContextValue {
  state: CallState;
  actions: CallActions;
}

const CallCtx = createContext<CallContextValue | null>(null);

// ── Constants ────────────────────────────────────────────────

const RING_TIMEOUT_MS = 30_000;
const OFFER_RESEND_INTERVAL_MS = 3_000;
const ENDED_DISMISS_MS = 3_000;

const generateCallId = () =>
  `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const IDLE_STATE: CallState = INITIAL_CALL_STATE;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Pick the local snapshot out of a LiveKit participants list. Returns null
 * before we've connected to the room (snapshot hasn't been emitted yet).
 */
function findLocalSnapshot(snaps: CallPeerSnapshot[]): CallPeerSnapshot | null {
  for (const s of snaps) if (s.isLocal) return s;
  return null;
}

/**
 * Pick a "primary" remote snapshot for the headline tile. For 1:1 (DM)
 * calls there's only one. For multi-party, pick the active speaker if
 * any, else the first remote — gives us something stable to show in the
 * minimised PiP without forcing the full grid into that surface.
 */
function findHeadlineRemote(snaps: CallPeerSnapshot[]): CallPeerSnapshot | null {
  const remotes = snaps.filter((s) => !s.isLocal);
  if (remotes.length === 0) return null;
  const speaking = remotes.find((s) => s.isSpeaking);
  return speaking ?? remotes[0];
}

// ── Provider ─────────────────────────────────────────────────

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [state, setState] = useState<CallState>(IDLE_STATE);
  const latestCallStateRef = useRef(state);
  latestCallStateRef.current = state;

  /**
   * Active LiveKit room wrapper. Created when we initiate or accept a call,
   * destroyed on hang-up / failure / disconnect. We ref it (not state) so
   * callbacks always see the live instance even mid-render.
   */
  const liveKitRef = useRef<LiveKitCallService | null>(null);

  /**
   * Most recent RingOffer received in our inbox while ringing — needed by
   * acceptCall so we can join the same room the caller put us in.
   */
  const pendingRingRef = useRef<RingOffer | null>(null);

  /**
   * The teammates we're ringing on an outgoing call. Used to fan out the
   * RingOffer + send RingCancel to the rest once someone accepts.
   */
  const remoteParticipantsRef = useRef<CallParticipant[]>([]);

  // Timers
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerResendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Active inbox channels we're broadcasting RingOffers on (one per dialed teammate). */
  const inboxChannelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);
  /** Clears delayed transition from "ended" → idle so it cannot race a new call. */
  const endStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const localParticipant: CallParticipant | null = user
    ? {
        userId: user.userId,
        displayName: user.displayName || user.email || 'User',
        photoURL: user.photoURL,
      }
    : null;

  // ── Cleanup helpers ────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (endStateTimeoutRef.current) {
      clearTimeout(endStateTimeoutRef.current);
      endStateTimeoutRef.current = null;
    }
    if (offerResendRef.current) {
      clearInterval(offerResendRef.current);
      offerResendRef.current = null;
    }
    if (inboxChannelsRef.current.length > 0) {
      for (const ch of inboxChannelsRef.current) {
        void supabase.removeChannel(ch);
      }
      inboxChannelsRef.current = [];
    }
  }, []);

  const teardownLiveKit = useCallback(async () => {
    const lk = liveKitRef.current;
    liveKitRef.current = null;
    if (lk) {
      await lk.disconnect().catch(() => undefined);
    }
  }, []);

  const resetCall = useCallback(() => {
    clearTimers();
    void teardownLiveKit();
    pendingRingRef.current = null;
    remoteParticipantsRef.current = [];
    setState(IDLE_STATE);
  }, [clearTimers, teardownLiveKit]);

  /**
   * Send a one-shot RingMessage to a specific user's inbox channel. We open
   * a fresh channel per send because the inbox listener on the receiver's
   * side is on a different channel — broadcasting on a shared channel would
   * also self-broadcast, and we'd see our own ring.
   */
  const sendInboxMessage = useCallback(
    (targetUserId: string, msg: RingMessage) => {
      const ch = supabase.channel(`call-inbox:${targetUserId}`, {
        config: { broadcast: { self: false } },
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'signal',
            payload: msg,
          });
          // Tear down after a short delay so the broadcast lands. The Realtime
          // server is fire-and-forget, but giving it a moment matches the
          // pattern already used elsewhere in this provider.
          setTimeout(() => {
            void supabase.removeChannel(ch);
          }, 1500);
        }
      });
    },
    [],
  );

  // ── Global incoming-call listener ──────────────────────────

  useEffect(() => {
    if (!user?.userId) return;

    const inboxChannel = supabase.channel(`call-inbox:${user.userId}`, {
      config: { broadcast: { self: false } },
    });

    inboxChannel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const msg = payload as RingMessage;
        if (msg.type === 'ring') {
          setState((prev) => {
            if (prev.status !== 'idle') return prev;
            pendingRingRef.current = msg;
            return {
              ...IDLE_STATE,
              status: 'ringing',
              direction: 'incoming',
              callId: msg.callId,
              roomName: msg.roomName,
              mediaType: msg.mediaType,
              remoteParticipant: msg.from,
              context: msg.context,
              localParticipant,
            };
          });
          return;
        }
        if (msg.type === 'ring-cancel') {
          // Either the caller bailed or someone else in the ring-all
          // already picked up. Drop our incoming ring if it matches.
          setState((prev) => {
            if (
              prev.status === 'ringing' &&
              prev.direction === 'incoming' &&
              prev.callId === msg.callId
            ) {
              pendingRingRef.current = null;
              return IDLE_STATE;
            }
            return prev;
          });
          return;
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(inboxChannel);
    };
  }, [user?.userId, localParticipant?.userId]);

  // ── 30-second incoming ring timeout ────────────────────────

  useEffect(() => {
    if (state.status === 'ringing' && state.direction === 'incoming') {
      const callId = state.callId;
      ringTimeoutRef.current = setTimeout(() => {
        // If the user still hasn't picked up, treat it as "missed".
        const stillIncoming =
          latestCallStateRef.current.callId === callId &&
          latestCallStateRef.current.status === 'ringing' &&
          latestCallStateRef.current.direction === 'incoming';
        if (!stillIncoming) return;
        resetCall();
      }, RING_TIMEOUT_MS);

      return () => {
        if (ringTimeoutRef.current) {
          clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
        }
      };
    }
  }, [state.status, state.direction, state.callId, resetCall]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(
    () => () => {
      clearTimers();
      void teardownLiveKit();
    },
    [clearTimers, teardownLiveKit],
  );

  // ── LiveKit event wiring ───────────────────────────────────

  /**
   * Build a fresh LiveKitCallService bound to our state-update handlers.
   * The same instance handles both outgoing (caller) and accepted incoming
   * (callee) calls — the only difference is who connected first.
   */
  const buildLiveKit = useCallback((): LiveKitCallService => {
    return new LiveKitCallService({
      onParticipantsChange: (peers) => {
        setState((prev) => {
          if (prev.status === 'idle' || prev.status === 'ended') return prev;
          const localSnap = findLocalSnapshot(peers);
          const remotes = peers.filter((p) => !p.isLocal);
          // First remote arrival flips us from 'connecting' to 'connected'.
          // After that we just refresh the participants list.
          let status = prev.status;
          if (
            (prev.status === 'ringing' || prev.status === 'connecting') &&
            remotes.length > 0
          ) {
            status = 'connected';
          }
          // Pick the headline remote for the ring/PiP UI. For multi-party
          // we promote whichever remote is "primary" (active speaker or
          // first joiner) over the project placeholder we showed while
          // ringing — gives the user a real face/name asap.
          const headline = findHeadlineRemote(peers);
          const remoteParticipantUpdate: CallParticipant | null = headline
            ? {
                userId: headline.userId,
                displayName: headline.displayName,
                photoURL: undefined,
              }
            : prev.remoteParticipant;
          return {
            ...prev,
            status,
            participants: peers,
            isMuted: localSnap ? localSnap.isMicMuted : prev.isMuted,
            isCameraOff: localSnap ? localSnap.isCameraOff : prev.isCameraOff,
            isScreenSharing: localSnap
              ? localSnap.isScreenSharing
              : prev.isScreenSharing,
            remoteParticipant: remoteParticipantUpdate,
          };
        });

        // First time we see someone else in the room on an outgoing
        // multi-party call, broadcast cancel to every other dialed
        // teammate so they stop ringing.
        const remotes = peers.filter((p) => !p.isLocal);
        const dialed = remoteParticipantsRef.current;
        if (
          remotes.length === 1 &&
          dialed.length > 1 &&
          localParticipant &&
          latestCallStateRef.current.direction === 'outgoing'
        ) {
          const answererId = remotes[0].userId;
          const callId = latestCallStateRef.current.callId;
          if (!callId) return;
          for (const p of dialed) {
            if (p.userId === answererId) continue;
            sendInboxMessage(p.userId, {
              type: 'ring-cancel',
              callId,
              from: localParticipant,
              reason: 'taken',
            });
          }
          // First connection — clean up the resend timers + inbox channels
          // (cancel was already broadcast). The room is live now.
          if (offerResendRef.current) {
            clearInterval(offerResendRef.current);
            offerResendRef.current = null;
          }
          if (inboxChannelsRef.current.length > 0) {
            for (const ch of inboxChannelsRef.current) {
              void supabase.removeChannel(ch);
            }
            inboxChannelsRef.current = [];
          }
          if (ringTimeoutRef.current) {
            clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
          }
        }
      },
      onConnectionStateChange: (cs) => {
        setState((prev) => {
          if (prev.status === 'idle' || prev.status === 'ended') return prev;
          if (cs === ConnectionState.Reconnecting) {
            return { ...prev, status: 'reconnecting' };
          }
          if (cs === ConnectionState.Connected && prev.status === 'reconnecting') {
            return { ...prev, status: 'connected', error: null };
          }
          return prev;
        });
      },
      onDisconnected: () => {
        // Server- or peer-initiated disconnect: tear down to idle. We don't
        // show "ended" here because in practice that's almost always a hang
        // up triggered by the local user — and they already see the UI go
        // away. If it was unexpected, the next call will surface an error.
        resetCall();
      },
      onError: (msg) => {
        // Surface non-fatal errors as toasts so the call keeps running.
        toast.error(msg);
      },
    });
  }, [localParticipant, sendInboxMessage, resetCall]);

  // ── Actions ────────────────────────────────────────────────

  const startCall = useCallback(
    async (
      context: CallContext,
      mediaType: CallMediaType,
      remoteParticipant: CallParticipant | CallParticipant[],
    ) => {
      if (!localParticipant || !isMediaSupported()) return;
      if (state.status !== 'idle') return;

      // Normalise to a deduped list of valid teammates (drop self + dupes).
      const requested = Array.isArray(remoteParticipant)
        ? remoteParticipant
        : [remoteParticipant];
      const dedupedTargets: CallParticipant[] = [];
      const seen = new Set<string>();
      for (const p of requested) {
        if (!p?.userId || seen.has(p.userId)) continue;
        if (p.userId === localParticipant.userId) continue;
        seen.add(p.userId);
        dedupedTargets.push(p);
      }
      if (dedupedTargets.length === 0) return;
      const isMultiParty = dedupedTargets.length > 1;
      const ringingHeadline: CallParticipant = isMultiParty
        ? {
            userId: context.targetId,
            displayName: context.label,
          }
        : dedupedTargets[0];

      clearTimers();

      const callId = generateCallId();
      remoteParticipantsRef.current = dedupedTargets;

      // Pick the canonical room name. Project calls reuse one room per
      // project so a late joiner could in principle hop in (we don't
      // surface that yet, but the room is reusable). DM calls use a
      // sorted-pair name so both sides converge on the same room.
      const roomName =
        context.type === 'project'
          ? projectRoomName(context.targetId)
          : dmRoomName(localParticipant.userId, dedupedTargets[0].userId);

      // Outgoing ring screen — local mic/cam haven't been published yet,
      // we publish only when actually connecting to the room below.
      setState({
        ...IDLE_STATE,
        status: 'ringing',
        callId,
        direction: 'outgoing',
        mediaType,
        roomName,
        localParticipant,
        remoteParticipant: ringingHeadline,
        remoteParticipants: dedupedTargets,
        context,
      });

      // Connect to the LiveKit room straight away — this is what actually
      // requests mic/camera permissions and makes the local user a
      // publisher in the room. Once a callee accepts, they'll join the
      // same room and our snapshot listener picks them up.
      const lk = buildLiveKit();
      liveKitRef.current = lk;
      try {
        await lk.connect({
          roomName,
          mediaType,
          participantName: localParticipant.displayName,
        });
      } catch (err) {
        clearTimers();
        await teardownLiveKit();
        setState((prev) => ({
          ...prev,
          status: 'ended',
          error:
            err instanceof Error
              ? err.message
              : 'Could not connect to the call server',
        }));
        endStateTimeoutRef.current = setTimeout(() => {
          endStateTimeoutRef.current = null;
          setState((s) => (s.status === 'ended' ? IDLE_STATE : s));
        }, ENDED_DISMISS_MS);
        return;
      }

      // Caller is in the room solo. Now ring every dialed teammate via
      // their personal inbox so they see the incoming-call modal.
      const offerPayload: RingOffer = {
        type: 'ring',
        callId,
        roomName,
        mediaType,
        context,
        from: localParticipant,
        isMultiParty,
      };

      const sendOfferToAllInboxes = () => {
        for (const target of dedupedTargets) {
          const ch = supabase.channel(`call-inbox:${target.userId}`, {
            config: { broadcast: { self: false } },
          });
          inboxChannelsRef.current.push(ch);
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              ch.send({
                type: 'broadcast',
                event: 'signal',
                payload: offerPayload,
              });
            }
          });
        }
      };

      sendOfferToAllInboxes();

      // Resend every 3s in case the first broadcast was missed before the
      // callee subscribed. Stops once someone joins or we time out.
      offerResendRef.current = setInterval(() => {
        const currentStatus = latestCallStateRef.current.status;
        // Once we move past 'ringing', or LiveKit is gone, stop ringing.
        if (!liveKitRef.current || currentStatus !== 'ringing') {
          if (offerResendRef.current) {
            clearInterval(offerResendRef.current);
            offerResendRef.current = null;
          }
          if (inboxChannelsRef.current.length > 0) {
            for (const ch of inboxChannelsRef.current) {
              void supabase.removeChannel(ch);
            }
            inboxChannelsRef.current = [];
          }
          return;
        }
        // Tear down the previous round and broadcast again.
        if (inboxChannelsRef.current.length > 0) {
          for (const ch of inboxChannelsRef.current) {
            void supabase.removeChannel(ch);
          }
          inboxChannelsRef.current = [];
        }
        sendOfferToAllInboxes();
      }, OFFER_RESEND_INTERVAL_MS);

      // 30s ring timeout — auto-cancel + show "didn't answer".
      ringTimeoutRef.current = setTimeout(() => {
        // If anyone has already joined, don't tear down.
        if (latestCallStateRef.current.status !== 'ringing') return;
        clearTimers();
        // Tell anyone whose inbox is still receiving the resend that we're
        // giving up so their ring stops cleanly.
        for (const t of dedupedTargets) {
          sendInboxMessage(t.userId, {
            type: 'ring-cancel',
            callId,
            from: localParticipant,
            reason: 'cancelled',
          });
        }
        void teardownLiveKit();
        const noAnswerError = isMultiParty
          ? `No one in ${context.label} answered`
          : `${dedupedTargets[0].displayName} didn't answer`;
        setState({
          ...IDLE_STATE,
          status: 'ended',
          error: noAnswerError,
        });
        if (endStateTimeoutRef.current) {
          clearTimeout(endStateTimeoutRef.current);
          endStateTimeoutRef.current = null;
        }
        endStateTimeoutRef.current = setTimeout(() => {
          endStateTimeoutRef.current = null;
          setState((prev) => (prev.status === 'ended' ? IDLE_STATE : prev));
        }, ENDED_DISMISS_MS);
      }, RING_TIMEOUT_MS);
    },
    [
      localParticipant,
      state.status,
      buildLiveKit,
      clearTimers,
      teardownLiveKit,
      sendInboxMessage,
    ],
  );

  const acceptCall = useCallback(async () => {
    const ring = pendingRingRef.current;
    if (!ring || !localParticipant) return;
    if (state.status !== 'ringing' || state.direction !== 'incoming') return;

    clearTimers();
    setState((prev) => ({ ...prev, status: 'connecting' }));

    const lk = buildLiveKit();
    liveKitRef.current = lk;
    try {
      await lk.connect({
        roomName: ring.roomName,
        mediaType: ring.mediaType,
        participantName: localParticipant.displayName,
      });
      pendingRingRef.current = null;
    } catch (err) {
      await teardownLiveKit();
      setState((prev) => ({
        ...prev,
        status: 'ended',
        error:
          err instanceof Error
            ? err.message
            : 'Could not connect to the call server',
      }));
      endStateTimeoutRef.current = setTimeout(() => {
        endStateTimeoutRef.current = null;
        setState((s) => (s.status === 'ended' ? IDLE_STATE : s));
      }, ENDED_DISMISS_MS);
    }
  }, [
    state.status,
    state.direction,
    localParticipant,
    buildLiveKit,
    clearTimers,
    teardownLiveKit,
  ]);

  const rejectCall = useCallback(() => {
    const ring = pendingRingRef.current;
    // Multi-party: don't broadcast a cancel — the caller is dialing other
    // teammates simultaneously and our reject must not yank their ring.
    // Just transition ourselves to idle and let the call continue.
    if (ring?.isMultiParty) {
      resetCall();
      return;
    }
    // 1:1 (DM): tell the caller's inbox we're declining so they get
    // immediate feedback instead of waiting for the 30s timeout.
    if (ring && localParticipant && state.callId) {
      sendInboxMessage(ring.from.userId, {
        type: 'ring-cancel',
        callId: state.callId,
        from: localParticipant,
        reason: 'cancelled',
      });
    }
    resetCall();
  }, [state.callId, localParticipant, resetCall, sendInboxMessage]);

  const hangUp = useCallback(() => {
    // If we're still ringing, broadcast cancel to everyone we dialed so
    // their phones stop ringing rather than ringing out for 30s.
    const status = latestCallStateRef.current.status;
    const callId = latestCallStateRef.current.callId;
    if (
      status === 'ringing' &&
      latestCallStateRef.current.direction === 'outgoing' &&
      callId &&
      localParticipant
    ) {
      for (const t of remoteParticipantsRef.current) {
        sendInboxMessage(t.userId, {
          type: 'ring-cancel',
          callId,
          from: localParticipant,
          reason: 'cancelled',
        });
      }
    }
    resetCall();
  }, [localParticipant, resetCall, sendInboxMessage]);

  const toggleMute = useCallback(() => {
    const next = !state.isMuted;
    void liveKitRef.current?.setMicMuted(next);
    setState((prev) => ({ ...prev, isMuted: next }));
  }, [state.isMuted]);

  const toggleCamera = useCallback(() => {
    const next = !state.isCameraOff;
    void liveKitRef.current?.setCameraOff(next);
    setState((prev) => ({ ...prev, isCameraOff: next }));
  }, [state.isCameraOff]);

  const toggleScreenShare = useCallback(async () => {
    const lk = liveKitRef.current;
    if (!lk) return;
    await lk.toggleScreenShare();
  }, []);

  const setVideoEffect = useCallback(async (_effect: VideoEffect) => {
    // Background blur is queued behind the LiveKit migration — re-enabling
    // it requires wiring a TrackProcessor onto the local camera publication.
    // For now toast so the action surface stays consistent and CallControls
    // doesn't have to branch on capability.
    setState((prev) => ({ ...prev, videoEffect: 'none', isApplyingEffect: false }));
    toast.message('Background blur is rolling out — coming back soon.');
  }, []);

  const actions: CallActions = {
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    setVideoEffect,
  };

  return (
    <CallCtx.Provider value={{ state, actions }}>{children}</CallCtx.Provider>
  );
};

export function useCallContext(): CallContextValue {
  const ctx = useContext(CallCtx);
  if (!ctx)
    throw new Error('useCallContext must be used within a CallProvider');
  return ctx;
}
