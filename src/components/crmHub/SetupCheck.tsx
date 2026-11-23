import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/context/OrganizationContext';
import { APP_OWNERS, APP_OWNER_SETTING } from '@/lib/platform';
import { useAuth } from '@/context/AuthContext';
import { StatusPill } from '@/components/common/StatusPill';
import type { StatusTone } from '@/components/common/StatusPill';
import { SETUP_PARTS } from '@/lib/crmSetup';
import type { SetupState } from '@/lib/crmSetup';
import { runSetupCheck } from '@/services/supabase/crmHub/setupCheck';
import { forgetVoiceSetup, voiceSetup } from '@/services/voice/client';
import type { VoiceSetup } from '../../../api/_voice/shared/types';

/**
 * Which parts of the CRM are set up. Each part needs a database file run once
 * in the Supabase SQL editor; calling also needs its settings on the server.
 * The check only reads: it changes nothing.
 */

const STATE_LABEL: Record<SetupState, string> = { ready: 'Ready', missing: 'Not set up', unknown: 'Cannot check' };
const STATE_TONE: Record<SetupState, StatusTone> = { ready: 'success', missing: 'warning', unknown: 'muted' };

const File: React.FC<{ name: string }> = ({ name }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">supabase/migrations/{name}</code>
);

const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground';

export const SetupCheck: React.FC = () => {
  const { organization, isOwner } = useOrganization();
  const { user } = useAuth();
  const [states, setStates] = useState<Record<string, SetupState> | null>(null);
  const [calling, setCalling] = useState<VoiceSetup | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    forgetVoiceSetup();
    const [database, phone] = await Promise.all([
      runSetupCheck().catch(() => ({} as Record<string, SetupState>)),
      voiceSetup().catch(() => null),
    ]);
    setStates(database);
    setCalling(phone);
    setChecking(false);
  }, []);

  useEffect(() => { void check(); }, [check]);

  const missing = states ? SETUP_PARTS.filter((part) => states[part.id] === 'missing').length : 0;
  const callingState: { label: string; tone: StatusTone } = !calling
    ? { label: 'Cannot check', tone: 'muted' }
    : calling.ready
      ? { label: 'Ready', tone: 'success' }
      : calling.configured ? { label: 'Not ready', tone: 'warning' } : { label: 'Not set up', tone: 'warning' };

  return (
    <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Set-up check</h2>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            Some parts of the CRM need a database file run once in the Supabase SQL editor. This shows which are done.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          Check again
        </Button>
      </div>

      {states && (
        <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {missing === 0
            ? 'Everything that can be checked is set up.'
            : `${missing} part${missing === 1 ? ' is' : 's are'} not set up yet.`}
        </p>
      )}

      {/* While nobody is named as the one who runs the site, every organisation's owner sees this page. */}
      {APP_OWNERS.length === 0 && user?.userId && (
        <p className="border-b border-border bg-warning-soft px-4 py-2 text-pretty text-xs text-warning-soft-foreground">
          The owner of every organisation on the site can see this page and set-up messages. To keep them to
          yourself, add the setting <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">{APP_OWNER_SETTING}</code> in
          Vercel with this value, then deploy again: <code className="break-all rounded bg-background px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">{user.userId}</code>
        </p>
      )}

      <ul className="divide-y divide-border">
        {SETUP_PARTS.map((part) => {
          const state = states?.[part.id];
          return (
            <li key={part.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{part.name}</p>
                <p className="text-xs text-muted-foreground">{part.gives}</p>
                {state === 'missing' && (
                  <p className="mt-1.5 text-xs text-foreground">Run <File name={part.file} /> in the Supabase SQL editor.</p>
                )}
                {state === 'unknown' && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {part.probe.kind === 'none'
                      ? <>This one cannot be seen from here. If you have not run <File name={part.file} /> yet, run it once. Running it twice is safe.</>
                      : <>The check did not get an answer. Try again; the file is <File name={part.file} />.</>}
                  </p>
                )}
              </div>
              {state ? <StatusPill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusPill> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Checking" />}
            </li>
          );
        })}

        <li className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Phone provider settings</p>
            <p className="text-xs text-muted-foreground">The settings on the server that let the CRM place calls.</p>
            {calling && !calling.configured && (
              <p className="mt-1.5 text-xs text-foreground">
                Calling is not switched on. Only the owner and admins can see this check. If you are one, add the
                seven <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">TWILIO_</code> settings in Vercel, then deploy again.
              </p>
            )}
            {calling && calling.configured && !calling.ready && calling.problem && (
              <p className="mt-1.5 text-xs text-foreground">{calling.problem}</p>
            )}
            {calling?.ready && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Numbers to call from: {[calling.numbers.US && 'United States', calling.numbers.GB && 'United Kingdom'].filter(Boolean).join(' and ') || 'none'}.
              </p>
            )}
            {/* The phone account is one for the whole site. This is how the owner keeps it to their own organisation. */}
            {isOwner && calling?.configured && organization?.organizationId && (
              <p className="mt-1.5 text-pretty text-xs text-muted-foreground">
                To let only your organisation place calls, add the setting <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">TWILIO_ALLOWED_ORGS</code> in
                Vercel with this value, then deploy again: <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">{organization.organizationId}</code>
              </p>
            )}
          </div>
          {checking && !calling
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Checking" />
            : <StatusPill tone={callingState.tone}>{callingState.label}</StatusPill>}
        </li>

        {/* Finding leads spends the credits of one Apollo account, so it is named for one organisation. */}
        {isOwner && organization?.organizationId && (
          <li className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Find leads settings</p>
              <p className="text-xs text-muted-foreground">The settings on the server that let the CRM search Apollo and add people as leads.</p>
              <p className="mt-1.5 text-pretty text-xs text-muted-foreground">
                Add two settings in Vercel, then deploy again: <code className={CODE}>APOLLO_API_KEY</code> with the API key
                from your Apollo account, and <code className={CODE}>APOLLO_ALLOWED_ORGS</code> with this
                value: <code className={`break-all ${CODE}`}>{organization.organizationId}</code>.
                The Find leads page (on the Leads page) says whether it is ready.
              </p>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
};
