import React, { useMemo } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
  Plus,
  CheckCircle2,
  Activity as ActivityIcon,
  ListTree,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';
import { useActivity } from '@/hooks/useActivity';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { formatDistanceToNow } from 'date-fns';

interface ProjectRightRailProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteClick?: () => void;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  owner: {
    label: 'Owner',
    className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  admin: { label: 'Admin', className: 'bg-info-soft text-info' },
  member: {
    label: 'Member',
    className: 'bg-secondary text-secondary-foreground',
  },
  viewer: { label: 'Viewer', className: 'bg-success-soft text-success' },
};

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  task_created: Plus,
  task_updated: ListTree,
  task_viewed: ActivityIcon,
  subtask_created: ListTree,
  subtask_done: CheckCircle2,
  comment_added: MessageSquare,
  project_viewed: ActivityIcon,
};

const summarizeActivity = (
  type: string,
  payload?: { subtaskTitle?: string; status?: string; completed?: boolean },
) => {
  switch (type) {
    case 'task_created':
      return 'created the task';
    case 'task_updated':
      if (payload?.status) return `moved to ${payload.status}`;
      return 'updated the task';
    case 'subtask_created':
      return payload?.subtaskTitle
        ? `added subtask "${payload.subtaskTitle}"`
        : 'added a subtask';
    case 'subtask_done':
      return payload?.completed
        ? `completed subtask "${payload?.subtaskTitle ?? ''}"`
        : `reopened subtask "${payload?.subtaskTitle ?? ''}"`;
    case 'comment_added':
      return 'commented';
    case 'task_viewed':
      return 'opened the task';
    case 'project_viewed':
      return 'opened the project';
    default:
      return type.replace(/_/g, ' ');
  }
};

export const ProjectRightRail: React.FC<ProjectRightRailProps> = ({
  project,
  open,
  onOpenChange,
  onInviteClick,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId =
    organization?.organizationId ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : '');
  const { events } = useActivity(orgId || null, 30);

  const projectEvents = useMemo(
    () => events.filter((e) => e.projectId === project.projectId).slice(0, 12),
    [events, project.projectId],
  );

  const dedupedMembers = useMemo(() => {
    const map = new Map<string, (typeof project.members)[number]>();
    const ROLE_ORDER: Record<string, number> = {
      owner: 3,
      admin: 2,
      member: 1,
      viewer: 0,
    };
    for (const m of project.members ?? []) {
      const key = m.userId || m.email;
      if (!key) continue;
      const existing = map.get(key);
      if (
        !existing ||
        (ROLE_ORDER[m.role] ?? 0) > (ROLE_ORDER[existing.role] ?? 0)
      ) {
        map.set(key, m);
      }
    }
    return Array.from(map.values());
  }, [project.members]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Open project rail"
        className="absolute right-3 top-3 z-20 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary shadow-sm"
      >
        <PanelRightOpen className="w-4 h-4" />
      </button>
    );
  }

  return (
    <aside className="w-72 shrink-0 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Project
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Hide project rail"
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Members */}
        <section className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Members ({dedupedMembers.length})
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
          <div className="space-y-1">
            {dedupedMembers.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                No members yet
              </p>
            )}
            {dedupedMembers.map((m) => {
              const role = ROLE_BADGES[m.role] || ROLE_BADGES.member;
              return (
                <div
                  key={m.userId || m.email}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary"
                >
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={m.photoURL} alt={m.displayName} />
                    <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                      {m.displayName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {m.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {m.email}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full',
                      role.className,
                    )}
                  >
                    {role.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* Activity */}
        <section className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Activity
          </h3>
          <div className="space-y-3">
            {projectEvents.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                No recent activity
              </p>
            )}
            {projectEvents.map((e) => {
              const Icon = ACTIVITY_ICONS[e.type] || ActivityIcon;
              return (
                <div key={e.activityId} className="flex gap-2">
                  <Avatar className="w-6 h-6 shrink-0">
                    <AvatarImage src={e.photoURL} alt={e.displayName} />
                    <AvatarFallback className="bg-secondary text-foreground text-[10px]">
                      {(e.displayName || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed">
                      <span className="font-medium text-foreground">
                        {e.displayName}
                      </span>{' '}
                      <span className="text-muted-foreground">
                        {summarizeActivity(e.type, e.payload as any)}
                      </span>
                      {e.taskTitle && (
                        <>
                          {' '}
                          <span className="text-foreground">{e.taskTitle}</span>
                        </>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Icon className="w-3 h-3" />
                      {formatDistanceToNow(new Date(e.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
};

export default ProjectRightRail;
