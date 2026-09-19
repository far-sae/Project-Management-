import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Info, Loader2, Plus, Save, SendHorizonal } from 'lucide-react';
import {
  MAIL_PROVIDERS, providerById, providerForEmail, providerForHost, settingsFor,
  type ProviderId,
} from '@/lib/email/providers';
import { MailboxImapFields, type ImapFieldsValues } from './MailboxImapFields';
import { MailboxSendingFields, type SendingFieldsValues } from './MailboxSendingFields';

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
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  sentFolderEnabled: boolean;
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
  // IMAP is optional — see MailboxImapFields — so a blank host here is a
  // complete, valid submission, not a field left unfilled.
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  sentFolderEnabled: true,
};

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
  // Derived, never stored: the picker reflects whatever host the form holds.
  const selectedProvider: ProviderId = providerForHost(form.smtpHost);
  const activeProvider = providerById(selectedProvider);

  /**
   * Fills the sending and inbox servers in from a preset.
   *
   * IMAP goes in alongside SMTP deliberately. It is optional — a mailbox with
   * no IMAP host is simply never scanned — but leaving it blank when the
   * answer is known means replies and bounces go undetected for a mailbox
   * that could have had both for free, and no screen ever says that is why.
   *
   * "Other" clears nothing. Somebody who picked Gmail by mistake and then
   * chose Other wants to edit those fields, not retype them from memory.
   */
  const applyProvider = (id: string) => {
    const settings = settingsFor(id as ProviderId);
    if (!settings) return;
    onFormChange((f) => ({ ...f, ...settings }));
  };

  /**
   * The address, and a suggestion drawn from its domain.
   *
   * It only ever fills a host that is still EMPTY. Rewriting a host somebody
   * typed — because they later corrected a typo in the address — would be the
   * form quietly undoing their work, and they would not see it happen: the
   * server fields are further down the dialog.
   */
  const onEmailChange = (value: string) => {
    const suggestion = providerForEmail(value);
    onFormChange((f) => {
      const next = { ...f, fromEmail: value };
      if (!suggestion || f.smtpHost.trim() !== '') return next;
      return { ...next, ...(settingsFor(suggestion.id) ?? {}) };
    });
  };

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

          {/*
            Read back from the host rather than held as its own field, so the
            picker tells the truth about a mailbox saved before this existed
            and about one whose host somebody has since edited by hand. There
            is no fourth state to get out of step.
          */}
          <div className="space-y-2">
            <Label htmlFor="acct-provider">Provider</Label>
            <Select value={selectedProvider} onValueChange={applyProvider}>
              <SelectTrigger id="acct-provider">
                <SelectValue placeholder="Pick a provider, or set the server up by hand" />
              </SelectTrigger>
              <SelectContent>
                {MAIL_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                ))}
                <SelectItem value="other">Other — enter the server settings myself</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Fills in the sending and inbox servers for you. Everything below stays editable.
            </p>
          </div>

          {/*
            Shown BEFORE Verify is pressed, which is the whole point: almost
            none of these providers accept an account password any more, and
            the alternative is somebody pasting the password they log in with
            and being handed an SMTP code for their trouble.
          */}
          {activeProvider && (
            <div className="rounded-md border border-border bg-secondary/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{activeProvider.setup}</span>
              </p>
              {activeProvider.warning && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{activeProvider.warning}</span>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="acct-from-email">From email *</Label>
              <Input id="acct-from-email" type="email" value={form.fromEmail} placeholder="hello@acme.com"
                onChange={(e) => onEmailChange(e.target.value)} required />
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
            <MailboxSendingFields
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

          <MailboxImapFields
            idPrefix="acct"
            smtpHost={form.smtpHost}
            values={{
              imapHost: form.imapHost,
              imapPort: form.imapPort,
              imapSecure: form.imapSecure,
              sentFolderEnabled: form.sentFolderEnabled,
            }}
            onChange={(patch) => onFormChange((f) => ({ ...f, ...patch }))}
          />

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

/** Everything MailboxLimitsDialog edits: the Sending fields plus the Inbox
 *  section's IMAP fields, since reconfiguring an existing mailbox is also
 *  where its IMAP settings get filled in or changed after the fact. */
export type MailboxSettingsFormState = PoolFormState & ImapFieldsValues;

interface MailboxLimitsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  /** Used only to derive the Inbox section's host suggestion. */
  smtpHost: string;
  form: MailboxSettingsFormState;
  onFormChange: (updater: (f: MailboxSettingsFormState) => MailboxSettingsFormState) => void;
  saving: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Reconfigures an existing mailbox — the "reconfigure a mailbox" action from
 * the admin-only gate, opened from MailboxCard's "Limits" button. Never
 * touches SMTP credentials (host, port, username, password): those are set
 * once at creation and are not editable here. IMAP is a second identity for
 * the same mailbox, though, and this is where it gets added or changed after
 * the mailbox already exists — which is the ordinary case, since an admin
 * usually creates a mailbox to send from first and only wires up inbox
 * scanning once it is already in use.
 */
export const MailboxLimitsDialog: React.FC<MailboxLimitsDialogProps> = ({
  open, onOpenChange, label, smtpHost, form, onFormChange, saving, error, onSubmit,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Mailbox settings — {label}</DialogTitle>
        <DialogDescription>Daily volume, warmup ramp and inbox scanning for this mailbox.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}
        <MailboxSendingFields
          idPrefix="limits"
          values={form}
          onChange={(patch) => onFormChange((f) => ({ ...f, ...patch }))}
        />
        <MailboxImapFields
          idPrefix="limits"
          smtpHost={smtpHost}
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
