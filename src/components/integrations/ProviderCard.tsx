import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Mail, MessageSquare, Loader2 } from 'lucide-react';
import { providerDisplay } from '@/services/integrations/providers';
import type { ProviderDisplay, ProviderId } from '@/services/integrations/types';
import { useIntegration } from '@/hooks/useIntegration';

const icons = { Video, Mail, MessageSquare } as const;

interface Props {
  provider: ProviderId;
  /** Optional scope list to request when connecting; defaults to provider's framework scopes. */
  scopes?: string[];
  /** For org-level providers, pass the current organization id. */
  orgId?: string | null;
  /** When false, hide the Connect button (e.g., for non-admins of org-level providers). */
  canConnect?: boolean;
}

export const ProviderCard: React.FC<Props> = ({
  provider,
  scopes,
  orgId,
  canConnect = true,
}) => {
  const display: ProviderDisplay = providerDisplay[provider];
  const Icon = icons[display.iconName];
  const { status, row, loading, error, connect, disconnect } = useIntegration(provider);

  const connectedAccount =
    (row?.metadata?.team_name as string | undefined) ??
    (row?.metadata?.email as string | undefined) ??
    null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-start gap-3">
          <Icon className={`h-6 w-6 ${display.accent}`} />
          <div>
            <CardTitle className="text-base">
              {display.label}
              {display.orgLevel && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Workspace
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {display.description}
            </CardDescription>
          </div>
        </div>
        <div>
          {status === 'active' && <Badge variant="default">Connected</Badge>}
          {status === 'error' && <Badge variant="destructive">Error</Badge>}
          {status === 'revoked' && <Badge variant="secondary">Disconnected</Badge>}
          {status === 'not_connected' && (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {connectedAccount && (
          <p className="text-sm text-muted-foreground mb-2">
            Connected as <span className="font-mono">{connectedAccount}</span>
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive mb-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          {status === 'active' || status === 'error' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void disconnect()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void connect({ scopes, orgId })}
              disabled={loading || !canConnect}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Connect ${display.label}`
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
