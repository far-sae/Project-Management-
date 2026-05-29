import React from 'react';
import { Plus, Upload, Building2, Users as UsersIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface AccountsLandingProps {
  canCreate: boolean;
  onCreate: () => void;
  onImport: () => void;
}

/**
 * Zoho-style "Who are your customers?" empty state shown on the Accounts
 * tab when the workspace has zero accounts yet. The B2B option creates an
 * account; the B2C "End users" option keeps the module enabled but nudges
 * the rep to capture individuals via Contacts/Leads instead.
 */
export const AccountsLanding: React.FC<AccountsLandingProps> = ({
  canCreate, onCreate, onImport,
}) => (
  <div className="grid place-items-center py-10">
    <Card className="max-w-3xl w-full">
      <CardContent className="pt-8 pb-8">
        <h2 className="text-xl md:text-2xl font-semibold text-center">
          Who are your customers?
        </h2>
        <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-xl mx-auto">
          Some businesses provide services to other businesses, and some
          work directly with end users. Each Account is one organization
          or department you do business with.
        </p>

        <div className="grid gap-6 mt-8 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-5 flex flex-col">
            <Badge variant="outline" className="self-start text-[10px] mb-2">
              <Building2 className="w-3 h-3 mr-1" /> Other businesses
            </Badge>
            <p className="text-sm text-muted-foreground flex-1">
              You sell to companies. Each Account stores firmographics, the
              people who work there, and the deals in flight.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {canCreate ? (
                <>
                  <Button onClick={onCreate}>
                    <Plus className="w-4 h-4 mr-2" /> Create an Account
                  </Button>
                  <Button variant="outline" onClick={onImport}>
                    <Upload className="w-4 h-4 mr-2" /> Import Accounts
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground text-center">
                  Ask an admin or owner to add accounts.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card/60 p-5 flex flex-col">
            <Badge variant="outline" className="self-start text-[10px] mb-2">
              <UsersIcon className="w-3 h-3 mr-1" /> End users
            </Badge>
            <p className="text-sm text-muted-foreground flex-1">
              You sell to individuals. Account-level fields are still useful
              for grouping families, employer info, or households — but most
              of your day lives in Contacts and Leads.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <p className="text-[11px] text-muted-foreground">
                Capture individuals as Contacts (attached to a household /
                family / shell account) or as Leads before they convert.
                The Accounts module stays on — you simply use it lightly.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);
