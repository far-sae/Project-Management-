import React, { useEffect } from 'react';
import {
  showIncomingCallNotification,
  startIncomingRing,
  startTitleFlash,
} from '@/services/calling/incomingAlert';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { CallParticipant, CallMediaType } from '@/services/webrtc/types';

interface IncomingCallModalProps {
  caller: CallParticipant;
  mediaType: CallMediaType;
  /**
   * Project / team name when this is a project-wide ring (e.g. "Acme Web").
   * Shown beneath the caller name as "via <project>" so the callee knows
   * they're being invited into a multi-party call, not a 1:1 DM.
   */
  contextLabel?: string;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  mediaType,
  contextLabel,
  onAccept,
  onReject,
}) => {
  // Ring out loud (shared, gesture-unlocked audio scheduled for the whole
  // ring), show a desktop notification when the app isn't in front, and
  // flash the tab title — so a teammate in another tab or window notices.
  const callerName = caller.displayName || 'Someone';
  useEffect(() => {
    const stopRing = startIncomingRing();
    const stopFlash = startTitleFlash(`📞 ${callerName} is calling…`);
    const notify = () =>
      showIncomingCallNotification({ callerName, mediaType, contextLabel });
    let closeNotification = notify();
    // Switched away after the ring started → notify now.
    const onAway = () => {
      closeNotification();
      closeNotification = notify();
    };
    document.addEventListener('visibilitychange', onAway);
    window.addEventListener('blur', onAway);
    return () => {
      document.removeEventListener('visibilitychange', onAway);
      window.removeEventListener('blur', onAway);
      stopRing();
      stopFlash();
      closeNotification();
    };
  }, [callerName, mediaType, contextLabel]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="alertdialog"
      aria-label={`Incoming ${mediaType} call from ${caller.displayName}`}
    >
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card p-8 shadow-2xl min-w-[280px] max-w-sm animate-in fade-in zoom-in-95 duration-200">
        {/* Pulsing ring indicator */}
        <div className="relative">
          <div className="absolute inset-[-8px] rounded-full bg-primary/15 animate-ping" />
          <div className="absolute inset-[-4px] rounded-full bg-primary/10 animate-pulse" />
          <Avatar className="h-20 w-20 ring-4 ring-primary/30 relative">
            <AvatarImage src={caller.photoURL} alt={caller.displayName} />
            <AvatarFallback className="text-2xl bg-primary/10 text-primary">
              {(caller.displayName || '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">
            {caller.displayName}
          </p>
          {contextLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">
              via {contextLabel}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-1 animate-pulse">
            Incoming {mediaType} call…
          </p>
        </div>

        <div className="flex items-center gap-6 mt-2">
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="destructive"
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg"
              onClick={onReject}
              aria-label="Decline call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <span className="text-xs text-muted-foreground">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Button
              size="lg"
              className="h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
              onClick={onAccept}
              aria-label="Accept call"
            >
              {mediaType === 'video' ? (
                <Video className="h-6 w-6" />
              ) : (
                <Phone className="h-6 w-6" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};
