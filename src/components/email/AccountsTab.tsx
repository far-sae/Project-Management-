import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Mail, Plus, Loader2, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listMailboxStatus, listAccounts, createAccount, deleteAccount, resumeAccount,
  updateAccountPool, updateAccountImap,
} from '@/services/supabase/email';
import type { EmailAccount, MailboxHealth } from '@/lib/email/types';
import { verifyAccount } from './verifyAccount';
import {
  AccountFormDialog, EMPTY_ACCOUNT_FORM, MailboxLimitsDialog, type MailboxSettingsFormState,
} from './AccountFormDialog';
import { MailboxCard } from './MailboxCard';
import { DomainAuthPanel } from './DomainAuthPanel';

interface AccountsTabProps {
  orgId: string;
  workspaceId: string | null;
  isAdmin: boolean;
}

const EMPTY_POOL_FORM: MailboxSettingsFormState = {
  dailyLimit: '40',
  warmupEnabled: true,
  warmupStartVolume: '5',
  warmupIncrement: '3',
  // IMAP is optional — a mailbox reconfigured with these defaults left alone
  // simply stays unconfigured; see MailboxImapFields.
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  sentFolderEnabled: true,
};

export const AccountsTab: React.FC<AccountsTabProps> = ({ orgId, workspaceId, isAdmin }) => {
  const { user } = useAuth();
  const [mailboxes, setMailboxes] = useState<MailboxHealth[]>([]);
  // Keyed by account id. mailbox_status (the view listMailboxStatus reads)
  // carries none of the IMAP columns migration 157 added, so the IMAP state
  // MailboxCard shows and the values MailboxLimitsDialog edits come from a
  // parallel read of email_accounts itself, kept alongside it rather than
  // folded into MailboxHealth.
  const [accounts, setAccounts] = useState<Record<string, EmailAccount>>({});
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_ACCOUNT_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MailboxHealth | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<MailboxHealth | null>(null);
  const [editForm, setEditForm] = useState<MailboxSettingsFormState>(EMPTY_POOL_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = () => {
    if (!orgId) { setMailboxes([]); setAccounts({}); setLoading(false); return Promise.resolve(); }
    return Promise.all([listMailboxStatus(orgId), listAccounts(orgId)])
      .then(([health, accountRows]) => {
        setMailboxes(health);
        setAccounts(Object.fromEntries(accountRows.map((a) => [a.id, a])));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load mailboxes'));
  };

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const resetForm = () => {
    setForm(EMPTY_ACCOUNT_FORM);
    setCreateError(null);
    setPendingAccountId(null);
  };

  const closeAddDialog = () => {
    setShowAddDialog(false);
    resetForm();
  };

  // A successful test send is proof the credentials work, so api/email/verify
  // clears the automatic pause and the failure streak along with the status —
  // the same state Resume clears. Mirror all of it here, or the card keeps
  // showing a paused mailbox that the database has already let back in.
  const runVerify = async (accountId: string) => {
    const result = await verifyAccount(accountId);
    setMailboxes((prev) => prev.map((m) => {
      if (m.id !== accountId) return m;
      return result.ok
        ? { ...m, status: 'active' as const, consecutiveFailures: 0, pausedReason: null, isActive: true }
        : { ...m, status: 'error' as const };
    }));
    return result;
  };

  // createAccount takes dailyLimit but has no warmup arguments, so the whole
  // Sending section is reapplied here, right after — including dailyLimit
  // again, not just the warmup fields, because the dialog leaves it editable
  // while a retry is pending and updateAccountPool only writes a column when
  // it's given, so a value the admin changed after the first attempt would
  // otherwise be silently dropped on retry (the exact failure class this
  // function exists to close, narrowed to one field). Read from live `form`
  // state throughout for the same reason. warmupStartedOn is set to null
  // when warmup is off, starting it today when warmup is on, since a null
  // warmup_started_on would otherwise hold the mailbox at its start volume
  // forever (migration 156). Shared by handleCreate and the retry path
  // below: updateAccountPool is a plain column update, not an insert, so
  // calling it again is idempotent and exactly what finishes the job if it
  // was this step, not verification, that failed the first time.
  //
  // warmupStartedOn is stamped with `new Date()` on every call, including a
  // retry, so a retry that crosses midnight slides the ramp's start date
  // forward rather than preserving the original attempt's timestamp. This
  // is intentional, not a bug: until verification actually succeeds the
  // mailbox's status never reaches 'active', so isSendable() keeps it out of
  // the pool regardless of what warmup_started_on says — nothing is sent on
  // the strength of a start date that only got as far as an unverified
  // account. Re-stamping "now" on every retry can only ever push the ramp's
  // day-0 later, never earlier, which is the conservative direction for a
  // mechanism whose entire purpose is protecting a cold mailbox's
  // reputation: at worst a slow retry costs the mailbox a day of ramp
  // progress it hadn't actually earned yet (nothing had sent), never a day
  // it's given credit for sending more than it should.
  const applyPoolSettings = (accountId: string) => updateAccountPool(accountId, {
    dailyLimit: Number(form.dailyLimit) || 40,
    warmupEnabled: form.warmupEnabled,
    warmupStartedOn: form.warmupEnabled ? new Date() : null,
    warmupStartVolume: Number(form.warmupStartVolume) || 0,
    warmupIncrement: Number(form.warmupIncrement) || 0,
  });

  // IMAP is optional, so an untouched (blank) host here writes exactly the
  // same "unconfigured" state createAccount's own row defaults already left
  // the mailbox in — this call is never a way to accidentally turn scanning
  // on. Read from live `form` state for the same reason applyPoolSettings
  // is: the dialog leaves these fields editable across a retry.
  const applyImapSettings = (accountId: string) => updateAccountImap(accountId, {
    imapHost: form.imapHost.trim() || null,
    imapPort: Number(form.imapPort) || 993,
    imapSecure: form.imapSecure,
    sentFolderEnabled: form.sentFolderEnabled,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !orgId) return;
    setCreateError(null);
    setCreating(true);
    try {
      const account = await createAccount({
        organizationId: orgId,
        workspaceId,
        userId: user?.userId ?? null,
        label: form.label.trim(),
        fromName: form.fromName.trim(),
        fromEmail: form.fromEmail.trim(),
        replyTo: form.replyTo.trim() || null,
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort) || 587,
        smtpSecure: form.smtpSecure,
        smtpUsername: form.smtpUsername.trim(),
        password: form.password,
        dailyLimit: Number(form.dailyLimit) || 40,
      });
      // Set the instant the account row exists, before anything else that
      // could fail — applyPoolSettings, applyImapSettings, refresh, or
      // verification. Otherwise a failure in one of those lands in the catch
      // block with pendingAccountId still null, canRetry reads false, the
      // dialog offers "Save and verify" instead of "Retry", and a second
      // submit creates a second mailbox row for the same SMTP account (there
      // is no uniqueness constraint to stop it).
      setPendingAccountId(account.id);
      await applyPoolSettings(account.id);
      await applyImapSettings(account.id);
      await refresh();
      setCreating(false);

      const result = await runVerify(account.id);
      if (result.ok) {
        toast.success('Sending mailbox created and verified');
        closeAddDialog();
      } else {
        // The account row already exists (createAccount succeeded); leave
        // the dialog open so the SMTP error — the actionable part — stays
        // visible. It's already in the list behind the dialog too.
        setCreateError(result.error ?? 'Verification failed');
      }
    } catch (err) {
      // pendingAccountId is already set by this point whenever createAccount
      // itself succeeded (see above), so this failure — whether it's
      // applyPoolSettings, refresh, or something else — still resumes via
      // Retry rather than reinserting the account.
      setCreateError(err instanceof Error ? err.message : 'Failed to create mailbox');
      void refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleRetryVerify = async () => {
    if (!pendingAccountId) return;
    setCreating(true);
    setCreateError(null);
    try {
      // Reapply the pool and IMAP settings before verifying: canRetry goes
      // true for *any* failure after createAccount, not only a verification
      // failure, so a first attempt that failed on applyPoolSettings or
      // applyImapSettings must not be "retried" by verification alone — that
      // would report the mailbox as verified while its warmup, daily limit
      // or inbox settings silently stayed at column defaults, with nothing
      // in the UI saying so.
      await applyPoolSettings(pendingAccountId);
      await applyImapSettings(pendingAccountId);
      await refresh();
      const result = await runVerify(pendingAccountId);
      if (result.ok) {
        toast.success('Sending mailbox verified');
        closeAddDialog();
      } else {
        setCreateError(result.error ?? 'Verification failed');
      }
    } catch (err) {
      // The pool update (or refresh) failed again — keep the dialog open
      // with the message rather than closing on a success that didn't
      // happen; canRetry stays true so the next click retries the same way.
      setCreateError(err instanceof Error ? err.message : 'Failed to update sending limits');
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (mailbox: MailboxHealth) => {
    if (!isAdmin) return;
    setTestingId(mailbox.id);
    const result = await runVerify(mailbox.id);
    if (result.ok) {
      toast.success(`Test email sent to ${user?.email ?? 'your inbox'}`);
    } else {
      toast.error(result.error ?? 'Verification failed');
    }
    setTestingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !isAdmin) return;
    setDeleting(true);
    try {
      await deleteAccount(deleteTarget.id);
      setMailboxes((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      toast.success('Mailbox deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete mailbox');
    } finally {
      setDeleting(false);
    }
  };

  const handleResume = async (mailbox: MailboxHealth) => {
    if (!isAdmin) return;
    setResumingId(mailbox.id);
    try {
      await resumeAccount(mailbox.id);
      setMailboxes((prev) => prev.map((m) => (m.id === mailbox.id
        ? { ...m, pausedReason: null, consecutiveFailures: 0, isActive: true }
        : m)));
      toast.success('Mailbox resumed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume mailbox');
    } finally {
      setResumingId(null);
    }
  };

  const openEdit = (mailbox: MailboxHealth) => {
    if (!isAdmin) return;
    const account = accounts[mailbox.id];
    setEditTarget(mailbox);
    setEditForm({
      dailyLimit: String(mailbox.dailyLimit ?? 40),
      warmupEnabled: mailbox.warmupEnabled ?? false,
      warmupStartVolume: String(mailbox.warmupStartVolume ?? 5),
      warmupIncrement: String(mailbox.warmupIncrement ?? 3),
      // Falls back to EMPTY_POOL_FORM's own IMAP defaults when the parallel
      // listAccounts() read hasn't landed yet — the form still opens, it
      // just starts from "unconfigured" rather than this mailbox's actual
      // saved values, which get overwritten by whatever is submitted first.
      // In practice `accounts` and `mailboxes` load together off the same
      // `refresh()`, so this is a same-tick race rather than a real gap.
      imapHost: account?.imapHost ?? '',
      imapPort: String(account?.imapPort ?? 993),
      imapSecure: account?.imapSecure ?? true,
      sentFolderEnabled: account?.sentFolderEnabled ?? true,
    });
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editTarget) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await updateAccountPool(editTarget.id, {
        dailyLimit: Number(editForm.dailyLimit) || 1,
        warmupEnabled: editForm.warmupEnabled,
        warmupStartVolume: Number(editForm.warmupStartVolume) || 0,
        warmupIncrement: Number(editForm.warmupIncrement) || 0,
        // Only starts the ramp when it wasn't already running, so re-saving
        // limits on a mailbox mid-warmup doesn't reset its day count to zero.
        warmupStartedOn: editForm.warmupEnabled ? (editTarget.warmupStartedOn ?? new Date()) : null,
      });
      await updateAccountImap(editTarget.id, {
        imapHost: editForm.imapHost.trim() || null,
        imapPort: Number(editForm.imapPort) || 993,
        imapSecure: editForm.imapSecure,
        sentFolderEnabled: editForm.sentFolderEnabled,
      });
      toast.success('Mailbox settings updated');
      setEditTarget(null);
      await refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update mailbox settings');
    } finally {
      setSavingEdit(false);
    }
  };

  const canSubmit = !!(form.label.trim() && form.fromName.trim() && form.fromEmail.trim()
    && form.smtpHost.trim() && form.smtpUsername.trim() && form.password);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Sending mailboxes</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              The pool campaigns send from, rotated and warmed up.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />Add mailbox
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!isAdmin && (
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <Lock className="w-4 h-4" />
              Only an organization owner or admin can add, test, delete or reconfigure mailboxes.
            </div>
          )}
          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading mailboxes...</p>
            </div>
          ) : mailboxes.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">No sending mailboxes yet</p>
              <p className="text-sm">Add an SMTP mailbox to start sending campaigns.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mailboxes.map((mailbox) => (
                <MailboxCard
                  key={mailbox.id}
                  mailbox={mailbox}
                  account={accounts[mailbox.id]}
                  isAdmin={isAdmin}
                  testing={testingId === mailbox.id}
                  resuming={resumingId === mailbox.id}
                  onSendTest={() => handleTest(mailbox)}
                  onDelete={() => setDeleteTarget(mailbox)}
                  onResume={() => handleResume(mailbox)}
                  onReconfigure={() => openEdit(mailbox)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DomainAuthPanel mailboxes={mailboxes} />

      <AccountFormDialog
        open={showAddDialog}
        onOpenChange={(open) => { if (!open) closeAddDialog(); else setShowAddDialog(true); }}
        form={form}
        onFormChange={setForm}
        creating={creating}
        createError={createError}
        canRetry={!!(createError && pendingAccountId)}
        canSubmit={canSubmit}
        onSubmit={handleCreate}
        onRetry={handleRetryVerify}
      />

      <MailboxLimitsDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        label={editTarget?.label ?? ''}
        smtpHost={(editTarget && accounts[editTarget.id]?.smtpHost) ?? ''}
        form={editForm}
        onFormChange={setEditForm}
        saving={savingEdit}
        error={editError}
        onSubmit={handleSaveEdit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete mailbox?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `"${deleteTarget.label}" will be removed. Campaigns already sent from it keep their history.`}
              {' '}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void handleDelete(); }}
            >
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AccountsTab;
