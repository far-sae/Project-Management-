import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import {
  EnrolmentDraft, MfaStatus,
  confirmEnrolment, disableMfa, fetchMfaStatus, startEnrolment,
} from '@/services/supabase/mfa';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { useOrganization } from '@/context/OrganizationContext';
import { toast } from 'sonner';

export const MfaSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<EnrolmentDraft | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!user?.userId) return;
    setLoading(true);
    try {
      setStatus(await fetchMfaStatus(user.userId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId]);

  const handleStart = async () => {
    if (!user?.email) return;
    setBusy(true);
    try {
      const d = await startEnrolment(user.email);
      setDraft(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start enrolment');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!user?.userId || !draft) return;
    setBusy(true);
    try {
      await confirmEnrolment(user.userId, draft, code);
      await recordAuditEvent(
        organization?.organizationId ?? null,
        { userId: user.userId, displayName: user.displayName },
        { action: 'mfa_enabled', targetType: 'user', targetId: user.userId, targetLabel: user.displayName ?? user.email ?? null },
      );
      toast.success('Two-factor enabled. Keep your recovery codes safe!');
      setDraft(null);
      setCode('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm code');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!user?.userId) return;
    if (!confirm('Disable two-factor authentication on this account?')) return;
    setBusy(true);
    try {
      await disableMfa(user.userId);
      await recordAuditEvent(
        organization?.organizationId ?? null,
        { userId: user.userId, displayName: user.displayName },
        { action: 'mfa_disabled', targetType: 'user', targetId: user.userId, targetLabel: user.displayName ?? user.email ?? null },
      );
      toast.success('Two-factor disabled.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCodes = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {status?.enabled ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            ) : (
              <ShieldOff className="w-5 h-5 text-amber-500" />
            )}
            <div>
              <p className="text-sm font-semibold">
                Two-factor authentication{' '}
                {status?.enabled
                  ? <Badge className="ml-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">On</Badge>
                  : <Badge variant="outline" className="ml-1">Off</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                Use an authenticator app (Google Authenticator, 1Password, Authy)
                to generate a 6-digit code at sign-in.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-6 text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : status?.enabled && !draft ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Enrolled {status.enrolledAt?.toLocaleDateString() ?? '—'}. Last
              verified {status.lastVerifiedAt?.toLocaleString() ?? 'never'}.
            </p>
            <Button variant="outline" onClick={handleDisable} disabled={busy}>
              <ShieldOff className="w-4 h-4 mr-2" /> Disable two-factor
            </Button>
          </div>
        ) : draft ? (
          <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-2 rounded-md border p-3 bg-card">
              <img src={draft.qrDataUrl} alt="TOTP QR code" className="w-[200px] h-[200px]" />
              <p className="text-[10px] text-muted-foreground text-center">
                Or paste this secret into your app:
              </p>
              <code className="text-[11px] font-mono break-all text-center select-all">
                {draft.secret}
              </code>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">6-digit code from your app</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Recovery codes — save these now</Label>
                <div className="rounded-md border bg-muted/40 p-2 grid grid-cols-2 gap-1 font-mono text-[11px]">
                  {draft.recoveryCodes.map((c) => <code key={c}>{c}</code>)}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={handleCopyCodes}
                >
                  {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? 'Copied' : 'Copy all codes'}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Each code works once if you lose access to your authenticator.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleConfirm} disabled={busy || code.length !== 6}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirm and enable
                </Button>
                <Button variant="ghost" onClick={() => { setDraft(null); setCode(''); }} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button onClick={handleStart} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <ShieldCheck className="w-4 h-4 mr-2" /> Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
