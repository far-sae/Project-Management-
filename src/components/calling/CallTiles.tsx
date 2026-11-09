import React, { useEffect, useRef } from 'react';
import { MicOff, VideoOff } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

// ── Stream attachment helper ─────────────────────────────────

/**
 * Attach a MediaStream to a media element and explicitly start playback.
 * iOS Safari (and some Android browsers) won't auto-play a freshly assigned
 * srcObject without an explicit `.play()` call, even when assignment
 * happened during a user gesture.
 */
export function attachStream(
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

// ── Participant tile ─────────────────────────────────────────

interface ParticipantTileProps {
  snap: CallPeerSnapshot;
  /** Compact tile (smaller name + mute icon, used in PiP / strip layouts). */
  compact?: boolean;
  /** Outline the tile when LiveKit reports this peer as actively speaking. */
  showSpeakingRing?: boolean;
  className?: string;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  snap,
  compact = false,
  showSpeakingRing = true,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const initials = (snap.displayName || '?').charAt(0).toUpperCase();
  // A screen-share track should always render even when the camera is off —
  // the `isCameraOff` flag describes the camera, not the screen.
  const showVideo = !!snap.videoStream && (snap.isScreenSharing || !snap.isCameraOff);

  // Re-run when `showVideo` flips too: turning the camera back on mounts a
  // fresh <video> element while the (cached) stream object is unchanged.
  useEffect(() => {
    attachStream(videoRef.current, showVideo ? snap.videoStream ?? null : null);
  }, [snap.videoStream, showVideo]);

  return (
    <div
      className={cn(
        'relative bg-black/70 rounded-xl overflow-hidden flex items-center justify-center',
        showSpeakingRing && snap.isSpeaking && !snap.isLocal &&
          'ring-2 ring-emerald-400/80 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]',
        className,
      )}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          data-call-user={snap.userId}
          autoPlay
          playsInline
          muted
          className={cn(
            'absolute inset-0 w-full h-full',
            // Mirror only the local user's camera so they see themselves
            // selfie-style (matches Meet/Zoom). Screen-share is never
            // mirrored — text would render backwards.
            snap.isLocal && !snap.isScreenSharing && 'scale-x-[-1]',
            snap.isScreenSharing ? 'object-contain' : 'object-cover',
          )}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 text-white/80">
          <Avatar
            className={cn(
              compact ? 'h-10 w-10' : 'h-20 w-20',
              'ring-2 ring-white/15',
            )}
          >
            <AvatarFallback className="bg-white/10 text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* Bottom name + mute strip */}
      <div
        className={cn(
          'absolute left-2 bottom-2 right-2 z-[2] flex items-center gap-1.5',
          compact ? 'text-[11px]' : 'text-xs',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-white/95 backdrop-blur-sm',
            'truncate min-w-0 max-w-full',
          )}
        >
          <span className="truncate">
            {snap.displayName}
            {snap.isLocal && (
              <span className="ml-1 text-white/60">(you)</span>
            )}
          </span>
        </span>
        {snap.isMicMuted && (
          <span
            className="inline-flex items-center justify-center rounded-md bg-black/55 p-1 text-rose-300 backdrop-blur-sm"
            aria-label={`${snap.displayName} is muted`}
            title={`${snap.displayName} is muted`}
          >
            <MicOff className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </span>
        )}
        {snap.isCameraOff && !snap.isScreenSharing && (
          <span
            className="inline-flex items-center justify-center rounded-md bg-black/55 p-1 text-white/70 backdrop-blur-sm"
            aria-label={`${snap.displayName}'s camera is off`}
            title={`${snap.displayName}'s camera is off`}
          >
            <VideoOff className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </span>
        )}
        {snap.isScreenSharing && (
          <span className="inline-flex items-center rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            Sharing
          </span>
        )}
      </div>
    </div>
  );
};

// ── Audio sink ───────────────────────────────────────────────

/**
 * Off-screen <audio> element for a remote participant. Visible <video>
 * tiles are muted to avoid double-routing audio (and to avoid echo on
 * local participants whose own track is in the tile). All sound flows
 * through this sink, one per remote.
 */
export const RemoteAudioSink: React.FC<{ snap: CallPeerSnapshot }> = ({ snap }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    attachStream(ref.current, snap.audioStream ?? null);
  }, [snap.audioStream]);
  return (
    <audio
      ref={ref}
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
};
