import { publicMessage } from '@/lib/publicError';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface InlineAddCardProps {
  onSubmit: (title: string) => Promise<void> | void;
  placeholder?: string;
}

/**
 * Top-of-column "+ Add task" affordance that turns into an inline
 * editor on click. Submits with Enter, cancels on Escape or blur
 * with empty text. Used by KanbanColumn to bypass the modal for
 * the common case of "just add a quick task".
 */
export const InlineAddCard: React.FC<InlineAddCardProps> = ({
  onSubmit,
  placeholder = 'Task title…',
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setValue('');
  }, []);

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      close();
      return;
    }
    try {
      setSubmitting(true);
      await onSubmit(trimmed);
      setValue('');
      // keep editor open so users can chain-add tasks
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      toast.error(publicMessage(err, 'Could not add task'));
    } finally {
      setSubmitting(false);
    }
  }, [value, onSubmit, close]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group mb-2 flex h-8 w-full items-center gap-1.5 rounded-md px-2',
          'text-sm font-medium text-muted-foreground',
          'hover:bg-foreground/[0.06] hover:text-foreground',
          'transition-colors',
        )}
      >
        <Plus className="h-4 w-4" />
        Add task
      </button>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-border bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground p-2.5 outline-none border-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
        <span className="text-[0.6875rem] text-muted-foreground">
          Enter to add &middot; Esc to cancel
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={close}
            disabled={submitting}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            className="px-3"
            onClick={submit}
            disabled={!value.trim() || submitting}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InlineAddCard;
