import React, { useEffect, useRef, useState } from 'react';
import { Minimize2, Maximize2, PhoneOff } from 'lucide-react';
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

export const CallOverlay: React.FC = () => {
  const { state, actions } = useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [pip, setPip] = useState(false);

  const isOutgoingRinging = state.status === 'ringing' && state.direction === 'outgoing';
  const isConnected = state.status === 'connected';

  useOutgoingRingtone(isOutgoingRinging);
  const callDuration = useCallTimer(isConnected);

  // Attach local stream
  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream, pip]);

  // Attach remote stream
  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream, pip]);

  // Nothing to render when idle
  if (state.status === 'idle') return null;

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
        className={cn(
          'fixed bottom-20 right-5 z-[250] flex flex-col items-center',
          'rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl overflow-hidden',
          isVideo ? 'w-[240px]' : 'w-[220px]',
        )}
        role="dialog"
        aria-label="Active call"
      >
        {isVideo && state.remoteStream && (
          <div className="relative w-full aspect-video bg-black">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {state.localStream && !state.isCameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-2 right-2 w-16 h-12 rounded-md object-cover border border-white/30 shadow"
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

        <div className="flex items-center justify-between w-full px-1 pb-1">
          <CallControls
            isMuted={state.isMuted}
            isCameraOff={state.isCameraOff}
            isScreenSharing={state.isScreenSharing}
            mediaType={state.mediaType}
            onToggleMute={actions.toggleMute}
            onToggleCamera={actions.toggleCamera}
            onToggleScreenShare={() => void actions.toggleScreenShare()}
            onHangUp={actions.hangUp}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground mr-1"
            onClick={() => setPip(false)}
            aria-label="Expand call"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
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
      <div className="flex-1 relative flex items-center justify-center">
        {isVideo && state.remoteStream ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="max-w-full max-h-full object-contain"
            />
            {state.localStream && !state.isCameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-4 right-4 w-40 h-28 rounded-lg object-cover border-2 border-white/20 shadow-xl"
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
          mediaType={state.mediaType}
          onToggleMute={actions.toggleMute}
          onToggleCamera={actions.toggleCamera}
          onToggleScreenShare={() => void actions.toggleScreenShare()}
          onHangUp={actions.hangUp}
        />
      </div>
    </div>
  );
};
