import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😂', '👍', '👎', '❤️', '🔥', '✨',
  '✅', '❌', '⭐', '📌', '💡', '🚀', '📝', '📎', '⏰', '🎯',
  '👏', '🙏', '🤔', '😊', '😎', '👍🏻', '👀', '💪', '🙌', '👋',
];

interface EmojiPickerButtonProps {
  value: string;
  onChange: (value: string) => void;
  /** When set, picking an emoji invokes this only (e.g. reactions) instead of appending to value. */
  onPickEmoji?: (emoji: string) => void;
  /** Use inside Dialog/Popover so the parent layer does not steal focus and dismiss (Radix modal stacking). */
  nested?: boolean;
  className?: string;
  disabled?: boolean;
}

export function EmojiPickerButton({
  value,
  onChange,
  onPickEmoji,
  nested = false,
  className,
  disabled = false,
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);

  const insertEmoji = (emoji: string) => {
    if (onPickEmoji) {
      onPickEmoji(emoji);
      setOpen(false);
      return;
    }
    onChange(value + emoji);
  };

  return (
    <DropdownMenu
      modal={!nested}
      open={disabled ? false : open}
      onOpenChange={disabled ? () => {} : setOpen}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            'h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted',
            className,
          )}
        >
          <Smile className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-2">
        <div className="grid grid-cols-5 gap-1">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="text-lg p-1.5 rounded-md hover:bg-muted"
              onClick={() => {
                insertEmoji(emoji);
                if (!onPickEmoji) setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
