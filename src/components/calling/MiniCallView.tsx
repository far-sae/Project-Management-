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
import {
  CALL_MUTED_TEXT,
  CALL_RECORDING_BADGE,
  CALL_ROUND,
  CALL_ROUND_DANGER,
  CALL_ROUND_IDLE,
  CALL_ROUND_TOGGLED,
  CALL_STAGE,
} from './callTheme';

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

/** 36px round control. */
const btn = cn(CALL_ROUND, 'h-9 w-9');

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
    <div className={cn('flex h-screen w-screen flex-col gap-1.5 p-1.5', CALL_STAGE)}>
      <div data-testid="mini-main-tile" className="relative min-h-0 flex-1">
        {main ? (
          <ParticipantTile snap={main} compact className="h-full w-full" />
        ) : (
          <div className={cn('flex h-full items-center justify-center text-xs', CALL_MUTED_TEXT)}>
            Waiting…
          </div>
        )}
        {isRecording && (
          <span
            className={cn(
              CALL_RECORDING_BADGE,
              'pointer-events-none absolute left-1.5 top-1.5 z-[3] h-5 px-2 text-xs',
            )}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
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

      <div className="flex shrink-0 items-center justify-center gap-2 py-0.5">
        <button
          type="button"
          className={cn(btn, isMuted ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE)}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        {mediaType === 'video' && (
          <button
            type="button"
            className={cn(btn, isCameraOff ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE)}
            onClick={onToggleCamera}
            aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {isCameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
          </button>
        )}
        {isScreenSharing && (
          <button
            type="button"
            className={cn(btn, CALL_ROUND_TOGGLED)}
            onClick={onStopSharing}
            aria-label="Stop sharing"
          >
            <MonitorOff className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className={cn(btn, CALL_ROUND_DANGER)}
          onClick={onHangUp}
          aria-label="Hang up"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(btn, CALL_ROUND_IDLE)}
          onClick={onBackToCall}
          aria-label="Back to call"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
