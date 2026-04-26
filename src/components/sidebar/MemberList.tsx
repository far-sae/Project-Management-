import React from 'react';
import { ProjectMember } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemberListProps {
  members: ProjectMember[];
  onMemberClick?: (member: ProjectMember) => void;
  onInviteClick?: () => void;
  selectedMemberId?: string;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  owner: { label: 'Owner', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  admin: { label: 'Admin', className: 'bg-info-soft text-info' },
  member: { label: 'Member', className: 'bg-secondary text-secondary-foreground' },
  viewer: { label: 'Viewer', className: 'bg-success-soft text-success' },
};

export const MemberList: React.FC<MemberListProps> = ({
  members,
  onMemberClick,
  onInviteClick,
  selectedMemberId,
}) => {
  const ROLE_ORDER: Record<string, number> = {
    owner: 3,
    admin: 2,
    member: 1,
    viewer: 0,
  };

  const dedupedMap = new Map<string, ProjectMember>();
  for (const m of members) {
    const key = m.userId || m.email;
    if (!key) continue;
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, m);
    } else {
      const currentRank = ROLE_ORDER[m.role] ?? 0;
      const existingRank = ROLE_ORDER[existing.role] ?? 0;
      if (currentRank > existingRank) {
        dedupedMap.set(key, m);
      }
    }
  }
  const displayMembers = Array.from(dedupedMap.values());

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Members
        </h3>
        {onInviteClick && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-primary hover:text-primary"
            onClick={onInviteClick}
          >
            <UserPlus className="w-3 h-3 mr-1" />
            Invite
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {displayMembers.map((member) => {
          const roleBadge = ROLE_BADGES[member.role] || ROLE_BADGES.member;
          const isSelected = selectedMemberId === member.userId;

          return (
            <button
              key={member.userId}
              onClick={() => onMemberClick?.(member)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isSelected
                  ? 'bg-primary-soft'
                  : 'hover:bg-secondary'
              )}
            >
              <Avatar className="w-8 h-8">
                <AvatarImage src={member.photoURL} alt={member.displayName} />
                <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-sm">
                  {member.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {member.displayName}
                </p>
                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
              </div>

              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  roleBadge.className
                )}
              >
                {roleBadge.label}
              </span>
            </button>
          );
        })}

        {members.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No team members yet
          </p>
        )}
      </div>
    </div>
  );
};

export default MemberList;
