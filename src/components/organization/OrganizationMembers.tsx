/**
 * Organization Members Component
 * Allows organization owners and admins to manage members
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { createInvitation } from '@/services/supabase/invitations';
import { sendInvitationEmail, isEmailServiceConfigured, openInvitationMailto } from '@/services/email/emailService';
import { toast } from 'sonner';

export const OrganizationMembers: React.FC = () => {
  const { user } = useAuth();
  const { organization, loading, refreshOrganization, canInviteMembers } = useOrganization();
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviting, setInviting] = useState(false);

  const handleSendInvite = async () => {
    if (!organization || !inviteEmail || !canInviteMembers) return;

    setInviting(true);
    try {
      const inviterName = organization.members.find(m => m.userId === organization.ownerId)?.displayName || user?.displayName || 'Admin';
      const inviterEmail = organization.members.find(m => m.userId === organization.ownerId)?.email || user?.email || '';

      const invitation = await createInvitation(
        '', // organization-level invite
        organization.name,
        user?.userId || organization.ownerId,
        inviterName,
        inviterEmail,
        organization.organizationId,
        {
          projectId: '',
          inviteeEmail: inviteEmail,
          role: inviteRole
        }
      );

      const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/accept-invite/${invitation.token}`;
      let emailSent = false;
      if (isEmailServiceConfigured()) {
        emailSent = await sendInvitationEmail({
          toEmail: inviteEmail.trim(),
          inviterName,
          projectName: organization.name,
          inviteLink,
          role: inviteRole,
        });
      }

      if (emailSent) {
        toast.success('Success', {
          description: `Invitation email sent to ${inviteEmail}.`,
        });
      } else {
        openInvitationMailto({
          toEmail: inviteEmail.trim(),
          inviterName,
          projectName: organization.name,
          inviteLink,
          role: inviteRole,
        });
        toast('Email client opened', {
          description: `Send the email to invite ${inviteEmail}.`,
        });
      }

      setInviteEmail('');
      setIsInviteDialogOpen(false);
      await refreshOrganization();
    } catch (error) {
      // console.error('Error sending invitation:', error);
      toast.error('Error', {
        description: 'Failed to send invitation',
      });
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
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

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-red-100 text-red-800 hover:bg-red-100';
      case 'admin':
        return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
      case 'member':
        return 'bg-gray-100 text-gray-800 hover:bg-gray-100';
      default:
        return 'bg-gray-100 text-gray-800 hover:bg-gray-100';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Organization Members</CardTitle>
            <CardDescription>Manage your organization members and their roles</CardDescription>
          </div>
          {canInviteMembers && (
            <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button>Add Member</Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>Invite Member</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="email" className="text-sm font-medium mb-1 block">
                      Email Address
                    </label>
                    <Input
                      id="email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="member@example.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="role" className="text-sm font-medium mb-1 block">
                      Role
                    </label>
                    <Select value={inviteRole} onValueChange={(value: 'member' | 'admin') => setInviteRole(value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={handleSendInvite}
                    disabled={!inviteEmail || inviting}
                    className="w-full"
                  >
                    {inviting ? 'Sending...' : 'Send Invitation'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {organization.members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <Avatar>
                    <AvatarImage src={member.photoURL || ''} alt={member.displayName} />
                    <AvatarFallback>{member.displayName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{member.displayName}</div>
                    <div className="text-sm text-gray-500">{member.email}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getRoleBadgeVariant(member.role)}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </Badge>
                  {member.joinedAt && (
                    <span className="text-xs text-gray-500">
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {organization.members.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No members in this organization yet
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};