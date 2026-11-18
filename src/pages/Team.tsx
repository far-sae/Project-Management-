import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { removeOrganizationMember, updateOrganization } from '@/services/supabase/organizations';
import { upsertProjectMember, type ProjectRole } from '@/services/supabase/projectMembers';
import type { Organization, OrganizationMember } from '@/types/organization';
import { recordAuditEvent } from '@/services/supabase/auditLog';
import { useProjects } from '@/hooks/useProjects';
import { managedProjects } from '@/lib/projectManagers';
import { useSubscription } from '@/context/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Users, UserPlus, Crown, Shield, User, Loader2,
  Clock, XCircle, Check, Copy, Lock, ArrowRightLeft, Trash2, X,
  type LucideIcon,
} from 'lucide-react';
import {
  createInvitation, getProjectInvitations, cancelInvitation,
} from '@/services/supabase/invitations';
import { ProjectInvitation } from '@/types/invitation';
import { ProjectMember } from '@/types/project';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { MemberContactActions } from '@/components/team/MemberContactActions';
import { MoveMemberDialog } from '@/components/team/MoveMemberDialog';
import { getInvitationEmailFailureHint, sendInvitationEmail } from '@/services/email/emailService';
import { checkTeamMemberLimit, supabase } from '@/services/supabase';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SUPPORT_EMAIL } from '@/lib/support-email';
import {
  Select as RoleSelect, SelectContent as RoleSelectContent, SelectItem as RoleSelectItem,
  SelectTrigger as RoleSelectTrigger, SelectValue as RoleSelectValue,
} from '@/components/ui/select';
import { resolveMemberDisplayName } from '@/lib/memberIdentity';
import {
  getProjectMemberProfiles,
  type ProjectMemberProfile,
} from '@/services/supabase/projectMemberProfiles';

const INVITATION_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

/** Small square tag (4px corners) for a person's role. */
const ROLE_TAG =
  'inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border px-1.5 text-xs font-medium text-muted-foreground';

/** 28px select inside a table row (touch-sized on phones). */
const ROW_SELECT = 'md:h-7 md:px-2 md:text-xs';

/** 28px square icon button in a row (touch-sized on phones). */
const ROW_ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';
const DANGER_ICON_BUTTON = 'text-destructive hover:bg-destructive-soft hover:text-destructive';

const ROLE_TAGS: Record<string, { label: string; Icon: LucideIcon }> = {
  owner: { label: 'Owner', Icon: Crown },
  admin: { label: 'Admin', Icon: Shield },
  viewer: { label: 'Viewer', Icon: User },
};

