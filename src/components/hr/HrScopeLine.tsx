import React from 'react';
import { cn } from '@/lib/utils';
import type { HrWorkspacePeople } from '@/hooks/useHrWorkspacePeople';

/**
 * The short line that says whose HR data is showing: "Showing Studio",
 * "Showing people with no workspace" or "Showing the whole company". Shows
 * nothing while HR is not split by workspace (before migration 185).
 */
export const HrScopeLine: React.FC<{
  scope: Pick<HrWorkspacePeople, 'label' | 'error'>;
  className?: string;
}> = ({ scope, className }) => {
  if (scope.error) {
    return (
      <p role="alert" className={cn('text-xs text-destructive', className)}>
        Could not check who is in this workspace, so this shows the whole company. Reload to try again.
      </p>
    );
  }
  if (!scope.label) return null;
  return <p className={cn('truncate text-xs text-muted-foreground', className)}>{scope.label}</p>;
};

export default HrScopeLine;
