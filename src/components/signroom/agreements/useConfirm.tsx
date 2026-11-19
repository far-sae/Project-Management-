import React, { useCallback, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmQuestion {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * A yes/no question in the app's own dialog, awaited like a function call:
 * `if (await ask({...})) …`. Render `dialog` once in the component.
 */
export function useConfirm(): { ask: (question: ConfirmQuestion) => Promise<boolean>; dialog: React.ReactNode } {
  const [question, setQuestion] = useState<ConfirmQuestion | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);

  const settle = useCallback((yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    setQuestion(null);
  }, []);

  const ask = useCallback((next: ConfirmQuestion) => new Promise<boolean>((resolve) => {
    // A second question while one is open answers the first with "no".
    answer.current?.(false);
    answer.current = resolve;
    setQuestion(next);
  }), []);

  const dialog = (
    <AlertDialog open={question !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{question?.title}</AlertDialogTitle>
          <AlertDialogDescription>{question?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{question?.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={question?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {question?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { ask, dialog };
}
