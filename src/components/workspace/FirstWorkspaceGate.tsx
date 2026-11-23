// Every organisation works in a workspace its own people made and named.
// There is no ready-made "General" any more: a new organisation is asked for
// its first workspace before anything else, and an organisation that still has
// only the old "General" is asked to give it a real name (nothing in it moves).
import React, { useState } from 'react';
import { Boxes, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useWorkspaceScope } from '@/context/WorkspaceContext';
import { publicMessage } from '@/lib/publicError';
import { WORKSPACE_NAME_MAX, isPlaceholderWorkspaceName, workspaceToName } from '@/lib/workspaceDisplay';
import { createWorkspace, updateWorkspace } from '@/services/supabase/workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const FirstWorkspaceGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaces, workspacesKnown, select, refreshWorkspaces } = useWorkspaceScope();
  const { organization, isAdmin } = useOrganization();
  const { signOut } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const organizationId = organization?.organizationId ?? '';
  // Until the list of workspaces is known for this organisation (signing in, a
  // reload), nobody is stopped. A stand-in organisation kept only in the
  // browser has no workspaces to make either.
  if (!workspacesKnown || !organizationId || organizationId.startsWith('local-')) return <>{children}</>;

  const none = workspaces.length === 0;
  const unnamed = none ? null : workspaceToName(workspaces);
  // Only the people who can make or rename a workspace are asked. A member is
  // never locked out of the app waiting for somebody else to do it.
  if (!isAdmin || (!none && !unnamed)) return <>{children}</>;

  const typed = name.trim();
  const ownName = typed !== '' && !isPlaceholderWorkspaceName(typed);
  const ready = ownName && typed.length <= WORKSPACE_NAME_MAX && !busy;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      let id: string;
      if (unnamed) {
        await updateWorkspace(unnamed.workspaceId, { name: typed });
        id = unnamed.workspaceId;
      } else {
        // The organisation's main workspace: the one every plan includes.
        id = (await createWorkspace({ name: typed, organizationId, isDefault: true })).workspaceId;
      }
      await refreshWorkspaces();
      select(id);
    } catch (err) {
      toast.error(publicMessage(err, unnamed ? 'The name could not be saved. Please try again.' : 'The workspace could not be created. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-background">
          <Boxes className="h-4 w-4" aria-hidden />
        </span>

        {(
          <form
            onSubmit={(event) => { event.preventDefault(); void save(); }}
            className="mt-4 flex flex-col gap-4"
          >
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {unnamed ? 'Name your workspace' : 'Create your first workspace'}
              </h1>
              <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
                {unnamed
                  ? 'Your workspace is still called “General”. Give it a name of your own. Everything in it stays where it is.'
                  : 'A workspace holds your projects, your leads and your team’s work. You can add more workspaces later.'}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first-workspace-name">Workspace name</Label>
              <Input
                id="first-workspace-name"
                autoFocus
                maxLength={WORKSPACE_NAME_MAX}
                placeholder="For example, your company or your team"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              {typed !== '' && !ownName && (
                <p className="text-xs text-muted-foreground">
                  Give it a name of your own, like the name of your company or your team.
                </p>
              )}
            </div>
            <Button type="submit" disabled={!ready}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {unnamed ? 'Save name' : 'Create workspace'}
            </Button>
          </form>
        )}

        <button
          type="button"
          className="mt-4 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

export default FirstWorkspaceGate;
