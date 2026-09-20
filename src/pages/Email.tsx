import React, { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  ProspectsTab, GroupsTab, TemplatesTab, AccountsTab, ComposeTab, CampaignsTab,
  SequencesTab, SuppressionTab, SettingsTab,
} from '@/components/email';
import type { EmailTemplate } from '@/lib/email/types';
import { readiness, type Readiness } from '@/lib/email/readiness';
import { queryableOrgId } from '@/lib/email/orgId';
import { listAccounts, listMailboxStatus } from '@/services/supabase/email';
import { SetupChecklist } from '@/components/email/SetupChecklist';

/**
 * Prospects and Groups lead, in that order: they are the audience, and every
 * tab after them is something you do to it. Templates follows them — it is the
 * last thing that exists before a message does. Campaigns stays the landing
 * tab; it is what an admin opens the page to check.
 */
type EmailTabValue =
  | 'prospects' | 'groups' | 'templates' | 'campaigns' | 'sequences'
  | 'accounts' | 'suppression' | 'settings';

export const Email: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin, loading: orgLoading } = useOrganization();
  const { selectedId, isAll } = useSelectedWorkspace();
  const [activeTab, setActiveTab] = useState<EmailTabValue>('campaigns');
  /**
   * A template on its way into the composer. Held here rather than in
   * TemplatesTab because the hand-off crosses tabs, and cleared by ComposeTab
   * the moment it lands so that picking the same template twice registers as
   * a second request rather than as no change at all.
   */
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);
  /** True while the campaign composer is open in place of the campaign list. */
  const [composing, setComposing] = useState(false);

  const useTemplate = useCallback((template: EmailTemplate) => {
    setPendingTemplate(template);
    // Campaigns, in its composing state — there is no Compose tab to go to
    // any more, and a template is wording for a campaign or for a sequence
    // step, both of which are reached from the thing they belong to.
    setComposing(true);
    setActiveTab('campaigns');
  }, []);
  const clearPendingTemplate = useCallback(() => setPendingTemplate(null), []);

  /**
   * The organization to query with, or '' while one is still resolving.
   *
   * AuthContext fills `user.organizationId` with `local-<user id>` the instant
   * a session exists, so the interface has something to render against before
   * OrganizationContext finishes. Passing that through to a query does not
   * return nothing — it returns 400, because every organization_id in this
   * feature is a uuid column and `local-…` is not a uuid. Campaigns, accounts
   * and mailbox health all failed together and it read like a broken feature
   * rather than a page that asked a few hundred milliseconds too early.
   *
   * Every screen here already guards on `if (!orgId)`, so '' takes the path
   * those guards were written for.
   */
  const orgId = queryableOrgId(organization?.organizationId ?? user?.organizationId);
  const workspaceId = isAll ? null : selectedId;

  /**
   * Where setup has got to, read once here and shown above the tabs.
   *
   * Above them, not inside Accounts, because the tabs are in the order they
   * were built rather than the order somebody works: Accounts sits near the
   * end and Compose will take a campaign from an organization that has no
   * mailbox at all. Somebody can write most of an email before anything tells
   * them it cannot be sent.
   *
   * A failure to read it is swallowed: this annotates the page and must never
   * be the reason the page does not load.
   */
  const [setup, setSetup] = useState<Readiness | null>(null);

  const loadReadiness = useCallback(async () => {
    if (!orgId) { setSetup(null); return; }
    try {
      const [accounts, health] = await Promise.all([
        listAccounts(orgId),
        listMailboxStatus(orgId),
      ]);
      setSetup(readiness(accounts, health));
    } catch {
      setSetup(null);
    }
  }, [orgId]);

  useEffect(() => { void loadReadiness(); }, [loadReadiness]);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-3xl font-bold text-foreground">Email</h1>
        <p className="text-muted-foreground">
          Send campaigns from your own SMTP accounts and track who received them.
        </p>
      </div>

      {/*
        Nothing is queried, and nothing claims to be empty, until there is a
        real organization to query for. Rendering the tabs against a
        not-yet-resolved organization means every list shows its "nothing yet"
        state for a person who may well have hundreds of things — which is the
        same lie as an error rendered as an empty list, arriving a different
        way.
      */}
      {!orgId ? (
        <div className="py-16 text-center text-muted-foreground">
          {orgLoading ? (
            <>
              <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-muted-foreground/60" />
              <p>Loading your workspace…</p>
            </>
          ) : (
            <p>
              No organization is selected, so there is nothing to send from yet.
            </p>
          )}
        </div>
      ) : (
      <>
      <div className="mb-6">
        {setup && (
          <SetupChecklist readiness={setup} onGoToAccounts={() => setActiveTab('accounts')} />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EmailTabValue)}>
        <TabsList>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="suppression">Suppression</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="prospects">
          <ProspectsTab orgId={orgId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsTab orgId={orgId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="templates">
          <TemplatesTab orgId={orgId} workspaceId={workspaceId} onUseTemplate={useTemplate} />
        </TabsContent>

        <TabsContent value="campaigns">
          {/* One surface, two states: the list, or the composer that adds to
              it. Compose was a tab of its own, which read as a third place to
              write an email beside Campaigns and Sequences — and it is not
              one, it is the form that creates a campaign. */}
          {composing ? (
            <ComposeTab
              orgId={orgId}
              workspaceId={workspaceId}
              isAdmin={isAdmin}
              onSent={() => { setComposing(false); }}
              onCancel={() => setComposing(false)}
              pendingTemplate={pendingTemplate}
              onTemplateLoaded={clearPendingTemplate}
            />
          ) : (
            <CampaignsTab
              orgId={orgId}
              workspaceId={workspaceId}
              onNewCampaign={() => setComposing(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="sequences">
          <SequencesTab orgId={orgId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="accounts">
          <AccountsTab orgId={orgId} workspaceId={workspaceId} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="suppression">
          <SuppressionTab orgId={orgId} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab orgId={orgId} isAdmin={isAdmin} orgTimezone={organization?.settings?.timezone ?? 'UTC'} />
        </TabsContent>
      </Tabs>
      </>
      )}
    </main>
  );
};

export default Email;
