import React from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProjectChatToggleProps {
  open: boolean;
  /** Messages from other people since the chat was last open. */
  unread: number;
  onToggle: () => void;
}

/**
 * The Chat button in the project header. It opens the project chat as a
 * panel beside the board, so nothing has to float on top of the board.
 */
export const ProjectChatToggle: React.FC<ProjectChatToggleProps> = ({ open, unread, onToggle }) => {
  const label = open
    ? 'Close project chat'
    : unread > 0
      ? `Open project chat, ${unread} unread`
      : 'Open project chat';
  return (
    <Button
      type="button"
      variant={open ? 'secondary' : 'outline'}
      className="shrink-0"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={onToggle}
    >
      <MessageSquare aria-hidden />
      <span className="hidden sm:inline">Chat</span>
      {!open && unread > 0 && (
        <span
          aria-hidden
          className="min-w-[18px] rounded-full bg-primary px-[5px] text-center text-[0.6875rem] font-semibold leading-[18px] text-primary-foreground tabular-nums"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Button>
  );
};

export default ProjectChatToggle;
