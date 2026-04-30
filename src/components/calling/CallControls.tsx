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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isScreenShareSupported } from '@/services/webrtc/mediaUtils';
import { isBackgroundEffectSupported } from '@/services/webrtc/BackgroundProcessor';
import type { CallVideoEffect } from '@/services/webrtc/types';

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
  /** Compact layout for the small/PiP window — drops blur + screen share and
   *  keeps the end-call button visually dominant, matching how Google Meet's
   *  picture-in-picture surfaces the hang-up. */
  compact?: boolean;
  /** When provided, shows a record/stop toggle that captures audio for AI
   *  notes. Hidden in compact mode (PiP) to keep the end-call dominant. */
  isRecording?: boolean;
  onToggleRecording?: () => void;
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
}) => {
  const btnSize = compact ? 'h-9 w-9' : 'h-11 w-11';
  const iconSize = compact ? 'h-4 w-4' : 'h-5 w-5';
  // In compact (PiP) mode we elongate the end-call button so it's the obvious
  // dominant action — matches Meet/Zoom PiP, where the red hang-up sits wider
  // than the round mute/camera toggles.
  const hangUpClasses = compact
    ? 'h-9 w-14 rounded-full shadow-lg'
    : 'h-11 w-11 rounded-full shadow-lg';

  return (
    <div
      className={cn(
        'flex items-center justify-center',
        compact ? 'gap-1.5 p-2' : 'gap-2 p-3',
      )}
      role="toolbar"
      aria-label="Call controls"
    >
      {/* Mute */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        className={cn(
          btnSize,
          'rounded-full transition-colors',
          isMuted
            ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
            : 'bg-muted hover:bg-muted/80 text-foreground',
        )}
      >
        {isMuted ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
      </Button>

      {/* Camera (only for video calls) */}
      {mediaType === 'video' && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCamera}
          aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          className={cn(
            btnSize,
            'rounded-full transition-colors',
            isCameraOff
              ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
              : 'bg-muted hover:bg-muted/80 text-foreground',
          )}
        >
          {isCameraOff ? (
            <VideoOff className={iconSize} />
          ) : (
            <Video className={iconSize} />
          )}
        </Button>
      )}

      {/* Background blur — hidden in compact (PiP) mode so the end-call button stays prominent */}
      {!compact && mediaType === 'video' && backgroundEffectAvailable && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleBackgroundEffect}
          disabled={isApplyingEffect}
          aria-label={
            videoEffect === 'blur'
              ? 'Turn off background blur'
              : 'Blur background'
          }
          aria-pressed={videoEffect === 'blur'}
          className={cn(
            'h-11 w-11 rounded-full transition-colors',
            videoEffect === 'blur'
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'bg-muted hover:bg-muted/80 text-foreground',
            isApplyingEffect && 'opacity-70 cursor-progress',
          )}
        >
          {isApplyingEffect ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Screen share — hidden in compact (PiP) mode for the same reason */}
      {!compact && screenShareAvailable && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleScreenShare}
          aria-label={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          className={cn(
            'h-11 w-11 rounded-full transition-colors',
            isScreenSharing
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'bg-muted hover:bg-muted/80 text-foreground',
          )}
        >
          {isScreenSharing ? (
            <MonitorOff className="h-5 w-5" />
          ) : (
            <MonitorUp className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Record (AI notes) — full-screen overlay only */}
      {!compact && onToggleRecording && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleRecording}
          aria-label={isRecording ? 'Stop recording' : 'Record meeting'}
          aria-pressed={isRecording}
          className={cn(
            'h-11 w-11 rounded-full transition-colors',
            isRecording
              ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
              : 'bg-muted hover:bg-muted/80 text-foreground',
          )}
          title={isRecording ? 'Stop recording' : 'Record meeting (AI notes)'}
        >
          {isRecording ? (
            <Square className="h-4 w-4 fill-current" />
          ) : (
            <Disc className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Hang up — wider pill in compact mode so users can't miss it */}
      <Button
        variant="destructive"
        size="icon"
        onClick={onHangUp}
        aria-label="End call"
        className={hangUpClasses}
      >
        <PhoneOff className={iconSize} />
      </Button>
    </div>
  );
};
