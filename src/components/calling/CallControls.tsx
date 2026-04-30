import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  MonitorOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isScreenShareSupported } from '@/services/webrtc/mediaUtils';

interface CallControlsProps {
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  mediaType: 'audio' | 'video';
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onHangUp: () => void;
}

// Most mobile browsers (iOS Safari, mobile Chrome on Android) do not implement
// navigator.mediaDevices.getDisplayMedia. Showing the button there leads to
// silent failures or, worse, broken renegotiation that drops the call.
const screenShareAvailable = isScreenShareSupported();

export const CallControls: React.FC<CallControlsProps> = ({
  isMuted,
  isCameraOff,
  isScreenSharing,
  mediaType,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
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
