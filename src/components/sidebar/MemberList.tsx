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
  owner: { label: 'Owner', className: 'bg-purple-100 text-purple-700' },
  admin: { label: 'Admin', className: 'bg-blue-100 text-blue-700' },
  member: { label: 'Member', className: 'bg-gray-100 text-gray-700' },
  viewer: { label: 'Viewer', className: 'bg-green-100 text-green-700' },
};

export const MemberList: React.FC<MemberListProps> = ({
  members,
  onMemberClick,
  onInviteClick,
  selectedMemberId,
}) => {
  // Deduplicate by userId/email and prefer highest role so old/stale entries
  // (or duplicates in the serialized project.members array) don't show up
  // multiple times in the sidebar.
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
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Members
        </h3>
        {onInviteClick && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-orange-600 hover:text-orange-700"
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
                  ? 'bg-orange-100'
                  : 'hover:bg-gray-100'
              )}
            >
              <Avatar className="w-8 h-8">
                <AvatarImage src={member.photoURL} alt={member.displayName} />
                <AvatarFallback className="bg-orange-100 text-orange-700 text-sm">
                  {member.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {member.displayName}
                </p>
                <p className="text-xs text-gray-500 truncate">{member.email}</p>
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
          <p className="text-sm text-gray-400 text-center py-4">
            No team members yet
          </p>
        )}
      </div>
    </div>
  );
};

export default MemberList;
