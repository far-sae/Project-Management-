import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { useSubscription } from '@/context/SubscriptionContext';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Users, UserPlus, Mail, Crown, Shield, User, Loader2,
  Clock, XCircle, Check, Copy, Lock,
} from 'lucide-react';
import {
  createInvitation, getProjectInvitations, cancelInvitation,
} from '@/services/supabase/invitations';
import { ProjectInvitation } from '@/types/invitation';
import { ProjectMember } from '@/types/project';
import { sendInvitationEmail } from '@/services/email/emailService';
import { checkTeamMemberLimit, supabase } from '@/services/supabase';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

const OWNER_EMAIL = 'smtkur31@gmail.com';

export const Team: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();
  const { hasFeature, currentTier, pricing } = useSubscription();
  const navigate = useNavigate();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const [infoDialog, setInfoDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
  }>({
    open: false,
    title: "",
    message: "",
  });

  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);

  const [limitModal, setLimitModal] = useState<{ open: boolean; message: string; max: number | null }>({
    open: false,
    message: '',
    max: null,
  });
  const [addSeatLoading, setAddSeatLoading] = useState(false);

  // ✅ Check feature access
  const canUseTeam = hasFeature('team_collaboration');

  useEffect(() => {
    if (!selectedProject) return;

    const channel = supabase
      .channel(`team-${selectedProject}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "invitations",
          filter: `project_id=eq.${selectedProject}`,
        },
        () => {
          loadTeamData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `project_id=eq.${selectedProject}`,
        },
        () => {
          loadTeamData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProject]);


  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].projectId);
    }
  }, [projects, selectedProject]);

  const loadTeamData = async () => {
    const selectedProjectData = projects.find((p) => p.projectId === selectedProject);
    const projectOrgId = selectedProjectData?.organizationId?.replace('local-', '') || '';
    if (!selectedProject) return;
    setLoading(true);
    try {
      type ProjectTeamRow = { owner_id?: string; };
      let projectRow: ProjectTeamRow | null = null;

      // Prefer org-scoped read, but fallback to project_id-only to avoid stale org mismatches.
      if (projectOrgId) {
        const { data } = await supabase
          .from('projects')
          .select('owner_id')
          .eq('project_id', selectedProject)
          .eq('organization_id', projectOrgId)
          .maybeSingle();
        projectRow = (data as ProjectTeamRow | null);
      }

      if (!projectRow) {
        const { data } = await supabase
          .from('projects')
          .select('owner_id')
          .eq('project_id', selectedProject)
          .maybeSingle();
        projectRow = (data as ProjectTeamRow | null);
      }

      const ownerId = projectRow?.owner_id || selectedProjectData?.ownerId || null;
      setProjectOwnerId(ownerId);

      if (projectOrgId) {
        const projectInvitations = await getProjectInvitations(selectedProject, projectOrgId);
        setInvitations(projectInvitations);
      } else {
        setInvitations([]);
      }

      const { data: acceptedInvites } = await supabase
        .from('invitations')
        .select('email, role, accepted_at, status')
        .eq('project_id', selectedProject)
        .eq('status', 'accepted');

      const acceptedEmails = (acceptedInvites || [])
        .map((inv: any) => (inv.email || '').toLowerCase().trim())
        .filter((email: string) => !!email);

      let profileMap = new Map<string, any>();
      if (acceptedEmails.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, display_name, photo_url')
          .in('email', acceptedEmails);

        profileMap = new Map(
          (profiles || []).map((p: any) => [
            (p.email || '').toLowerCase().trim(),
            p,
          ]),
        );
      }

      const ownerOrgMember = ownerId
        ? (organization?.members || []).find((m) => m.userId === ownerId)
        : null;

      const assembledMembers: ProjectMember[] = [];
      if (ownerId) {
        assembledMembers.push({
          userId: ownerId,
          email: ownerOrgMember?.email || (ownerId === user?.userId ? user.email : ''),
          displayName: ownerOrgMember?.displayName || (ownerId === user?.userId ? user.displayName : 'Owner'),
          photoURL: ownerOrgMember?.photoURL || (ownerId === user?.userId ? (user.photoURL || '') : ''),
          role: 'owner',
          addedAt: ownerOrgMember?.joinedAt || new Date(),
        });
      }

      for (const inv of acceptedInvites || []) {
        const email = (inv.email || '').toLowerCase().trim();
        if (!email) continue;
        const profile = profileMap.get(email);
        const memberId = profile?.id || email;
        if (ownerId && memberId === ownerId) continue;
        assembledMembers.push({
          userId: memberId,
          email: profile?.email || inv.email || '',
          displayName: profile?.display_name || inv.email || 'Member',
          photoURL: profile?.photo_url || '',
          role: (inv.role || 'member') as ProjectMember['role'],
          addedAt: inv.accepted_at ? new Date(inv.accepted_at) : new Date(),
        });
      }

      setProjectMembers(assembledMembers);
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeamData();
  }, [selectedProject, projects, organization?.organizationId, user?.organizationId, user?.userId]);

  const currentProject = projects.find((p) => p.projectId === selectedProject);
  const organizationMemberMap = new Map(
    (organization?.members || []).map((member) => [member.userId, member])
  );
  const allMembersMap = new Map<string, ProjectMember>();

  for (const member of projectMembers as Array<any>) {
    const memberUserId = member.userId || member.user_id;
    if (!memberUserId) continue;
    const orgMember = organizationMemberMap.get(memberUserId);
    allMembersMap.set(memberUserId, {
      ...member,
      userId: memberUserId,
      email: member.email || orgMember?.email || '',
      displayName: member.displayName || member.display_name || orgMember?.displayName || orgMember?.email || 'Member',
      photoURL: member.photoURL || member.photo_url || orgMember?.photoURL || '',
      role: memberUserId === currentProject?.ownerId ? 'owner' : (member.role || 'member'),
      addedAt: member.addedAt || member.added_at || orgMember?.joinedAt || new Date(),
    });
  }

  const effectiveOwnerId = projectOwnerId || currentProject?.ownerId || null;
  if (effectiveOwnerId && !allMembersMap.has(effectiveOwnerId)) {
    const ownerFromOrg = organizationMemberMap.get(effectiveOwnerId);
    allMembersMap.set(effectiveOwnerId, {
      userId: effectiveOwnerId,
      email: ownerFromOrg?.email || (effectiveOwnerId === user?.userId ? user.email : ''),
      displayName:
        ownerFromOrg?.displayName ||
        (effectiveOwnerId === user?.userId ? user.displayName : 'Owner'),
      photoURL:
        ownerFromOrg?.photoURL ||
        (effectiveOwnerId === user?.userId ? (user.photoURL || '') : ''),
      role: 'owner',
      addedAt: ownerFromOrg?.joinedAt || new Date(),
    });
  }

  const allMembers = Array.from(allMembersMap.values());

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending"
  );
  // Use effectiveOwnerId (from DB + project list) so project owner can always invite
  const isProjectOwner = !!user?.userId && effectiveOwnerId === user.userId;

  const handleRemoveMember = async (member: ProjectMember) => {
    if (!selectedProject) return;
    if (!isProjectOwner) {
      toast.error('Only the project owner can remove members.');
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await supabase.functions.invoke("remove-member", {
        body: {
          projectId: selectedProject,
          memberUserId: member.userId,
          memberEmail: member.email,
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      // Optimistically update local state so the removed member disappears immediately.
      setProjectMembers((prev) =>
        prev.filter((m) => m.userId !== member.userId),
      );

      loadTeamData();
    } catch {
      setInfoDialog({
        open: true,
        title: "Failed to Remove Member",
        message: "Something went wrong while removing the member.",
      });
    }
  };


  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner': return <Badge className="bg-yellow-100 text-yellow-800"><Crown className="w-3 h-3 mr-1" />Owner</Badge>;
      case 'admin': return <Badge className="bg-purple-100 text-purple-800"><Shield className="w-3 h-3 mr-1" />Admin</Badge>;
      case 'viewer': return <Badge className="bg-gray-100 text-gray-800"><User className="w-3 h-3 mr-1" />Viewer</Badge>;
      default: return <Badge className="bg-blue-100 text-blue-800"><User className="w-3 h-3 mr-1" />Member</Badge>;
    }
  };

  const handleInvite = async () => {
    if (!user || !selectedProject || !currentProject || !inviteEmail.trim()) return;
    if (!isProjectOwner) {
      toast.error('Only the project owner can invite members.');
      return;
    }
    if (inviteEmail.toLowerCase().trim() === user.email?.toLowerCase().trim()) {
      setInfoDialog({
        open: true,
        title: "Invalid Action",
        message: "You cannot invite yourself.",
      });
      return;
    }
    const projectOrgId = (currentProject?.organizationId || '').replace('local-', '');
    if (!projectOrgId) return;

    // ✅ Check team member limit BEFORE sending invite
    const limitCheck = await checkTeamMemberLimit(user.userId, allMembers.length, organization?.organizationId);
    if (!limitCheck.allowed) {
      setLimitModal({ open: true, message: limitCheck.message, max: limitCheck.max ?? null });
      return;
    }

    setSending(true);
    try {
      const invitation = await createInvitation(
        selectedProject, currentProject.name, user.userId,
        user.displayName, user.email, projectOrgId,
        { projectId: selectedProject, inviteeEmail: inviteEmail.trim(), role: inviteRole }
      );
      setInvitations((prev) => [invitation, ...prev]);
      const inviteLink = `${window.location.origin}/accept-invite/${invitation.token}`;
      const emailSent = await sendInvitationEmail({
        toEmail: inviteEmail.trim(), inviterName: user.displayName,
        projectName: currentProject.name, inviteLink, role: inviteRole,
      });
      setInviteEmail('');
      setShowInviteModal(false);
      if (emailSent) {
        setInfoDialog({
          open: true,
          title: "Invitation Sent",
          message: `Email successfully delivered to ${inviteEmail.trim()}.`,
        });
      } else {
        setInfoDialog({
          open: true,
          title: "Invitation Created",
          message: `Email failed. Share this link manually:\n\n${inviteLink}`,
        });
      }
    } catch (error) {
      console.error('Error sending invitation:', error);
      setInfoDialog({
        open: true,
        title: "Invitation Failed",
        message: "Failed to send invitation. Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!isProjectOwner) {
      toast.error('Only the project owner can manage invitations.');
      return;
    }

    const projectOrgId = (currentProject?.organizationId || '').replace('local-', '');
    if (!projectOrgId) return;
    try {
      await cancelInvitation(invitationId, projectOrgId);
      setInvitations((prev) =>
        prev.map((inv) => inv.invitationId === invitationId ? { ...inv, status: 'expired' } : inv)
      );
    } catch (error) {
      console.error('Error cancelling invitation:', error);
    }
  };

  const copyInviteLink = async (token: string, invitationId: string) => {
    const link = `${window.location.origin}/accept-invite/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedLink(invitationId);
    setTimeout(() => setCopiedLink(null), 3000);
  };

  // ✅ FEATURE GATE — shown if trial or basic plan
  if (!canUseTeam) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Team</h1>
            <p className="text-gray-500">Manage your team members and their roles</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Team Collaboration</h2>
            <p className="text-gray-500 mb-2 max-w-md">
              Invite team members, assign roles, and collaborate on projects together.
            </p>
            <p className="text-sm text-orange-600 font-medium mb-6">
              Available on Basic plan and above (3 members on Basic, 10 on Advanced)
            </p>
            <Button
              className="bg-gradient-to-r from-orange-500 to-red-500"
              onClick={() => navigate('/pricing')}
            >
              Upgrade to Basic or Advanced
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Team</h1>
            <p className="text-gray-500">
              {isProjectOwner && selectedProject
                ? "As project owner, you can invite team members by email and manage roles."
                : "Manage your team members and their roles"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setShowInviteModal(true)}
              className="bg-gradient-to-r from-orange-500 to-red-500"
              disabled={!selectedProject || !isProjectOwner}
              title={!isProjectOwner ? "Select a project you own to invite members" : "Invite team members by email"}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Member
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Total Members</CardTitle>
              <Users className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{allMembers.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Admins</CardTitle>
              <Shield className="w-4 h-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {allMembers.filter((m) => m.role === 'admin' || m.role === 'owner').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Pending Invites</CardTitle>
              <Mail className="w-4 h-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {pendingInvitations.length ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Team Members</CardTitle></CardHeader>
          <CardContent>
            {!selectedProject ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Select a project to view team members</p>
              </div>
            ) : loading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-gray-400" />
              </div>
            ) : allMembers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No team members yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {allMembers.map((member) => (
                  <div key={member.userId} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <Avatar>
                        <AvatarImage src={member.photoURL} />
                        <AvatarFallback className="bg-orange-100 text-orange-700">
                          {member.displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-gray-900">
                          {member.displayName}
                          {member.userId === user?.userId && (
                            <span className="ml-2 text-sm text-gray-500">(You)</span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getRoleBadge(member.role)}

                      {/* Remove button - hide for owner */}
                      {isProjectOwner && member.role !== "owner" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => setRemoveMemberId(member.userId)}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className={`transition-all duration-300 ${pendingInvitations.length === 0
          ? "opacity-0 max-h-0 overflow-hidden"
          : "opacity-100 max-h-[1000px]"}`}
        >
          {pendingInvitations.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Pending Invitations</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {pendingInvitations.map((invitation) => (
                    <div key={invitation.invitationId}
                      className="flex items-center justify-between p-4 bg-yellow-50/70 backdrop-blur-sm rounded-xl border border-yellow-200 shadow-sm hover:shadow-md transition"                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                          <Mail className="w-5 h-5 text-yellow-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{invitation.inviteeEmail}</p>
                          <p className="text-sm text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getRoleBadge(invitation.role)}
                        <Button variant="ghost" size="sm" onClick={() => copyInviteLink(invitation.token, invitation.invitationId)}>
                          {copiedLink === invitation.invitationId ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                        {isProjectOwner && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => setCancelInviteId(invitation.invitationId)}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email" type="email" placeholder="colleague@example.com"
                  value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                />
                {inviteEmail.trim() && inviteEmail.toLowerCase().trim() === user?.email?.toLowerCase().trim() && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />You cannot invite yourself
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as typeof inviteRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-purple-500" />Admin - Can manage members and settings</div>
                    </SelectItem>
                    <SelectItem value="member">
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-blue-500" />Member - Can create and edit tasks</div>
                    </SelectItem>
                    <SelectItem value="viewer">
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-gray-500" />Viewer - Read-only access</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowInviteModal(false)}>Cancel</Button>
              <Button
                onClick={handleInvite}
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={!inviteEmail.trim() || sending || inviteEmail.toLowerCase().trim() === user?.email?.toLowerCase().trim()}
              >
                {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : 'Send Invite'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={infoDialog.open}
          onOpenChange={(open) =>
            setInfoDialog((prev) => ({ ...prev, open }))
          }
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{infoDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {infoDialog.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                onClick={() =>
                  setInfoDialog({ open: false, title: "", message: "" })
                }
              >
                OK
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>


        <AlertDialog
          open={!!cancelInviteId}
          onOpenChange={() => setCancelInviteId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Invitation?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to cancel this invitation?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setCancelInviteId(null)}>
                No
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500 hover:bg-red-600"
                onClick={async () => {
                  if (cancelInviteId) {
                    await handleCancelInvitation(cancelInviteId);
                    setCancelInviteId(null);
                  }
                }}
              >
                Yes, Cancel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={limitModal.open}
          onOpenChange={(open) => setLimitModal((p) => ({ ...p, open }))}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Team member limit reached</AlertDialogTitle>
              <AlertDialogDescription>
                {limitModal.message}
                {currentTier === 'basic' && limitModal.max === 3 && (
                  <span className="block mt-2 text-sm">Upgrade to Advanced for up to 10 team members.</span>
                )}
                {currentTier === 'advanced' && limitModal.max === 10 && (
                  <span className="block mt-2 text-sm">
                    Add more seats for {pricing.currencySymbol}{pricing.tiers.advanced.extraUserPrice}/member per month.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setLimitModal({ open: false, message: '', max: null })}>
                Close
              </AlertDialogCancel>
              {currentTier === 'basic' && limitModal.max === 3 && (
                <AlertDialogAction onClick={() => { setLimitModal({ open: false, message: '', max: null }); navigate('/pricing'); }}>
                  Upgrade to Advanced
                </AlertDialogAction>
              )}
              {currentTier === 'advanced' && limitModal.max === 10 && (
                <AlertDialogAction
                  disabled={addSeatLoading}
                  onClick={async () => {
                    setLimitModal({ open: false, message: '', max: null });
                    const priceId = pricing.tiers.advanced.extraUserPriceId;
                    if (!priceId || !user?.userId) {
                      window.location.href = `mailto:${OWNER_EMAIL}?subject=Add extra team seat (Advanced)&body=Hi, I'd like to add an extra team seat to my Advanced plan.`;
                      return;
                    }
                    setAddSeatLoading(true);
                    const toastId = toast.loading('Redirecting to checkout...');
                    try {
                      await supabase.auth.refreshSession();
                      const { data: { session } } = await supabase.auth.getSession();
                      const token = session?.access_token;
                      const origin = window.location.origin;
                      const { data, error } = await supabase.functions.invoke('create-checkout-extra-seat', {
                        body: {
                          extraUserPriceId: priceId,
                          userId: user.userId,
                          successUrl: `${origin}/team?extra_seat=success`,
                          cancelUrl: `${origin}/team`,
                        },
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (error || !data?.url) throw new Error(error?.message || 'Checkout failed');
                      toast.dismiss(toastId);
                      window.location.href = data.url;
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed to start checkout', { id: toastId });
                      window.location.href = `mailto:${OWNER_EMAIL}?subject=Add extra team seat (Advanced)&body=Hi, I'd like to add an extra team seat to my Advanced plan.`;
                    } finally {
                      setAddSeatLoading(false);
                    }
                  }}
                >
                  {addSeatLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : `Add seat — ${pricing.currencySymbol}${pricing.tiers.advanced.extraUserPrice}/mo`}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={!!removeMemberId}
          onOpenChange={() => setRemoveMemberId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Team Member?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this member from the project?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setRemoveMemberId(null)}>
                Cancel
              </AlertDialogCancel>

              <AlertDialogAction
                className="bg-red-500 hover:bg-red-600"
                onClick={async () => {
                  if (removeMemberId) {
                    const member = allMembers.find((m) => m.userId === removeMemberId);
                    if (member) await handleRemoveMember(member);
                    setRemoveMemberId(null);
                  }
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
};

export default Team;
