import type { Project } from '@/types';

type ProjectLike = Pick<Project, 'projectId' | 'ownerId' | 'members'>;

/**
 * Who may manage a project's people (invite, add, remove, change roles):
 * its owner or a member whose role in THAT project is admin. Organization
 * admins can too, but that's checked separately (useOrganization().isAdmin).
 * Mirrors can_manage_project_members() in the database (migration 173).
 */
export function canManageProjectPeople(project: ProjectLike, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (project.ownerId === userId) return true;
  return (project.members ?? []).some((m) => m.userId === userId && m.role === 'admin');
}

/** Projects the person can manage people on. */
export function managedProjects<T extends ProjectLike>(projects: T[], userId: string | null | undefined): T[] {
  return projects.filter((p) => canManageProjectPeople(p, userId));
}
