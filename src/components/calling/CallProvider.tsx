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
  /** Start an outgoing call */
  startCall: (
    context: CallContext,
    mediaType: CallMediaType,
    remoteParticipant: CallParticipant,
  ) => Promise<void>;
  /** Accept an incoming call */
  acceptCall: () => Promise<void>;
  /** Reject / decline an incoming call */
  rejectCall: () => void;
  /** End the current call */
  hangUp: () => void;
  /** Toggle microphone mute */
  toggleMute: () => void;
  /** Toggle camera on/off */
  toggleCamera: () => void;
  /** Start / stop screen sharing */
  toggleScreenShare: () => Promise<void>;
}

interface CallContextValue {
  state: CallState;
  actions: CallActions;
}

const CallCtx = createContext<CallContextValue | null>(null);

// ── Helper ───────────────────────────────────────────────────

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
  const rtcRef = useRef<WebRTCService | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const pendingOfferRef = useRef<SignalOffer | null>(null);
  const inboxRemoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const localParticipant: CallParticipant | null = user
    ? {
        userId: user.userId,
        displayName: user.displayName || user.email || 'User',
        photoURL: user.photoURL,
      }
    : null;

  // ── Global incoming-call listener ──────────────────────────
  // We listen on a user-scoped channel so anyone can ring us.

  useEffect(() => {
    if (!user?.userId) return;

    const inboxChannel = supabase.channel(`call-inbox:${user.userId}`, {
      config: { broadcast: { self: false } },
    });

    inboxChannel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const msg = payload as SignalMessage;
        if (msg.type !== 'offer') return;
        // Ignore if we're already in a call
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

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(
    () => () => {
      if (inboxRemoveTimeoutRef.current) {
        clearTimeout(inboxRemoveTimeoutRef.current);
        inboxRemoveTimeoutRef.current = null;
      }
      rtcRef.current?.destroy();
    },
    [],
  );

  // ── Helpers ────────────────────────────────────────────────

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
  }, []);

  const resetCall = useCallback(() => {
    if (inboxRemoveTimeoutRef.current) {
      clearTimeout(inboxRemoveTimeoutRef.current);
      inboxRemoveTimeoutRef.current = null;
    }
    rtcRef.current?.destroy();
    rtcRef.current = null;
    signalingRef.current = null;
    pendingOfferRef.current = null;
    setState(IDLE_STATE);
  }, []);

  // ── Actions ────────────────────────────────────────────────

  const startCall = useCallback(
    async (
      context: CallContext,
      mediaType: CallMediaType,
      remoteParticipant: CallParticipant,
    ) => {
      if (!localParticipant || !isMediaSupported()) return;
      if (state.status !== 'idle') return;

      const callId = generateCallId();

      // Set up signaling on the call channel
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

      setState({
        ...IDLE_STATE,
        status: 'connecting',
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

        // Ring the callee via inbox with the real offer + context (call channel is used after accept).
        if (inboxRemoveTimeoutRef.current) {
          clearTimeout(inboxRemoveTimeoutRef.current);
          inboxRemoveTimeoutRef.current = null;
        }
        const inboxChannel = supabase.channel(
          `call-inbox:${remoteParticipant.userId}`,
        );
        inboxChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            inboxChannel.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'offer',
                sdp: localDesc,
                callId,
                from: localParticipant,
                mediaType,
                context,
              } satisfies SignalOffer,
            });
            inboxRemoveTimeoutRef.current = setTimeout(() => {
              void supabase.removeChannel(inboxChannel);
              inboxRemoveTimeoutRef.current = null;
            }, 2000);
          }
        });
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
    },
    [localParticipant, state.status, setupRTCEvents],
  );

  const acceptCall = useCallback(async () => {
    if (!localParticipant) return;
    const offer = pendingOfferRef.current;
    if (!offer || !state.callId) return;

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
  }, [localParticipant, state.callId, setupRTCEvents]);

  const rejectCall = useCallback(() => {
    if (rtcRef.current) {
      rtcRef.current.reject();
    } else if (state.callId && localParticipant && state.remoteParticipant) {
      // No RTC yet (we haven't accepted), send reject via a throwaway channel
      const sig = new SignalingChannel(
        `call:${state.callId}`,
        localParticipant.userId,
      );
      sig.subscribe();
      sig.send({
        type: 'reject',
        callId: state.callId,
        from: localParticipant,
      });
      setTimeout(() => sig.destroy(), 1000);
    }
    resetCall();
  }, [state.callId, localParticipant, state.remoteParticipant, resetCall]);

  const hangUp = useCallback(() => {
    rtcRef.current?.hangUp();
    resetCall();
  }, [resetCall]);

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
        // Listen for native "stop sharing"
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          setState((prev) => ({
            ...prev,
            isScreenSharing: false,
            screenStream: null,
          }));
        });
      }
    } catch {
      // User cancelled the screen picker — not an error
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
