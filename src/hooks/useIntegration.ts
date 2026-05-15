import { useCallback, useEffect, useState } from 'react';
import { startOAuth, disconnect as disconnectApi, listIntegrations } from '@/services/integrations/api';
import type { IntegrationRow, IntegrationStatus, ProviderId } from '@/services/integrations/types';

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
        const authUrl = await startOAuth(provider, opts?.scopes, opts?.orgId ?? null);
        window.location.assign(authUrl);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [provider],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectApi(provider);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [provider, refresh]);

  return { status, row, loading, error, connect, disconnect, refresh };
}
