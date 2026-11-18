import React from 'react';
import { MessageSquare, Phone, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useCall } from '@/hooks/useCall';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import { presenceStatus } from '@/lib/presenceStatus';
import { cn } from '@/lib/utils';
import type { PresencePeer } from '@/hooks/usePresence';

export interface ProjectTeamMember {
  /** Missing for people invited by email who have no account yet. */
  userId?: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

interface ProjectTeamMemberRowProps {
  member: ProjectTeamMember;
  roleLabel: string;
  isSelf: boolean;
  /** Live presence for this person, when known. */
  peer: PresencePeer | undefined;
  /** Saved last-seen time; drives "Last seen 5 min ago". */
  lastSeenAt: Date | null;
  /** View-only users see the call buttons but cannot use them. */
  callsDisabled: boolean;
  /** Opens the one-to-one chat with this person. */
  onMessage: () => void;
}

const VIEW_ONLY_TITLE = 'View-only — calls are disabled for your role.';

/**
 * One person in the project chat's Team tab: avatar with presence dot, name,
 * status, then buttons to message or call that one person. Calls from here
 * ring only this person (the buttons in the panel header ring everyone).
 */
export const ProjectTeamMemberRow: React.FC<ProjectTeamMemberRowProps> = ({
  member,
  roleLabel,
  isSelf,
  peer,
  lastSeenAt,
  callsDisabled,
  onMessage,
}) => {
  const { actions: callActions, state: callState } = useCall();
  const name = member.displayName;
  const firstName = name.split(' ')[0] || name;
  const status = presenceStatus(peer, lastSeenAt);
  const canReach = Boolean(member.userId) && !isSelf;
  const canCall = canReach && isMediaSupported() && callState.status === 'idle';

  const startCall = (media: 'audio' | 'video') => {
    if (callsDisabled || !member.userId) return;
    void callActions.startCall(
      { type: 'dm', targetId: member.userId, label: name },
      media,
      { userId: member.userId, displayName: name, photoURL: member.photoURL },
    );
  };

  const identity = (
    <>
      <span className="relative shrink-0">
        <Avatar className="h-8 w-8">
          <AvatarImage src={member.photoURL} alt="" />
          <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
            {(name || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span
          aria-hidden
          className={cn(
            'absolute -bottom-px -right-px h-2 w-2 rounded-full ring-2 ring-card',
            status.dot,
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium leading-[18px] text-foreground">
            {name}
          </span>
          {isSelf && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
          <span className="shrink-0 rounded bg-secondary px-1.5 text-xs font-medium leading-4 text-muted-foreground">
            {roleLabel}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          <span
            className={cn('shrink-0', status.online && 'text-success-soft-foreground')}
            title={status.title}
          >
            {status.label}
          </span>
          {member.email && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{member.email}</span>
            </>
          )}
        </span>
      </span>
    </>
  );

  return (
    <div className="flex min-h-[52px] items-center gap-0.5 rounded-lg px-2 transition-colors hover:bg-surface-2">
      {canReach ? (
        // Clicking the person opens their chat, as before; the labelled
        // button on the right does the same for keyboard users.
        <button
          type="button"
          tabIndex={-1}
          onClick={onMessage}
          title={`Message ${name}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch py-1.5 pr-1 text-left"
        >
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pr-1">{identity}</div>
      )}
      {canReach && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label={`Message ${name}`}
          title={`Message ${firstName}`}
          onClick={onMessage}
        >
          <MessageSquare />
        </Button>
      )}
      {canCall && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label={`Voice call ${name}`}
            title={callsDisabled ? VIEW_ONLY_TITLE : `Voice call ${firstName} only`}
            disabled={callsDisabled}
            aria-disabled={callsDisabled}
            onClick={() => startCall('audio')}
          >
            <Phone />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label={`Video call ${name}`}
            title={callsDisabled ? VIEW_ONLY_TITLE : `Video call ${firstName} only`}
            disabled={callsDisabled}
            aria-disabled={callsDisabled}
            onClick={() => startCall('video')}
          >
            <Video />
          </Button>
        </>
      )}
    </div>
  );
};

export default ProjectTeamMemberRow;
