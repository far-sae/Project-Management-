// Asks before leaving a page that has unsaved changes.
import React, { useContext, useEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  /** True while there is something to lose. */
  when: boolean;
  /** What would be lost, e.g. "Your changes to this invoice". */
  what: string;
}

/**
 * Stops a link or the back button while `when` is true and asks first, and
 * warns before the tab is closed or reloaded. In-app links can only be held
 * back under the app's own router; anywhere else only the tab warning applies.
 */
export const UnsavedGuard: React.FC<Props> = ({ when, what }) => {
  const inAppRouter = useContext(UNSAFE_DataRouterContext) !== null;

  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);

  return inAppRouter ? <LinkGuard when={when} what={what} /> : null;
};

const LinkGuard: React.FC<Props> = ({ when, what }) => {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);
  const blocked = blocker.state === 'blocked';
  /** Set by "Leave", so closing the question does not also cancel the move. */
  const leaving = useRef(false);

  // Saved while the question was open: nothing left to lose, so carry on.
  useEffect(() => {
    if (!blocked) leaving.current = false;
    else if (!when) blocker.proceed?.();
  }, [blocked, when]);

  return (
    <AlertDialog open={blocked} onOpenChange={(open) => { if (!open && !leaving.current && blocker.state === 'blocked') blocker.reset(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>{what} have not been saved. If you leave now they are lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { leaving.current = true; if (blocker.state === 'blocked') blocker.proceed(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default UnsavedGuard;
