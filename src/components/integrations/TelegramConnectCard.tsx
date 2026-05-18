// src/components/integrations/TelegramConnectCard.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import {
  requestTelegramLinkCode,
  getTelegramStatus,
  unlinkTelegram,
  type TelegramStatus,
} from '@/services/integrations/telegram';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'YourBot';

export const TelegramConnectCard: React.FC = () => {
  const { organization } = useOrganization();
  const [status, setStatus] = React.useState<TelegramStatus | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getTelegramStatus().then(setStatus).catch(() => setStatus({ linked: false }));
  }, []);

  const onConnect = async () => {
    if (!organization?.organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await requestTelegramLinkCode(organization.organizationId);
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
      await unlinkTelegram();
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
        <MessageCircle className="text-sky-600" size={20} />
        <div className="flex-1">
          <CardTitle className="text-base">Telegram</CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage workspaces, projects, tasks, and clients by texting the bot.
          </p>
        </div>
        {status?.linked && <Badge variant="secondary">Linked</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Note: bot messages are sent to OpenAI for parsing.
        </p>

        {status?.linked ? (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Connected{status.username ? ` as @${status.username}` : ''}.
            </span>
            <Button variant="outline" size="sm" onClick={onUnlink} disabled={loading}>
              Unlink
            </Button>
          </div>
        ) : code ? (
          <div className="space-y-2">
            <p className="text-sm">
              Open <a className="underline" href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer">@{BOT_USERNAME}</a> on Telegram and send:
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
