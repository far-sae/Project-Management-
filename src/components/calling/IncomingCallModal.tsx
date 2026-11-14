import React, { useEffect } from 'react';
import {
  showIncomingCallNotification,
  startIncomingRing,
  startTitleFlash,
} from '@/services/calling/incomingAlert';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  /** `audioOnly`: answer a video call with the camera off. */
  onAccept: (opts: { audioOnly: boolean }) => void;
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

  const kind = mediaType === 'video' ? 'Video call' : 'Voice call';
  const roundBtn =
    'flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md transition-transform duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

  // Teams-style call card: sits in the bottom-right corner over whatever
  // you're doing (no dimmed screen), with answer-with-video,
  // answer-with-audio and decline.
  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[300] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[380px] rounded-2xl border border-border bg-card text-card-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Incoming ${mediaType} call from ${callerName}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Incoming call
      </div>
      <div className="flex items-center gap-3 p-4">
        <div className="relative shrink-0">
          <span className="absolute -inset-1 rounded-full bg-primary/20 animate-pulse motion-reduce:animate-none" />
          <Avatar className="relative h-12 w-12">
            <AvatarImage src={caller.photoURL} alt={callerName} />
            <AvatarFallback className="bg-primary/10 text-lg text-primary">
              {callerName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground" title={callerName}>
            {callerName}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {contextLabel ? `${kind} · ${contextLabel}` : kind}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mediaType === 'video' && (
            <button
              type="button"
              className={`${roundBtn} bg-emerald-600 hover:bg-emerald-700`}
              onClick={() => onAccept({ audioOnly: false })}
              aria-label="Accept with video"
              title="Accept with video"
            >
              <Video className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            className={`${roundBtn} bg-emerald-600 hover:bg-emerald-700`}
            onClick={() => onAccept({ audioOnly: mediaType === 'video' })}
            aria-label="Accept with audio"
            title="Accept with audio"
          >
            <Phone className="h-5 w-5" />
          </button>
          <button
            type="button"
            className={`${roundBtn} bg-red-600 hover:bg-red-700`}
            onClick={onReject}
            aria-label="Decline"
            title="Decline"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
