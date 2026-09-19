import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  ProspectsTab, GroupsTab, AccountsTab, ComposeTab, CampaignsTab, SequencesTab,
  SuppressionTab, SettingsTab,
} from '@/components/email';

/**
 * Prospects and Groups lead, in that order: they are the audience, and every
 * tab after them is something you do to it. Campaigns stays the landing tab —
 * it is what an admin opens the page to check.
 */
type EmailTabValue =
  | 'prospects' | 'groups' | 'campaigns' | 'sequences' | 'compose'
  | 'accounts' | 'suppression' | 'settings';

export const Email: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin } = useOrganization();
  const { selectedId, isAll } = useSelectedWorkspace();
  const [activeTab, setActiveTab] = useState<EmailTabValue>('campaigns');

  const orgId = organization?.organizationId ?? user?.organizationId ?? '';
  const workspaceId = isAll ? null : selectedId;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-3xl font-bold text-foreground">Email</h1>
        <p className="text-muted-foreground">
          Send campaigns from your own SMTP accounts and track who received them.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EmailTabValue)}>
        <TabsList>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
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
