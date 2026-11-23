// "Connect" for each social platform. Pressing it sends the person to the
// platform to log in; the platform sends them back, and the account is in the
// list. Nobody copies a key by hand.
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SetupHint } from '@/components/common/SetupHint';
import { Button } from '@/components/ui/button';
import { CONNECT_BRINGS } from '@/lib/socialConnect';
import { publicMessage } from '@/lib/publicError';
import { CONNECT_FAILED_MESSAGE, socialConnectSetup, startSocialConnect } from '@/services/social/connect';
import {
  CONNECT_KINDS, CONNECT_NAME, CONNECT_SETTINGS,
  type ConnectKind, type ConnectSetup,
} from '../../../api/_social/shared/connect';

interface Props {
  organizationId: string;
  workspaceId: string;
  /** Owners and admins connect accounts; everybody else only sees the list below. */
  canConnect: boolean;
  /** Leaves the app for the platform's log-in page. */
  go?: (url: string) => void;
}

const leave = (url: string) => window.location.assign(url);

export const ConnectAccounts: React.FC<Props> = ({ organizationId, workspaceId, canConnect, go = leave }) => {
  const [setup, setSetup] = useState<ConnectSetup | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [opening, setOpening] = useState<ConnectKind | null>(null);

  useEffect(() => {
    if (!canConnect) return;
    let alive = true;
    socialConnectSetup()
      .then((answer) => { if (alive) setSetup(answer); })
      .catch(() => { if (alive) setUnknown(true); });
    return () => { alive = false; };
  }, [canConnect]);

  if (!canConnect) {
    return <p className="text-sm text-muted-foreground">Only an owner or admin can connect accounts.</p>;
  }

  const connect = async (kind: ConnectKind) => {
    setOpening(kind);
    try {
      go(await startSocialConnect(kind, organizationId, workspaceId));
      // The page is being left: the button stays busy until it is.
    } catch (err) {
      toast.error(publicMessage(err, CONNECT_FAILED_MESSAGE));
      setOpening(null);
    }
  };

  const someOff = setup !== null && CONNECT_KINDS.some((kind) => !setup.ready[kind]);

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-foreground">Connect an account</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Press Connect and log in at the platform. You come back here with the account in the list.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {CONNECT_KINDS.map((kind) => {
          const ready = setup?.ready[kind] === true;
          const off = setup !== null && !ready;
          return (
            <li key={kind} aria-label={CONNECT_NAME[kind]} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{CONNECT_NAME[kind]}</p>
                <p className="text-sm text-muted-foreground">{CONNECT_BRINGS[kind]}</p>
                {off && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <SetupHint other="Not switched on yet.">
                      Needs {(setup?.needs?.[kind]?.length ? setup.needs[kind] : CONNECT_SETTINGS[kind]).join(' and ')} in the server settings.
                    </SetupHint>
                  </p>
                )}
              </div>
              <Button
                variant="outline" aria-label={`Connect ${CONNECT_NAME[kind]}`}
                disabled={!ready || opening !== null} onClick={() => void connect(kind)}
              >
                {opening === kind && <Loader2 className="animate-spin" aria-hidden />}
                {opening === kind ? 'Opening…' : 'Connect'}
              </Button>
            </li>
          );
        })}
      </ul>
      {unknown && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          Connecting could not be checked just now. Reload the page to try again.
        </p>
      )}
      {someOff && setup?.callback && (
        <SetupHint other={null}>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Each platform asks for a return address when you create its app. Give every one this address:{' '}
            <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">{setup.callback}</code>
          </p>
        </SetupHint>
      )}
    </section>
  );
};

export default ConnectAccounts;
