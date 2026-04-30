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
  startCall: (
    context: CallContext,
    mediaType: CallMediaType,
    remoteParticipant: CallParticipant,
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
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
  localParticipant: null,
  remoteParticipant: null,
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

  // Timers
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerResendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inboxChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
    if (inboxChannelRef.current) {
      void supabase.removeChannel(inboxChannelRef.current);
      inboxChannelRef.current = null;
    }
  }, []);

  const resetCall = useCallback(() => {
    clearTimers();
    rtcRef.current?.destroy();
    rtcRef.current = null;
    signalingRef.current = null;
    pendingOfferRef.current = null;
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
        if (msg.type !== 'offer') return;
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
  }, [state.status, state.direction, state.callId, localParticipant, resetCall]);

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
        case 'remote-stream':
          setState((prev) => ({
            ...prev,
            status: 'connected',
            remoteStream: payload as MediaStream,
          }));
          break;
        case 'connection-state':
          if (payload === 'connected') {
            setState((prev) => ({ ...prev, status: 'connected' }));
          } else if (payload === 'disconnected') {
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
      remoteParticipant: CallParticipant,
    ) => {
      if (!localParticipant || !isMediaSupported()) return;
      if (state.status !== 'idle') return;

      clearTimers();

      const callId = generateCallId();

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
        remoteParticipant,
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
        };

        // Send offer to callee's inbox channel, and resend every 3s to handle timing races.
        // The callee ignores duplicate offers if already ringing.
        const sendOfferViaInbox = () => {
          const ch = supabase.channel(
            `call-inbox:${remoteParticipant.userId}`,
            { config: { broadcast: { self: false } } },
          );
          inboxChannelRef.current = ch;
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              ch.send({
                type: 'broadcast',
                event: 'signal',
                payload: offerPayload,
              });
            }
          });
        };

        sendOfferViaInbox();

        // Resend every 3s in case the first broadcast was missed
        offerResendRef.current = setInterval(() => {
          // Stop resending if we're no longer ringing
          if (rtcRef.current?.destroyed) {
            if (offerResendRef.current) clearInterval(offerResendRef.current);
            return;
          }
          // Clean up old channel and resend
          if (inboxChannelRef.current) {
            void supabase.removeChannel(inboxChannelRef.current);
            inboxChannelRef.current = null;
          }
          sendOfferViaInbox();
        }, OFFER_RESEND_INTERVAL_MS);

        // Also listen on the call channel for the callee's answer/reject
        // (the signaling channel is already subscribed by WebRTCService)

        // 30-second outgoing ring timeout — auto-cancel if no answer
        ringTimeoutRef.current = setTimeout(() => {
          clearTimers();
          rtcRef.current?.hangUp();
          rtcRef.current = null;
          signalingRef.current = null;
          setState({
            ...IDLE_STATE,
            status: 'ended',
            error: `${remoteParticipant.displayName} didn't answer`,
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
    signalingRef.current = null;
    pendingOfferRef.current = null;
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
        }));
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          setState((prev) => ({
            ...prev,
            isScreenSharing: false,
            screenStream: null,
          }));
        });
      }
    } catch {
      // User cancelled the screen picker
    }
  }, [state.isScreenSharing]);

  const actions: CallActions = {
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
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
