import React from 'react';
import { Smile } from 'lucide-react';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** The reactions offered first, before the full emoji list. */
export const CHAT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** emoji → the ids of the people who reacted with it. */
export type ReactionsOfMessage = Record<string, string[]>;

/** Groups reaction rows by message, then by emoji, keeping the order they were added in. */
export function groupReactions(
  rows: ReadonlyArray<{ messageId: string; userId: string; emoji: string }>,
): Record<string, ReactionsOfMessage> {
  const out: Record<string, ReactionsOfMessage> = {};
  for (const r of rows) {
    const ofMessage = (out[r.messageId] ??= {});
    (ofMessage[r.emoji] ??= []).push(r.userId);
  }
  return out;
}

interface ReactionButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  /** My own messages sit on the right, so their menu opens towards the left. */
  mine: boolean;
  disabled?: boolean;
}

/** The smiley beside a message: quick reactions first, the full emoji list under them. */
export const ReactionButton: React.FC<ReactionButtonProps> = ({ open, onOpenChange, onPick, mine, disabled }) => (
  <Popover modal={false} open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Add reaction"
        title="React"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align={mine ? 'end' : 'start'}
      sideOffset={6}
      className="flex w-auto max-w-[264px] flex-wrap gap-0.5 p-2"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap justify-center gap-0.5">
        {CHAT_QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React with ${emoji}`}
            className="min-w-[2.25rem] rounded-md p-1.5 text-[22px] leading-none hover:bg-secondary"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onPick(emoji);
              onOpenChange(false);
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="mt-1 flex w-full justify-center border-t border-border pt-2">
        <EmojiPickerButton
          value=""
          onChange={() => {}}
          nested
          onPickEmoji={(emoji) => {
            onPick(emoji);
            onOpenChange(false);
          }}
          disabled={disabled}
        />
      </div>
    </PopoverContent>
  </Popover>
);

/** Reaction count under a message: a 22px bordered pill. */
const CHIP =
  'inline-flex h-[22px] items-center gap-1 rounded-full border border-border bg-card px-2 text-xs font-medium text-muted-foreground';
/** …tinted when you are one of the people who reacted. */
const CHIP_MINE = 'border-primary/40 bg-primary-soft text-primary-soft-foreground';

interface ReactionChipsProps {
  reactions: ReactionsOfMessage | undefined;
  selfId: string | undefined;
  mine: boolean;
  /** Left out for people who can only read: the counts show but cannot be clicked. */
  onToggle?: (emoji: string) => void;
}

/** The counts under a message. Clicking one adds your reaction or takes it back. */
export const ReactionChips: React.FC<ReactionChipsProps> = ({ reactions, selfId, mine, onToggle }) => {
  const entries = Object.entries(reactions ?? {});
  if (entries.length === 0) return null;
  return (
    <div className={cn('mt-1 flex max-w-full flex-wrap gap-1', mine && 'justify-end')}>
      {entries.map(([emoji, userIds]) => {
        const reacted = userIds.includes(selfId ?? '');
        const chipClass = cn(CHIP, reacted && CHIP_MINE);
        const title = `${userIds.length} reaction${userIds.length === 1 ? '' : 's'}`;
        const body = (
          <>
            <span className="text-xs leading-none">{emoji}</span>
            <span className="tabular-nums">{userIds.length}</span>
          </>
        );
        return onToggle ? (
          <button
            key={emoji}
            type="button"
            className={cn(chipClass, 'transition-colors hover:bg-secondary')}
            aria-pressed={reacted}
            aria-label={`${emoji} ${userIds.length}`}
            onClick={() => onToggle(emoji)}
            title={title}
          >
            {body}
          </button>
        ) : (
          <span key={emoji} className={cn(chipClass, 'cursor-default')} title={title}>
            {body}
          </span>
        );
      })}
    </div>
  );
};
