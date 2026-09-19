import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, Save, SendHorizonal } from 'lucide-react';

export interface AccountFormState {
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  password: string;
  dailyLimit: string;
  warmupEnabled: boolean;
  warmupStartVolume: string;
  warmupIncrement: string;
}

export const EMPTY_ACCOUNT_FORM: AccountFormState = {
  label: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  smtpHost: '',
  smtpPort: '587',
  smtpSecure: false,
  smtpUsername: '',
  password: '',
  dailyLimit: '40',
  warmupEnabled: true,
  warmupStartVolume: '5',
  warmupIncrement: '3',
};

/** The four sending-limit fields shared by the create form and the
 *  reconfigure-an-existing-mailbox dialog below. */
export interface SendingFieldsValues {
  dailyLimit: string;
  warmupEnabled: boolean;
  warmupStartVolume: string;
  warmupIncrement: string;
}

const SendingFields: React.FC<{
  idPrefix: string;
  values: SendingFieldsValues;
  onChange: (patch: Partial<SendingFieldsValues>) => void;
}> = ({ idPrefix, values, onChange }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-daily-limit`}>Daily limit</Label>
      <Input
        id={`${idPrefix}-daily-limit`}
        type="number"
        min={1}
        value={values.dailyLimit}
        onChange={(e) => onChange({ dailyLimit: e.target.value })}
      />
    </div>

    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <div>
        <Label htmlFor={`${idPrefix}-warmup`}>Warm up this mailbox</Label>
        <p className="text-xs text-muted-foreground">
          Ramps up from a small volume instead of sending the full limit from day one.
        </p>
      </div>
      <Switch
        id={`${idPrefix}-warmup`}
        checked={values.warmupEnabled}
        onCheckedChange={(v) => onChange({ warmupEnabled: v })}
      />
    </div>

    {values.warmupEnabled && (
      <>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-start-volume`}>Start volume</Label>
            <Input
              id={`${idPrefix}-start-volume`}
              type="number"
              min={0}
              value={values.warmupStartVolume}
              onChange={(e) => onChange({ warmupStartVolume: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-increment`}>Daily increment</Label>
            <Input
              id={`${idPrefix}-increment`}
              type="number"
              min={0}
              value={values.warmupIncrement}
              onChange={(e) => onChange({ warmupIncrement: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This mailbox starts at {values.warmupStartVolume || 0} a day and climbs by{' '}
          {values.warmupIncrement || 0} until it reaches {values.dailyLimit || 0}.
        </p>
      </>
    )}
  </div>
);

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: AccountFormState;
  onFormChange: (updater: (f: AccountFormState) => AccountFormState) => void;
  creating: boolean;
  createError: string | null;
  /** True once the account row already exists (createAccount succeeded) but
   *  something after it — applying the sending limits, or verification —
   *  failed. The footer switches from "create" to "retry the same account"
   *  so a second submit doesn't insert a duplicate row; `onRetry` reapplies
   *  whichever of those steps didn't finish, not verification alone. */
  canRetry: boolean;
  canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onRetry: () => void;
}

/** "Add sending account" dialog — pure form UI. AccountsTab owns all state
 *  and the create/verify/retry logic so this stays presentational. */
export const AccountFormDialog: React.FC<AccountFormDialogProps> = ({
  open, onOpenChange, form, onFormChange, creating, createError, canRetry, canSubmit, onSubmit, onRetry,
}) => {
  const setPort = (value: string) => {
    onFormChange((f) => ({
      ...f,
      smtpPort: value,
      smtpSecure: value === '465' ? true : value === '587' ? false : f.smtpSecure,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add sending account</DialogTitle>
          <DialogDescription>
            Stored SMTP credentials used to send campaigns. Saving automatically sends a
            verification test to your own address.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {createError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="acct-label">Label *</Label>
              <Input id="acct-label" value={form.label} placeholder="Marketing"
                onChange={(e) => onFormChange((f) => ({ ...f, label: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-from-name">From name *</Label>
              <Input id="acct-from-name" value={form.fromName} placeholder="Acme Team"
                onChange={(e) => onFormChange((f) => ({ ...f, fromName: e.target.value }))} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="acct-from-email">From email *</Label>
              <Input id="acct-from-email" type="email" value={form.fromEmail} placeholder="hello@acme.com"
                onChange={(e) => onFormChange((f) => ({ ...f, fromEmail: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-reply-to">Reply-to</Label>
              <Input id="acct-reply-to" type="email" value={form.replyTo} placeholder="Optional"
                onChange={(e) => onFormChange((f) => ({ ...f, replyTo: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="acct-host">SMTP host *</Label>
              <Input id="acct-host" value={form.smtpHost} placeholder="smtp.acme.com"
                onChange={(e) => onFormChange((f) => ({ ...f, smtpHost: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-port">SMTP port</Label>
              <Input id="acct-port" type="number" value={form.smtpPort}
                onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="acct-secure">Use TLS on connect</Label>
              <p className="text-xs text-muted-foreground">Usually on for port 465, off for 587.</p>
            </div>
            <Switch id="acct-secure" checked={form.smtpSecure}
              onCheckedChange={(v) => onFormChange((f) => ({ ...f, smtpSecure: v }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="acct-username">Username *</Label>
              <Input id="acct-username" value={form.smtpUsername}
                onChange={(e) => onFormChange((f) => ({ ...f, smtpUsername: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-password">Password *</Label>
              <Input id="acct-password" type="password" value={form.password}
                onChange={(e) => onFormChange((f) => ({ ...f, password: e.target.value }))} required />
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-4">
            <p className="text-sm font-medium text-foreground">Sending</p>
            <SendingFields
              idPrefix="acct"
              values={{
                dailyLimit: form.dailyLimit,
                warmupEnabled: form.warmupEnabled,
                warmupStartVolume: form.warmupStartVolume,
                warmupIncrement: form.warmupIncrement,
              }}
              onChange={(patch) => onFormChange((f) => ({ ...f, ...patch }))}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            {canRetry ? (
              <Button type="button" onClick={onRetry} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SendHorizonal className="w-4 h-4 mr-2" />}
                Retry
              </Button>
            ) : (
              <Button type="submit" disabled={creating || !canSubmit}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Save and verify
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** dailyLimit/warmupEnabled/warmupStartVolume/warmupIncrement only — the
 *  fields `updateAccountPool` accepts, as strings for the number inputs. */
export type PoolFormState = SendingFieldsValues;

interface MailboxLimitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  form: PoolFormState;
  onFormChange: (updater: (f: PoolFormState) => PoolFormState) => void;
  saving: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Reconfigures an existing mailbox's daily limit and warmup ramp — the
 * "reconfigure a mailbox" action from the admin-only gate, opened from
 * MailboxCard's "Limits" button. Never touches SMTP credentials, so it only
 * ever shows the Sending section.
 */
export const MailboxLimitsDialog: React.FC<MailboxLimitsDialogProps> = ({
  open, onOpenChange, label, form, onFormChange, saving, error, onSubmit,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Sending limits — {label}</DialogTitle>
        <DialogDescription>Daily volume and warmup ramp for this mailbox.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}
        <SendingFields
          idPrefix="limits"
          values={form}
          onChange={(patch) => onFormChange((f) => ({ ...f, ...patch }))}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);

export default AccountFormDialog;
