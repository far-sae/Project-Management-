import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface TextPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** The label of the one input. */
  label: string;
  initialValue?: string;
  /** One line (a name) or several (a reason). */
  multiline?: boolean;
  maxLength?: number;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Called with the trimmed text; it is never empty. */
  onConfirm: (value: string) => void;
}

/** Asks for one piece of text before an action goes ahead: a reason, or a name. */
export const TextPromptDialog: React.FC<TextPromptDialogProps> = ({
  open, onOpenChange, title, description, label, initialValue = '', multiline = false, maxLength,
  confirmLabel, cancelLabel = 'Cancel', destructive = false, busy = false, onConfirm,
}) => {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);
  const text = value.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (text && !busy) onConfirm(text);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-text`}>{label}</Label>
            {multiline ? (
              <Textarea
                id={`${id}-text`} rows={3} value={value} maxLength={maxLength} disabled={busy} autoFocus
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <Input
                id={`${id}-text`} value={value} maxLength={maxLength} disabled={busy} autoFocus
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{cancelLabel}</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || !text}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TextPromptDialog;
