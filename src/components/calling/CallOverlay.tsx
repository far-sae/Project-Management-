import React, { useEffect, useRef, useState } from 'react';
import { Minimize2, Maximize2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CallControls } from './CallControls';
import { IncomingCallModal } from './IncomingCallModal';
import { useCall } from '@/hooks/useCall';
import { cn } from '@/lib/utils';

/**
 * Global call overlay rendered at the app root.
 * - Shows IncomingCallModal when ringing
 * - Shows a full / PiP video overlay when connected
 * - Shows a compact bar for audio-only calls
 */
export const CallOverlay: React.FC = () => {
  const { state, actions } = useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [pip, setPip] = useState(false);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream, pip]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream, pip]);

  // Nothing to render when idle
  if (state.status === 'idle' || state.status === 'ended') return null;

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

  // ── Active call overlay ────────────────────────────────────

  const isVideo = state.mediaType === 'video';
  const remoteName = state.remoteParticipant?.displayName || 'Participant';
  const statusLabel =
    state.status === 'connecting'
      ? 'Connecting…'
      : state.status === 'reconnecting'
        ? 'Reconnecting…'
        : null;

  // PiP mode — compact floating window
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
            {/* Local PiP inset */}
            {state.localStream && (
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
              <AvatarImage
                src={state.remoteParticipant?.photoURL}
                alt={remoteName}
              />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {remoteName}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {statusLabel || 'Audio call'}
              </p>
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

  // ── Full-screen overlay ────────────────────────────────────

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
            <AvatarImage
              src={state.remoteParticipant?.photoURL}
              alt={remoteName}
            />
            <AvatarFallback className="text-sm bg-white/10 text-white">
              {remoteName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold">{remoteName}</p>
            <p className="text-xs text-white/60">
              {statusLabel ||
                (isVideo ? 'Video call' : 'Audio call') +
                  (state.isScreenSharing ? ' · Screen sharing' : '')}
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
            {/* Local camera PiP */}
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
          // Audio-only: show large avatar
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-28 w-28 ring-4 ring-white/10">
              <AvatarImage
                src={state.remoteParticipant?.photoURL}
                alt={remoteName}
              />
              <AvatarFallback className="text-4xl bg-white/10 text-white">
                {remoteName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <p className="text-lg font-semibold">{remoteName}</p>
            <p className="text-sm text-white/50">
              {statusLabel || 'Connected'}
            </p>
          </div>
        )}

        {/* Error banner */}
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
