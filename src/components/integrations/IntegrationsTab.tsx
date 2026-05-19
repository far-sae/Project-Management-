import React from 'react';
import { ProviderCard } from './ProviderCard';
import { TelegramConnectCard } from './TelegramConnectCard';
import { WhatsAppConnectCard } from './WhatsAppConnectCard';
import { providerOrder, providerDisplay } from '@/services/integrations/providers';
import { useOrganization } from '@/context/OrganizationContext';

export const IntegrationsTab: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  const currentOrgId = organization?.organizationId ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Connected services</h3>
        <p className="text-sm text-muted-foreground">
          Link external tools so they can power task workflows. Each connection
          uses OAuth — TaskCalendar never sees your password.
        </p>
      </div>
      <div className="grid gap-3">
        {providerOrder.map((id) => {
          const display = providerDisplay[id];
          // Org-level providers (Slack) can only be connected by admins.
          // Non-admins still see the card so they know the connection exists,
          // but the Connect button is disabled.
          const canConnect = display.orgLevel ? canManageSettings : true;
          return (
            <ProviderCard
              key={id}
              provider={id}
              orgId={display.orgLevel ? currentOrgId : null}
              canConnect={canConnect}
            />
          );
        })}
        <TelegramConnectCard />
        <WhatsAppConnectCard />
      </div>
    </div>
  );
};
