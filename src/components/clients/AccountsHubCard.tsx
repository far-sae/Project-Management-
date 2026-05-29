import React from 'react';
import {
  Plus, Upload, Users as UsersIcon, UserPlus, GitBranch, ListTodo,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface AccountsHubCardProps {
  accountsCount: number;
  contactsCount: number;
  leadsCount: number;
  canCreate: boolean;
  scopeLabel?: string | null;

  onCreateAccount: () => void;
  onImportAccounts: () => void;
  onGoToContacts: () => void;
  onGoToLeads: () => void;
  onGoToPipeline: () => void;
  onGoToTasks: () => void;
}

/**
 * Zoho-style hub at the top of the Accounts tab. Mirrors the Leads and
 * Contacts hubs so reps land on a consistent "Choose what you want to do
 * next" panel whichever module they enter through.
 */
export const AccountsHubCard: React.FC<AccountsHubCardProps> = ({
  accountsCount, contactsCount, leadsCount, canCreate, scopeLabel,
  onCreateAccount, onImportAccounts, onGoToContacts, onGoToLeads,
  onGoToPipeline, onGoToTasks,
}) => (
  <Card>
    <CardContent className="pt-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scopeLabel ?? 'All accounts'}
          </p>
          <h2 className="text-lg font-semibold mt-1">
            Choose what you want to do next
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Accounts are the companies (or households) you work with. Add
            them one by one, import a spreadsheet, then track follow-ups,
            deals, and contacts from here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">
            {accountsCount} account{accountsCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">
            {contactsCount} contact{contactsCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">
            {leadsCount} lead{leadsCount === 1 ? '' : 's'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mt-4">
        {canCreate && (
          <HubTile
            icon={Plus}
            title="Add one account"
            hint="Best for a single new company or household."
            onClick={onCreateAccount}
          />
        )}
        {canCreate && (
          <HubTile
            icon={Upload}
            title="Import Accounts"
            hint="Upload CSV files, including Apollo / HubSpot exports."
            onClick={onImportAccounts}
          />
        )}
        <HubTile
          icon={UsersIcon}
          title={`View contacts (${contactsCount})`}
          hint="Jump to the people you know at each account."
          onClick={onGoToContacts}
        />
        <HubTile
          icon={UserPlus}
          title={`View leads (${leadsCount})`}
          hint="Jump to prospects waiting to be qualified."
          onClick={onGoToLeads}
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
          hint="See the next task for every account."
          onClick={onGoToTasks}
        />
      </div>
    </CardContent>
  </Card>
);

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
