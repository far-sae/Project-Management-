import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

interface LoadFailureProps {
  /** The sentence to show. Already resolved by `loadFailureMessage`. */
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/**
 * What a screen shows when its data did not load.
 *
 * It exists because the screens used to show nothing at all: a failed request
 * left the list empty and the empty state rendered "No prospects yet", so a
 * broken screen and a genuinely empty one were indistinguishable — and the
 * only trace of the failure was a toast that had already gone.
 *
 * Two rules follow from that, and they are the whole component:
 *
 *   * It PERSISTS. A toast is the wrong shape for a failure that is still
 *     true: it disappears while the problem does not.
 *   * An empty state may only be rendered after a request that SUCCEEDED.
 *     That is the caller's half of the contract, and it is why every screen
 *     using this keeps its error in state rather than only reporting it.
 */
export const LoadFailure: React.FC<LoadFailureProps> = ({ message, onRetry, retrying }) => (
  <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            This didn&apos;t load
          </p>
          {/* The message, not a summary of it: where it names a migration, that
              sentence is the entire answer and paraphrasing it would lose the
              number somebody needs. */}
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <RefreshCw className="mr-2 h-4 w-4" />}
          Try again
        </Button>
      </div>
    </div>
  </div>
);
