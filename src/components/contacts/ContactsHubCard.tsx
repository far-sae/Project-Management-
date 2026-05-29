import React from 'react';
import {
  Plus, Upload, Building2, UserPlus, GitBranch, Star,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ContactsHubCardProps {
  contactsCount: number;
  accountsCount: number;
  leadsCount: number;
  primaryCount: number;
  canCreate: boolean;
  scopeLabel?: string | null;

  onCreateContact: () => void;
  onImportContacts: () => void;
  onGoToLeads: () => void;
  onGoToAccounts: () => void;
  onGoToPipeline: () => void;
  onShowPrimary: () => void;
}

/**
 * Zoho-style hub card at the top of the Contacts tab. Mirrors the Home /
 * Leads / Accounts pattern so reps land on a consistent "Choose what you
 * want to do next" panel whichever module they enter through.
 */
export const ContactsHubCard: React.FC<ContactsHubCardProps> = ({
  contactsCount, accountsCount, leadsCount, primaryCount, canCreate, scopeLabel,
  onCreateContact, onImportContacts, onGoToLeads, onGoToAccounts,
  onGoToPipeline, onShowPrimary,
}) => (
  <Card>
    <CardContent className="pt-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scopeLabel ?? 'All contacts'}
          </p>
          <h2 className="text-lg font-semibold mt-1">
            Choose what you want to do next
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Contacts are the people you know at each account. Add them one
            by one, import a spreadsheet, send a personalised email, and
            jump back to the lead → account → deal funnel.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">
            {contactsCount} contact{contactsCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">
            {accountsCount} account{accountsCount === 1 ? '' : 's'}
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
            title="Add one contact"
            hint="Best for a single new person at an existing account."
            onClick={onCreateContact}
          />
        )}
        {canCreate && (
          <HubTile
            icon={Upload}
            title="Import Contacts"
            hint="Upload a CSV that lists the people at each account."
            onClick={onImportContacts}
          />
        )}
        <HubTile
          icon={Star}
          title={`Show primary contacts (${primaryCount})`}
          hint="Jump to the single point of contact at each account."
          onClick={onShowPrimary}
          disabled={primaryCount === 0}
        />
        <HubTile
          icon={UserPlus}
          title={`View leads (${leadsCount})`}
          hint="Jump to the prospects waiting to be qualified."
          onClick={onGoToLeads}
        />
        <HubTile
          icon={Building2}
          title={`View accounts (${accountsCount})`}
          hint="Jump to the companies your contacts work at."
          onClick={onGoToAccounts}
        />
        <HubTile
          icon={GitBranch}
          title="Track sales"
          hint="Move deals through stages and see totals."
          onClick={onGoToPipeline}
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
