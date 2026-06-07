import React from 'react';
import { ProviderCard } from './ProviderCard';
import { TelegramConnectCard } from './TelegramConnectCard';
import { WhatsAppConnectCard } from './WhatsAppConnectCard';
import { IntegrationsHealthCard } from './IntegrationsHealthCard';
import { providerOrder, providerDisplay, visibleProviders } from '@/services/integrations/providers';
import { FEATURES } from '@/config/featureFlags';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';

export const IntegrationsTab: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  const { user } = useAuth();
  const currentOrgId = organization?.organizationId ?? null;
  // The WhatsApp bot is owner-only for now — only the app owner (us) sees it,
  // not customer orgs' admins/members. Falls back to the build flag so it can
  // be opened up later by setting VITE_ENABLE_WHATSAPP=true.
  const showWhatsApp = isAppOwner(user?.userId) || FEATURES.whatsapp;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Connected services</h3>
        <p className="text-sm text-muted-foreground">
          Link external tools so they can power task workflows. Each connection
          uses OAuth — TaskCalendar never sees your password.
        </p>
      </div>

      {/* At-a-glance health for Gmail / Meet / Automations so the rep can
          see whether the wiring is actually live without having to test
          each one by triggering a real workflow. */}
      <IntegrationsHealthCard />
      <div className="grid gap-3">
        {visibleProviders(providerOrder, { gmail: FEATURES.gmail || isAppOwner(user?.userId) }).map((id) => {
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
        {showWhatsApp && <WhatsAppConnectCard />}
      </div>
    </div>
  );
};
