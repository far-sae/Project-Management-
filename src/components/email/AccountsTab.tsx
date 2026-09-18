import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Mail, Plus, Loader2, CheckCircle2, AlertCircle, Clock, Trash2, SendHorizonal, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { listAccounts, createAccount, deleteAccount } from '@/services/supabase/email';
import type { EmailAccount } from '@/lib/email/types';
import { verifyAccount } from './verifyAccount';
import { AccountFormDialog, EMPTY_ACCOUNT_FORM } from './AccountFormDialog';

interface AccountsTabProps {
  orgId: string;
  workspaceId: string | null;
  isAdmin: boolean;
}

const statusBadge = (account: EmailAccount) => {
  if (account.status === 'active') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3 mr-1" />Active
      </Badge>
    );
  }
  if (account.status === 'error') {
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
        <AlertCircle className="w-3 h-3 mr-1" />Error
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Clock className="w-3 h-3 mr-1" />Unverified
    </Badge>
  );
};

export const AccountsTab: React.FC<AccountsTabProps> = ({ orgId, workspaceId, isAdmin }) => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_ACCOUNT_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmailAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    if (!orgId) { setAccounts([]); setLoading(false); return Promise.resolve(); }
    return listAccounts(orgId)
      .then(setAccounts)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load accounts'));
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

  const runVerify = async (accountId: string) => {
    const result = await verifyAccount(accountId);
    setAccounts((prev) => prev.map((a) => (a.id === accountId
      ? {
        ...a,
        status: result.ok ? 'active' : 'error',
        lastError: result.ok ? null : (result.error ?? 'Verification failed'),
        lastVerifiedAt: result.ok ? new Date() : a.lastVerifiedAt,
      }
      : a)));
    return result;
  };

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
      });
      setAccounts((prev) => [account, ...prev]);
      setPendingAccountId(account.id);
      setCreating(false);

      const result = await runVerify(account.id);
      if (result.ok) {
        toast.success('Sending account created and verified');
        closeAddDialog();
      } else {
        // The account row already exists (createAccount succeeded); leave
        // the dialog open so the SMTP error — the actionable part — stays
        // visible. It's already in the list behind the dialog too.
        setCreateError(result.error ?? 'Verification failed');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create account');
      void refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleRetryVerify = async () => {
    if (!pendingAccountId) return;
    setCreating(true);
    const result = await runVerify(pendingAccountId);
    setCreating(false);
    if (result.ok) {
      toast.success('Sending account verified');
      closeAddDialog();
    } else {
      setCreateError(result.error ?? 'Verification failed');
    }
  };

  const handleTest = async (account: EmailAccount) => {
    if (!isAdmin) return;
    setTestingId(account.id);
    const result = await runVerify(account.id);
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
      setAccounts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      toast.success('Account deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  const canSubmit = !!(form.label.trim() && form.fromName.trim() && form.fromEmail.trim()
    && form.smtpHost.trim() && form.smtpUsername.trim() && form.password);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Sending accounts</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">SMTP identities campaigns send from.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
            <Plus className="w-4 h-4 mr-2" />Add account
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!isAdmin && (
          <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />Only an organization owner or admin can add, test or delete accounts.
          </div>
        )}
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
            <p>Loading accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Mail className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
            <p className="text-lg font-medium text-foreground">No sending accounts yet</p>
            <p className="text-sm">Add an SMTP account to start sending campaigns.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => (
              <div key={account.id} className="p-4 bg-secondary/40 border border-border rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">{account.label}</p>
                      {statusBadge(account)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {account.fromName} &lt;{account.fromEmail}&gt;
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {account.smtpHost}:{account.smtpPort}
                    </p>
                    {account.status === 'error' && account.lastError && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{account.lastError}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingId === account.id}
                        onClick={() => handleTest(account)}
                      >
                        {testingId === account.id
                          ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          : <SendHorizonal className="w-4 h-4 mr-1" />}
                        Send test to me
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete account"
                        onClick={() => setDeleteTarget(account)}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sending account?</AlertDialogTitle>
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
    </Card>
  );
};

export default AccountsTab;
