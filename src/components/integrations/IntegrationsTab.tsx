import React from 'react';
import { ProviderCard } from './ProviderCard';
import { TelegramConnectCard } from './TelegramConnectCard';
import { WhatsAppConnectCard } from './WhatsAppConnectCard';
import { IntegrationsHealthCard } from './IntegrationsHealthCard';
import { TwilioSmsConfigCard } from './TwilioSmsConfigCard';
import { providerOrder, providerDisplay, visibleProviders } from '@/services/integrations/providers';
import { FEATURES } from '@/config/featureFlags';
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

      {/* At-a-glance health for Gmail / Meet / Automations so the rep can
          see whether the wiring is actually live without having to test
          each one by triggering a real workflow. */}
      <IntegrationsHealthCard />
      <div className="grid gap-3">
        {visibleProviders(providerOrder, FEATURES).map((id) => {
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
        {FEATURES.whatsapp && <WhatsAppConnectCard />}
        {/* Twilio (SMS) — credentials are server-side env vars, not
            in-app fields, so this card surfaces the exact var names +
            a probe button instead of a Connect flow. */}
        <TwilioSmsConfigCard />
      </div>
    </div>
  );
};
