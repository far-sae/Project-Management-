import React from 'react';
import {
  Plus, Upload, Building2, GitBranch, ListTodo, Repeat,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface LeadsHubCardProps {
  /** Total leads in scope (workspace-filtered if applicable). */
  leadsCount: number;
  /** Total accounts in scope, so the "View accounts" tile shows the
   *  count exactly like the Accounts page does. */
  accountsCount: number;
  /** Whether the rep has create permission — viewers hide the create
   *  tiles and see read-only navigation tiles instead. */
  canCreate: boolean;
  /** Optional badge — when "All workspaces" is selected we surface that
   *  so the rep knows the counts span every workspace, not just the
   *  current one. */
  scopeLabel?: string | null;

  onCreateLead: () => void;
  onImportLeads: () => void;
  onGoToAccounts: () => void;
  onGoToPipeline: () => void;
  onGoToTasks: () => void;
  /** When clicking the "Convert qualified leads" tile, jump back into
   *  the leads table so the user can pick which lead to convert. We
   *  expose the click as a no-op anchor if it isn't useful in some
   *  contexts (parent can pass () => undefined or a real scroller). */
  onConvertHelp: () => void;
}

/**
 * Zoho-style "Start here" hub card that sits at the top of the Leads tab.
 * Mirrors the layout the Accounts tab uses so reps see a consistent
 * landing pattern whichever module they enter through, and gives Leads
 * top-level cross-links into Accounts / Pipeline / Tasks so the lead
 * → account → deal funnel is one click apart.
 */
export const LeadsHubCard: React.FC<LeadsHubCardProps> = ({
  leadsCount, accountsCount, canCreate, scopeLabel,
  onCreateLead, onImportLeads, onGoToAccounts, onGoToPipeline,
  onGoToTasks, onConvertHelp,
}) => {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {scopeLabel ? scopeLabel : 'All leads'}
            </p>
            <h2 className="text-lg font-semibold mt-1">
              Choose what you want to do next
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Leads are prospects you haven't qualified yet. Add them one by
              one, import a spreadsheet, convert qualified ones into
              Accounts, and track the sales pipeline from here.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">
              {leadsCount} lead{leadsCount === 1 ? '' : 's'}
            </Badge>
            <Badge variant="outline">
              {accountsCount} account{accountsCount === 1 ? '' : 's'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mt-4">
          {canCreate && (
            <HubTile
              icon={Plus}
              title="Add one lead"
              hint="Best for a single new prospect you talked to."
              onClick={onCreateLead}
            />
          )}
          {canCreate && (
            <HubTile
              icon={Upload}
              title="Import Leads"
              hint="Upload CSV files, including Apollo / HubSpot exports."
              onClick={onImportLeads}
            />
          )}
          <HubTile
            icon={Repeat}
            title="Convert qualified leads"
            hint="Promote a hot lead into an Account + Contact in one step."
            onClick={onConvertHelp}
            disabled={leadsCount === 0}
          />
          <HubTile
            icon={Building2}
            title={`View accounts (${accountsCount})`}
            hint="Jump to the companies you already work with."
            onClick={onGoToAccounts}
          />
          <HubTile
            icon={GitBranch}
            title="Track sales"
            hint="Move deals through stages and see totals."
            onClick={onGoToPipeline}
          />
          <HubTile
            icon={ListTodo}
            title="Follow up"
            hint="See the next task for every lead and account."
            onClick={onGoToTasks}
          />
        </div>
      </CardContent>
    </Card>
  );
};

const HubTile: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon: Icon, title, hint, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={
      'rounded-lg border bg-background p-3 text-left transition-colors ' +
      (disabled
        ? 'opacity-50 cursor-not-allowed'
        : 'hover:border-primary/50 hover:bg-muted/40')
    }
  >
    <Icon className="w-4 h-4 text-primary mb-2" />
    <p className="font-medium text-sm">{title}</p>
    <p className="text-xs text-muted-foreground mt-1">{hint}</p>
  </button>
);
