// The card on a lead's page: hidden when there is nothing to say, else where the newest run stands.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Run, RunSummary } from '../../../../api/_automation/shared/types';
import { NOW, finishedRun, polyfillDom, runs, waitingRun } from './fixtures';

const auto = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the loading effect for ever.
  return { call, state: { client: { call }, workspaceId: 'w' as string | null, workspaceName: 'Studio' } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useAutomation', () => ({ useAutomation: () => auto.state }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));

import { LeadAutomationCard } from '@/components/automation/LeadAutomationCard';
import { AutomationError } from '@/services/automation/client';

let list: RunSummary[];
let full: Run;
type Handler = (body: unknown) => unknown;
const serve = (overrides: Record<string, Handler> = {}) => {
  auto.call.mockImplementation(async (path: string, body?: unknown) => {
    if (overrides[path]) return overrides[path](body);
    if (path.startsWith('runs?contactId=')) return list;
    if (path === `runs/${full.id}`) return full;
    if (path === `runs/${full.id}/replied`) { full = { ...full, status: 'running', result: 'The lead replied', waitingFor: null }; return full; }
    throw new AutomationError('Not found.', 404);
  });
};

const open = (contactId = 'c2') => render(<MemoryRouter><LeadAutomationCard contactId={contactId} /></MemoryRouter>);
const shown = () => screen.findByRole('region', { name: 'Automation' });
const paths = () => auto.call.mock.calls.map((c) => c[0] as string);
/** Lets every pending answer arrive. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

beforeAll(polyfillDom);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  full = waitingRun();
  list = [runs[1]!];
  auto.state.workspaceId = 'w';
  auto.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Lead automation card', () => {
  describe('hidden', () => {
    it('renders nothing, and calls nothing, while no workspace is selected', async () => {
      auto.state.workspaceId = null;
      const { container } = open();
      await settle();
      expect(container.innerHTML).toBe('');
      expect(auto.call).not.toHaveBeenCalled();
    });

    it('renders nothing when the lead has no run', async () => {
      list = [];
      const { container } = open();
      await waitFor(() => expect(paths()).toEqual(['runs?contactId=c2']));
      await settle();
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing when the server says automation is not set up', async () => {
      serve({ 'runs?contactId=c2': () => { throw new AutomationError('Automation is not ready yet: ANTHROPIC_API_KEY is missing.', 503); } });
      const { container } = open();
      await waitFor(() => expect(auto.call).toHaveBeenCalled());
      await settle();
      expect(container.innerHTML).toBe('');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('renders nothing when the runs cannot be read', async () => {
      serve({ 'runs?contactId=c2': () => { throw new AutomationError('Choose a workspace.', 403); } });
      const { container } = open();
      await waitFor(() => expect(auto.call).toHaveBeenCalled());
      await settle();
      expect(container.innerHTML).toBe('');
    });
  });

  describe('shown', () => {
    it('shows the newest run: its status, what it waits for, the last thing an agent did, and a link to it', async () => {
      list = [runs[1]!, { ...runs[3]!, contactId: 'c2' }];
      open();
      const card = within(await shown());
      expect(await card.findByText('Waiting for someone to approve the first email.')).toBeTruthy();
      expect(paths()).toEqual(['runs?contactId=c2', 'runs/r2']);
      expect(card.getByText('Needs approval').getAttribute('data-tone')).toBe('warning');
      expect(card.getByText('New lead to project')).toBeTruthy();
      expect(card.getByText('2 of 6 steps done')).toBeTruthy();
      expect(card.getByText('Stopped at step 3: waiting for approval')).toBeTruthy();
      expect(card.getByText(/Qualifier: Marked the lead Qualified/)).toBeTruthy();
      expect(card.getByRole('link', { name: 'Open the run' }).getAttribute('href')).toBe('/crm/automation/runs/r2');
      // The older run of the same lead is not shown.
      expect(card.queryByText('Trade show leads')).toBeNull();
    });

    it('asks for the lead by its id, safely', async () => {
      open('a b&c');
      await waitFor(() => expect(paths()[0]).toBe('runs?contactId=a%20b%26c'));
    });

    it('logs a reply from the card and shows where the run stands then', async () => {
      open();
      const card = within(await shown());
      fireEvent.click(card.getByRole('button', { name: 'They replied' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Use this when Harbour Dental answered somewhere the agents cannot see');
      fireEvent.click(within(dialog).getByRole('radio', { name: /^Not positive/ }));
      fireEvent.change(within(dialog).getByLabelText('Note (optional)'), { target: { value: 'No budget this year' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Log the reply' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(auto.call).toHaveBeenCalledWith('runs/r2/replied', { positive: false, note: 'No budget this year' });
      expect(await card.findByText('The lead replied')).toBeTruthy();
      expect(card.getByText('Running')).toBeTruthy();
      expect(card.queryByText('Waiting for someone to approve the first email.')).toBeNull();
    });

    it('has no “They replied” when the server says this person may not log one', async () => {
      full = waitingRun({ contactId: 'c1', canReply: false });
      open('c1');
      const card = within(await shown());
      expect(await card.findByText('Waiting for someone to approve the first email.')).toBeTruthy();
      expect(card.queryByRole('button', { name: 'They replied' })).toBeNull();
    });

    it('has no “They replied” on a run that has ended', async () => {
      full = finishedRun({ contactId: 'c1' });
      list = [runs[0]!];
      open('c1');
      const card = within(await shown());
      expect(await card.findByText(/Project starter: Created the project with 5 tasks/)).toBeTruthy();
      expect(card.getByText('Finished').getAttribute('data-tone')).toBe('success');
      expect(card.queryByRole('button', { name: 'They replied' })).toBeNull();
      expect(card.queryByText('Waiting for')).toBeNull();
    });

    it('still shows the status and the link when the details cannot be read', async () => {
      serve({ 'runs/r2': () => { throw new AutomationError('Not found.', 404); } });
      open();
      const card = within(await shown());
      await settle();
      expect(card.getByText('Needs approval')).toBeTruthy();
      expect(card.getByText('Stopped at step 3: waiting for approval')).toBeTruthy();
      expect(card.getByRole('link', { name: 'Open the run' })).toBeTruthy();
      expect(card.queryByText('Last done')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
