// Made-up workspace rules, workspaces and people for the workspace rules screen tests.
import { vi } from 'vitest';
import type { Overview, WorkspaceRow, WorkspaceRules } from '../../../../api/_automation/shared/types';

/** The rules of the workspace "Studio" (w1), as the server stores them. */
export const rules = (over: Partial<WorkspaceRules> = {}): WorkspaceRules => ({
  workspaceId: 'w1',
  enabled: true,
  autonomy: 'ask_external',
  monthlyBudgetCents: 5000,
  emailsPerLead: 3,
  sendWindow: { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: 'Europe/London' },
  webResearch: false,
  project: {
    nameTemplate: '{company} – {deal}',
    lead: 'deal_owner',
    addEveryone: true,
    columns: ['Undefined task', 'To-do', 'Done'],
    tasks: [
      { title: 'Kick-off call with the customer', days: 2 },
      { title: 'Confirm scope and what was promised in the deal', days: 3 },
    ],
    agentMayAddTasks: true,
  },
  revision: 4,
  updated: '2026-11-20T09:00:00Z',
  ...over,
});

/** What a save of the rules above sends when nothing was changed. */
export const savedBody = () => ({
  enabled: true,
  autonomy: 'ask_external',
  monthlyBudgetCents: 5000,
  emailsPerLead: 3,
  sendWindow: { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: 'Europe/London' },
  webResearch: false,
  project: {
    nameTemplate: '{company} – {deal}',
    lead: 'deal_owner',
    addEveryone: true,
    columns: ['Undefined task', 'To-do', 'Done'],
    tasks: [
      { title: 'Kick-off call with the customer', days: 2 },
      { title: 'Confirm scope and what was promised in the deal', days: 3 },
    ],
    agentMayAddTasks: true,
  },
  revision: 4,
});

export const overview = (over: Partial<Overview> = {}): Overview => ({
  setUp: true,
  enabled: true,
  role: 'Owner',
  stats: {
    automationsOn: 1, automationsPaused: 0, runsThisWeek: 0, finishedThisWeek: 0, stoppedThisWeek: 0,
    waitingApprovals: 0, oldestApproval: null, spentCents: 0, budgetCents: 5000,
  },
  automation: null,
  chain: [],
  approvals: [],
  latestRuns: [],
  ...over,
});

export const workspaceRows = (): WorkspaceRow[] => [
  { workspaceId: 'w1', name: 'Studio', setUp: true, enabled: true, autonomy: 'ask_external', projectsThisMonth: 4 },
  { workspaceId: 'w2', name: 'Retainers', setUp: true, enabled: false, autonomy: 'full', projectsThisMonth: 1 },
  { workspaceId: 'w3', name: 'Internal', setUp: false, enabled: false, autonomy: null, projectsThisMonth: 0 },
];

export const people = () => [
  { userId: 'u1', name: 'Sam Carter' },
  { userId: 'u2', name: 'Elena Rossi' },
];

/** jsdom has no ResizeObserver, scrolling or pointer capture, which the drop-downs use. */
export function stubBrowser(): void {
  class Observer { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observer;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
}
