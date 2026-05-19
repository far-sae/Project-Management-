// src/components/integrations/WhatsAppConnectCard.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import {
  requestWhatsAppLinkCode,
  getWhatsAppStatus,
  unlinkWhatsApp,
  type WhatsAppStatus,
} from '@/services/integrations/whatsapp';

const BOT_NUMBER = import.meta.env.VITE_WHATSAPP_BOT_NUMBER ?? '+1 555-000-0000';

export const WhatsAppConnectCard: React.FC = () => {
  const { organization } = useOrganization();
  const [status, setStatus] = React.useState<WhatsAppStatus | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getWhatsAppStatus().then(setStatus).catch(() => setStatus({ linked: false }));
  }, []);

  const onConnect = async () => {
    if (!organization?.organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await requestWhatsAppLinkCode(organization.organizationId);
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onUnlink = async () => {
    setLoading(true);
    try {
      await unlinkWhatsApp();
      setStatus({ linked: false });
      setCode(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const minsLeft = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <MessageCircle className="text-emerald-600" size={20} />
        <div className="flex-1">
          <CardTitle className="text-base">WhatsApp</CardTitle>
          <p className="text-sm text-muted-foreground">
            Same bot, on WhatsApp. Text it and it creates entries in your workspace.
          </p>
        </div>
        {status?.linked && <Badge variant="secondary">Linked</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Messages you send are routed via Meta's WhatsApp Cloud API and parsed by OpenAI to detect intent.
        </p>

        {status?.linked ? (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Connected{status.phoneNumber ? ` as ${status.phoneNumber}` : ''}.
            </span>
            <Button variant="outline" size="sm" onClick={onUnlink} disabled={loading}>
              Unlink
            </Button>
          </div>
        ) : code ? (
          <div className="space-y-2">
            <p className="text-sm">
              On WhatsApp, message <strong>{BOT_NUMBER}</strong> with:
            </p>
            <pre className="rounded bg-muted px-3 py-2 text-base">/start {code}</pre>
            <p className="text-xs text-muted-foreground">
              Code expires in ~{minsLeft} min.
            </p>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={loading || !organization?.organizationId}>
            Connect
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
};
