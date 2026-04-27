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
      toast.error(err instanceof Error ? err.message : 'Could not add task');
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
          'group w-full flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-md',
          'text-xs font-medium text-muted-foreground',
          'border border-dashed border-border hover:border-foreground/30 hover:text-foreground hover:bg-secondary/40',
          'transition-colors',
        )}
      >
        <Plus className="w-3.5 h-3.5" />
        Add task
      </button>
    );
  }

  return (
    <div className="mb-2 rounded-md border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-primary/40">
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
        <span className="text-[10px] text-muted-foreground">
          Enter to add &middot; Esc to cancel
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={close}
            disabled={submitting}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs"
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
