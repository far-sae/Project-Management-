import { useSubscription } from "@/context/SubscriptionContext";
import { SubscriptionTier } from "@/types/subscription";
// import { INDIA_PRICING, DEFAULT_PRICING } from "@/types/subscription";

// Trial gets Advanced limits for 28 days
const TRIAL_LIMITS = {
  projects: null,
  workspaces: 10,
  teamMembers: 10,
  tasksPerProject: null,
  storageGB: 20,
};

export function usePlanLimits() {
  const { currentTier, pricing } = useSubscription();

  const getLimits = () => {
    if (!currentTier || currentTier === "trial") return TRIAL_LIMITS;

    const tierPricing = pricing.tiers[currentTier as SubscriptionTier];
    return tierPricing?.limits ?? TRIAL_LIMITS;
  };

  const limits = getLimits();

  const canCreateProject = (currentCount: number): boolean => {
    if (limits.projects === null) return true;
    return currentCount < limits.projects;
  };

  const canCreateWorkspace = (currentCount: number): boolean => {
    if (limits.workspaces === null) return true;
    return currentCount < limits.workspaces;
  };

  const canAddTeamMember = (currentCount: number): boolean => {
    if (limits.teamMembers === null) return true;
    return currentCount < limits.teamMembers;
  };

  const canCreateTask = (currentTaskCount: number): boolean => {
    if (limits.tasksPerProject === null) return true;
    return currentTaskCount < limits.tasksPerProject;
  };

  const canUploadFile = (): boolean => {
    if (limits.storageGB === null) return true;
    return limits.storageGB > 0;
  };

  const getProjectLimitMessage = (): string => {
    if (limits.projects === null) return "";
    return `You've reached your ${limits.projects} project limit. Upgrade to add more.`;
  };

  const getWorkspaceLimitMessage = (): string => {
    if (limits.workspaces === null) return "";
    return `You've reached your ${limits.workspaces} workspace limit. Upgrade to add more.`;
  };

  const getTeamLimitMessage = (): string => {
    if (limits.teamMembers === null) return "";
    return `You've reached your ${limits.teamMembers} team member limit. Upgrade to add more.`;
  };

  const getTaskLimitMessage = (): string => {
    if (limits.tasksPerProject === null) return "";
    return `You've reached the ${limits.tasksPerProject} task limit per project. Upgrade to add more.`;
  };

  return {
    limits,
    canCreateProject,
    canCreateWorkspace,
    canAddTeamMember,
    canCreateTask,
    canUploadFile,
    getProjectLimitMessage,
    getWorkspaceLimitMessage,
    getTeamLimitMessage,
    getTaskLimitMessage,
  };
}
