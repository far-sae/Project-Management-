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
  className?: string;
  disabled?: boolean;
}

export function EmojiPickerButton({
  value,
  onChange,
  className,
  disabled = false,
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);

  const insertEmoji = (emoji: string) => {
    onChange(value + emoji);
  };

  return (
    <DropdownMenu open={disabled ? false : open} onOpenChange={disabled ? () => {} : setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn('h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-200', className)}
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
              className="text-lg p-1.5 rounded hover:bg-gray-100"
              onClick={() => {
                insertEmoji(emoji);
                setOpen(false);
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
