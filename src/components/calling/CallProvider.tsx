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
import { SignalingChannel } from '@/services/webrtc/SignalingChannel';
import { WebRTCService } from '@/services/webrtc/WebRTCService';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import type { VideoEffect } from '@/services/webrtc/BackgroundProcessor';
import type {
  CallContext,
  CallMediaType,
  CallParticipant,
  CallState,
  SignalMessage,
  SignalOffer,
} from '@/services/webrtc/types';

// ── Context types ────────────────────────────────────────────

interface CallActions {
  /**
   * Start an outgoing call. Pass a single participant for a 1:1 (DM) call, or
   * an array of participants for a project-wide "ring all" call — every
   * teammate is rung simultaneously and the first to accept is connected.
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
   * Apply (or remove) a Microsoft Teams-style background effect to the local
   * camera. The processed track replaces the raw camera track in the active
   * peer connection so the remote side sees the effect.
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

const generateCallId = () =>
  `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const IDLE_STATE: CallState = {
  status: 'idle',
  callId: null,
  direction: null,
  mediaType: 'audio',
  localStream: null,
  remoteStream: null,
  screenStream: null,
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  videoEffect: 'none',
  isApplyingEffect: false,
  localParticipant: null,
  remoteParticipant: null,
  remoteParticipants: [],
  context: null,
  error: null,
};

// ── Provider ─────────────────────────────────────────────────

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [state, setState] = useState<CallState>(IDLE_STATE);
  const latestCallStateRef = useRef(state);
  latestCallStateRef.current = state;

  const rtcRef = useRef<WebRTCService | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const pendingOfferRef = useRef<SignalOffer | null>(null);
  /**
   * Every teammate the local user dialed on this call (caller-side state).
   * Used to (a) fan out the offer to all of them while ringing and (b) send
   * a `cancel` to the rest once one of them answers, so their rings stop
   * instead of timing out 30 s later.
   */
  const remoteParticipantsRef = useRef<CallParticipant[]>([]);

