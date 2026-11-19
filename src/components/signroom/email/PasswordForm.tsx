// Connecting a mailbox with its password or app password. Server details stay out of the way unless the provider is not listed.
import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FIELD } from '@/components/signroom/billing/shared';
import {
  PORTS, PROVIDER_NAME, SECURITY_LABEL, SMTP_PROVIDERS, connectionOf, isSignIn, keepsPassword, securityForPort,
  smtpDirty, smtpFormOf, smtpProblem,
  type EmailConnectionView, type MailboxPort, type Security, type SmtpForm, type SmtpProviderId,
} from '@/lib/signroom/emailConnection';
import { cn } from '@/lib/utils';
import { BusyButton, HELP, PAIR, Step } from './parts';
import type { EmailConnection } from './useEmailConnection';

const APP_PASSWORD_HELP: Partial<Record<SmtpProviderId, string>> = {
  gmail: 'Gmail usually needs an app password instead of your normal password. You create one in the security settings of your Google account.',
  yahoo: 'Yahoo Mail usually needs an app password instead of your normal password. You create one in the security settings of your Yahoo account.',
};
const PASSWORD_HELP = 'Some providers, such as Gmail, Yahoo and iCloud, need an app password instead of your normal password.';

export const PasswordForm: React.FC<{
  view: EmailConnectionView;
  connection: EmailConnection;
  onSaved: () => void;
  /** Leaves without saving. Only offered when the owner chose to come here. */
  onBack?: () => void;
}> = ({ view, connection, onSaved, onBack }) => {
  const id = useId();
  const [form, setForm] = useState<SmtpForm>(() => smtpFormOf(view));
  const [advanced, setAdvanced] = useState(false);

  const set = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => setForm((old) => ({ ...old, [key]: value }));
  const locked = connection.busy !== null;
  const custom = form.provider === 'custom';
  const named = form.provider !== '' && !custom;
  const server = connectionOf(form);
  const saved = view.configured && view.provider === 'smtp';
  const unverified = saved && view.status !== 'verified';
  const keeps = keepsPassword(form, view);
  const dirty = smtpDirty(form, view);

  const save = async () => {
    const problem = smtpProblem(form, view);
    if (problem) { connection.refuse(problem); return; }
    const reply = await connection.saveSmtp(form);
    if (!reply) return;
    // The server has it now: the field never holds it again.
    set('password', '');
    onSaved();
  };

  return (
    <Step
      title="Your mailbox details"
      step={{ n: 2, of: 2 }}
      next="When you save, TaskCalendar signs in to your mailbox once to check the details. No email is sent."
    >
      <form className="flex flex-col gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className={PAIR}>
          <div className={FIELD}>
            <Label htmlFor={`${id}-provider`}>Email provider</Label>
            <Select value={form.provider} onValueChange={(v) => set('provider', v as SmtpProviderId)} disabled={locked}>
              <SelectTrigger id={`${id}-provider`}><SelectValue placeholder="Choose your provider" /></SelectTrigger>
              <SelectContent>
                {SMTP_PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-email`}>Email address</Label>
            <Input
              id={`${id}-email`} type="email" maxLength={254} autoComplete="email" disabled={locked}
              placeholder="you@yourcompany.com" value={form.email} onChange={(e) => set('email', e.target.value)}
            />
          </div>
        </div>

        {custom && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
            <div className={FIELD}>
              <Label htmlFor={`${id}-host`}>Server name</Label>
              <Input
                id={`${id}-host`} maxLength={253} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={locked}
                placeholder="smtp.yourprovider.com" value={form.host} onChange={(e) => set('host', e.target.value)}
              />
            </div>
            <div className={PAIR}>
              <div className={FIELD}>
                <Label htmlFor={`${id}-port`}>Port</Label>
                <Select
                  value={String(form.port)} disabled={locked}
                  onValueChange={(v) => {
                    const port = Number(v) as MailboxPort;
                    setForm((old) => ({ ...old, port, security: securityForPort(port) }));
                  }}
                >
                  <SelectTrigger id={`${id}-port`} className="tabular-nums"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PORTS.map((port) => <SelectItem key={port} value={String(port)}>{port}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-security`}>Security</Label>
                <Select value={form.security} onValueChange={(v) => set('security', v as Security)} disabled={locked}>
                  <SelectTrigger id={`${id}-security`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">{SECURITY_LABEL.tls}</SelectItem>
                    <SelectItem value="starttls">{SECURITY_LABEL.starttls}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className={HELP}>
              Use the server name, port and security your provider gives you; regional settings can differ. The connection is
              always encrypted and the server&apos;s certificate is always checked.
            </p>
          </div>
        )}

        <div className={FIELD}>
          <Label htmlFor={`${id}-password`}>Password or app password</Label>
          <Input
            id={`${id}-password`} type="password" maxLength={256} autoComplete="new-password" disabled={locked}
            placeholder={saved && keeps ? 'Saved. Leave empty to keep it.' : 'Stored encrypted and never shown again'}
            value={form.password} onChange={(e) => set('password', e.target.value)}
          />
          <p className={HELP}>{(form.provider && APP_PASSWORD_HELP[form.provider]) || PASSWORD_HELP}</p>
          {saved && !keeps && !form.password && (
            <p className="text-xs text-foreground">You changed the server or username, so enter the password again.</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <Button
              type="button" variant="ghost" size="sm" className="-ml-2.5"
              aria-expanded={advanced} aria-controls={`${id}-advanced`} onClick={() => setAdvanced((open) => !open)}
            >
              <ChevronDown className={cn('transition-transform', advanced && 'rotate-180')} aria-hidden />
              Advanced
            </Button>
          </div>
          {advanced && (
            <div id={`${id}-advanced`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
              {named && (
                <>
                  <div className={FIELD}>
                    <Label htmlFor={`${id}-host-fixed`}>Server name</Label>
                    <Input id={`${id}-host-fixed`} readOnly value={server.host} className="bg-muted text-muted-foreground" />
                  </div>
                  <div className={PAIR}>
                    <div className={FIELD}>
                      <Label htmlFor={`${id}-port-fixed`}>Port</Label>
                      <Input id={`${id}-port-fixed`} readOnly value={String(server.port)} className="bg-muted tabular-nums text-muted-foreground" />
                    </div>
                    <div className={FIELD}>
                      <Label htmlFor={`${id}-security-fixed`}>Security</Label>
                      <Input id={`${id}-security-fixed`} readOnly value={SECURITY_LABEL[server.security]} className="bg-muted text-muted-foreground" />
                    </div>
                  </div>
                  <p className={HELP}>
                    These are filled in for your provider. If yours are different, choose &quot;Another provider&quot; above.
                  </p>
                </>
              )}
              <div className={FIELD}>
                <Label htmlFor={`${id}-username`}>Username</Label>
                <Input
                  id={`${id}-username`} maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false}
                  disabled={locked} placeholder="Leave blank to use your email address"
                  value={form.username} onChange={(e) => set('username', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {saved && view.status === 'verified' && (
          <p className={HELP}>Saving resets verification: your mailbox is checked again straight away.</p>
        )}
        {unverified && dirty && (
          <p className={HELP}>Save your changes before checking. Saving resets verification.</p>
        )}
        {view.configured && isSignIn(view.provider) && (
          <p className={HELP}>Saving this replaces your {PROVIDER_NAME[view.provider]} sign-in.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <BusyButton type="submit" working={connection.busy === 'save'} disabled={locked}>Save and connect</BusyButton>
          {unverified && (
            <BusyButton
              type="button" variant="outline" working={connection.busy === 'verify'} disabled={locked || dirty}
              onClick={() => void connection.verify()}
            >
              Check again
            </BusyButton>
          )}
          {onBack && <Button type="button" variant="ghost" disabled={locked} onClick={onBack}>Back</Button>}
        </div>
      </form>
    </Step>
  );
};
