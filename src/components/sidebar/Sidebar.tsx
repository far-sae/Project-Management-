import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  Users,
  Calendar,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  CreditCard,
  Shield,
  GanttChartSquare,
  Lock,
  Unlock,
  Inbox,
  Star,
  Activity,
  ChevronUp,
  ChevronDown,
  Menu,
  X,
  Clock,
  Receipt,
  UserCircle,
  Wallet,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useProjectChrome } from '@/context/ProjectChromeContext';
import { useProjects } from '@/hooks/useProjects';
import {
  ALL_WORKSPACES_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { usePinnedProjects } from '@/hooks/usePinnedProjects';
import { QuickMenu } from './QuickMenu';
import { StatusFilters } from './StatusFilters';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { ThemeQuickToggle } from './ThemeQuickToggle';
import { ClockButton } from '@/components/time/ClockButton';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { resolveTaskDisplayColumnId } from '@/lib/kanbanTaskColumn';
import { TaskCalendarLogo } from '@/components/brand/TaskCalendarLogo';
import {
  isProjectLockUnlockedInSession,
  clearProjectLockUnlockedInSession,
} from '@/lib/projectLockPin';
import { toast } from 'sonner';

const QUICK_ITEMS_FULL = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
  { icon: CheckSquare, label: 'My Tasks', href: '/tasks' },
  { icon: Inbox, label: 'Inbox', href: '/inbox' },
  { icon: Calendar, label: 'Calendar', href: '/calendar' },
  { icon: Activity, label: 'Workload', href: '/workload' },
  { icon: BarChart3, label: 'Reports', href: '/reports' },
];

// Members get a deliberately small surface: just the personal-productivity
// pages. No Dashboard / Inbox / Reports — those are admin/owner views.
const QUICK_ITEMS_MEMBER = [
  { icon: CheckSquare, label: 'My Tasks', href: '/tasks' },
  { icon: Calendar, label: 'Calendar', href: '/calendar' },
  { icon: Activity, label: 'Workload', href: '/workload' },
];

// Viewers are read-only observers (clients, auditors). They don't get tasks
// assigned, don't clock in, don't have a workload. Just Calendar to see what's
// scheduled — the project list in the sidebar handles browsing.
const QUICK_ITEMS_VIEWER = [
  { icon: Calendar, label: 'Calendar', href: '/calendar' },
];

