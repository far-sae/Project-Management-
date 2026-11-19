// Document settings: send agreement and invoice emails from the workspace's own mailbox instead of from TaskCalendar.
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSignroom } from '@/hooks/useSignroom';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { Card } from '@/components/signroom/billing/shared';
import {
  ARRIVAL_FAILED_MESSAGE, ARRIVED_MESSAGE, NOT_SET_UP_SENTENCE, PROVIDER_NAME, arrivalOf, disconnectQuestion, isSignIn, stageOf,
  type Editing, type EmailConnectionView,
} from '@/lib/signroom/emailConnection';
import { cn } from '@/lib/utils';
import { AppDetailsForm } from './AppDetailsForm';
import { ConnectionStatus } from './ConnectionStatus';
import { PasswordForm } from './PasswordForm';
import { CodeStep, SignInStep, TestEmailStep } from './SignInSteps';
import { WayChooser } from './WayChooser';
import { BusyButton, HELP } from './parts';
import { useEmailConnection, type EmailConnection } from './useEmailConnection';

const ARRIVAL_PARAM = 'emailConnection';
const TITLE = 'Send from your own mailbox';
const BOX = 'min-w-0 rounded-lg border border-border bg-background px-3 py-3 text-sm text-muted-foreground';

/**
 * `readOnly` is true for anyone who is not a workspace owner: they see the
 * state and nothing that changes it. Renders nothing until a workspace is picked.
 */
export const EmailConnectionPanel: React.FC<{ readOnly: boolean }> = ({ readOnly }) => {
  const { workspaceId } = useSignroom();
  if (!workspaceId) return null;
  // Keyed, so nothing typed or shown for one workspace survives a switch to another.
  return <Panel key={workspaceId} readOnly={readOnly} />;
};

const Panel: React.FC<{ readOnly: boolean }> = ({ readOnly }) => {
  const connection = useEmailConnection(readOnly);
  const { view, loadError, loadStatus } = connection;
  const [params, setParams] = useSearchParams();
  const arrived = useRef(false);

  // Back from Google or Microsoft: say how it went, tidy the address, and read the state again.
  useEffect(() => {
    if (!params.has(ARRIVAL_PARAM)) { arrived.current = true; return; }
    const outcome = arrivalOf(params.get(ARRIVAL_PARAM));
    if (outcome === 'connected') connection.say(ARRIVED_MESSAGE);
    if (outcome === 'error') connection.refuse(ARRIVAL_FAILED_MESSAGE);
    const rest = new URLSearchParams(params);
    rest.delete(ARRIVAL_PARAM);
    setParams(rest, { replace: true });
    // On first arrival the view is already being read; later (the page was open all along) it is read afresh.
    if (arrived.current) void connection.reload();
    arrived.current = true;
  }, [params]);

  const hidden = readOnly && loadStatus === 403;

  return (
    <Card title={TITLE}>
      <div className="flex min-w-0 flex-col gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          Connect your company&apos;s mailbox and your agreement and invoice emails come from your own address. Until you do,
          TaskCalendar sends them for you.
        </p>

        {view ? (
          <ConnectionStatus view={view} />
        ) : hidden ? (
          <p className={BOX}>Only a workspace owner or admin can see or change how emails are sent.</p>
        ) : loadError ? (
          <div className={cn(BOX, 'flex flex-col items-start gap-2')}>
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void connection.reload()}>Try again</Button>
          </div>
        ) : (
          // The same shape as the state it makes way for, so the card does not jump when the answer arrives.
          <div role="status" className={cn(BOX, 'flex items-start gap-3')}>
            <span className="h-8 w-8 shrink-0 rounded-md bg-muted motion-safe:animate-pulse" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-xs text-muted-foreground">Checking how your emails are sent</p>
              <span className="h-5 w-40 max-w-full rounded-md bg-muted motion-safe:animate-pulse" aria-hidden />
              <span className="h-9 w-full rounded-md bg-muted motion-safe:animate-pulse" aria-hidden />
            </div>
          </div>
        )}

        {view && readOnly && (
          <p className="text-sm text-muted-foreground">Only a workspace owner or admin can change how emails are sent.</p>
        )}
        {view && !readOnly && view.available === false && (
          <p role="status" aria-label="Not set up yet" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            {NOT_SET_UP_SENTENCE}
          </p>
        )}
        {/* With nothing connected and no key on the server there is nothing an owner can do here yet. */}
        {view && !readOnly && (view.available !== false || view.configured) && <Owner view={view} connection={connection} />}
        {(!view || readOnly) && <Messages connection={connection} />}
      </div>
    </Card>
  );
};

