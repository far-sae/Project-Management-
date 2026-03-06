/**
 * Organization Dashboard Component
 * Main page for organization management
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Users, Settings, CreditCard, BarChart3 } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { OrganizationMember } from '@/types/organization';
import { OrganizationSettings } from '@/components/organization/OrganizationSettings';
import { OrganizationMembers } from '@/components/organization/OrganizationMembers';

export const OrganizationDashboard: React.FC = () => {
  const { organization, loading, error } = useOrganization();

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        Error: {error}
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="text-center py-8 text-gray-500">
        No organization found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="text-gray-500">Manage your organization settings and members</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
            {organization.subscription.status}
          </span>
          {organization.subscription.tier && (
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              {organization.subscription.tier}
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="members" className="flex items-center space-x-2">
            <Users className="h-4 w-4" />
            <span>Members</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center space-x-2">
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center space-x-2">
            <CreditCard className="h-4 w-4" />
            <span>Billing</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center space-x-2">
            <BarChart3 className="h-4 w-4" />
            <span>Analytics</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4">
          <OrganizationMembers />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <OrganizationSettings />
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Billing & Subscription</CardTitle>
              <CardDescription>Manage your organization's billing and subscription</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 border rounded-lg">
                  <div>
                    <h3 className="font-medium">Current Plan</h3>
                    <p className="text-sm text-gray-500">
                      {organization.subscription.tier || 'Free Trial'} • {organization.subscription.status}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      {organization.subscription.tier ? '$9.99/month' : 'Free Trial'}
                    </p>
                    {organization.subscription.trialEndDate && (
                      <p className="text-sm text-gray-500">
                        Trial ends: {new Date(organization.subscription.trialEndDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Projects</CardTitle>
                      <CardDescription>Total projects in organization</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{organization.metrics.totalProjects}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Members</CardTitle>
                      <CardDescription>Total members in organization</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{organization.members.length}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Tasks</CardTitle>
                      <CardDescription>Total tasks in organization</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{organization.metrics.totalTasks}</div>
                    </CardContent>
                  </Card>
                </div>

                <Button className="w-full">
                  Upgrade Plan
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Analytics</CardTitle>
              <CardDescription>Track your organization's activity and usage</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                Analytics dashboard coming soon
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">ID</span>
              <span className="font-mono text-sm">{organization.organizationId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span>{organization.createdAt ? new Date(organization.createdAt).toLocaleDateString() : 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Owner</span>
              <span>
                {organization.members.find((m: OrganizationMember) => m.userId === organization.ownerId)?.displayName || 'Unknown'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full">
              Export Data
            </Button>
            <Button variant="outline" className="w-full">
              Invite Multiple Members
            </Button>
            <Button variant="outline" className="w-full text-red-600 hover:text-red-700">
              Archive Organization
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};