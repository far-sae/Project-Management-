// Google or Microsoft sign-in, steps 3 to 5: sign in at the provider, send a test email, type in its code.
import React, { useId, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FIELD } from '@/components/signroom/billing/shared';
import {
  PROVIDER_NAME, cleanCode, isCode, needsReconnect, type EmailConnectionView, type SignInProvider,
} from '@/lib/signroom/emailConnection';
import { BusyButton, HELP, Step } from './parts';
import type { EmailConnection } from './useEmailConnection';

interface StepProps {
  view: EmailConnectionView;
  connection: EmailConnection;
}

const nameOf = (view: EmailConnectionView) => PROVIDER_NAME[view.provider as SignInProvider];

/** Step 3: a full-page trip to the provider's own sign-in page and back. */
export const SignInStep: React.FC<StepProps> = ({ view, connection }) => {
  const name = nameOf(view);
  return (
    <Step
      title={`Sign in at ${name}`}
      step={{ n: 3, of: 5 }}
      next={`Next: you send a test email to ${view.email} and enter the code from it.`}
    >
      <p className="text-sm text-muted-foreground">
        {needsReconnect(view)
          ? `Your ${name} sign-in has expired or was withdrawn. Sign in again as ${view.email} to carry on sending from it.`
          : `You leave this page to sign in on ${name}'s own page as ${view.email}, then come straight back here.`}
      </p>
      <div>
        <BusyButton working={connection.busy === 'authorize'} disabled={connection.busy !== null} onClick={() => void connection.authorize()}>
          {connection.busy !== 'authorize' && <ExternalLink aria-hidden />}
          Sign in with {name}
        </BusyButton>
      </div>
      <p className={HELP}>Sign in with exactly the address saved here. Another address is turned away.</p>
    </Step>
  );
};

/** Step 4: a real email, carrying only a code, to the saved address. */
export const TestEmailStep: React.FC<StepProps & { onSent: () => void; onHaveCode: () => void }> = ({
  view, connection, onSent, onHaveCode,
}) => (
  <Step title="Send a test email" step={{ n: 4, of: 5 }} next="Next: you enter the 6-digit code from that email.">
    <p className="text-sm text-muted-foreground">
      This sends only a verification code to {view.email}, without a document or signing link.
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <BusyButton
        working={connection.busy === 'test'} disabled={connection.busy !== null}
        onClick={async () => { if (await connection.sendTest()) onSent(); }}
      >
        Send test email
      </BusyButton>
      <Button type="button" variant="ghost" disabled={connection.busy !== null} onClick={onHaveCode}>I already have a code</Button>
    </div>
  </Step>
);

/** Step 5: the code proves the email really arrived in the mailbox. */
export const CodeStep: React.FC<StepProps> = ({ view, connection }) => {
  const id = useId();
  const [code, setCode] = useState('');
  const locked = connection.busy !== null;

  const confirm = async () => {
    if (!isCode(code)) return;
    await connection.confirm(code);
  };
  const again = async () => {
    if (await connection.sendTest()) setCode('');
  };

  return (
    <Step
      title="Enter the code"
      step={{ n: 5, of: 5 }}
      next={`Once the code is confirmed, your agreement and invoice emails are sent from ${view.email}.`}
    >
      <form className="flex flex-col gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <p className="text-sm text-muted-foreground">
          Open the test email in {view.email} and type its 6-digit code here. A code works for ten minutes.
        </p>
        <div className={FIELD}>
          <Label htmlFor={`${id}-code`}>Code from the test email</Label>
          <Input
            id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={locked}
            className="w-32 tabular-nums" value={code} onChange={(e) => setCode(cleanCode(e.target.value))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BusyButton type="submit" working={connection.busy === 'confirm'} disabled={locked || !isCode(code)}>Confirm code</BusyButton>
          <BusyButton type="button" variant="outline" working={connection.busy === 'test'} disabled={locked} onClick={() => void again()}>
            Send a new code
          </BusyButton>
        </div>
      </form>
    </Step>
  );
};
