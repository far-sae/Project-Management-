// Google or Microsoft sign-in, step 2: the details of the app the workspace registered with the provider.
import React, { useId, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FIELD } from '@/components/signroom/billing/shared';
import {
  PROVIDER_NAME, appFormOf, appProblem, isSignIn, keepsClientSecret,
  type AppForm, type EmailConnectionView, type SignInProvider,
} from '@/lib/signroom/emailConnection';
import { BusyButton, HELP, PAIR, Step } from './parts';
import type { EmailConnection } from './useEmailConnection';

const REGISTER: Record<SignInProvider, string> = {
  google: 'In Google Cloud, register a web application with the Gmail API turned on and the gmail.send permission.',
  microsoft: 'In Microsoft Entra, register an application with the delegated permissions Mail.Send and User.Read, plus offline access.',
};

export const AppDetailsForm: React.FC<{
  view: EmailConnectionView;
  provider: SignInProvider;
  connection: EmailConnection;
  onSaved: () => void;
  onBack?: () => void;
}> = ({ view, provider, connection, onSaved, onBack }) => {
  const id = useId();
  const [form, setForm] = useState<AppForm>(() => appFormOf(view, provider));
  const name = PROVIDER_NAME[provider];
  const set = <K extends keyof AppForm>(key: K, value: AppForm[K]) => setForm((old) => ({ ...old, [key]: value }));
  const locked = connection.busy !== null;
  const sameProvider = view.configured && view.provider === provider;
  const keeps = keepsClientSecret(form, view);
  const redirect = view.callbackUri ?? '';

  const save = async () => {
    const problem = appProblem(form);
    if (problem) { connection.refuse(problem); return; }
    if (!(await connection.saveApp(form))) return;
    // The server has it now: the field never holds it again.
    set('clientSecret', '');
    onSaved();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirect);
      toast.success('Redirect address copied.');
    } catch {
      toast.error('Could not copy. Select the address and copy it yourself.');
    }
  };

  return (
    <Step title={`Your ${name} app details`} step={{ n: 2, of: 5 }} next={`Next: you sign in at ${name}.`}>
      <form className="flex flex-col gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="text-sm text-muted-foreground">
          {REGISTER[provider]} Your provider may ask for registration or admin approval. You sign in on the provider&apos;s own
          page, never here.
        </p>

        <div className={FIELD}>
          <Label htmlFor={`${id}-redirect`}>Redirect address to register</Label>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id={`${id}-redirect`} readOnly value={redirect} className="min-w-0 flex-1 bg-muted text-muted-foreground"
              placeholder="Not available on this address" onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" size="icon" aria-label="Copy the redirect address" disabled={!redirect} onClick={() => void copy()}>
              <Copy aria-hidden />
            </Button>
          </div>
          <p className={HELP}>Add this to your app at {name} as its redirect address (redirect URI), exactly as shown.</p>
        </div>

        <div className={FIELD}>
          <Label htmlFor={`${id}-email`}>Work email address</Label>
          <Input
            id={`${id}-email`} type="email" maxLength={254} autoComplete="email" disabled={locked}
            placeholder="you@yourcompany.com" value={form.email} onChange={(e) => set('email', e.target.value)}
          />
          <p className={HELP}>Your emails will come from this address. You sign in with exactly this address in the next step.</p>
        </div>

        <div className={PAIR}>
          <div className={FIELD}>
            <Label htmlFor={`${id}-client-id`}>Client ID</Label>
            <Input
              id={`${id}-client-id`} maxLength={300} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={locked}
              value={form.clientId} onChange={(e) => set('clientId', e.target.value)}
            />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-client-secret`}>Client secret (if your app has one)</Label>
            <Input
              id={`${id}-client-secret`} type="password" maxLength={4096} autoComplete="new-password" disabled={locked}
              placeholder={keeps ? 'Saved. Leave empty to keep it.' : 'Stored encrypted and never shown again'}
              value={form.clientSecret} onChange={(e) => set('clientSecret', e.target.value)}
            />
          </div>
        </div>
        {sameProvider && view.hasClientSecret && !keeps && !form.clientSecret && (
          <p className="text-xs text-foreground">
            You changed the app details, so the saved client secret is not kept. Enter it again if your app has one.
          </p>
        )}

        {provider === 'microsoft' && (
          <div className={FIELD}>
            <Label htmlFor={`${id}-tenant`}>Microsoft tenant ID or domain</Label>
            <Input
              id={`${id}-tenant`} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={locked}
              value={form.tenant} onChange={(e) => set('tenant', e.target.value)}
            />
            <p className={HELP}>Leave this as &quot;organizations&quot; unless your IT admin gave you a tenant ID or domain.</p>
          </div>
        )}

        {sameProvider && (
          <p className={HELP}>Saving resets verification: you sign in and confirm a test email again.</p>
        )}
        {view.configured && !sameProvider && isSignIn(view.provider) && (
          <p className={HELP}>Saving this replaces your {PROVIDER_NAME[view.provider]} sign-in.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <BusyButton type="submit" working={connection.busy === 'save'} disabled={locked}>Save app details</BusyButton>
          {onBack && <Button type="button" variant="ghost" disabled={locked} onClick={onBack}>Back</Button>}
        </div>
      </form>
    </Step>
  );
};
