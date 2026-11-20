// One run: every step, approvals inline, the result, the facts, "They replied" and "Stop this run".
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Approval, Run } from '../../../../api/_automation/shared/types';
import { NOW, approval, finishedRun, polyfillDom, waitingRun, wonApproval } from './fixtures';

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

import { AutomationRunPage } from '@/pages/automation/RunDetail';
import { AutomationError } from '@/services/automation/client';
import { dateTime, dayTime } from '@/lib/automation/format';

let run: Run;
let pending: Approval[];
type Handler = (body: unknown) => unknown;
const serve = (overrides: Record<string, Handler> = {}) => {
  auto.call.mockImplementation(async (path: string, body?: unknown) => {
    if (overrides[path]) return overrides[path](body);
    if (path === `runs/${run.id}`) return run;
    if (path === 'approvals') return pending;
    if (path === `runs/${run.id}/stop`) { run = { ...run, status: 'stopped', result: 'Stopped by you', waitingFor: null }; return run; }
    if (path === `runs/${run.id}/replied`) { run = { ...run, status: 'running', result: 'The lead replied', waitingFor: null }; return run; }
    if (/^approvals\/[^/]+\/(approve|reject)$/.test(path)) {
      const id = path.split('/')[1];
      pending = pending.filter((a) => a.id !== id);
      run = {
        ...run, status: 'running', waitingFor: null,
        steps: run.steps.map((s) => (s.status === 'waiting_approval' ? { ...s, status: 'done', did: ['Sent the intro email'], approvedBy: 'Sam' } : s)),
      };
      return { id, status: 'approved' };
    }
    throw new AutomationError('This run does not exist in this workspace.', 404);
  });
};

const open = (id = run.id) => render(
  <MemoryRouter initialEntries={[`/crm/automation/runs/${id}`]}>
    <Routes>
      <Route path="/crm/automation/runs/:id" element={<AutomationRunPage />} />
    </Routes>
  </MemoryRouter>,
);
const ready = () => screen.findByRole('list', { name: 'Steps of this run' });
const steps = () => Array.from(screen.getByRole('list', { name: 'Steps of this run' }).children) as HTMLElement[];
const card = (name: string) => within(screen.getByRole('region', { name }));
const fact = (label: string) => (card('This run').getByText(label).parentElement as HTMLElement).querySelector('dd')!.textContent;
const calls = (path: string) => auto.call.mock.calls.filter((c) => c[0] === path);
const posted = (path: string) => calls(path).map((c) => c[1]);

