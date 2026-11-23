import React, { useEffect, useRef } from 'react';
import { MicOff, VideoOff } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { CALL_SURFACE } from './callTheme';

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
  /**
   * Show the screen this person is sharing instead of their camera. The same
   * person then has two tiles: this one, and their camera among the others.
   */
  screen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  snap,
  compact = false,
  showSpeakingRing = true,
  screen = false,
  className,
  style,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const initials = (snap.displayName || '?').charAt(0).toUpperCase();
  // A camera tile shows the camera, sharing or not: sharing a screen never
  // takes the person's own picture away. A screen tile shows only the screen.
  const stream = (screen ? snap.screenStream : snap.videoStream) ?? null;
  const showVideo = !!stream && (screen || !snap.isCameraOff);

  // Re-run when `showVideo` flips too: turning the camera back on mounts a
  // fresh <video> element while the (cached) stream object is unchanged.
  useEffect(() => {
    attachStream(videoRef.current, showVideo ? stream : null);
  }, [stream, showVideo]);

  return (
    <div
      style={style}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-[10px]',
        CALL_SURFACE,
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
            snap.isLocal && !screen && 'scale-x-[-1]',
            screen ? 'object-contain' : 'object-cover',
          )}
        />
      ) : (
        <Avatar className={compact ? 'h-10 w-10' : 'h-[72px] w-[72px]'}>
          <AvatarFallback
            className={cn(
              'bg-[#3a3a3a] font-semibold text-white',
              compact ? 'text-base' : 'text-[28px]',
            )}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      )}

      {/* Active speaker: a plain green ring drawn over the video, so it is
          never clipped by the stage or hidden behind the picture. */}
      {showSpeakingRing && !screen && snap.isSpeaking && !snap.isLocal && (
        <span
          aria-hidden
          data-testid="speaking-ring"
          className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] ring-2 ring-inset ring-success"
        />
      )}

      {/* Name tag, bottom-left, with mic / camera / sharing indicators */}
      <div
        className={cn(
          'absolute bottom-2 left-2 right-2 z-[2] flex items-center gap-1.5 font-medium text-white',
          compact ? 'text-xs' : 'text-xs',
        )}
      >
        <span
          className={cn(
            'inline-flex min-w-0 max-w-full items-center rounded-md bg-black/70',
            compact ? 'h-5 px-1.5' : 'h-6 px-2',
          )}
        >
          {screen ? (
            <span className="truncate">{snap.isLocal ? 'Your screen' : `${snap.displayName}’s screen`}</span>
          ) : (
            <span className="truncate">
              {snap.displayName}
              {snap.isLocal && <span className="ml-1 font-normal text-[#a3a3a3]">(you)</span>}
            </span>
          )}
        </span>
        {!screen && snap.role === 'guest' && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded bg-warning px-1.5 text-xs text-warning-foreground',
              compact ? 'h-5' : 'h-6',
            )}
          >
            Guest
          </span>
        )}
        {!screen && snap.isMicMuted && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-md bg-black/70 text-[#fda29b]',
              compact ? 'h-5 w-5' : 'h-6 w-6',
            )}
            aria-label={`${snap.displayName} is muted`}
            title={`${snap.displayName} is muted`}
          >
            <MicOff className="h-3 w-3" />
          </span>
        )}
        {!screen && snap.isCameraOff && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-md bg-black/70 text-[#a3a3a3]',
              compact ? 'h-5 w-5' : 'h-6 w-6',
            )}
            aria-label={`${snap.displayName}'s camera is off`}
            title={`${snap.displayName}'s camera is off`}
          >
            <VideoOff className="h-3 w-3" />
          </span>
        )}
        {!screen && snap.isScreenSharing && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded bg-success px-1.5 text-xs text-success-foreground',
              compact ? 'h-5' : 'h-6',
            )}
          >
            Sharing
          </span>
        )}
      </div>
    </div>
  );
};

// ── A shared screen with everybody beside it ─────────────────

/**
 * The call while somebody shares a screen: the screen takes the middle, and
 * everybody's camera (the sharer's too, first) lines up on the right. On a
 * phone, where there is no room at the side, they are a row under the screen.
 */
export const ScreenShareStage: React.FC<{
  sharer: CallPeerSnapshot;
  /** Everybody in the call, the sharer included. */
  peers: CallPeerSnapshot[];
  className?: string;
}> = ({ sharer, peers, className }) => {
  const ordered = [sharer, ...peers.filter((p) => p.userId !== sharer.userId)];
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-3 sm:flex-row', className)}>
      <div data-testid="shared-screen" className="flex min-h-0 min-w-0 flex-1">
        <ParticipantTile snap={sharer} screen showSpeakingRing={false} className="min-h-0 min-w-0 flex-1" />
      </div>
      <ul
        aria-label="People in the call"
        className="flex shrink-0 gap-3 overflow-x-auto sm:w-44 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden lg:w-56"
      >
        {ordered.map((p) => (
          <li key={p.userId} className="w-36 shrink-0 list-none sm:w-full">
            <ParticipantTile snap={p} compact className="aspect-video w-full" />
          </li>
        ))}
      </ul>
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
