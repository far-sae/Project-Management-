// "Each workspace runs on its own": the organisation's workspaces, what each does alone, and the way to its rules.
import React from 'react';
import type { WorkspaceRow } from '../../../../api/_automation/shared/types';
import { aloneWords, projectsWords } from '@/lib/automation/rules';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, HEAD_ROW, ROW, TD, TH } from '@/components/signroom/billing/shared';

interface Props {
  /** Null until the first answer. */
  rows: WorkspaceRow[] | null;
  loading: boolean;
  /** The server's sentence when the list could not be loaded. */
  error: string;
  /** The workspace whose rules are on the page. */
  currentId: string;
  /** Another workspace's rules, or the place where one is set up. */
  onOpen: (row: WorkspaceRow) => void;
  onRetry: () => void;
}

const NOTE = "Own agents, own pipeline, own mailbox, own limit. One never touches another's leads or projects.";

export const WorkspacesCard: React.FC<Props> = ({ rows, loading, error, currentId, onOpen, onRetry }) => (
  <Card title="Each workspace runs on its own" action={<span className="text-xs text-muted-foreground">{NOTE}</span>}>
    {error ? (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    ) : !rows ? (
      loading && (
        // About the height of the heading row and three workspaces, so the rules below do not jump.
        <div role="status" aria-label="Loading the workspaces" className="pt-8">
          {[0, 1, 2].map((n) => (
            <div key={n} className="flex h-11 items-center border-t border-border px-3">
              <div className="h-4 w-full max-w-md rounded-md bg-muted motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      )
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={TH}>Workspace</th>
              <th scope="col" className={TH}>Automation</th>
              <th scope="col" className={TH}>How much it does alone</th>
              <th scope="col" className={TH}>Projects it created</th>
              <th scope="col" className={TH}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const on = row.setUp && row.enabled;
              return (
                <tr key={row.workspaceId} className={ROW}>
                  <td className={`${TD} font-medium text-foreground`}>{row.name}</td>
                  <td className={TD}>
                    {on ? <StatusPill tone="success">On</StatusPill> : <StatusPill tone="muted" dot={false}>Off</StatusPill>}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>{aloneWords(row)}</td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>{projectsWords(row.setUp ? row.projectsThisMonth : 0)}</td>
                  <td className={`${TD} text-right`}>
                    {!row.setUp ? (
                      <Button type="button" variant="outline" size="sm" aria-label={`Set up automation in ${row.name}`} onClick={() => onOpen(row)}>
                        Set up
                      </Button>
                    ) : row.workspaceId === currentId ? (
                      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">Editing now</span>
                    ) : (
                      <Button type="button" variant="outline" size="sm" aria-label={`Open rules for ${row.name}`} onClick={() => onOpen(row)}>
                        Open rules
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

export default WorkspacesCard;
