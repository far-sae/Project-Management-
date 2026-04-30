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
}) => (
  <div
    className="flex items-center justify-center gap-2 p-3"
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
        'h-11 w-11 rounded-full transition-colors',
        isMuted
          ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
          : 'bg-muted hover:bg-muted/80 text-foreground',
      )}
    >
      {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </Button>

    {/* Camera (only for video calls) */}
    {mediaType === 'video' && (
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCamera}
        aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
        className={cn(
          'h-11 w-11 rounded-full transition-colors',
          isCameraOff
            ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
            : 'bg-muted hover:bg-muted/80 text-foreground',
        )}
      >
        {isCameraOff ? (
          <VideoOff className="h-5 w-5" />
        ) : (
          <Video className="h-5 w-5" />
        )}
      </Button>
    )}

    {/* Background blur (Teams-style) — video calls only, on supported browsers */}
    {mediaType === 'video' && backgroundEffectAvailable && (
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

    {/* Screen share — only on devices that actually support getDisplayMedia */}
    {screenShareAvailable && (
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

    {/* Hang up */}
    <Button
      variant="destructive"
      size="icon"
      onClick={onHangUp}
      aria-label="End call"
      className="h-11 w-11 rounded-full shadow-lg"
    >
      <PhoneOff className="h-5 w-5" />
    </Button>
  </div>
);
