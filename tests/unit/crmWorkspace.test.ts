import { describe, expect, it } from 'vitest';
import {
  concreteCrmWorkspaceId,
  projectMatchesDealWorkspace,
  sharedTaskStatusFor,
} from '@/lib/crmWorkspace';

describe('CRM workspace isolation', () => {
  it('never treats aggregate or unassigned selection as a CRM workspace', () => {
    expect(concreteCrmWorkspaceId('all', true, false)).toBeNull();
    expect(concreteCrmWorkspaceId('unassigned', false, true)).toBeNull();
    expect(concreteCrmWorkspaceId('workspace-a', false, false)).toBe('workspace-a');
  });

  it('allows a deal handoff only when deal and project match the requested workspace', () => {
    expect(projectMatchesDealWorkspace('workspace-a', 'workspace-a', 'workspace-a')).toBe(true);
    expect(projectMatchesDealWorkspace('workspace-a', 'workspace-b', 'workspace-a')).toBe(false);
    expect(projectMatchesDealWorkspace(null, 'workspace-a', 'workspace-a')).toBe(false);
  });

  it('maps CRM follow-up state onto the project Kanban columns', () => {
    const columns = [
      { id: 'todo', title: 'To do', color: '#fff', order: 1 },
      { id: 'doing', title: 'In progress', color: '#fff', order: 2 },
      { id: 'shipped', title: 'Completed', color: '#fff', order: 3 },
    ];
    expect(sharedTaskStatusFor(columns, 'pending')).toBe('todo');
    expect(sharedTaskStatusFor(columns, 'in_progress')).toBe('doing');
    expect(sharedTaskStatusFor(columns, 'completed')).toBe('shipped');
    expect(sharedTaskStatusFor([], 'pending')).toBe('todo');
  });
});
