// Workspace rules: how much the agents may do alone in one workspace, their limits, and the project a won deal becomes.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { WorkspaceRow } from '../../../api/_automation/shared/types';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { AutonomyCard } from '@/components/automation/rules/AutonomyCard';
import { EnabledCard } from '@/components/automation/rules/EnabledCard';
import { LimitsCard } from '@/components/automation/rules/LimitsCard';
import { ProjectCard } from '@/components/automation/rules/ProjectCard';
import { useWorkspaceRules } from '@/components/automation/rules/useWorkspaceRules';
import { WorkspacesCard } from '@/components/automation/rules/WorkspacesCard';
import { EmptyState, PickWorkspace } from '@/components/signroom/billing/shared';
import { UnsavedGuard } from '@/components/signroom/billing/UnsavedGuard';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const OVERVIEW = '/crm/automation';
const UNSAVED = 'Your changes to the workspace rules';
const BOX = 'rounded-lg border border-border bg-card';
/** Two columns side by side where each has room (about 32rem), one under the other where not. */
const COLUMNS = 'flex min-w-0 flex-wrap items-start gap-4';
const COLUMN = 'flex min-w-0 flex-1 basis-[32rem] flex-col gap-4';

/** Holds the place of the rules while they load, at about the size they will have. */
const RulesSkeleton: React.FC = () => (
  <div role="status" aria-label="Loading the workspace rules" className={COLUMNS}>
    <div className={COLUMN}>
      {['h-28', 'h-80', 'h-96'].map((height) => (
        <div key={height} className={`${BOX} ${height} p-4`}>
          <div className="h-4 w-48 max-w-full rounded-md bg-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
    <div className={COLUMN}>
      <div className={`${BOX} h-96 p-4`}>
        <div className="h-4 w-64 max-w-full rounded-md bg-muted motion-safe:animate-pulse" />
      </div>
    </div>
  </div>
);

export const AutomationRulesPage: React.FC = () => {
  const state = useWorkspaceRules();
  const { workspaceId, workspaceName, list, view, rules, form, set, dirty, saving, problems, notice } = state;
  const { select } = useSelectedWorkspace();
  const navigate = useNavigate();
  const place = workspaceName || 'this workspace';
  /** The workspace asked for while there are unsaved changes: the question is open. */
  const [asking, setAsking] = useState<WorkspaceRow | null>(null);
  /** The workspace to go to as soon as nothing unsaved is left. */
  const [going, setGoing] = useState<WorkspaceRow | null>(null);

  /** Another workspace's rules stay on this page; one that is not set up goes to where it is set up. */
  const go = useCallback((row: WorkspaceRow) => {
    if (row.workspaceId !== workspaceId) select(row.workspaceId);
    if (!row.setUp) navigate(OVERVIEW);
  }, [workspaceId, select, navigate]);

  // After "Leave": the changes are dropped first, so leaving is not asked about a second time.
  useEffect(() => {
    if (!going || dirty) return;
    setGoing(null);
    go(going);
  }, [going, dirty, go]);

  const editable = view.phase === 'ready' && !view.readOnly;
  const showList = Boolean(list.error || (list.rows ? list.rows.length > 0 : list.loading));

  return (
    <AutomationPage
      title="Workspace rules"
      description={`How much the agents may do alone in ${place}, their limits, and the project a won deal becomes.`}
      actions={editable ? (
        <>
          <span role="status" className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : ''}</span>
          <Button type="button" disabled={!dirty || saving} onClick={() => void state.save()}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Save rules
          </Button>
        </>
      ) : undefined}
    >
      {!workspaceId ? (
        <PickWorkspace what="its automation rules" />
      ) : (
        <>
          <UnsavedGuard when={dirty} what={UNSAVED} />
          {notice && <p role="alert" className={`${BOX} px-4 py-3 text-sm text-destructive`}>{notice}</p>}

          {showList && (
            <WorkspacesCard
              rows={list.rows}
              loading={list.loading}
              error={list.error}
              currentId={workspaceId}
              onOpen={(row) => (dirty ? setAsking(row) : go(row))}
              onRetry={() => void state.reloadList()}
            />
          )}

          {view.phase === 'loading' ? (
            <RulesSkeleton />
          ) : view.phase === 'failed' ? (
            view.quiet ? (
              <EmptyState>{view.sentence}</EmptyState>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
                <p role="alert" className="max-w-md text-sm text-destructive">{view.sentence}</p>
                <Button type="button" variant="outline" onClick={() => void state.reload()}>Try again</Button>
              </div>
            )
          ) : view.phase === 'notSetUp' ? (
            <EmptyState action={<Button asChild variant="outline"><Link to={OVERVIEW}>Set it up on the overview</Link></Button>}>
              Automation is not set up in {place} yet.
            </EmptyState>
          ) : form && rules && (
            <div className="flex min-w-0 flex-col gap-4">
              {view.readOnly && (
                <p className={`${BOX} px-4 py-3 text-sm text-muted-foreground`}>Only a workspace owner or admin can change these rules.</p>
              )}
              <div className={COLUMNS}>
                <div className={COLUMN}>
                  <EnabledCard
                    place={place} enabled={form.enabled} disabled={view.readOnly || saving}
                    onChange={(enabled) => set('enabled', enabled)}
                  />
                  <AutonomyCard
                    place={place} value={form.autonomy} disabled={view.readOnly || saving}
                    alreadyFull={rules.autonomy === 'full'}
                    onChange={(autonomy) => set('autonomy', autonomy)}
                  />
                  <LimitsCard form={form} set={set} problems={problems} locked={view.readOnly || saving} />
                </div>
                <div className={COLUMN}>
                  <ProjectCard
                    form={form} set={set} problems={problems} locked={view.readOnly || saving}
                    place={place} people={view.people} readOnly={view.readOnly}
                  />
                </div>
              </div>
            </div>
          )}

          <AlertDialog open={asking !== null} onOpenChange={(open) => { if (!open) setAsking(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
                <AlertDialogDescription>{UNSAVED} have not been saved. If you leave now they are lost.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Stay</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { state.discard(); setGoing(asking); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Leave
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </AutomationPage>
  );
};

export default AutomationRulesPage;