export const Sidebar: React.FC = () => {
  const { project, tasks, selectedStatus, onStatusChange, columns } =
    useProjectChrome();
  const { user, signOut } = useAuth();
  const { trialInfo, hasFeature } = useSubscription();
  const { isAdmin: isOrgAdminOrOwner, isViewer } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();
  // Owner + admin see HR / Payroll / Time / Expenses; members must use the
  // task-level "Add expense" dialog instead.
  const canSeePeopleOps = isOrgAdminOrOwner || isAppOwner(user?.userId);

  const { projects } = useProjects();
  const { selectedId: selectedWorkspaceId, isAll, isUnassigned } =
    useSelectedWorkspace();
  const { pinnedIds, isPinned, toggle: togglePin } = usePinnedProjects();

  const visibleProjects = useMemo(() => {
    if (isAll) return projects;
    if (isUnassigned) return projects.filter((p) => !p.workspaceId);
    return projects.filter((p) => {
      if (!p.workspaceId) return true;
      return p.workspaceId === selectedWorkspaceId;
    });
  }, [projects, selectedWorkspaceId, isAll, isUnassigned]);

  const sortedProjects = useMemo(() => {
    const pinnedSet = new Set(pinnedIds);
    return [...visibleProjects].sort((a, b) => {
      const ap = pinnedSet.has(a.projectId) ? 0 : 1;
      const bp = pinnedSet.has(b.projectId) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
  }, [visibleProjects, pinnedIds]);

  /** Current project first when viewing a board, then the rest (for quick switching). */
  const projectsForNav = useMemo(() => {
    if (!project) return sortedProjects;
    const others = sortedProjects.filter((p) => p.projectId !== project.projectId);
    const self = sortedProjects.find((p) => p.projectId === project.projectId) ?? project;
    return [self, ...others];
  }, [sortedProjects, project]);

  const [footerExpanded, setFooterExpanded] = useState(false);
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the mobile drawer on route change so a tap on a nav link doesn't
  // leave the overlay obscuring the page they just navigated to.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the mobile drawer is open so the page underneath
  // doesn't scroll behind the overlay.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const bottomMenuItems = canSeePeopleOps
    ? ([
        { icon: Users, label: 'Team', href: '/team', feature: 'team_collaboration' as const },
        { icon: Building2, label: 'Clients', href: '/clients', feature: null },
        { icon: GanttChartSquare, label: 'Timeline', href: '/timeline', feature: 'timeline_overview' as const },
        { icon: FileText, label: 'Contracts', href: '/contracts', feature: 'contracts' as const },
        { icon: FileText, label: 'Files', href: '/files', feature: 'file_attachments' as const },
        { icon: MessageSquare, label: 'Comments', href: '/comments', feature: null },
        { icon: Clock, label: 'Time Tracking', href: '/time', feature: null },
        { icon: Receipt, label: 'Expenses', href: '/expenses', feature: null },
        { icon: UserCircle, label: 'HR', href: '/hr', feature: null },
        { icon: Wallet, label: 'Payroll', href: '/payroll', feature: null },
      ] as const)
    : isViewer
      ? ([
          // Viewers get Timeline only; no Clients (read-only access there is
          // still subject to other product decisions). Project list in the
          // sidebar above is enough to navigate the projects they were given.
          // Not subscription-gated — members inherit the owner's plan, and
          // hiding Timeline behind the owner's tier means an invited viewer
          // on a Basic-plan org has no link to view the projects they were
          // granted access to. Timeline is essentially a project-info view
          // for invitees, not a premium-tier feature here.
          { icon: GanttChartSquare, label: 'Timeline', href: '/timeline', feature: null },
        ] as const)
      : ([
          // Members see Timeline + their personal Files page. Clients/CRM,
          // Team, Contracts, Comments, etc. stay admin/owner-only. Files
          // is per-user personal storage (no sharing) and is treated as a
          // baseline feature — not gated on the owner's subscription —
          // because every non-viewer should be able to keep personal
          // documents regardless of plan tier.
          { icon: GanttChartSquare, label: 'Timeline', href: '/timeline', feature: null },
          { icon: FileText, label: 'Files', href: '/files', feature: null },
        ] as const);

  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    if (columns && columns.length > 0) {
      columns.forEach((c) => { counts[c.id] = 0; });
      tasks.forEach((t) => {
        const col = resolveTaskDisplayColumnId(t.status, columns);
        if (counts[col] !== undefined) counts[col]++;
      });
    } else {
      const defaults = { undefined: 0, todo: 0, inprogress: 0, done: 0, needreview: 0 };
      Object.assign(counts, defaults);
      tasks.forEach((t) => {
        if (counts[t.status] !== undefined) counts[t.status]++;
      });
    }
    return counts;
  }, [tasks, columns]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin' || isAppOwner(user?.userId);

  // The body of the sidebar is rendered once and reused inside both the
  // desktop static aside and the mobile slide-in drawer. Each wrapper supplies
  // its own width / position classes; everything inside is layout-agnostic.
  const body = (
    <>
      {/* Brand + workspace switcher */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/dashboard"
            className="flex min-w-0 items-center gap-2 leading-none"
          >
            <TaskCalendarLogo sizeClass="h-8 w-8" />
            <h1 className="truncate font-semibold text-foreground">TaskCalendar</h1>
          </Link>
          <NotificationBell />
        </div>
        <WorkspaceSwitcher />
      </div>

      {trialInfo && trialInfo.isInTrial && canSeePeopleOps && (
        <div className="mx-3 mt-3 p-3 bg-primary-soft border border-primary/20 rounded-lg">
          <p className="text-sm font-medium text-primary-soft-foreground">
            Trial: {trialInfo.daysRemaining} days left
          </p>
          <Button
            variant="link"
            className="text-xs text-primary p-0 h-auto"
            onClick={() => navigate('/pricing')}
          >
            <CreditCard className="w-3 h-3 mr-1" />
            Upgrade now
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {/* Quick navigation — full / member / viewer surfaces */}
        <QuickMenu
          items={
            canSeePeopleOps
              ? QUICK_ITEMS_FULL
              : isViewer
                ? QUICK_ITEMS_VIEWER
                : QUICK_ITEMS_MEMBER
          }
        />

        {/* Project context: status filters + members live here when in a project */}
        {project && onStatusChange && (
          <StatusFilters
            selectedStatus={selectedStatus}
            onStatusChange={onStatusChange}
            taskCounts={taskCounts}
            columns={columns}
          />
        )}

        {/* Projects list — also on project board for quick switching */}
        <div>
          <div className="flex items-stretch gap-1 mb-0">
            <button
              type="button"
              onClick={() => setProjectsSectionOpen((v) => !v)}
              className="flex-1 flex items-center justify-between gap-2 min-w-0 px-1 py-0.5 rounded-md hover:bg-secondary/60 transition-colors text-left"
              aria-expanded={projectsSectionOpen}
            >
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {project ? 'Switch project' : 'Projects'}
              </h3>
              <span className="inline-flex items-center gap-1 shrink-0">
                <span className="text-xs text-muted-foreground/70">
                  {projectsForNav.length}
                </span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-muted-foreground transition-transform duration-300 ease-out',
                    projectsSectionOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </span>
            </button>
          </div>
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: projectsSectionOpen ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              <nav
                className={cn(
                  'space-y-0.5 pt-2',
                  project && 'max-h-44 overflow-y-auto pr-0.5',
                )}
              >
                {projectsForNav.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">
                    No projects yet
                  </p>
                )}
                {projectsForNav.slice(0, 30).map((p) => {
                  const active = location.pathname === `/project/${p.projectId}`;
                  const pinned = isPinned(p.projectId);
                  const sessionUnlocked =
                    p.isLocked &&
                    p.hasLockPin &&
                    isProjectLockUnlockedInSession(
                      p.projectId,
                      p.lockPinVersion ?? 0,
                    );
                  return (
                    <div
                      key={p.projectId}
                      className={cn(
                        'group flex items-center gap-2 rounded-lg pr-1 transition-colors',
                        active
                          ? 'bg-primary-soft text-primary-soft-foreground'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      <Link
                        to={`/project/${p.projectId}`}
                        className="flex-1 flex items-center gap-2 min-w-0 px-2 py-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: p.coverColor || 'hsl(var(--primary))' }}
                        />
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        {p.isLocked && p.hasLockPin && !sessionUnlocked && (
                          <span title="PIN required to open" className="inline-flex">
                            <Lock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-label="Project locked with PIN" />
                          </span>
                        )}
                      </Link>
                      {p.isLocked && p.hasLockPin && sessionUnlocked && (
                        <button
                          type="button"
                          title="Session unlocked — click to require PIN again"
                          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
                          aria-label="Lock project again for this session"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            clearProjectLockUnlockedInSession(
                              p.projectId,
                              p.lockPinVersion ?? 0,
                            );
                            toast.success('PIN will be required again when you open this project.');
                          }}
                        >
                          <Unlock className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          togglePin(p.projectId);
                        }}
                        className={cn(
                          'p-1 rounded-md opacity-0 group-hover:opacity-100 transition',
                          pinned && 'opacity-100 text-warning',
                          'hover:text-warning',
                        )}
                        aria-label={pinned ? 'Unpin project' : 'Pin project'}
                        title={pinned ? 'Unpin' : 'Pin'}
                      >
                        <Star
                          className={cn('w-3.5 h-3.5', pinned && 'fill-current')}
                        />
                      </button>
                    </div>
                  );
                })}
                {projectsForNav.length > 30 && (
                  <Link
                    to="/dashboard"
                    className="block text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
                  >
                    + {projectsForNav.length - 30} more on Dashboard
                  </Link>
                )}
              </nav>
            </div>
          </div>
        </div>

        <Separator />

        {/* Secondary nav */}
        <nav className="space-y-0.5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            Workspace
          </h3>
          {bottomMenuItems.map((item) => {
            const Icon = item.icon;
            const locked = item.feature ? !hasFeature(item.feature as any) : false;
            const active = location.pathname === item.href;

            // Hide locked items entirely for members — they have no path to
            // upgrade and the "click to upgrade" CTA shouldn't reach them.
            if (locked && !canSeePeopleOps) return null;

            return locked ? (
              <button
                key={item.href}
                onClick={() => navigate('/pricing')}
                className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground/70 hover:bg-secondary transition-colors"
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{item.label}</span>
                <Lock className="w-3 h-3" />
              </button>
            ) : (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-soft text-primary-soft-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom: account panel slides up from bottom on open */}
      <div className="p-3 border-t border-border shrink-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {!footerExpanded ? (
            <motion.button
              key="account-collapsed"
              type="button"
              onClick={() => setFooterExpanded(true)}
              className="w-full flex items-center gap-2 rounded-lg border border-border px-2 py-2 text-left hover:bg-secondary transition-colors"
              aria-expanded={false}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarImage src={user?.photoURL} alt={user?.displayName} />
                <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                  {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">Account</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  Theme, settings, sign out
                </p>
              </div>
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
            </motion.button>
          ) : (
            <motion.div
              key="account-expanded"
              className="space-y-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                type="button"
                onClick={() => setFooterExpanded(false)}
                className="w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-expanded
              >
                <span className="font-medium">Account &amp; workspace</span>
                <ChevronDown className="w-4 h-4" aria-hidden />
              </button>
              <ThemeQuickToggle />

              {/* Anywhere-clock-out: members can't reach /time, so they need
                  this control here to end their shift from any page. Hidden
                  for viewers, who don't have shifts at all. */}
              {!isViewer && (
                <div className="px-1">
                  <ClockButton className="w-full justify-center" size="sm" />
                </div>
              )}

              {isAdmin && (
                <Link
                  to="/admin"
                  className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium text-violet-600 dark:text-violet-300 hover:bg-violet-500/10 transition-colors"
                >
                  <Shield className="w-4 h-4" />
                  <span>Admin Panel</span>
                </Link>
              )}

              <Link
                to="/settings"
                className={cn(
                  'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  location.pathname === '/settings'
                    ? 'bg-primary-soft text-primary-soft-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </Link>

              <Separator />

              <div className="flex items-center gap-2">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={user?.photoURL} alt={user?.displayName} />
                  <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                    {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user?.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile-only top bar: keeps the hamburger reachable from anywhere on
          the page without each page having to opt in. The bar is sticky-fixed
          at the top so it stays visible while content underneath scrolls. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-2 px-3 h-12 bg-card/95 backdrop-blur border-b border-border">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-md text-foreground hover:bg-secondary"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link to="/dashboard" className="flex items-center gap-2 min-w-0 flex-1">
          <TaskCalendarLogo sizeClass="h-6 w-6" />
          <span className="font-semibold text-sm text-foreground truncate">TaskCalendar</span>
        </Link>
        <NotificationBell />
      </div>
      {/* Spacer so page content below the fixed mobile top bar isn't covered. */}
      <div className="md:hidden h-12 shrink-0" aria-hidden="true" />

      {/* Desktop sidebar — unchanged width and behaviour for >= md screens. */}
      <aside className="w-64 bg-card border-r border-border h-screen hidden md:flex flex-col shrink-0">
        {body}
      </aside>

      {/* Mobile drawer — off-canvas slide-in. Renders only when open so the
          DOM stays light on mobile. The backdrop dismisses the drawer; the
          panel itself caps at 85vw so a sliver of page is visible behind it
          (a familiar drawer UX pattern). z-index sits above the project chat
          dock (z-100) so opening the sidebar covers it instead of leaving
          the dock floating on top. */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[110] flex" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px] animate-in fade-in duration-150"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-card border-r border-border flex flex-col animate-in slide-in-from-left-2 duration-200">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-2 right-2 z-10 p-2 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;

// Re-export id constant for any callers that want it
export { ALL_WORKSPACES_ID };
