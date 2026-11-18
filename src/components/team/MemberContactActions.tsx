import React from 'react';
import { MessageSquare, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatDock } from '@/components/messaging/ChatDock';
import { useCall } from '@/hooks/useCall';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';

interface MemberContactActionsProps {
  member: {
    userId: string;
    displayName: string;
    email?: string;
    photoURL?: string;
  };
  /** The signed-in user: nothing is shown on their own row. */
  currentUserId?: string | null;
  organizationId?: string | null;
}

/** 28px square icon button on desktop (touch-sized on phones). */
const ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';

/**
 * "Open chat" and "Call" for one person in the Team list. Both reach only
 * that person: the chat opens in the bottom chat dock, the call is a
 * one-to-one voice call.
 */
export const MemberContactActions: React.FC<MemberContactActionsProps> = ({
  member,
  currentUserId,
  organizationId,
}) => {
  const { openChat } = useChatDock();
  const { actions, state } = useCall();

  if (!member.userId || member.userId === currentUserId) return null;

  const canCall = isMediaSupported() && state.status === 'idle';

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={ICON_BUTTON}
        aria-label={`Open chat with ${member.displayName}`}
        title="Open chat"
        onClick={() =>
          openChat({
            userId: member.userId,
            displayName: member.displayName,
            email: member.email,
            photoURL: member.photoURL,
            organizationId,
          })
        }
      >
        <MessageSquare aria-hidden />
      </Button>
      {canCall && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ICON_BUTTON}
          aria-label={`Voice call ${member.displayName}`}
          title="Voice call"
          onClick={() =>
            void actions.startCall(
              { type: 'dm', targetId: member.userId, label: member.displayName },
              'audio',
              {
                userId: member.userId,
                displayName: member.displayName,
                photoURL: member.photoURL,
              },
            )
          }
        >
          <Phone aria-hidden />
        </Button>
      )}
    </>
  );
};

export default MemberContactActions;