const getRoleBadge = (role: string) => {
  const { label, Icon } = ROLE_TAGS[role] ?? { label: 'Member', Icon: User };
  return (
    <span className={ROLE_TAG}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
};

/**
 * Inline role picker for a member row — assigns a built-in role.
 */
const MemberRoleSelect: React.FC<{
  userId: string;
  organization: Organization;
  onChanged: () => Promise<void> | void;
}> = ({ userId, organization, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const orgMember = (organization.members ?? []).find((m) => m.userId === userId);
  const role = orgMember?.role ?? 'member';
  const value = `builtin:${role}`;

  const assign = async (v: string) => {
    const next = (organization.members ?? []).map((m) => {
      if (m.userId !== userId) return m;
      return { ...m, role: v.slice('builtin:'.length) as OrganizationMember['role'] };
    });
    setBusy(true);
    try {
      await updateOrganization(organization.organizationId, { members: next });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update access');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <RoleSelect value={value} onValueChange={(v) => void assign(v)}>
        <RoleSelectTrigger
          className={cn(ROW_SELECT, 'w-44')}
          aria-label="Organization role"
          title="Organization role — an organization admin can see and manage every project"
        >
          <RoleSelectValue />
        </RoleSelectTrigger>
        <RoleSelectContent>
          <RoleSelectItem value="builtin:admin">Org admin · all projects</RoleSelectItem>
          <RoleSelectItem value="builtin:member">Org member</RoleSelectItem>
          <RoleSelectItem value="builtin:viewer">Org viewer</RoleSelectItem>
        </RoleSelectContent>
      </RoleSelect>
    </div>
  );
};

export const Team: React.FC = () => {
  const { user } = useAuth();
  const { organization, refreshOrganization, isAdmin } = useOrganization();
  const { projects, refreshProjects } = useProjects();
  const { hasFeature, currentTier, pricing } = useSubscription();
  const navigate = useNavigate();

  const [showInviteModal, setShowInviteModal] = useState(false);
  // Add-existing-member-to-project dialog + per-row project-role busy flag.
  const [openAddMember, setOpenAddMember] = useState(false);
  const [addUserId, setAddUserId] = useState<string>('');
  const [addRole, setAddRole] = useState<ProjectRole>('member');
  const [addBusy, setAddBusy] = useState(false);
  const [roleBusyUserId, setRoleBusyUserId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  // Combined role value: 'builtin:admin|member|viewer' or 'custom:<roleId>'.
  // A custom pick grants the role on accept; the built-in `role` stays as a
  // safe baseline ('member') so deleting the role later degrades gracefully.
  const [inviteRoleValue, setInviteRoleValue] = useState<string>('builtin:member');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [moveMember, setMoveMember] = useState<ProjectMember | null>(null);

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

  // CRM access (Deals/Leads) is governed by the member's assigned role — see
  // the "Roles & access" section above (RolesAndAccessSection + the per-member
  // role picker). Owners/admins always have full access. The old per-member
  // Deals/Leads grant matrix was removed in favour of custom roles.

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
          // Background refresh — don't blank the team list while the user is
          // looking at it. Realtime can fire repeatedly when another tab/window
          // is editing the same project.
          loadTeamData({ silent: true });
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
          loadTeamData({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProject]);


  // Organization admins see every project; project owners / project admins
  // only the projects whose people they manage.
  const selectableProjects = useMemo(
    () => (isAdmin ? projects : managedProjects(projects, user?.userId)),
    [isAdmin, projects, user?.userId],
  );

  useEffect(() => {
    if (selectableProjects.length === 0) return;
    if (!selectedProject || !selectableProjects.some((p) => p.projectId === selectedProject)) {
      setSelectedProject(selectableProjects[0].projectId);
    }
  }, [selectableProjects, selectedProject]);

  const loadTeamData = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const selectedProjectData = projects.find((p) => p.projectId === selectedProject);
    const projectOrgId = selectedProjectData?.organizationId?.replace('local-', '') || '';
    if (!selectedProject) return;
    if (!silent) setLoading(true);
    try {
      type ProjectTeamRow = { owner_id?: string; members?: Array<any>; };
      let projectRow: ProjectTeamRow | null = null;

      // Prefer org-scoped read, but fallback to project_id-only to avoid stale org mismatches.
      if (projectOrgId) {
        const { data } = await supabase
          .from('projects')
          .select('owner_id, members')
          .eq('project_id', selectedProject)
          .eq('organization_id', projectOrgId)
          .maybeSingle();
        projectRow = (data as ProjectTeamRow | null);
      }

      if (!projectRow) {
        const { data } = await supabase
          .from('projects')
          .select('owner_id, members')
          .eq('project_id', selectedProject)
          .maybeSingle();
        projectRow = (data as ProjectTeamRow | null);
      }

      const ownerId = projectRow?.owner_id || selectedProjectData?.ownerId || null;
      // Prefer DB row only when fetch succeeded — avoid stale hook cache showing removed members.
      const membersFromProject = (
        projectRow != null
          ? (projectRow.members || [])
          : (selectedProjectData?.members || [])
      ) as Array<any>;
      setProjectOwnerId(ownerId);

      const [projectInvitations, profiles] = await Promise.all([
        projectOrgId
          ? getProjectInvitations(selectedProject, projectOrgId)
          : Promise.resolve([] as ProjectInvitation[]),
        getProjectMemberProfiles(selectedProject),
      ]);
      setInvitations(projectInvitations);
      const profileMap = new Map<string, ProjectMemberProfile>(
        profiles.map((profile) => [profile.userId, profile]),
      );

      const ownerOrgMember = ownerId
        ? (organization?.members || []).find((m) => m.userId === ownerId)
        : null;

      const assembledMembers: ProjectMember[] = [];
      if (ownerId) {
        const ownerProfile = profileMap.get(ownerId);
        const ownerEmail =
          ownerProfile?.email ||
          ownerOrgMember?.email ||
          (organization?.ownerId === ownerId ? organization.ownerEmail : '') ||
          (ownerId === user?.userId ? user.email : '');
        assembledMembers.push({
          userId: ownerId,
          email: ownerEmail,
          displayName: resolveMemberDisplayName(
            ownerId,
            ownerEmail,
            ownerProfile?.displayName,
            ownerOrgMember?.displayName,
            organization?.ownerId === ownerId ? organization.ownerName : null,
            ownerId === user?.userId ? user.displayName : null,
          ),
          photoURL:
            ownerProfile?.photoURL ||
            ownerOrgMember?.photoURL ||
            (ownerId === user?.userId ? (user.photoURL || '') : ''),
          role: 'owner',
          addedAt: ownerOrgMember?.joinedAt || new Date(),
        });
      }

      for (const member of membersFromProject) {
        const memberId = member?.userId || member?.user_id;
        if (!memberId || (ownerId && memberId === ownerId)) continue;
        const profile = profileMap.get(memberId);
        const orgMember = (organization?.members || []).find((m) => m.userId === memberId);
        const memberEmail = profile?.email || orgMember?.email || member.email || '';
        assembledMembers.push({
          userId: memberId,
          email: memberEmail,
          displayName: resolveMemberDisplayName(
            memberId,
            memberEmail,
            profile?.displayName,
            orgMember?.displayName,
            member.displayName,
            member.display_name,
          ),
          photoURL: profile?.photoURL || orgMember?.photoURL || member.photoURL || member.photo_url || '',
          role: (member.role || 'member') as ProjectMember['role'],
          addedAt: member.addedAt || member.added_at ? new Date(member.addedAt || member.added_at) : new Date(),
        });
      }

      setProjectMembers(assembledMembers);
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Re-run only when the project being viewed (or org/user identity) changes.
  // We intentionally do NOT depend on the `projects` array reference: the
  // visibility-change handlers in useProjects and OrganizationContext silently
  // refetch when a tab regains focus, which would replace the `projects`
  // reference and otherwise loop this effect — flashing the team list back to
  // a loading state every time you switch windows. In-tab project edits stay
  // fresh via the realtime subscription effect above.
  useEffect(() => {
    loadTeamData();
  }, [selectedProject, organization?.organizationId, user?.organizationId, user?.userId]);

  const currentProject = projects.find((p) => p.projectId === selectedProject);
  const organizationMemberMap = new Map(
    (organization?.members || []).map((member) => [member.userId, member])
  );
  const allMembersMap = new Map<string, ProjectMember>();

  for (const member of projectMembers as Array<any>) {
    const memberUserId = member.userId || member.user_id;
    if (!memberUserId) continue;
    const orgMember = organizationMemberMap.get(memberUserId);
    const memberEmail =
      member.email ||
      orgMember?.email ||
      (organization && organization.ownerId === memberUserId ? organization.ownerEmail : '');
    allMembersMap.set(memberUserId, {
      ...member,
      userId: memberUserId,
      email: memberEmail,
      displayName: resolveMemberDisplayName(
        memberUserId,
        memberEmail,
        member.displayName,
        member.display_name,
        orgMember?.displayName,
        organization && organization.ownerId === memberUserId ? organization.ownerName : null,
      ),
      photoURL: member.photoURL || member.photo_url || orgMember?.photoURL || '',
      role: memberUserId === currentProject?.ownerId ? 'owner' : (member.role || 'member'),
      addedAt: member.addedAt || member.added_at || orgMember?.joinedAt || new Date(),
    });
  }

  const effectiveOwnerId = projectOwnerId || currentProject?.ownerId || null;
  if (effectiveOwnerId && !allMembersMap.has(effectiveOwnerId)) {
    const ownerFromOrg = organizationMemberMap.get(effectiveOwnerId);
    const ownerEmail =
      ownerFromOrg?.email ||
      (organization?.ownerId === effectiveOwnerId ? organization.ownerEmail : '') ||
      (effectiveOwnerId === user?.userId ? user.email : '');
    allMembersMap.set(effectiveOwnerId, {
      userId: effectiveOwnerId,
      email: ownerEmail,
      displayName: resolveMemberDisplayName(
        effectiveOwnerId,
        ownerEmail,
        ownerFromOrg?.displayName,
        organization?.ownerId === effectiveOwnerId ? organization.ownerName : null,
        effectiveOwnerId === user?.userId ? user.displayName : null,
      ),
      photoURL:
        ownerFromOrg?.photoURL ||
        (effectiveOwnerId === user?.userId ? (user.photoURL || '') : ''),
      role: 'owner',
      addedAt: ownerFromOrg?.joinedAt || new Date(),
    });
  }

  const allMembers = Array.from(allMembersMap.values());

  // Existing org members who aren't already on this project (for "Add member").
  const inProjectIds = new Set(allMembers.map((m) => m.userId));
  const availableToAdd = (organization?.members ?? []).filter(
    (m) => m.status !== 'removed'
      && m.userId !== effectiveOwnerId
      && !inProjectIds.has(m.userId),
  );

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending"
  );
  // Use effectiveOwnerId (from DB + project list) so project owner can always invite
  const isProjectOwner = !!user?.userId && effectiveOwnerId === user.userId;
  /** Project admins manage THIS project's people only (invite, add, remove, roles). */
  const isProjectAdmin = !!user?.userId && allMembers.some(
    (m) => m.userId === user.userId && m.role === 'admin',
  );
  const canManageMembers = isProjectOwner || isAdmin || isProjectAdmin;

  const handleAddMember = async () => {
    if (!selectedProject || !organization || !addUserId) {
      toast.error('Pick a teammate to add');
      return;
    }
    setAddBusy(true);
    try {
      await upsertProjectMember(selectedProject, organization.organizationId, addUserId, addRole);
      setOpenAddMember(false);
      setAddUserId('');
      setAddRole('member');
      await loadTeamData();
      toast.success('Member added to project');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddBusy(false);
    }
  };

  const handleChangeProjectRole = async (userId: string, role: ProjectRole) => {
    if (!selectedProject || !organization) return;
    setRoleBusyUserId(userId);
    try {
      await upsertProjectMember(selectedProject, organization.organizationId, userId, role);
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change project role');
    } finally {
      setRoleBusyUserId(null);
    }
  };

  const handleRemoveMember = async (member: ProjectMember, unassignTasks: boolean) => {
    if (!selectedProject) return;
    if (!canManageMembers) {
      toast.error('Only the project owner or a project admin can remove members.');
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { error } = await supabase.functions.invoke("remove-member", {
        body: {
          projectId: selectedProject,
          memberUserId: member.userId,
          memberEmail: member.email,
          unassignTasks,
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });
      if (error) throw error;

      // Optimistically update local state so the removed member disappears immediately.
      setProjectMembers((prev) =>
        prev.filter((m) => m.userId !== member.userId),
      );

      void recordAuditEvent(
        organization?.organizationId ?? null,
        { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
        {
          action: 'member_removed',
          targetType: 'user',
          targetId: member.userId,
          targetLabel: member.displayName ?? member.email ?? null,
          metadata: { projectId: selectedProject, unassignTasks },
        },
      );

      await refreshProjects();
      await refreshOrganization();
      await loadTeamData();
    } catch (error) {
      console.error('Error removing member:', error);
      setInfoDialog({
        open: true,
        title: "Failed to Remove Member",
        message: "Something went wrong while removing the member.",
      });
    }
  };


  /** Remove from the whole organization: every project, task, invitation. */
  const handleRemoveFromOrganization = async (member: ProjectMember) => {
    if (!organization) return;
    try {
      const summary = await removeOrganizationMember(organization.organizationId, member.userId);
      setProjectMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      void recordAuditEvent(
        organization.organizationId,
        { userId: user?.userId ?? null, displayName: user?.displayName ?? null },
        {
          action: 'member_removed',
          targetType: 'user',
          targetId: member.userId,
          targetLabel: member.displayName ?? member.email ?? null,
          metadata: { scope: 'organization', ...summary },
        },
      );
      toast.success(
        `${member.displayName} was removed from the organization and ${summary.projects} project${summary.projects === 1 ? '' : 's'}`,
      );
      await refreshProjects();
      await refreshOrganization();
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleInvite = async () => {
    if (!user || !selectedProject || !currentProject || !inviteEmail.trim()) return;
    if (!canManageMembers) {
      toast.error('Only the project owner or a project admin can invite members.');
      return;
    }

    // Allow comma- / newline- / semicolon-separated emails so the inviter can
    // bulk-invite the whole crew in one go.
    const rawList = inviteEmail
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    // Dedupe + basic email-shape filter
    const emails = Array.from(new Set(rawList)).filter((e) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
    );

    if (emails.length === 0) {
      setInfoDialog({
        open: true,
        title: 'No valid emails',
        message:
          'Enter one or more email addresses separated by spaces, commas, or new lines.',
      });
      return;
    }

    const selfEmail = user.email?.toLowerCase().trim() ?? '';
    const filtered = emails.filter((e) => e !== selfEmail);
    if (filtered.length === 0) {
      setInfoDialog({
        open: true,
        title: 'Invalid Action',
        message: 'You cannot invite yourself.',
      });
      return;
    }

    const projectOrgId = (currentProject?.organizationId || '').replace('local-', '');
    if (!projectOrgId) return;

    // ✅ Check team member limit BEFORE sending invites — count the entire batch
    const totalCount = allMembers.length + pendingInvitations.length + filtered.length;
    const limitCheck = await checkTeamMemberLimit(
      user.userId,
      totalCount,
      organization?.organizationId,
    );
    if (!limitCheck.allowed) {
      setLimitModal({ open: true, message: limitCheck.message, max: limitCheck.max ?? null });
      return;
    }

    setSending(true);
    const sentTo: string[] = [];
    const failed: { email: string; reason: string }[] = [];
    const manualLinks: { email: string; link: string; reason: string }[] = [];

    const inviteBuiltinRole = inviteRoleValue.slice('builtin:'.length) as 'admin' | 'member' | 'viewer';
    const inviteRoleLabel = inviteBuiltinRole;

    try {
      // Sequential — gives each createInvitation a clean turn for RLS / DB writes.
      for (const email of filtered) {
        try {
          const invitation = await createInvitation(
            selectedProject, currentProject.name, user.userId,
            user.displayName, user.email, projectOrgId,
            {
              projectId: selectedProject, inviteeEmail: email,
              role: inviteBuiltinRole,
            },
          );
          setInvitations((prev) => [invitation, ...prev]);
          const inviteLink = `${window.location.origin}/accept-invite/${invitation.token}`;
          const emailResult = await sendInvitationEmail({
            toEmail: email, inviterName: user.displayName,
            projectName: currentProject.name, inviteLink, role: inviteRoleLabel,
          });
          if (emailResult.ok) {
            sentTo.push(email);
          } else {
            const oAuthHint =
              emailResult.status === 412
                ? `\n${getInvitationEmailFailureHint(emailResult)}`
                : '';
            const serverHint = emailResult.text ? `\nServer: ${emailResult.text}` : '';
            manualLinks.push({
              email,
              link: inviteLink,
              reason: `${oAuthHint}${serverHint}`.trim() || 'Email send failed',
            });
          }
        } catch (perEmailErr) {
          failed.push({
            email,
            reason: perEmailErr instanceof Error ? perEmailErr.message : 'unknown error',
          });
        }
      }

      setInviteEmail('');
      setShowInviteModal(false);

      // Summarize the batch in one dialog
      const lines: string[] = [];
      if (sentTo.length > 0) {
        lines.push(`✅ Sent to ${sentTo.length}: ${sentTo.join(', ')}`);
      }
      if (manualLinks.length > 0) {
        lines.push(
          `⚠️ ${manualLinks.length} invite(s) created but email didn't send. Share these links manually:`,
        );
        manualLinks.forEach((m) => lines.push(`• ${m.email}\n  ${m.link}`));
      }
      if (failed.length > 0) {
        lines.push(`❌ ${failed.length} failed:`);
        failed.forEach((f) => lines.push(`• ${f.email} — ${f.reason}`));
      }

      setInfoDialog({
        open: true,
        title:
          failed.length === 0 && manualLinks.length === 0
            ? 'Invitations Sent'
            : 'Invitations Processed',
        message: lines.join('\n\n'),
      });
    } catch (error) {
      console.error('Error sending invitation:', error);
      setInfoDialog({
        open: true,
        title: 'Invitation Failed',
        message: 'Failed to send invitations. Please try again.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!canManageMembers) {
      toast.error('Only the project owner or a project admin can manage invitations.');
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
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(invitationId);
      setTimeout(() => setCopiedLink(null), 3000);
    } catch (err) {
      console.error('copyInviteLink: clipboard write failed', err);
      toast.error(
        'Could not copy the invite link. Copy it manually or check browser permissions.',
      );
    }
  };

  // ✅ FEATURE GATE — shown if trial or basic plan
  if (!canUseTeam) {
    return (
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">Team</span>} />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
            <PageHeader title="Team" description="Manage your team members and their roles" />
            <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-16 text-center">
              <Lock className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              <h2 className="text-[13px] font-medium text-foreground">Team Collaboration</h2>
              <p className="max-w-md text-xs text-muted-foreground">
                Invite team members, assign roles, and collaborate on projects together.
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Available on Basic plan and above (3 members on Basic, 10 on Advanced)
              </p>
              <Button className="mt-3" onClick={() => navigate('/pricing')}>
                Upgrade to Basic or Advanced
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <AppHeader left={<span className="text-sm font-semibold">Team</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader
            title="Team"
            description={
              canManageMembers && selectedProject
                ? "You can invite people to this project by email and manage their roles."
                : "Manage your team members and their roles"
            }
            actions={
              <>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className="w-full sm:w-52" aria-label="Select project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableProjects.map((project) => (
                      <SelectItem key={project.projectId} value={project.projectId}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => { setAddUserId(''); setAddRole('member'); setOpenAddMember(true); }}
                  disabled={!selectedProject || !canManageMembers}
                  title="Add an existing teammate to this project"
                >
                  Add Member
                </Button>
                <Button
                  onClick={() => setShowInviteModal(true)}
                  disabled={!selectedProject || !canManageMembers}
                  title={!canManageMembers ? "Only the project owner or a project admin can invite" : "Invite people to this project by email"}
                >
                  <UserPlus aria-hidden />
                  Invite Member
                </Button>
              </>
            }
          />

          <StatStrip
            items={[
              { label: 'Total Members', value: allMembers.length },
              {
                label: 'Admins',
                value: allMembers.filter((m) => m.role === 'admin' || m.role === 'owner').length,
              },
              { label: 'Pending Invites', value: pendingInvitations.length ?? 0 },
            ]}
          />

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Team Members</h2>
            <div className="overflow-hidden rounded-lg border border-border">
              {!selectedProject ? (
                <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                  <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-[13px] font-medium">Select a project to view team members</p>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading team members" />
                </div>
              ) : allMembers.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                  <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-[13px] font-medium">No team members yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-[13px]" aria-label="Team members">
                    <thead>
                      <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                        <th scope="col" className="px-4 font-medium">Member</th>
                        <th scope="col" className="px-4 font-medium">Email</th>
                        <th scope="col" className="px-4 font-medium">Role</th>
                        <th scope="col" className="px-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allMembers.map((member) => {
                        const isSelf = member.userId === user?.userId;
                        const isOwnerRow = member.role === 'owner';
                        const canSetOrgRole = isAdmin && !!organization
                          && organization.ownerId !== member.userId
                          && !isSelf
                          && (organization.members ?? []).some((m) => m.userId === member.userId);
                        return (
                          <tr
                            key={member.userId}
                            className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage src={member.photoURL} alt="" />
                                  <AvatarFallback className="text-xs font-semibold">
                                    {member.displayName.charAt(0).toUpperCase() || 'T'}
                                  </AvatarFallback>
                                </Avatar>
                                <p className="max-w-[16rem] truncate font-medium text-foreground">
                                  {member.displayName}
                                  {isSelf && (
                                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(You)</span>
                                  )}
                                </p>
                                {isOwnerRow && <span className={ROLE_TAG}>Owner</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {member.email ? (
                                <p className="max-w-[18rem] truncate">{member.email}</p>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                {canSetOrgRole && organization ? (
                                  <MemberRoleSelect
                                    userId={member.userId}
                                    organization={organization}
                                    onChanged={refreshOrganization}
                                  />
                                ) : (
                                  // The owner is already tagged next to their name.
                                  !isOwnerRow && getRoleBadge(member.role)
                                )}

                                {/* Per-project role (separate from the org-wide role). */}
                                {canManageMembers && !isOwnerRow && !isSelf && (
                                  <RoleSelect
                                    value={member.role}
                                    onValueChange={(v) => void handleChangeProjectRole(member.userId, v as ProjectRole)}
                                  >
                                    <RoleSelectTrigger
                                      className={cn(ROW_SELECT, 'w-40')}
                                      aria-label="Role in this project"
                                      title="Role in this project only — a project admin manages this project's people"
                                    >
                                      {roleBusyUserId === member.userId
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <RoleSelectValue />}
                                    </RoleSelectTrigger>
                                    <RoleSelectContent>
                                      <RoleSelectItem value="admin">Project admin</RoleSelectItem>
                                      <RoleSelectItem value="member">Project member</RoleSelectItem>
                                      <RoleSelectItem value="viewer">Project viewer</RoleSelectItem>
                                    </RoleSelectContent>
                                  </RoleSelect>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                {/* Message / call this person only (never on your own row). */}
                                <MemberContactActions
                                  member={{
                                    userId: member.userId,
                                    displayName: member.displayName,
                                    email: member.email,
                                    photoURL: member.photoURL,
                                  }}
                                  currentUserId={user?.userId}
                                  organizationId={
                                    currentProject?.organizationId ?? organization?.organizationId ?? null
                                  }
                                />

                                {/* Move to the right project - for people added to the wrong one */}
                                {isProjectOwner && member.role !== "owner" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={ROW_ICON_BUTTON}
                                    aria-label={`Move ${member.displayName} to another project`}
                                    title="Move to another project"
                                    onClick={() => setMoveMember(member)}
                                  >
                                    <ArrowRightLeft aria-hidden />
                                  </Button>
                                )}

                                {/* Remove button - hide for owner */}
                                {canManageMembers && member.role !== "owner"
                                  && member.userId !== user?.userId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Remove ${member.displayName} from this project`}
                                    title="Remove from project"
                                    className={cn(ROW_ICON_BUTTON, DANGER_ICON_BUTTON)}
                                    onClick={() => setRemoveMemberId(member.userId)}
                                  >
                                    <Trash2 aria-hidden />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {pendingInvitations.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Pending Invitations</h2>
              <ul className="overflow-hidden rounded-lg border border-border">
                {pendingInvitations.map((invitation) => (
                  <li
                    key={invitation.invitationId}
                    className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-4 py-2 text-[13px] transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 basis-52">
                      <p className="truncate font-medium text-foreground">{invitation.inviteeEmail}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">
                          Expires {INVITATION_DATE_FORMATTER.format(new Date(invitation.expiresAt))}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {getRoleBadge(invitation.role)}
                      <StatusPill tone="warning">Pending</StatusPill>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={ROW_ICON_BUTTON}
                          aria-label={`Copy invitation link for ${invitation.inviteeEmail}`}
                          title="Copy invitation link"
                          onClick={() => copyInviteLink(invitation.token, invitation.invitationId)}
                        >
                          {copiedLink === invitation.invitationId
                            ? <Check className="text-success" aria-hidden />
                            : <Copy aria-hidden />}
                        </Button>
                        {canManageMembers && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Cancel invitation for ${invitation.inviteeEmail}`}
                            title="Cancel invitation"
                            className={cn(ROW_ICON_BUTTON, DANGER_ICON_BUTTON)}
                            onClick={() => setCancelInviteId(invitation.invitationId)}
                          >
                            <X aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Add an existing teammate to this project (no email). */}
      <Dialog open={openAddMember} onOpenChange={(o) => { if (!addBusy) setOpenAddMember(o); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add a member to this project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Add an existing teammate to{' '}
              <strong className="text-foreground">{currentProject?.name ?? 'this project'}</strong>{' '}
              and set their project role.
            </p>
            <div>
              <Label className="text-xs">Member</Label>
              <RoleSelect value={addUserId} onValueChange={setAddUserId}>
                <RoleSelectTrigger><RoleSelectValue placeholder="Pick a teammate" /></RoleSelectTrigger>
                <RoleSelectContent>
                  {availableToAdd.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Everyone in the org is already on this project.
                    </div>
                  ) : availableToAdd.map((m) => (
                    <RoleSelectItem key={m.userId} value={m.userId}>
                      {m.displayName || m.email}
                    </RoleSelectItem>
                  ))}
                </RoleSelectContent>
              </RoleSelect>
            </div>
            <div>
              <Label className="text-xs">Project role</Label>
              <RoleSelect value={addRole} onValueChange={(v) => setAddRole(v as ProjectRole)}>
                <RoleSelectTrigger><RoleSelectValue /></RoleSelectTrigger>
                <RoleSelectContent>
                  <RoleSelectItem value="admin">Admin</RoleSelectItem>
                  <RoleSelectItem value="member">Member</RoleSelectItem>
                  <RoleSelectItem value="viewer">Viewer</RoleSelectItem>
                </RoleSelectContent>
              </RoleSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenAddMember(false)} disabled={addBusy}>Cancel</Button>
            <Button onClick={handleAddMember} disabled={addBusy || !addUserId}>
              {addBusy && <Loader2 className="animate-spin" aria-hidden />}
              Add to project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Invite Team Member(s)</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address(es)</Label>
              <Textarea
                id="email"
                placeholder={"alice@example.com\nbob@example.com, carol@example.com"}
                rows={3}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separate multiple invitees with commas, spaces, or new lines. Everyone gets the role you pick below.
              </p>
              {inviteEmail.trim() && inviteEmail.toLowerCase().trim() === user?.email?.toLowerCase().trim() && (
                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                  <XCircle className="h-3 w-3" aria-hidden />You cannot invite yourself
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={inviteRoleValue} onValueChange={setInviteRoleValue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin:admin">
                    <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-muted-foreground" aria-hidden />Admin - Can manage members and settings</div>
                  </SelectItem>
                  <SelectItem value="builtin:member">
                    <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" aria-hidden />Member - Can create and edit tasks</div>
                  </SelectItem>
                  <SelectItem value="builtin:viewer">
                    <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" aria-hidden />Viewer - Read-only access</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>Cancel</Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || sending || inviteEmail.toLowerCase().trim() === user?.email?.toLowerCase().trim()}
            >
              {sending ? <><Loader2 className="animate-spin" aria-hidden />Sending...</> : 'Send Invite'}
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
            <AlertDialogDescription className="whitespace-pre-line break-words">
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
                    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Add extra team seat (Advanced)&body=Hi, I'd like to add an extra team seat to my Advanced plan.`;
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
                    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Add extra team seat (Advanced)&body=Hi, I'd like to add an extra team seat to my Advanced plan.`;
                  } finally {
                    setAddSeatLoading(false);
                  }
                }}
              >
                {addSeatLoading ? <><Loader2 className="animate-spin" aria-hidden />Processing...</> : `Add seat — ${pricing.currencySymbol}${pricing.tiers.advanced.extraUserPrice}/mo`}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {moveMember && organization && selectedProject && moveMember.role !== 'owner' && (
        <MoveMemberDialog
          open={!!moveMember}
          onOpenChange={(o) => !o && setMoveMember(null)}
          member={{
            userId: moveMember.userId,
            email: moveMember.email,
            displayName: moveMember.displayName,
            role: moveMember.role,
          }}
          currentProjectId={selectedProject}
          organizationId={organization.organizationId}
          projects={projects}
          onMoved={() => {
            void refreshProjects();
            void refreshOrganization();
            void loadTeamData();
          }}
        />
      )}

      <AlertDialog
        open={!!removeMemberId}
        onOpenChange={() => setRemoveMemberId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member?</AlertDialogTitle>
            <AlertDialogDescription>
              {canManageMembers
                ? 'Remove them from this project only (choose whether their tasks stay assigned), or from the whole organization.'
                : 'Remove them from the whole organization.'}
              {isAdmin && ' Removing from the organization takes away access to every project, unassigns their tasks and cancels their invitations. Projects they own move to the organization owner.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="flex-wrap gap-2">
            <AlertDialogCancel onClick={() => setRemoveMemberId(null)}>
              Cancel
            </AlertDialogCancel>

            {isAdmin && (
              <Button
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive-soft hover:text-destructive"
                onClick={async () => {
                  if (removeMemberId) {
                    const member = allMembers.find((m) => m.userId === removeMemberId);
                    if (member) await handleRemoveFromOrganization(member);
                    setRemoveMemberId(null);
                  }
                }}
              >
                Remove from organization
              </Button>
            )}

            {canManageMembers && (
            <Button
              variant="outline"
              onClick={async () => {
                if (removeMemberId) {
                  const member = allMembers.find((m) => m.userId === removeMemberId);
                  if (member) await handleRemoveMember(member, false);
                  setRemoveMemberId(null);
                }
              }}
            >
              Remove from project (keep tasks)
            </Button>
            )}

            {canManageMembers && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (removeMemberId) {
                  const member = allMembers.find((m) => m.userId === removeMemberId);
                  if (member) await handleRemoveMember(member, true);
                  setRemoveMemberId(null);
                }
              }}
            >
              Remove from project & unassign
            </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default Team;
