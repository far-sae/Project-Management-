import { useCallback, useEffect, useState } from 'react';
import { startOAuth, disconnect as disconnectApi, listIntegrations } from '@/services/integrations/api';
import type { IntegrationRow, IntegrationStatus, ProviderId } from '@/services/integrations/types';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';

export interface UseIntegrationResult {
  status: IntegrationStatus;
  row: IntegrationRow | null;
  loading: boolean;
  error: string | null;
  /** Kicks off the OAuth redirect for this provider. */
  connect: (opts?: { scopes?: string[]; orgId?: string | null }) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useIntegration(provider: ProviderId): UseIntegrationResult {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIntegrations();
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const row = rows?.find((r) => r.provider === provider) ?? null;
  const status: IntegrationStatus = row ? row.status : 'not_connected';

  const connect = useCallback(
    async (opts?: { scopes?: string[]; orgId?: string | null }) => {
      setError(null);
      try {
        // Record the intent to connect before redirecting; the actual token
        // exchange happens in the oauth-callback function, but the redirect
        // is initiated here so this is the place we have a session.
        void recordAuditEvent(
          organization?.organizationId ?? opts?.orgId ?? null,
          { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
          {
            action: 'integration_connected',
            targetType: 'integration',
            targetId: provider,
            targetLabel: provider,
            metadata: { scopes: opts?.scopes ?? [], status: 'oauth_started' },
          },
        );
        const authUrl = await startOAuth(provider, opts?.scopes, opts?.orgId ?? null);
        window.location.assign(authUrl);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [provider, organization?.organizationId, user?.userId, user?.displayName],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectApi(provider);
      void recordAuditEvent(
        organization?.organizationId ?? null,
        { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
        {
          action: 'integration_disconnected',
          targetType: 'integration',
          targetId: provider,
          targetLabel: provider,
          metadata: {},
        },
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [provider, refresh, organization?.organizationId, user?.userId, user?.displayName]);

  return { status, row, loading, error, connect, disconnect, refresh };
}