beforeAll(polyfillDom);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  run = finishedRun();
  pending = [approval(), wonApproval({ runId: 'r8' })];
  auto.state.workspaceId = 'w';
  auto.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('One automation run', () => {
  describe('states', () => {
    it('asks for a workspace, and calls nothing, while none is selected', async () => {
      auto.state.workspaceId = null;
      open();
      expect(screen.getByText('Pick a workspace in the sidebar to see this run.')).toBeTruthy();
      await Promise.resolve();
      expect(auto.call).not.toHaveBeenCalled();
    });

    it('shows placeholders while loading, with the way back already there', () => {
      auto.call.mockImplementation(() => new Promise(() => {}));
      open();
      expect(screen.getByRole('status', { name: 'Loading the run' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'All runs' }).getAttribute('href')).toBe('/crm/automation/runs');
    });

    it('shows the server’s sentence when the run cannot be read, and tries again', async () => {
      serve({ 'runs/r1': () => { throw new AutomationError('This run does not exist in this workspace.', 404); } });
      open();
      expect((await screen.findByRole('alert')).textContent).toBe('This run does not exist in this workspace.');
      serve();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await ready()).toBeTruthy();
    });

    it('says quietly what is missing when the server answers 503', async () => {
      const sentence = 'Automation is not ready yet: run supabase/migrations/187_automation.sql in the Supabase SQL editor.';
      serve({ 'runs/r1': () => { throw new AutomationError(sentence, 503); } });
      open();
      expect((await screen.findByText(sentence)).getAttribute('role')).toBe('status');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('a finished run', () => {
    it('is headed by who it is about, its automation and its status', async () => {
      open();
      await ready();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Northwind Studio');
      const happened = within(screen.getByRole('region', { name: 'What happened' }));
      expect(happened.getByRole('heading', { level: 2, name: 'New lead to project' })).toBeTruthy();
      expect(happened.getByText('Finished').getAttribute('data-tone')).toBe('success');
      expect(happened.getByText('Everything each agent received, decided and did, in order. Nothing happens that is not written here.')).toBeTruthy();
      expect(calls('runs/r1')).toHaveLength(1);
      // Nothing waits in a finished run, so the approvals are not asked for.
      expect(calls('approvals')).toHaveLength(0);
    });

    it('writes out every step: number, agent, when, what it received, decided and did', async () => {
      open();
      await ready();
      expect(steps()).toHaveLength(6);
      const first = within(steps()[0]!);
      expect(first.getByRole('heading', { level: 3 }).textContent).toBe('Step 1: Researcher');
      expect(first.getByText(dayTime('2026-11-09T09:02:00Z'))).toBeTruthy();
      expect(steps()[0]!.querySelector('dl')!.textContent).toBe(
        'ReceivedNew lead: Elena Rossi, Marketing director, Northwind Studio'
        + 'DecidedDesign studio, about 20 people, redesigning their website this year'
        + 'DidWrote the summary on the lead',
      );
      expect(first.queryByText(/Approved by/)).toBeNull();
      expect(first.queryByText('Done')).toBeNull();

      expect(within(steps()[2]!).getByText('Approved by Sam')).toBeTruthy();
      expect(within(steps()[3]!).getByText('Skipped').getAttribute('data-tone')).toBe('muted');
      expect(within(steps()[3]!).getByText('Nothing')).toBeTruthy();
      // A step that did two things lists both.
      expect(within(steps()[4]!).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Opened the deal “Northwind website”', 'Marked the deal won',
      ]);
    });

    it('links the result to the project, the deal and the lead', async () => {
      open();
      await ready();
      const result = card('Result');
      expect(result.getByText('Project created with 5 tasks')).toBeTruthy();
      expect(result.getByRole('link', { name: 'Open project' }).getAttribute('href')).toBe('/project/p1');
      expect(result.getByRole('link', { name: 'Open the deal' }).getAttribute('href')).toBe('/crm/deals/d1');
      expect(result.getByRole('link', { name: 'Open the lead' }).getAttribute('href')).toBe('/crm/contacts/c1');
    });

    it('gives the facts of the run, with the AI cost in dollars', async () => {
      open();
      await ready();
      expect(fact('Started')).toBe(dateTime('2026-11-09T09:02:00Z'));
      expect(fact('Finished')).toBe(dateTime('2026-11-17T16:10:00Z'));
      expect(fact('Agent steps')).toBe('6');
      expect(fact('Approvals given')).toBe('2');
      expect(fact('Emails sent')).toBe('1');
      expect(fact('AI cost')).toBe('$0.42');
    });

    it('offers neither button on an open run when the server says this person may not', async () => {
      run = waitingRun({ canStop: false, canReply: false });
      serve();
      open();
      await ready();
      const actions = card('If something looks wrong');
      expect(actions.queryByRole('button', { name: 'They replied' })).toBeNull();
      expect(actions.queryByRole('button', { name: 'Stop this run' })).toBeNull();
    });

    it('cannot be stopped or answered any more, but the assistant can still be told', async () => {
      open();
      await ready();
      const actions = card('If something looks wrong');
      expect(actions.queryByRole('button', { name: 'They replied' })).toBeNull();
      expect(actions.queryByRole('button', { name: 'Stop this run' })).toBeNull();
      expect(actions.getByRole('link', { name: 'Tell the assistant what to change' }).getAttribute('href')).toBe('/crm/automation/assistant');
    });
  });

  describe('a run that waits', () => {
    beforeEach(() => { run = waitingRun(); });

    it('says what it is waiting for, and has no project or deal to open yet', async () => {
      open();
      await ready();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Harbour Dental');
      expect(screen.getByText('Waiting for someone to approve the first email.')).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'What happened' })).getAllByText('Needs approval')[0]!.getAttribute('data-tone')).toBe('warning');
      expect(card('Result').queryByRole('link', { name: 'Open project' })).toBeNull();
      expect(card('Result').queryByRole('link', { name: 'Open the deal' })).toBeNull();
      expect(card('Result').getByRole('link', { name: 'Open the lead' }).getAttribute('href')).toBe('/crm/contacts/c2');
      expect(fact('Finished')).toBe('Not yet');
    });

    it('shows this run’s approval under the step that waits, and not another run’s', async () => {
      open();
      await ready();
      const writer = within(steps()[2]!);
      expect(await writer.findByText('Send the first email to Priya Nair')).toBeTruthy();
      expect(writer.getByText('Nothing yet')).toBeTruthy();
      expect(calls('approvals')).toHaveLength(1);
      expect(screen.queryByText('Mark “Northwind website” as won')).toBeNull();
      expect(within(steps()[0]!).queryByRole('button')).toBeNull();
    });

    it('reviews, edits and approves the email in place, then reads the run again', async () => {
      open();
      await ready();
      fireEvent.click(await screen.findByRole('button', { name: 'Review: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Subject'), { target: { value: 'A new website for Harbour Dental' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(within(steps()[2]!).queryByText('Approved by Sam')).toBeTruthy());
      expect(posted('approvals/ap1/approve')).toEqual([
        { subject: 'A new website for Harbour Dental', body: 'Hi Priya,\n\nThank you for getting in touch.' },
      ]);
      expect(calls('runs/r2')).toHaveLength(2);
      expect(screen.queryByText('Send the first email to Priya Nair')).toBeNull();
      expect(screen.queryByText('Waiting for someone to approve the first email.')).toBeNull();
    });

    it('rejects in place with a reason', async () => {
      open();
      await ready();
      fireEvent.click(await screen.findByRole('button', { name: 'Reject: Send the first email to Priya Nair' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Wrong person' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(posted('approvals/ap1/reject')).toEqual([{ reason: 'Wrong person' }]));
    });

    it('shows no buttons on an approval the person may not decide', async () => {
      pending = [approval({ canDecide: false })];
      open();
      await ready();
      const writer = within(steps()[2]!);
      expect(await writer.findByText('Send the first email to Priya Nair')).toBeTruthy();
      expect(writer.queryByRole('button')).toBeNull();
    });

    it('logs a positive reply with a note', async () => {
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'They replied' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'They replied' })).toBeTruthy();
      const save = within(dialog).getByRole('button', { name: 'Log the reply' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);

      fireEvent.click(within(dialog).getByRole('radio', { name: /^Positive/ }));
      fireEvent.change(within(dialog).getByLabelText('Note (optional)'), { target: { value: '  Wants a call on Thursday.  ' } });
      fireEvent.click(save);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(posted('runs/r2/replied')).toEqual([{ positive: true, note: 'Wants a call on Thursday.' }]);
      expect(toast.success).toHaveBeenCalledWith('Reply logged on the lead. The run goes on from here.');
      // The page now shows the run as the server answered it.
      expect(card('Result').getByText('The lead replied')).toBeTruthy();
      expect(calls('runs/r2')).toHaveLength(1);
    });

    it('logs a reply that was not positive, without a note', async () => {
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'They replied' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('radio', { name: /^Not positive/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Log the reply' }));
      await waitFor(() => expect(posted('runs/r2/replied')).toEqual([{ positive: false }]));
    });

    it('keeps the reply dialog open with the server’s sentence as a toast when it is refused', async () => {
      serve({ 'runs/r2/replied': () => { throw new AutomationError('Only the lead’s owner can do this.', 403); } });
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'They replied' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('radio', { name: /^Positive/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Log the reply' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the lead’s owner can do this.'));
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('stops the run after asking, and then offers nothing more to stop', async () => {
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'Stop this run' }));
      const question = await screen.findByRole('alertdialog');
      expect(question.textContent).toContain('Stop this run?');
      expect(question.textContent).toContain('The agents do nothing more for Harbour Dental.');
      expect(calls('runs/r2/stop')).toHaveLength(0);

      fireEvent.click(within(question).getByRole('button', { name: 'Stop this run' }));
      await waitFor(() => expect(posted('runs/r2/stop')).toEqual([{}]));
      expect(await card('Result').findByText('Stopped by you')).toBeTruthy();
      expect(toast.success).toHaveBeenCalledWith('Run stopped.');
      expect(card('If something looks wrong').queryByRole('button', { name: 'Stop this run' })).toBeNull();
      expect(card('If something looks wrong').queryByRole('button', { name: 'They replied' })).toBeNull();
    });

    it('stops nothing when the person keeps it going', async () => {
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'Stop this run' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep it going' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(calls('runs/r2/stop')).toHaveLength(0);
    });

    it('shows the server’s sentence as a toast when stopping is refused', async () => {
      serve({ 'runs/r2/stop': () => { throw new AutomationError('Only a workspace owner or admin can change the automation.', 403); } });
      open();
      await ready();
      fireEvent.click(card('If something looks wrong').getByRole('button', { name: 'Stop this run' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Stop this run' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only a workspace owner or admin can change the automation.'));
      expect(card('If something looks wrong').getByRole('button', { name: 'Stop this run' })).toBeTruthy();
    });
  });
});
