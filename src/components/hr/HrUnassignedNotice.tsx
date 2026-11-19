import React from 'react';
import { Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hrUnassignedNotice } from '@/lib/hrWorkspace';

/**
 * Shown at the top of HR when a workspace is selected and some people are not
 * in any workspace yet. They show only under "Unassigned" and "All
 * workspaces", so without this they would seem to have disappeared.
 */
export const HrUnassignedNotice: React.FC<{
  count: number;
  workspaceName: string;
  /** Owners and admins can add them all to the selected workspace. */
  canAssign: boolean;
  busy?: boolean;
  onAddAll: () => void;
  onReview: () => void;
}> = ({ count, workspaceName, canAssign, busy = false, onAddAll, onReview }) => (
  <div
    role="status"
    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-2.5"
  >
    <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
      <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="tabular-nums">{hrUnassignedNotice(count)}</span>
    </p>
    <div className="flex flex-wrap items-center gap-2">
      {canAssign && (
        <Button type="button" size="sm" variant="outline" onClick={onAddAll} disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Add them to {workspaceName}
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onReview}>
        Review
      </Button>
    </div>
  </div>
);

export default HrUnassignedNotice;
