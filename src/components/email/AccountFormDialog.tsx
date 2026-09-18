import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, SendHorizonal } from 'lucide-react';

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
};

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: AccountFormState;
  onFormChange: (updater: (f: AccountFormState) => AccountFormState) => void;
  creating: boolean;
  createError: string | null;
  /** True once a "create" already succeeded but verification failed — the
   *  footer switches from "create" to "retry the same account" so a second
   *  submit doesn't insert a duplicate row. */
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            {canRetry ? (
              <Button type="button" onClick={onRetry} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SendHorizonal className="w-4 h-4 mr-2" />}
                Retry verification
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

export default AccountFormDialog;
