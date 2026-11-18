import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  MonitorOff,
  Sparkles,
  Loader2,
  Disc,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isScreenShareSupported } from '@/services/webrtc/mediaUtils';
import { isBackgroundEffectSupported } from '@/services/webrtc/BackgroundProcessor';
import type { CallVideoEffect } from '@/services/webrtc/types';
import {
  CALL_ROUND,
  CALL_ROUND_DANGER,
  CALL_ROUND_IDLE,
  CALL_ROUND_TOGGLED,
} from './callTheme';

interface CallControlsProps {
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  videoEffect: CallVideoEffect;
  isApplyingEffect: boolean;
  mediaType: 'audio' | 'video';
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleBackgroundEffect: () => void;
  onHangUp: () => void;
  /** Compact layout for the small floating call — drops blur, screen share
   *  and record, and uses 36px buttons with a round end-call button. */
  compact?: boolean;
  /** When provided, shows a record/stop toggle that captures audio for AI
   *  notes. Hidden in compact mode. */
  isRecording?: boolean;
  onToggleRecording?: () => void;
  /** Set false to hide the screen-share button (e.g. guests). Default true. */
  allowScreenShare?: boolean;
}

// Most mobile browsers (iOS Safari, mobile Chrome on Android) do not implement
// navigator.mediaDevices.getDisplayMedia. Showing the button there leads to
// silent failures or, worse, broken renegotiation that drops the call.
const screenShareAvailable = isScreenShareSupported();
// Background-effect (segmentation + blur) needs canvas.captureStream and the
// MediaPipe runtime; older browsers lack one or both.
const backgroundEffectAvailable = isBackgroundEffectSupported();

export const CallControls: React.FC<CallControlsProps> = ({
  isMuted,
  isCameraOff,
  isScreenSharing,
  videoEffect,
  isApplyingEffect,
  mediaType,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onToggleBackgroundEffect,
  onHangUp,
  compact = false,
  isRecording = false,
  onToggleRecording,
  allowScreenShare = true,
}) => {
  // 48px round buttons on the call screen, 36px in the small floating call.
  const round = cn(CALL_ROUND, compact ? 'h-9 w-9' : 'h-12 w-12');
  const iconSize = compact ? 'h-4 w-4' : 'h-5 w-5';
  const blurOn = videoEffect === 'blur';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center',
        compact ? 'gap-1.5' : 'gap-3 px-4 pb-4 pt-3',
      )}
      role="toolbar"
      aria-label="Call controls"
    >
      {/* Mute */}
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        className={cn(round, isMuted ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE)}
      >
        {isMuted ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
      </button>

      {/* Camera (only for video calls) */}
      {mediaType === 'video' && (
        <button
          type="button"
          onClick={onToggleCamera}
          aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          className={cn(round, isCameraOff ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE)}
        >
          {isCameraOff ? <VideoOff className={iconSize} /> : <Video className={iconSize} />}
        </button>
      )}

      {/* Background blur — not in the small floating call */}
      {!compact && mediaType === 'video' && backgroundEffectAvailable && (
        <button
          type="button"
          onClick={onToggleBackgroundEffect}
          disabled={isApplyingEffect}
          aria-label={blurOn ? 'Turn off background blur' : 'Blur background'}
          aria-pressed={blurOn}
          className={cn(
            round,
            blurOn ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE,
            isApplyingEffect && 'cursor-progress',
          )}
        >
          {isApplyingEffect ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </button>
      )}

      {/* Screen share — not in the small floating call */}
      {!compact && allowScreenShare && screenShareAvailable && (
        <button
          type="button"
          onClick={onToggleScreenShare}
          aria-label={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          className={cn(round, isScreenSharing ? CALL_ROUND_TOGGLED : CALL_ROUND_IDLE)}
        >
          {isScreenSharing ? (
            <MonitorOff className="h-5 w-5" />
          ) : (
            <MonitorUp className="h-5 w-5" />
          )}
        </button>
      )}

      {/* Record (AI notes) — call screen only */}
      {!compact && onToggleRecording && (
        <button
          type="button"
          onClick={onToggleRecording}
          aria-label={isRecording ? 'Stop recording' : 'Record meeting'}
          aria-pressed={isRecording}
          className={cn(round, isRecording ? CALL_ROUND_DANGER : CALL_ROUND_IDLE)}
          title={isRecording ? 'Stop recording' : 'Record meeting (AI notes)'}
        >
          {isRecording ? (
            <Square className="h-4 w-4 fill-current" />
          ) : (
            <Disc className="h-5 w-5" />
          )}
        </button>
      )}

      {/* End call — a labelled pill on the call screen, round when compact */}
      <button
        type="button"
        onClick={onHangUp}
        aria-label="End call"
        className={cn(
          CALL_ROUND,
          CALL_ROUND_DANGER,
          compact ? 'h-9 w-9' : 'h-12 gap-2 px-5 text-sm font-semibold',
        )}
      >
        <PhoneOff className={iconSize} />
        {!compact && <span>End call</span>}
      </button>
    </div>
  );
};
