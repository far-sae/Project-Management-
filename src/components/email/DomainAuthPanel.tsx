import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { checkDomainAuth } from '@/services/supabase/email';
import type { AuthCheck, DomainAuthReport } from '@/lib/email/domainAuth';
import type { MailboxHealth } from '@/lib/email/types';

interface DomainAuthPanelProps {
  mailboxes: MailboxHealth[];
}

interface DomainState {
  status: 'unchecked' | 'checking' | 'checked' | 'error';
  report?: DomainAuthReport;
  error?: string;
}

const AuthRow: React.FC<{ label: string; check: AuthCheck }> = ({ label, check }) => (
  <div className="flex items-start gap-2 text-sm">
    {check.ok
      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
      : <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
    <div className="min-w-0">
      <span className="font-medium text-foreground">{label}</span>
      {check.value && (
        <code className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
          {check.value}
        </code>
      )}
      <p className="text-muted-foreground">{check.detail}</p>
    </div>
  </div>
);

/**
 * One panel per distinct sending domain (derived from the mailboxes' from
 * addresses), each checked on demand through `checkDomainAuth`. Any org
 * member may run the check — it is a read-only DNS lookup, not a mailbox
 * action, which is why this panel carries no admin gate (api/email/domain-auth.ts
 * requires only membership, unlike verify/delete/resume/reconfigure).
 */
export const DomainAuthPanel: React.FC<DomainAuthPanelProps> = ({ mailboxes }) => {
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const m of mailboxes) {
      const domain = m.fromEmail.split('@')[1]?.trim().toLowerCase();
      if (domain) set.add(domain);
    }
    return Array.from(set).sort();
  }, [mailboxes]);

  const [state, setState] = useState<Record<string, DomainState>>({});

  const runCheck = async (domain: string) => {
    setState((prev) => ({ ...prev, [domain]: { status: 'checking' } }));
    try {
      const report = await checkDomainAuth(domain);
      setState((prev) => ({ ...prev, [domain]: { status: 'checked', report } }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        [domain]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to check domain authentication',
        },
      }));
    }
  };

  if (domains.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domain authentication</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          SPF, DKIM, DMARC and MX for each domain you send from.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {domains.map((domain) => {
          const s = state[domain] ?? { status: 'unchecked' as const };
          return (
            <div key={domain} className="p-4 bg-secondary/40 border border-border rounded-lg">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">{domain}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={s.status === 'checking'}
                  onClick={() => runCheck(domain)}
                >
                  {s.status === 'checking'
                    ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    : <RefreshCw className="w-4 h-4 mr-1" />}
                  Check
                </Button>
              </div>

              {s.status === 'unchecked' && (
                <p className="text-sm text-muted-foreground mt-2">Not checked yet.</p>
              )}
              {s.status === 'error' && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">{s.error}</p>
              )}
              {s.status === 'checked' && s.report && (
                <div className="mt-3 space-y-2">
                  <AuthRow label="SPF" check={s.report.spf} />
                  <AuthRow label="DKIM" check={s.report.dkim} />
                  <AuthRow label="DMARC" check={s.report.dmarc} />
                  <div className="flex items-start gap-2 text-sm">
                    {s.report.mx.length > 0
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      : <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <span className="font-medium text-foreground">MX</span>
                      {s.report.mx.length > 0 ? (
                        <code className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                          {s.report.mx.join(', ')}
                        </code>
                      ) : (
                        <p className="text-muted-foreground">No MX records found.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default DomainAuthPanel;