/** What the last change came to: one refusal or one piece of good news, never both. */
const Messages: React.FC<{ connection: EmailConnection }> = ({ connection }) => (
  <>
    {connection.error && (
      <p role="alert" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-destructive">{connection.error}</p>
    )}
    {connection.notice && (
      <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">{connection.notice}</p>
    )}
  </>
);

/** Everything an owner can do, one step at a time. */
const Owner: React.FC<{ view: EmailConnectionView; connection: EmailConnection }> = ({ view, connection }) => {
  const [editing, setEditing] = useState<Editing>(null);
  const [codeSent, setCodeSent] = useState(false);
  const { ask, dialog } = useConfirm();
  const locked = connection.busy !== null;
  const stage = stageOf(view, editing, codeSent);

  // A code only makes sense while the sign-in is waiting for one.
  useEffect(() => {
    if (view.status !== 'authenticated') setCodeSent(false);
  }, [view.status]);

  const follow = () => { setEditing(null); setCodeSent(false); };
  const back = editing ? () => setEditing(null) : undefined;

  const disconnect = async () => {
    if (!(await ask({ ...disconnectQuestion(view), destructive: true }))) return;
    if (await connection.disconnect()) follow();
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 border-t border-border pt-4">
        {stage === 'choose' && (
          <WayChooser
            current={view.configured ? view.provider : null}
            disabled={locked}
            onPick={setEditing}
            onCancel={view.configured ? () => setEditing(null) : undefined}
          />
        )}
        {stage === 'smtp' && <PasswordForm key="smtp" view={view} connection={connection} onSaved={follow} onBack={back} />}
        {stage === 'app' && isSignIn(editing) && (
          <AppDetailsForm key={editing} view={view} provider={editing} connection={connection} onSaved={follow} onBack={back} />
        )}
        {stage === 'signin' && <SignInStep view={view} connection={connection} />}
        {stage === 'test' && (
          <TestEmailStep view={view} connection={connection} onSent={() => setCodeSent(true)} onHaveCode={() => setCodeSent(true)} />
        )}
        {stage === 'code' && <CodeStep view={view} connection={connection} />}
        {stage === 'done' && !isSignIn(view.provider) && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <BusyButton variant="outline" working={connection.busy === 'test'} disabled={locked} onClick={() => void connection.sendTest()}>
                Send a test email
              </BusyButton>
              <BusyButton variant="outline" working={connection.busy === 'verify'} disabled={locked} onClick={() => void connection.verify()}>
                Check connection
              </BusyButton>
            </div>
            <p className={HELP}>The test email goes to {view.email} itself. Checking only signs in to the mailbox and sends nothing.</p>
          </div>
        )}
        {stage === 'done' && isSignIn(view.provider) && (
          <p className={HELP}>
            Nothing more to do. If {PROVIDER_NAME[view.provider]} ever needs you to sign in again, this panel will say so.
          </p>
        )}
        <Messages connection={connection} />
      </div>

      {view.configured && editing === null && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-border pt-3">
          {stage !== 'smtp' && (
            <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setEditing(view.provider)}>Change details</Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setEditing('choose')}>Use a different way</Button>
          <BusyButton
            type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive"
            working={connection.busy === 'disconnect'} disabled={locked} onClick={() => void disconnect()}
          >
            Disconnect
          </BusyButton>
        </div>
      )}
      {dialog}
    </>
  );
};

export default EmailConnectionPanel;
