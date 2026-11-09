import React from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickMiniMainTile } from '@/services/livekit/callHelpers';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { ParticipantTile } from './CallTiles';
import { GuestAdmitBanners, type GuestDecision } from './GuestAdmitBanners';

interface MiniCallViewProps {
  participants: CallPeerSnapshot[];
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  mediaType: 'audio' | 'video';
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onStopSharing: () => void;
  onHangUp: () => void;
  onBackToCall: () => void;
  /** Someone in the call is recording — shows the shared "Recording" badge. */
  isRecording?: boolean;
  /** Guests waiting to be let in (empty when the user can't admit). */
  waitingGuests?: CallPeerSnapshot[];
  /** Identities whose admit/deny request is in flight. */
  guestBusy?: Record<string, boolean>;
  onGuestDecision?: (identity: string, decision: GuestDecision) => void;
}

const btn =
  'inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors';

/**
 * Compact call UI rendered into the floating (picture-in-picture) window.
 * Video only — remote audio keeps playing from the main page, so this view
 * must never render <audio> elements.
 */
export const MiniCallView: React.FC<MiniCallViewProps> = ({
  participants,
  isMuted,
  isCameraOff,
  isScreenSharing,
  mediaType,
  onToggleMute,
  onToggleCamera,
  onStopSharing,
  onHangUp,
  onBackToCall,
  isRecording = false,
  waitingGuests = [],
  guestBusy = {},
  onGuestDecision,
}) => {
  const main = pickMiniMainTile(participants);
  // Everyone else, small. The local user appears as their camera tile, never
  // as their own screen share.
  const others = participants
    .filter((p) => p.userId !== main?.userId)
    .map((p) =>
      p.isLocal && p.isScreenSharing
        ? { ...p, videoStream: null, isScreenSharing: false }
        : p,
    );

  return (
    <div className="flex h-screen w-screen flex-col gap-1.5 bg-neutral-950 p-1.5 text-white">
      <div data-testid="mini-main-tile" className="relative min-h-0 flex-1">
        {main ? (
          <ParticipantTile snap={main} compact className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-white/60">
            Waiting…
          </div>
        )}
        {isRecording && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-[3] inline-flex items-center gap-1 rounded-full bg-red-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
            Recording
          </span>
        )}
      </div>

      {onGuestDecision && (
        <GuestAdmitBanners
          guests={waitingGuests}
          busy={guestBusy}
          onDecide={onGuestDecision}
          compact
          className="shrink-0"
        />
      )}

      {others.length > 0 && (
        <div data-testid="mini-strip" className="flex h-14 shrink-0 gap-1.5 overflow-x-auto">
          {others.map((p) => (
            <ParticipantTile
              key={p.userId}
              snap={p}
              compact
              showSpeakingRing
              className="h-full w-20 shrink-0"
            />
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-center gap-2 pb-0.5">
        <button
          type="button"
          className={cn(btn, isMuted && 'bg-rose-600 hover:bg-rose-500')}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        {mediaType === 'video' && (
          <button
            type="button"
            className={cn(btn, isCameraOff && 'bg-rose-600 hover:bg-rose-500')}
            onClick={onToggleCamera}
            aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {isCameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
          </button>
        )}
        {isScreenSharing && (
          <button
            type="button"
            className={cn(btn, 'bg-emerald-600 hover:bg-emerald-500')}
            onClick={onStopSharing}
            aria-label="Stop sharing"
          >
            <MonitorOff className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(btn, 'bg-red-600 hover:bg-red-500')}
          onClick={onHangUp}
          aria-label="Hang up"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
        <button type="button" className={btn} onClick={onBackToCall} aria-label="Back to call">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
