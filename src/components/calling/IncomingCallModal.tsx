import React, { useEffect } from 'react';
import {
  showIncomingCallNotification,
  startIncomingRing,
  startTitleFlash,
} from '@/services/calling/incomingAlert';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { CallParticipant, CallMediaType } from '@/services/webrtc/types';

interface IncomingCallModalProps {
  caller: CallParticipant;
  mediaType: CallMediaType;
  /**
   * Project / team name when this is a project-wide ring (e.g. "Acme Web").
   * Shown after the call type as "· <project>" so the callee knows they're
   * being invited into a multi-party call, not a 1:1 DM.
   */
  contextLabel?: string;
  /** Lets Accept / Decline on the desktop pop-up find this call. */
  callId?: string | null;
  /** `audioOnly`: answer a video call with the camera off. */
  onAccept: (opts: { audioOnly: boolean }) => void;
  onReject: () => void;
}

/** One of the three 44px answer buttons. */
const action =
  'inline-flex h-11 min-w-0 flex-1 basis-[88px] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  mediaType,
  contextLabel,
  callId,
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
      showIncomingCallNotification({
        callerName,
        mediaType,
        contextLabel,
        ...(callId ? { callId } : {}),
      });
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
  }, [callerName, mediaType, contextLabel, callId]);

  const kind = mediaType === 'video' ? 'Incoming video call' : 'Incoming audio call';

  // Teams-style call card: sits in the bottom-right corner over whatever
  // you're doing (no dimmed screen), with decline, answer-with-audio and
  // answer-with-video.
  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[300] flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-[0_12px_32px_rgba(0,0,0,0.10)] animate-in fade-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none sm:bottom-6 sm:left-auto sm:right-6 sm:w-[340px]"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Incoming ${mediaType} call from ${callerName}`}
    >
      <Avatar className="h-16 w-16">
        <AvatarImage src={caller.photoURL} alt="" />
        <AvatarFallback className="bg-primary-soft text-2xl font-semibold text-primary-soft-foreground">
          {callerName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="w-full min-w-0 text-center">
        <p className="truncate text-base font-semibold text-foreground" title={callerName}>
          {callerName}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {contextLabel ? `${kind} · ${contextLabel}` : kind}
        </p>
      </div>
      <div className="flex w-full flex-wrap gap-2">
        <button
          type="button"
          className={cn(action, 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          onClick={onReject}
          aria-label="Decline"
          title="Decline"
        >
          <PhoneOff aria-hidden />
          Decline
        </button>
        <button
          type="button"
          className={cn(
            action,
            // On a video call audio is the quieter choice; on a voice call
            // it is the only way to answer, so it takes the accept colour.
            mediaType === 'video'
              ? 'border border-input bg-background text-foreground hover:bg-secondary'
              : 'bg-success text-success-foreground hover:bg-success/90',
          )}
          onClick={() => onAccept({ audioOnly: mediaType === 'video' })}
          aria-label="Accept with audio"
          title="Accept with audio"
        >
          <Phone aria-hidden />
          Audio
        </button>
        {mediaType === 'video' && (
          <button
            type="button"
            className={cn(action, 'bg-success text-success-foreground hover:bg-success/90')}
            onClick={() => onAccept({ audioOnly: false })}
            aria-label="Accept with video"
            title="Accept with video"
          >
            <Video aria-hidden />
            Video
          </button>
        )}
      </div>
    </div>
  );
};
