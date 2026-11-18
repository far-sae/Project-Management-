import React from 'react';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { cn } from '@/lib/utils';

/** A message bubble whose web addresses / emails are clickable links. */
export const ChatBubble: React.FC<{ text: string; mine: boolean; grouped?: boolean }> = ({
  text,
  mine,
  grouped,
}) => (
  <div
    className={cn(
      'whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-5',
      mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
      // The corner nearest the sender is tightened on the first bubble of a run.
      !grouped && (mine ? 'rounded-tr' : 'rounded-tl'),
    )}
  >
    <LinkifiedText
      text={text}
      linkClassName={mine ? 'text-primary-foreground decoration-primary-foreground/50 hover:decoration-primary-foreground' : undefined}
    />
  </div>
);

interface ProjectChatMessageProps {
  mine: boolean;
  /** Follow-up from the same person within a few minutes: no avatar / name. */
  grouped: boolean;
  authorLabel: string;
  photoURL?: string;
  createdAt: Date;
  /** Online / last-seen indicator next to the name. */
  presence?: React.ReactNode;
  /** Hover actions (e.g. add reaction). */
  actions?: React.ReactNode;
  /** The bubble (or a call-recording card). */
  content: React.ReactNode;
  /** Attachments and reactions under the bubble. */
  footer?: React.ReactNode;
}

/**
 * One row in the project chat. Teams style: other people's messages sit on
 * the left with an avatar on the first message of a run; mine sit on the
 * right with no avatar. Times show on the first message and on hover.
 */
export const ProjectChatMessage: React.FC<ProjectChatMessageProps> = ({
  mine,
  grouped,
  authorLabel,
  photoURL,
  createdAt,
  presence,
  actions,
  content,
  footer,
}) => (
  <div className={cn('group/msg flex gap-2', mine && 'justify-end', grouped ? 'mt-0.5' : 'mt-3')}>
    {!mine &&
      (grouped ? (
        <span aria-hidden className="w-7 shrink-0" />
      ) : (
        <Avatar data-testid="chat-avatar" className="h-7 w-7 shrink-0">
          <AvatarImage src={photoURL} alt="" />
          <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
            {(authorLabel || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
    <div className={cn('relative min-w-0 max-w-[80%]', mine && 'flex flex-col items-end')}>
      {!grouped && (
        <div
          className={cn(
            'mb-0.5 flex min-w-0 items-baseline gap-1.5 text-xs leading-4 text-muted-foreground',
            mine && 'justify-end',
          )}
        >
          {!mine && (
            <span className="truncate text-xs font-semibold text-foreground">{authorLabel}</span>
          )}
          {!mine && presence}
          <time className="shrink-0 tabular-nums" dateTime={createdAt.toISOString()}>
            {format(createdAt, 'p')}
          </time>
        </div>
      )}
      <div className={cn('relative flex items-center gap-1', mine && 'flex-row-reverse')}>
        <div className="min-w-0">{content}</div>
        {actions && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/msg:opacity-100 [@media(hover:none)]:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {footer}
    </div>
  </div>
);
