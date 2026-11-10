import { describe, expect, it } from 'vitest';
import { canManageProjectPeople, managedProjects } from '@/lib/projectManagers';

const p = (projectId: string, ownerId: string, members: Array<{ userId: string; role: string }>) =>
  ({ projectId, ownerId, members }) as never;

const projects = [
  p('a', 'boss', [{ userId: 'tam', role: 'admin' }, { userId: 'zg', role: 'member' }]),
  p('b', 'boss', [{ userId: 'zg', role: 'admin' }]),
  p('c', 'zg', []),
  p('d', 'boss', [{ userId: 'tam', role: 'member' }]),
];

describe('project managers', () => {
  it('a project admin or owner manages that project only', () => {
    expect(canManageProjectPeople(projects[0], 'tam')).toBe(true);
    expect(canManageProjectPeople(projects[3], 'tam')).toBe(false);
    expect(canManageProjectPeople(projects[2], 'zg')).toBe(true);
    expect(canManageProjectPeople(projects[0], 'zg')).toBe(false);
  });

  it('lists the projects someone manages', () => {
    expect(managedProjects(projects, 'tam').map((x: { projectId: string }) => x.projectId)).toEqual(['a']);
    expect(managedProjects(projects, 'zg').map((x: { projectId: string }) => x.projectId)).toEqual(['b', 'c']);
    expect(managedProjects(projects, 'nobody')).toEqual([]);
    expect(managedProjects(projects, undefined)).toEqual([]);
  });
});
