import React, { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  ProspectsTab, GroupsTab, TemplatesTab, AccountsTab, ComposeTab, CampaignsTab,
  SequencesTab, SuppressionTab, SettingsTab,
} from '@/components/email';
import type { EmailTemplate } from '@/lib/email/types';
import { readiness, type Readiness } from '@/lib/email/readiness';
import { listAccounts, listMailboxStatus } from '@/services/supabase/email';
import { SetupChecklist } from '@/components/email/SetupChecklist';

/**
 * Prospects and Groups lead, in that order: they are the audience, and every
 * tab after them is something you do to it. Templates follows them — it is the
 * last thing that exists before a message does. Campaigns stays the landing
 * tab; it is what an admin opens the page to check.
 */
type EmailTabValue =
  | 'prospects' | 'groups' | 'templates' | 'campaigns' | 'sequences' | 'compose'
  | 'accounts' | 'suppression' | 'settings';

export const Email: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin } = useOrganization();
  const { selectedId, isAll } = useSelectedWorkspace();
  const [activeTab, setActiveTab] = useState<EmailTabValue>('campaigns');
  /**
   * A template on its way into the composer. Held here rather than in
   * TemplatesTab because the hand-off crosses tabs, and cleared by ComposeTab
   * the moment it lands so that picking the same template twice registers as
   * a second request rather than as no change at all.
   */
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);

  const useTemplate = useCallback((template: EmailTemplate) => {
    setPendingTemplate(template);
    setActiveTab('compose');
  }, []);
  const clearPendingTemplate = useCallback(() => setPendingTemplate(null), []);

  const orgId = organization?.organizationId ?? user?.organizationId ?? '';
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
          <TabsTrigger value="compose">Compose</TabsTrigger>
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
          <CampaignsTab orgId={orgId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="sequences">
          <SequencesTab orgId={orgId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="compose">
          <ComposeTab
            orgId={orgId}
            workspaceId={workspaceId}
            isAdmin={isAdmin}
            onSent={() => setActiveTab('campaigns')}
            pendingTemplate={pendingTemplate}
            onTemplateLoaded={clearPendingTemplate}
          />
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
    </main>
  );
};

export default Email;