  // Timers
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerResendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Active inbox channels we're currently broadcasting offers on. For DM
   * calls there's exactly one; for "ring all" project calls there's one per
   * teammate. We tear them all down together when the call moves past
   * ringing or hangs up.
   */
  const inboxChannelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);
  /** Clears delayed transition from "ended" → idle so it cannot race with a new call. */
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

  const resetCall = useCallback(() => {
    clearTimers();
    rtcRef.current?.destroy();
    rtcRef.current = null;
    // Tear down signaling explicitly: WebRTCService.destroy already calls
    // signaling.destroy on its own SignalingChannel, but signalingRef may
    // hold a channel even when rtcRef is null (e.g. before WebRTCService
    // construction or after rtcRef was cleared elsewhere).
    signalingRef.current?.destroy();
    signalingRef.current = null;
    pendingOfferRef.current = null;
    remoteParticipantsRef.current = [];
    setState(IDLE_STATE);
  }, [clearTimers]);

  // ── Global incoming-call listener ──────────────────────────

  useEffect(() => {
    if (!user?.userId) return;

    const inboxChannel = supabase.channel(`call-inbox:${user.userId}`, {
      config: { broadcast: { self: false } },
    });

    inboxChannel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const msg = payload as SignalMessage;
        if (msg.type === 'offer') {
          setState((prev) => {
            if (prev.status !== 'idle') return prev;
            pendingOfferRef.current = msg as SignalOffer;
            return {
              ...IDLE_STATE,
              status: 'ringing',
              direction: 'incoming',
              callId: msg.callId,
              mediaType: (msg as SignalOffer).mediaType,
              remoteParticipant: (msg as SignalOffer).from,
              context: (msg as SignalOffer).context,
              localParticipant: localParticipant,
            };
          });
          return;
        }
        if (msg.type === 'cancel') {
          // Caller already connected with someone else (project "ring all"),
          // or cancelled before anyone picked up. Drop our incoming ring if
          // it matches this callId — otherwise we'd keep ringing for 30s.
          setState((prev) => {
            if (
              prev.status === 'ringing' &&
              prev.direction === 'incoming' &&
              prev.callId === msg.callId
            ) {
              pendingOfferRef.current = null;
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

  // ── 30-second ring timeout (incoming) ──────────────────────

  useEffect(() => {
    if (state.status === 'ringing' && state.direction === 'incoming') {
      const callId = state.callId;
      const participant = localParticipant;
      ringTimeoutRef.current = setTimeout(() => {
        void (async () => {
          const stillIncomingRingForThisCall = () => {
            const s = latestCallStateRef.current;
            return (
              s.callId === callId &&
              s.status === 'ringing' &&
              s.direction === 'incoming'
            );
          };

          let created: SignalingChannel | null = null;
          try {
            if (!callId || !participant) return;
            if (!stillIncomingRingForThisCall()) return;

            created = new SignalingChannel(
              `call:${callId}`,
              participant.userId,
            );
            await created.subscribe();
            if (!stillIncomingRingForThisCall()) {
              created.destroy();
              created = null;
              return;
            }
            created.send({
              type: 'reject',
              callId,
              from: participant,
            });
            const chForDelayedDestroy = created;
            created = null;
            setTimeout(() => chForDelayedDestroy.destroy(), 1000);
          } catch {
            if (created) {
              created.destroy();
              created = null;
            }
          } finally {
            if (stillIncomingRingForThisCall()) {
              resetCall();
            } else if (created) {
              created.destroy();
            }
          }
        })();
      }, RING_TIMEOUT_MS);

      return () => {
        if (ringTimeoutRef.current) {
          clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
        }
      };
    }
    // localParticipant itself is a fresh object every render; depend on its
    // stable userId so the effect doesn't reschedule the timeout on every
    // re-render. The closure still reads the up-to-date object from outer scope.
  }, [state.status, state.direction, state.callId, localParticipant?.userId, resetCall]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(
    () => () => {
      clearTimers();
      rtcRef.current?.destroy();
    },
    [clearTimers],
  );

  // ── RTC event wiring ───────────────────────────────────────

  const setupRTCEvents = useCallback((rtc: WebRTCService) => {
    rtc.onEvent((type, payload) => {
      switch (type) {
        case 'answered': {
          // The peer has explicitly accepted the call (caller received answer
          // or callee just sent theirs). Cancel the "didn't answer" / offer
          // resend timers immediately, even if ICE hasn't finished, so a slow
          // network can't tear down a real, accepted call after 30 s.
          if (ringTimeoutRef.current) {
            clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
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
          // For "ring all" project calls the WebRTCService payload is the
          // CallParticipant who actually picked up. Promote them into the
          // visible remoteParticipant slot so the call UI shows the right
          // name, and tell every OTHER teammate's inbox to stop ringing —
          // otherwise their phone keeps ringing until the 30s timeout.
          const answerer = payload as CallParticipant | undefined;
          const dialed = remoteParticipantsRef.current;
          if (answerer && dialed.length > 1 && localParticipant) {
            const callIdAtAnswer = latestCallStateRef.current.callId;
            const others = dialed.filter((p) => p.userId !== answerer.userId);
            for (const p of others) {
              const ch = supabase.channel(`call-inbox:${p.userId}`, {
                config: { broadcast: { self: false } },
              });
              ch.subscribe((status) => {
                if (status === 'SUBSCRIBED' && callIdAtAnswer) {
                  ch.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: {
                      type: 'cancel',
                      callId: callIdAtAnswer,
                      from: localParticipant,
                    },
                  });
                  setTimeout(() => {
                    void supabase.removeChannel(ch);
                  }, 1500);
                }
              });
            }
          }
          setState((prev) =>
            prev.status === 'ringing'
              ? {
                  ...prev,
                  status: 'connecting',
                  remoteParticipant: answerer ?? prev.remoteParticipant,
                }
              : prev,
          );
          break;
        }
        case 'remote-stream':
          // The call has actually connected — cancel any pending "didn't
          // answer" / offer-resend timers so they don't tear down the call
          // 30 s after start even though the other side already picked up.
          if (ringTimeoutRef.current) {
            clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
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
          setState((prev) => ({
            ...prev,
            status: 'connected',
            remoteStream: payload as MediaStream,
          }));
          break;
        case 'connection-state':
          if (payload === 'connected') {
            // Same defensive cleanup: once the peer connection is up, kill
            // any ringing-phase timers that could otherwise still fire.
            if (ringTimeoutRef.current) {
              clearTimeout(ringTimeoutRef.current);
              ringTimeoutRef.current = null;
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
            // Connection recovered — clear stale "reconnecting" state and any
            // transient error banner from a previous blip.
            setState((prev) => ({ ...prev, status: 'connected', error: null }));
          } else if (payload === 'disconnected' || payload === 'failed') {
            // WebRTCService now auto-attempts ICE restart in the background.
            // Show "Reconnecting…" instead of tearing down the call so brief
            // network hiccups (e.g. Snipping Tool overlay) don't end it.
            setState((prev) => ({ ...prev, status: 'reconnecting' }));
          }
          break;
        case 'hangup':
        case 'reject':
          clearTimers();
          rtcRef.current = null;
          signalingRef.current = null;
          setState(IDLE_STATE);
          break;
        case 'error':
          setState((prev) => ({
            ...prev,
            error: String(payload || 'Connection error'),
          }));
          break;
      }
    });
  }, [clearTimers]);

  // ── Actions ────────────────────────────────────────────────

  const startCall = useCallback(
    async (
      context: CallContext,
      mediaType: CallMediaType,
      remoteParticipant: CallParticipant | CallParticipant[],
    ) => {
      if (!localParticipant || !isMediaSupported()) return;
      if (state.status !== 'idle') return;

      // Normalise to a list so DM (single recipient) and project "ring all"
      // (many recipients) share one path. De-dupe by userId in case the
      // caller passed the same teammate twice — we'd otherwise open two
      // inbox channels and double-ring them.
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
      // Until someone picks up we don't know who is on the other end. Show
      // the project label (or the first dialed teammate for DM) in the
      // ringing UI. Once we receive an SDP answer, this is replaced by the
      // actual answerer.
      const ringingHeadline: CallParticipant = isMultiParty
        ? {
            userId: context.targetId,
            displayName: context.label,
          }
        : dedupedTargets[0];

      clearTimers();

      const callId = generateCallId();
      remoteParticipantsRef.current = dedupedTargets;

      // Set up the call signaling channel (both caller and callee join this)
      const signaling = new SignalingChannel(
        `call:${callId}`,
        localParticipant.userId,
      );
      signalingRef.current = signaling;

      const rtc = new WebRTCService(
        callId,
        localParticipant,
        signaling,
      );
      rtcRef.current = rtc;
      setupRTCEvents(rtc);

      // Show ringing state for outgoing call (not "connecting" — that comes after accept)
      setState({
        ...IDLE_STATE,
        status: 'ringing',
        callId,
        direction: 'outgoing',
        mediaType,
        localParticipant,
        remoteParticipant: ringingHeadline,
        remoteParticipants: dedupedTargets,
        context,
      });

      try {
        const localStream = await rtc.createOffer(mediaType, context);
        setState((prev) => ({ ...prev, localStream }));

        const localDesc = rtc.localDescription;
        if (!localDesc) {
          throw new Error('Missing local SDP after createOffer');
        }

        const offerPayload: SignalOffer = {
          type: 'offer',
          sdp: localDesc,
          callId,
          from: localParticipant,
          mediaType,
          context,
          isMultiParty,
        };

        // Fan out: open one inbox channel per dialed teammate and broadcast
        // the same SignalOffer on each. Resend every 3s in case the first
        // broadcast was missed before the callee subscribed. Callees ignore
        // duplicate offers if already ringing.
        const sendOfferToAllInboxes = () => {
          for (const target of dedupedTargets) {
            const ch = supabase.channel(
              `call-inbox:${target.userId}`,
              { config: { broadcast: { self: false } } },
            );
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

        // Resend every 3s in case the first broadcast was missed
        offerResendRef.current = setInterval(() => {
          // Stop resending once the RTC service is gone OR the call has
          // moved past ringing (e.g. callee answered → connecting/connected,
          // or the call ended/was rejected). Otherwise we'd keep paging an
          // already-accepted call.
          const currentStatus = latestCallStateRef.current.status;
          if (rtcRef.current?.destroyed || currentStatus !== 'ringing') {
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
          // Clean up old channels and resend
          if (inboxChannelsRef.current.length > 0) {
            for (const ch of inboxChannelsRef.current) {
              void supabase.removeChannel(ch);
            }
            inboxChannelsRef.current = [];
          }
          sendOfferToAllInboxes();
        }, OFFER_RESEND_INTERVAL_MS);

        // Also listen on the call channel for the callee's answer/reject
        // (the signaling channel is already subscribed by WebRTCService)

        // 30-second outgoing ring timeout — auto-cancel if no answer
        ringTimeoutRef.current = setTimeout(() => {
          clearTimers();
          rtcRef.current?.hangUp();
          rtcRef.current = null;
          signalingRef.current = null;
          // "No one in <project> answered" reads better than naming whichever
          // teammate happens to be first in the dialed list.
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
            setState((prev) =>
              prev.status === 'ended' ? IDLE_STATE : prev,
            );
          }, 3000);
        }, RING_TIMEOUT_MS);
      } catch (err) {
        clearTimers();
        setState((prev) => ({
          ...prev,
          status: 'ended',
          error:
            err instanceof Error
              ? err.message
              : 'Could not access camera/microphone',
        }));
      }
    },
    [localParticipant, state.status, setupRTCEvents, clearTimers],
  );

  const acceptCall = useCallback(async () => {
    if (!localParticipant) return;
    const offer = pendingOfferRef.current;
    if (!offer || !state.callId) return;

    clearTimers();

    const signaling = new SignalingChannel(
      `call:${state.callId}`,
      localParticipant.userId,
    );
    signalingRef.current = signaling;

    const rtc = new WebRTCService(
      state.callId,
      localParticipant,
      signaling,
    );
    rtcRef.current = rtc;
    setupRTCEvents(rtc);

    setState((prev) => ({ ...prev, status: 'connecting' }));

    try {
      const localStream = await rtc.answerOffer(
        offer.sdp,
        offer.mediaType,
        offer.context,
      );
      setState((prev) => ({ ...prev, localStream }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'ended',
        error:
          err instanceof Error
            ? err.message
            : 'Could not access camera/microphone',
      }));
    }
    pendingOfferRef.current = null;
  }, [localParticipant, state.callId, setupRTCEvents, clearTimers]);

  const rejectCall = useCallback(() => {
    // For project "ring all" calls (`isMultiParty` on the pending offer), the
    // caller has dialed several teammates simultaneously and only needs ONE
    // of us to pick up. If we broadcast a reject on the call channel here, the
    // caller's WebRTCService would treat it as the call ending — yanking the
    // ring away from everyone else who's still deciding. So we just transition
    // ourselves to idle and let the call continue ringing for our peers.
    const pending = pendingOfferRef.current;
    if (pending?.isMultiParty) {
      resetCall();
      return;
    }
    if (rtcRef.current) {
      rtcRef.current.reject();
      resetCall();
      return;
    }
    if (state.callId && localParticipant) {
      const callId = state.callId;
      const sig = new SignalingChannel(
        `call:${callId}`,
        localParticipant.userId,
      );
      void (async () => {
        try {
          await sig.subscribe();
          sig.send({
            type: 'reject',
            callId,
            from: localParticipant,
          });
        } catch {
          /* ignore */
        } finally {
          setTimeout(() => sig.destroy(), 1000);
          resetCall();
        }
      })();
      return;
    }
    resetCall();
  }, [state.callId, localParticipant, resetCall]);

  const hangUp = useCallback(() => {
    clearTimers();
    rtcRef.current?.hangUp();
    rtcRef.current = null;
    // Mirror resetCall: explicitly tear down signaling so the channel
    // can't leak when rtcRef.current was already null (no WebRTCService
    // to call signaling.destroy() through its own destroy()).
    signalingRef.current?.destroy();
    signalingRef.current = null;
    pendingOfferRef.current = null;
    remoteParticipantsRef.current = [];
    setState(IDLE_STATE);
  }, [clearTimers]);

  const toggleMute = useCallback(() => {
    const next = !state.isMuted;
    rtcRef.current?.toggleMute(next);
    setState((prev) => ({ ...prev, isMuted: next }));
  }, [state.isMuted]);

  const toggleCamera = useCallback(() => {
    const next = !state.isCameraOff;
    rtcRef.current?.toggleCamera(next);
    setState((prev) => ({ ...prev, isCameraOff: next }));
  }, [state.isCameraOff]);

  const toggleScreenShare = useCallback(async () => {
    if (!rtcRef.current) return;
    try {
      if (state.isScreenSharing) {
        await rtcRef.current.stopScreenShare();
        setState((prev) => ({
          ...prev,
          isScreenSharing: false,
          screenStream: null,
        }));
      } else {
        const screen = await rtcRef.current.startScreenShare();
        setState((prev) => ({
          ...prev,
          isScreenSharing: true,
          screenStream: screen,
          error: null,
        }));
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          setState((prev) => ({
            ...prev,
            isScreenSharing: false,
            screenStream: null,
          }));
        });
      }
    } catch (err) {
      // Distinguish "user cancelled the picker" (silent) from real failures
      // (NotSupportedError on mobile, NotAllowedError due to policy, etc.)
      // — those should surface to the user without ending the call.
      const isUserAbort =
        err instanceof DOMException &&
        (err.name === 'AbortError' || err.name === 'NotAllowedError');
      if (isUserAbort) return;
      const message =
        err instanceof Error
          ? err.message
          : 'Screen sharing is not available on this device';
      setState((prev) => ({
        ...prev,
        isScreenSharing: false,
        screenStream: null,
        error: message,
      }));
    }
  }, [state.isScreenSharing]);

  const setVideoEffect = useCallback(async (effect: VideoEffect) => {
    if (!rtcRef.current) return;
    setState((prev) => ({ ...prev, isApplyingEffect: true, error: null }));
    try {
      await rtcRef.current.setVideoEffect(effect);
      setState((prev) => ({
        ...prev,
        videoEffect: effect,
        isApplyingEffect: false,
      }));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not apply the background effect';
      setState((prev) => ({
        ...prev,
        videoEffect: 'none',
        isApplyingEffect: false,
        error: message,
      }));
    }
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
    <CallCtx.Provider value={{ state, actions }}>
      {children}
    </CallCtx.Provider>
  );
};

export function useCallContext(): CallContextValue {
  const ctx = useContext(CallCtx);
  if (!ctx)
    throw new Error('useCallContext must be used within a CallProvider');
  return ctx;
}
