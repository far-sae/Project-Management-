// The automation overview: first run, the figures, the chain, approvals and the latest runs.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Overview } from '../../../../api/_automation/shared/types';
import { NOW, approval, notSetUp, overview, polyfillDom, wonApproval } from './fixtures';

const auto = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the loading effect for ever.
  return { call, state: { client: { call }, workspaceId: 'w' as string | null, workspaceName: 'Studio' } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useAutomation', () => ({ useAutomation: () => auto.state }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));

import { AutomationOverviewPage } from '@/pages/automation/Overview';
import { AutomationError } from '@/services/automation/client';

let current: Overview;
type Handler = (body: unknown) => unknown;
const serve = (overrides: Record<string, Handler> = {}) => {
  auto.call.mockImplementation(async (path: string, body?: unknown) => {
    if (overrides[path]) return overrides[path](body);
    if (path === 'nudge') return { ok: true };
    if (path === 'overview') return current;
    if (path === 'setup') { current = overview({ automation: { id: 'a1', name: 'New lead to project', status: 'draft' }, approvals: [], latestRuns: [] }); return current; }
    if (/^approvals\/[^/]+\/(approve|reject)$/.test(path)) {
      const id = path.split('/')[1];
      const decided = current.approvals.find((a) => a.id === id)!;
      current = { ...current, approvals: current.approvals.filter((a) => a.id !== id) };
      return { ...decided, status: path.endsWith('approve') ? 'approved' : 'rejected' };
    }
    if (/^automations\/a1\/(turn-on|pause)$/.test(path)) {
      const status = path.endsWith('pause') ? 'paused' : 'on';
      current = { ...current, automation: { ...current.automation!, status } };
      return { id: 'a1', status };
    }
    throw new AutomationError('Not found.', 404);
  });
};

const open = () => render(<MemoryRouter><AutomationOverviewPage /></MemoryRouter>);
const ready = () => screen.findByRole('heading', { name: 'Waiting for your approval' });
const stat = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
const section = (name: string | RegExp) => within(screen.getByRole('region', { name }));
const calls = (path: string) => auto.call.mock.calls.filter((c) => c[0] === path);
const posted = (path: string) => calls(path).map((c) => c[1]);
const paths = () => auto.call.mock.calls.map((c) => c[0] as string);

beforeAll(polyfillDom);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  current = overview();
  auto.state.workspaceId = 'w';
  auto.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Automation overview', () => {
  describe('states', () => {
    it('asks for a workspace, and calls nothing, while none is selected', async () => {
      auto.state.workspaceId = null;
      open();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Automation');
      expect(screen.getByText('Pick a workspace in the sidebar to see its automation.')).toBeTruthy();
      await Promise.resolve();
      expect(auto.call).not.toHaveBeenCalled();
    });

    it('nudges the server once, then reads the overview', async () => {
      open();
      await ready();
      expect(paths()).toEqual(['nudge', 'overview']);
      expect(calls('nudge')[0]).toEqual(['nudge', {}]);
    });

    it('reads the overview even when the nudge fails', async () => {
      serve({ nudge: () => { throw new AutomationError('Too soon.', 429); } });
      open();
      await ready();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows placeholders while loading, with the title and the header already in place', () => {
      auto.call.mockImplementation(() => new Promise(() => {}));
      open();
      expect(screen.getByRole('status', { name: 'Loading the automation' })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Automation');
      expect(screen.getByRole('link', { name: 'Ask the assistant' })).toBeTruthy();
    });

    it('shows the server’s sentence when the overview cannot be read, and tries again', async () => {
      serve({ overview: () => { throw new AutomationError('Choose a workspace.', 403); } });
      open();
      expect((await screen.findByRole('alert')).textContent).toBe('Choose a workspace.');
      serve();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await ready()).toBeTruthy();
    });

    it('says quietly what is missing when the server answers 503', async () => {
      const sentence = 'Automation is not ready yet: run supabase/migrations/187_automation.sql in the Supabase SQL editor.';
      serve({ overview: () => { throw new AutomationError(sentence, 503); } });
      open();
      const note = await screen.findByText(sentence);
      expect(note.getAttribute('role')).toBe('status');
      expect(note.className).not.toContain('destructive');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Set up automation' })).toBeNull();
    });
  });

  describe('first run', () => {
    it('explains automation in three lines and lets an owner set it up', async () => {
      current = notSetUp('Owner');
      open();
      expect(await screen.findByRole('heading', { name: 'Automation is not set up in this workspace yet' })).toBeTruthy();
      expect(within(screen.getByRole('list', { name: 'What automation does' })).getAllByRole('listitem')).toHaveLength(3);
      expect(screen.queryByText('Waiting for your approval')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Set up automation' }));
      expect(await ready()).toBeTruthy();
      expect(posted('setup')).toEqual([{}]);
      expect(toast.success).toHaveBeenCalledWith('Automation is set up. Turn it on when you are ready.');
      expect(screen.getByText('Not turned on yet')).toBeTruthy();
    });

    it('tells a member that an owner or admin sets it up', async () => {
      current = notSetUp('Member');
      open();
      expect(await screen.findByText('A workspace owner or admin sets automation up.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Set up automation' })).toBeNull();
    });

    it('shows the server’s sentence as a toast when setting up is refused', async () => {
      current = notSetUp('Owner');
      serve({ setup: () => { throw new AutomationError('Only a workspace owner or admin can change the automation.', 403); } });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Set up automation' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only a workspace owner or admin can change the automation.'));
      expect(screen.getByRole('button', { name: 'Set up automation' })).toBeTruthy();
    });
  });

  describe('figures', () => {
    it('shows automations, runs, approvals and the AI budget', async () => {
      open();
      await ready();
      expect(within(stat('Automations running')).getByText('2')).toBeTruthy();
      expect(within(stat('Automations running')).getByText('1 paused')).toBeTruthy();
      expect(within(stat('Runs this week')).getByText('48')).toBeTruthy();
      expect(within(stat('Runs this week')).getByText('46 finished, 2 stopped')).toBeTruthy();
      expect(within(stat('Waiting for your approval')).getByText('2').getAttribute('data-tone')).toBe('danger');
      expect(within(stat('Waiting for your approval')).getByText('Oldest: 2 hours')).toBeTruthy();
      expect(within(stat('AI budget this month')).getByText('31%')).toBeTruthy();
      expect(within(stat('AI budget this month')).getByText('$3.10 of $10.00')).toBeTruthy();
    });

    it('stays calm when nothing waits, and has no percent without a limit', async () => {
      current = overview({
        approvals: [],
        stats: { ...overview().stats, automationsPaused: 0, waitingApprovals: 0, oldestApproval: null, spentCents: 25, budgetCents: 0 },
      });
      open();
      await ready();
      expect(within(stat('Automations running')).getByText('None paused')).toBeTruthy();
      expect(within(stat('Waiting for your approval')).getByText('0').getAttribute('data-tone')).toBe('default');
      expect(within(stat('Waiting for your approval')).getByText('Nothing is waiting')).toBeTruthy();
      expect(within(stat('AI budget this month')).getByText('—')).toBeTruthy();
      expect(within(stat('AI budget this month')).getByText('$0.25 spent, no limit set')).toBeTruthy();
    });
  });

  describe('the chain', () => {
    it('shows every step with its agent, what it does, when it starts and whether it asks', async () => {
      open();
      await ready();
      const steps = section('From the first enquiry to the running project').getAllByRole('listitem');
      expect(steps).toHaveLength(6);
      expect(steps.map((li) => within(li).getByText(/^Step \d$/).textContent)).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6']);
      expect(within(steps[0]!).getByText('Researcher')).toBeTruthy();
      expect(within(steps[0]!).getByText('Reads the lead and their company and writes a short summary on the lead.')).toBeTruthy();
      expect(within(steps[0]!).getByText('Straight away')).toBeTruthy();
      expect(within(steps[0]!).getByText('Automatic').getAttribute('data-tone')).toBe('neutral');
      expect(within(steps[2]!).getByText('Needs approval').getAttribute('data-tone')).toBe('warning');
      expect(within(steps[3]!).getByText('After 3 days with no reply')).toBeTruthy();
      expect(within(steps[4]!).getByText('When the lead replies')).toBeTruthy();
      expect(within(steps[5]!).getByText('When the deal is won')).toBeTruthy();
      expect(section('From the first enquiry to the running project').getByRole('link', { name: 'Edit the chain' }).getAttribute('href')).toBe('/crm/automation/agents');
    });

    it('lets an owner pause a running automation and turn it on again', async () => {
      open();
      await ready();
      const card = section('From the first enquiry to the running project');
      expect(card.getByText('Running').getAttribute('data-tone')).toBe('success');
      expect(card.queryByRole('button', { name: 'Turn on' })).toBeNull();

      fireEvent.click(card.getByRole('button', { name: 'Pause' }));
      expect(await card.findByText('Paused')).toBeTruthy();
      expect(posted('automations/a1/pause')).toEqual([{}]);
      expect(toast.success).toHaveBeenCalledWith('Automation paused. New leads start no run.');

      fireEvent.click(card.getByRole('button', { name: 'Turn on' }));
      expect(await card.findByText('Running')).toBeTruthy();
      expect(posted('automations/a1/turn-on')).toEqual([{}]);
      expect(toast.success).toHaveBeenCalledWith('Automation turned on. New leads start a run.');
      // Each change reads the overview again; the server is not nudged again.
      expect(calls('overview')).toHaveLength(3);
      expect(calls('nudge')).toHaveLength(1);
    });

    it('offers a draft to be turned on, and shows the server’s sentence when that is refused', async () => {
      current = overview({ automation: { id: 'a1', name: 'New lead to project', status: 'draft' } });
      serve({ 'automations/a1/turn-on': () => { throw new AutomationError('Add at least one step before you turn this on.', 409); } });
      open();
      await ready();
      const card = section('From the first enquiry to the running project');
      expect(card.getByText('Not turned on yet').getAttribute('data-tone')).toBe('neutral');
      fireEvent.click(card.getByRole('button', { name: 'Turn on' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Add at least one step before you turn this on.'));
      expect(card.getByText('Not turned on yet')).toBeTruthy();
    });

    it('gives a member no way to change anything', async () => {
      current = overview({ role: 'Member', approvals: [approval({ canDecide: false })] });
      open();
      await ready();
      const card = section('From the first enquiry to the running project');
      expect(card.getByText('Running')).toBeTruthy();
      expect(card.queryByRole('button', { name: 'Pause' })).toBeNull();
      expect(card.queryByRole('button', { name: 'Turn on' })).toBeNull();
      expect(card.queryByRole('link', { name: 'Edit the chain' })).toBeNull();
      expect(card.getByRole('link', { name: 'See the agents' }).getAttribute('href')).toBe('/crm/automation/agents');
      expect(screen.queryByRole('link', { name: 'New agent' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Ask the assistant' })).toBeNull();
    });

    it('points to the assistant when there is no automation yet', async () => {
      current = overview({ automation: null, chain: [] });
      open();
      await ready();
      const card = section('From the first enquiry to the running project');
      expect(card.getByText(/No automation yet\./)).toBeTruthy();
      expect(card.getByRole('link', { name: 'Ask the assistant' }).getAttribute('href')).toBe('/crm/automation/assistant');
      expect(card.queryByRole('button', { name: 'Turn on' })).toBeNull();
    });

    it('says so when automation is switched off in the workspace rules', async () => {
      current = overview({ enabled: false });
      open();
      await ready();
      expect(screen.getByText(/Automation is switched off for this workspace\./)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Open workspace rules' }).getAttribute('href')).toBe('/crm/automation/rules');
    });
  });

  describe('approvals', () => {
    const row = (what: string) => screen.getByText(what).closest('li') as HTMLElement;

    it('lists what waits, who asks, who it is about and since when', async () => {
      open();
      await ready();
      const card = section('Waiting for your approval');
      expect(card.getByText('Nothing leaves the workspace until you say so')).toBeTruthy();
      expect(row('Send the first email to Priya Nair').textContent).toContain('Writer · Harbour Dental · 2 hours ago');
      expect(row('Mark “Northwind website” as won').textContent).toContain('Deal keeper · Northwind Studio · 40 minutes ago');
    });

    it('approves straight from the list and reads the overview again', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Approve: Mark “Northwind website” as won' }));
      await waitFor(() => expect(screen.queryByText('Mark “Northwind website” as won')).toBeNull());
      expect(posted('approvals/ap2/approve')).toEqual([{}]);
      expect(toast.success).toHaveBeenCalledWith('Approved. The run goes on.');
      expect(calls('overview')).toHaveLength(2);
      expect(screen.getByText('Send the first email to Priya Nair')).toBeTruthy();
    });

    it('shows an email in full for review and approves it unchanged', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Send the first email to Priya Nair' })).toBeTruthy();
      expect(within(dialog).getByText('To')).toBeTruthy();
      expect(dialog.textContent).toContain('priya@harbourdental.example');
      expect((within(dialog).getByLabelText('Subject') as HTMLInputElement).value).toBe('Your enquiry about a new website');
      expect((within(dialog).getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Hi Priya,\n\nThank you for getting in touch.');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(posted('approvals/ap1/approve')).toEqual([{}]);
    });

    it('sends the email as edited when it was changed before approving', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Body'), { target: { value: 'Hi Priya,\n\nCould we talk on Thursday?' } });
      expect(within(dialog).getByText('The email goes out as you changed it.')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(posted('approvals/ap1/approve')).toEqual([
        { subject: 'Your enquiry about a new website', body: 'Hi Priya,\n\nCould we talk on Thursday?' },
      ]);
      await waitFor(() => expect(screen.queryByText('Send the first email to Priya Nair')).toBeNull());
    });

    it('does not send the email when Enter is pressed in the subject line', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.submit(within(dialog).getByLabelText('Subject').closest('form') as HTMLFormElement);
      await Promise.resolve();
      expect(calls('approvals/ap1/approve')).toHaveLength(0);
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('will not approve an email with no body', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Body'), { target: { value: '   ' } });
      expect(within(dialog).getByText('An email needs a subject and a body.')).toBeTruthy();
      expect((within(dialog).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('describes any other action in a sentence', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Mark “Northwind website” as won' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Mark the deal as won. Reason: Signed on the 18th')).toBeTruthy();
      expect(within(dialog).queryByLabelText('Subject')).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Decide later' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(calls('approvals/ap2/approve')).toHaveLength(0);
    });

    it('rejects with the reason given', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Reject: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Reject this?' })).toBeTruthy();
      expect(dialog.textContent).toContain('the run for Harbour Dental stops at this step');
      fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: '  Too formal for a dentist.  ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(posted('approvals/ap1/reject')).toEqual([{ reason: 'Too formal for a dentist.' }]);
      expect(toast.success).toHaveBeenCalledWith('Rejected. The run has stopped.');
      await waitFor(() => expect(screen.queryByText('Send the first email to Priya Nair')).toBeNull());
    });

    it('rejects without a reason too, also from the review', async () => {
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Review: Mark “Northwind website” as won' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject' }));
      const question = await screen.findByRole('heading', { name: 'Reject this?' }).then((h) => h.closest('[role="dialog"]') as HTMLElement);
      fireEvent.click(within(question).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(posted('approvals/ap2/reject')).toEqual([{}]));
    });

    it('shows no buttons on an approval the person may not decide', async () => {
      current = overview({ role: 'Member', approvals: [approval({ canDecide: false }), wonApproval({ canDecide: true })] });
      open();
      await ready();
      const theirs = within(row('Send the first email to Priya Nair'));
      expect(theirs.queryByRole('button')).toBeNull();
      expect(theirs.getByText('For the lead’s owner or an admin to decide.')).toBeTruthy();
      // A member decides for their own leads.
      expect(within(row('Mark “Northwind website” as won')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Review', 'Approve', 'Reject']);
    });

    it('shows the server’s sentence as a toast when a decision is refused, and keeps the approval', async () => {
      serve({ 'approvals/ap1/approve': () => { throw new AutomationError('Only the lead’s owner can approve this.', 403); } });
      open();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Approve: Send the first email to Priya Nair' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the lead’s owner can approve this.'));
      expect(screen.getByText('Send the first email to Priya Nair')).toBeTruthy();
      expect(calls('overview')).toHaveLength(1);
    });

    it('says so when nothing is waiting', async () => {
      current = overview({ approvals: [] });
      open();
      await ready();
      expect(section('Waiting for your approval').getByText('Nothing is waiting for you.')).toBeTruthy();
    });
  });

  describe('latest runs', () => {
    it('lists each run with its result and when, opening the run', async () => {
      open();
      await ready();
      const card = section('Latest runs');
      const links = card.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/crm/automation/runs/'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/crm/automation/runs/r1', '/crm/automation/runs/r2', '/crm/automation/runs/r3', '/crm/automation/runs/r4',
      ]);
      expect(links[0]!.textContent).toContain('Northwind Studio');
      expect(links[0]!.textContent).toContain('Project created with 5 tasks');
      expect(links[0]!.textContent).toContain('1 hour ago');
      expect(links[3]!.textContent).toContain('Yesterday');
      expect(card.getByRole('link', { name: 'All runs' }).getAttribute('href')).toBe('/crm/automation/runs');
    });

    it('says when a run starts while there are none', async () => {
      current = overview({ latestRuns: [] });
      open();
      await ready();
      expect(section('Latest runs').getByText('No runs yet. A run starts when a lead is added.')).toBeTruthy();
    });
  });

  describe('header', () => {
    it('links to the assistant and to a new agent, and refreshes with one more nudge', async () => {
      open();
      await ready();
      expect(screen.getAllByRole('link', { name: 'Ask the assistant' })[0]!.getAttribute('href')).toBe('/crm/automation/assistant');
      expect(screen.getByRole('link', { name: 'New agent' }).getAttribute('href')).toBe('/crm/automation/agents?new=1');

      current = overview({ approvals: [] });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
      expect(paths()).toEqual(['nudge', 'overview', 'nudge', 'overview']);
    });
  });
});
