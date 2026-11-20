// The agents screen: the chain, one agent's editor, and everything that can be done to an agent.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RIGHTS, type Agent, type Automation, type Overview } from '../../../../api/_automation/shared/types';
import {
  agent, allAgents, automation, deferred, overview, polyfillDom, qualifier, researcher, testResult,
} from './fixtures';

const au = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the page's loading effect for ever.
  const state = { client: { call }, workspaceId: 'w' as string | null, workspaceName: 'Studio' };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));

vi.mock('@/hooks/useAutomation', () => ({ useAutomation: () => au.state }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));

import { AutomationAgentsPage } from '@/pages/automation/Agents';
import { AutomationError } from '@/services/automation/client';

type Handler = (body: any, method: string | undefined) => unknown;
let ov: Overview;
let agents: Agent[];
let chain: Automation;
const serve = (overrides: Record<string, Handler> = {}) => {
  au.call.mockImplementation(async (path: string, body?: any, method?: string) => {
    if (overrides[path]) return overrides[path](body, method);
    if (path === 'overview') return ov;
    if (path === 'agents' && body === undefined) return agents;
    if (path === 'agents') {
      const made = agent({ id: 'ag10', ...body });
      agents = [...agents, made];
      return made;
    }
    if (path === 'automations/au1') {
      if (method === 'PATCH') {
        const { revision: _revision, ...rest } = body;
        chain = { ...chain, ...rest, revision: chain.revision + 1 };
      }
      return chain;
    }
    const match = /^agents\/(\w+)(?:\/(pause|resume|test))?$/.exec(path);
    const found = match && agents.find((a) => a.id === match[1]);
    if (match && found) {
      if (match[2] === 'test') return testResult({ steps: [testResult().steps[0]], note: null });
      let next = found;
      if (match[2]) next = { ...found, paused: match[2] === 'pause', revision: found.revision + 1 };
      else if (method === 'DELETE') { agents = agents.filter((a) => a.id !== found.id); return { ok: true }; }
      else if (method === 'PATCH') {
        const { revision: _revision, ...rest } = body;
        next = { ...found, ...rest, revision: found.revision + 1 };
      }
      agents = agents.map((a) => (a.id === next.id ? next : a));
      return next;
    }
    throw new AutomationError('Not found.', 404);
  });
};

const renderPage = (entry = '/crm/automation/agents') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/crm/automation/agents" element={<AutomationAgentsPage />} />
      <Route path="/crm/automation/assistant" element={<div>assistant page</div>} />
      <Route path="/crm/automation" element={<div>overview page</div>} />
    </Routes>
  </MemoryRouter>,
);

const calls = (path: string, method?: string) => au.call.mock.calls.filter((c) => c[0] === path && c[2] === method);
const bodies = (path: string, method?: string) => calls(path, method).map((c) => c[1]);
const ready = () => screen.findByRole('region', { name: 'Agent details' });
const chainItems = () => within(screen.getByRole('list', { name: 'Chain' })).getAllByRole('listitem');
const chainNames = () => chainItems().map((li) => within(li).getByTestId('agent-name').textContent);
const otherNames = () => within(screen.getByRole('list', { name: 'Not in a chain' })).getAllByTestId('agent-name').map((el) => el.textContent);
const pickButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}\\b`) });
const pick = (name: string) => fireEvent.click(pickButton(name));
const details = () => screen.getByRole('region', { name: 'Agent details' });
const nameBox = () => within(details()).getByLabelText('Name') as HTMLInputElement;
const jobBox = () => within(details()).getByLabelText('Its one job') as HTMLTextAreaElement;
const right = (label: string) => within(details()).getByRole('switch', { name: label });
const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';
const button = (name: string) => within(details()).getByRole('button', { name }) as HTMLButtonElement;
const confirm = async (label: string) => fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: label }));
/** Opens the page and selects an agent by name. */
const open = async (name?: string, entry?: string) => {
  renderPage(entry);
  await ready();
  if (name) {
    pick(name);
    await within(details()).findByRole('heading', { name });
  }
};

beforeAll(polyfillDom);
beforeEach(() => {
  ov = overview();
  agents = allAgents();
  chain = automation();
  au.state.workspaceId = 'w';
  au.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('before there is anything to show', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    au.state.workspaceId = null;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByText('Pick a workspace in the sidebar to see its agents.')).toBeTruthy();
    expect(au.call).not.toHaveBeenCalled();
  });

  it('points to the overview when automation is not set up', async () => {
    ov = overview({ setUp: false, automation: null, chain: [] });
    renderPage();
    expect(await screen.findByText('Automation is not set up in Studio yet. Set it up on the overview first.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the overview' }).getAttribute('href')).toBe('/crm/automation');
    expect(au.call.mock.calls.map((c) => c[0])).toEqual(['overview']);
    expect(screen.queryByRole('button', { name: 'New agent' })).toBeNull();
  });

  it('shows where it is loading, then the server’s sentence when that fails, and tries again', async () => {
    serve({ agents: () => { throw new AutomationError('Run supabase/migrations/187_automation.sql in the Supabase SQL editor.', 503); } });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading agents' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe('Run supabase/migrations/187_automation.sql in the Supabase SQL editor.');
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await ready()).toBeTruthy();
  });

  it('says so when the workspace has no automation yet, and still lists the agents', async () => {
    ov = overview({ automation: null, chain: [] });
    renderPage();
    await ready();
    expect(screen.getByText(/There is no automation in this workspace yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Build one with the assistant' }).getAttribute('href')).toBe('/crm/automation/assistant');
    expect(screen.queryByRole('list', { name: 'Chain' })).toBeNull();
    expect(otherNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser', 'Greeter']);
    expect(screen.queryByRole('button', { name: 'Add an agent to the chain' })).toBeNull();
    expect(au.call.mock.calls.map((c) => c[0])).not.toContain('automations/au1');
  });
});

describe('the chain', () => {
  it('lists each agent with its number, its job and who it hands on to', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'New lead to project' })).toBeTruthy();
    expect(screen.getByText('Each agent has one job. When it finishes, it hands its result to the next one.')).toBeTruthy();
    expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    const [first, , third, last] = chainItems();
    expect(first.textContent).toContain('1');
    expect(first.textContent).toContain('Reads the lead and company; writes a summary');
    expect(first.textContent).toContain('hands on to Qualifier');
    expect(third.textContent).toContain('hands on to Chaser, which starts after 3 days with no reply');
    expect(last.textContent).not.toContain('hands on');
    expect(otherNames()).toEqual(['Greeter']);
    expect(au.call.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['overview', 'automations/au1', 'agents']));
  });

  it('opens the first agent, and another when it is picked', async () => {
    await open();
    expect(pickButton('Researcher').getAttribute('aria-pressed')).toBe('true');
    expect(pickButton('Qualifier').getAttribute('aria-pressed')).toBe('false');
    expect(within(details()).getByRole('heading', { name: 'Researcher' })).toBeTruthy();
    expect(within(details()).getByText('First in the chain · ran 40 times this month')).toBeTruthy();

    pick('Qualifier');
    expect(pickButton('Qualifier').getAttribute('aria-pressed')).toBe('true');
    expect(pickButton('Researcher').getAttribute('aria-pressed')).toBe('false');
    expect(within(details()).getByText('Second in the chain · ran 31 times this month')).toBeTruthy();
    expect(nameBox().value).toBe('Qualifier');
    expect(jobBox().value).toBe(qualifier.job);

    pick('Greeter');
    expect(within(details()).getByText('Not in a chain · has not run this month')).toBeTruthy();
  });

  it('says who an agent receives from and hands on to', async () => {
    await open('Qualifier');
    expect(within(details()).getByRole('heading', { name: 'Receives from Researcher' })).toBeTruthy();
    expect(within(details()).getByRole('heading', { name: 'Hands on to Writer' })).toBeTruthy();
    pick('Researcher');
    expect(within(details()).getByRole('heading', { name: 'Receives the new lead' })).toBeTruthy();
    pick('Chaser');
    expect(within(details()).getByRole('heading', { name: 'Receives from Writer' })).toBeTruthy();
    expect(details().textContent).toContain('Starts after 3 days with no reply');
    expect(within(details()).getByRole('heading', { name: 'Last in the chain' })).toBeTruthy();
    pick('Greeter');
    expect(details().textContent).toContain('It is in no chain yet, so it receives nothing and hands nothing on.');
  });

  it('moves a step and saves the automation', async () => {
    await open();
    fireEvent.click(within(chainItems()[1]).getByRole('button', { name: 'Move step 2 up' }));
    await waitFor(() => expect(chainNames()).toEqual(['Qualifier', 'Researcher', 'Writer', 'Chaser']));
    const [s1, s2, s3, s4] = automation().steps;
    expect(bodies('automations/au1', 'PATCH')).toEqual([{
      name: 'New lead to project', trigger: { type: 'lead_created', skipImports: false }, steps: [s2, s1, s3, s4], revision: 7,
    }]);

    // The next save names the revision the server answered with.
    fireEvent.click(within(chainItems()[2]).getByRole('button', { name: 'Move step 3 down' }));
    await waitFor(() => expect(chainNames()).toEqual(['Qualifier', 'Researcher', 'Chaser', 'Writer']));
    expect(bodies('automations/au1', 'PATCH')[1]).toMatchObject({ steps: [s2, s1, s4, s3], revision: 8 });
    expect((within(chainItems()[0]).getByRole('button', { name: 'Move step 1 up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(chainItems()[3]).getByRole('button', { name: 'Move step 4 down' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server’s sentence when the chain cannot be saved, and leaves it as it was', async () => {
    serve({ 'automations/au1': (_body, method) => {
      if (method === 'PATCH') throw new AutomationError('Only a workspace owner or admin can change the automation.', 403);
      return chain;
    } });
    await open();
    fireEvent.click(within(chainItems()[1]).getByRole('button', { name: 'Move step 2 up' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only a workspace owner or admin can change the automation.');
    expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
  });

  it('reloads and says so when the chain was changed elsewhere', async () => {
    serve({ 'automations/au1': (_body, method) => {
      if (method === 'PATCH') {
        chain = automation({ steps: automation().steps.slice(0, 2), revision: 9 });
        throw new AutomationError('This automation was changed elsewhere.', 409);
      }
      return chain;
    } });
    await open();
    fireEvent.click(within(chainItems()[1]).getByRole('button', { name: 'Move step 2 up' }));
    expect(await screen.findByText('The chain was changed elsewhere. The latest version is shown.')).toBeTruthy();
    expect(chainNames()).toEqual(['Researcher', 'Qualifier']);
    expect(otherNames()).toEqual(['Writer', 'Chaser', 'Greeter']);
  });

  it('removes an agent from the chain after asking, and keeps the agent', async () => {
    await open('Writer');
    fireEvent.click(button('Remove from the chain'));
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain('Remove Writer from the chain?');
    expect(bodies('automations/au1', 'PATCH')).toEqual([]);
    fireEvent.click(within(question).getByRole('button', { name: 'Remove from the chain' }));
    await waitFor(() => expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Chaser']));
    const [s1, s2, , s4] = automation().steps;
    expect(bodies('automations/au1', 'PATCH')).toEqual([{
      name: 'New lead to project', trigger: { type: 'lead_created', skipImports: false }, steps: [s1, s2, s4], revision: 7,
    }]);
    expect(otherNames()).toEqual(['Writer', 'Greeter']);
    // It stays open, now as an agent in no chain.
    expect(within(details()).getByRole('heading', { name: 'Writer' })).toBeTruthy();
    expect(within(details()).queryByRole('button', { name: 'Remove from the chain' })).toBeNull();
  });

  it('shows a step whose agent is gone, and lets an owner take it out', async () => {
    agents = allAgents().filter((a) => a.id !== 'ag3');
    await open();
    expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Removed agent', 'Chaser']);
    pick('Removed agent');
    expect(within(details()).getByText('This agent no longer exists.')).toBeTruthy();
    fireEvent.click(button('Remove this step from the chain'));
    await confirm('Remove from the chain');
    await waitFor(() => expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Chaser']));
    expect((bodies('automations/au1', 'PATCH')[0] as { steps: Automation['steps'] }).steps.map((s) => s.id)).toEqual(['s1', 's2', 's4']);
    expect(within(details()).getByRole('heading', { name: 'Researcher' })).toBeTruthy();
  });

  it('adds an existing agent to the end of the chain, with when it starts', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add an agent to the chain' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Agent' }).textContent).toContain('Greeter');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'When it starts' }));
    fireEvent.click(screen.getByRole('option', { name: 'When the deal is won' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to the chain' }));

    await waitFor(() => expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser', 'Greeter']));
    const sent = bodies('automations/au1', 'PATCH')[0] as { steps: Automation['steps']; revision: number };
    expect(sent.revision).toBe(7);
    expect(sent.steps.slice(0, 4)).toEqual(automation().steps);
    expect(sent.steps[4]).toMatchObject({ agentId: 'ag9', starts: { type: 'on_deal_won' } });
    expect(typeof sent.steps[4].id).toBe('string');
    expect(sent.steps[4].id.length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(chainItems()[3].textContent).toContain('hands on to Greeter, which starts when the deal is won');
    expect(within(details()).getByRole('heading', { name: 'Greeter' })).toBeTruthy();
  });

  it('can add a new agent to the chain: it is made first, then joins the end', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add an agent to the chain' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Agent' }));
    fireEvent.click(screen.getByRole('option', { name: 'A new agent' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(within(details()).getByRole('heading', { name: 'New agent' })).toBeTruthy();
    expect(details().textContent).toContain('It joins the end of the chain when you save it, and starts straight away.');
    fireEvent.change(nameBox(), { target: { value: 'Thanker' } });
    fireEvent.change(jobBox(), { target: { value: 'Add a thank-you note to the deal.' } });
    fireEvent.click(right('Add notes and follow-ups'));
    fireEvent.click(button('Save agent'));

    await waitFor(() => expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser', 'Thanker']));
    expect(bodies('agents', undefined).filter(Boolean)).toEqual([
      { name: 'Thanker', job: 'Add a thank-you note to the deal.', rights: ['add_notes_followups'], askFirst: false },
    ]);
    const sent = bodies('automations/au1', 'PATCH')[0] as { steps: Automation['steps'] };
    expect(sent.steps[4]).toMatchObject({ agentId: 'ag10', starts: { type: 'after_previous' } });
    const order = au.call.mock.calls.filter((c) => c[1] !== undefined).map((c) => c[0]);
    expect(order).toEqual(['agents', 'automations/au1']);
  });
});

describe('one agent', () => {
  it('has a switch for every right, with its note, and says the list is the limit', async () => {
    await open('Qualifier');
    for (const entry of RIGHTS) {
      expect(right(entry.label)).toBeTruthy();
      expect(within(details()).getByText(entry.note)).toBeTruthy();
    }
    expect(RIGHTS.map((entry) => isOn(right(entry.label)))).toEqual([true, true, false, false, false]);
    expect(within(details()).getByText('An agent can never do more than this list, whatever it is told.')).toBeTruthy();
    expect(details().textContent).toContain('Read the lead, its company and its deal');
  });

  it('says what "Ask me before it acts" means for this agent', async () => {
    await open('Qualifier');
    const askFirst = right('Ask me before it acts');
    expect(isOn(askFirst)).toBe(false);
    expect(details().textContent).toContain('Off for this agent: it only changes the lead’s step and adds notes and follow-ups, which can be undone.');
    fireEvent.click(askFirst);
    expect(details().textContent).toContain('On: everything Qualifier wants to do waits for a person to approve it.');
    fireEvent.click(askFirst);
    fireEvent.click(right('Send email'));
    expect(details().textContent).toContain('Off: it acts alone where the workspace rules allow it.');
  });

  it('links to the assistant for rewriting the job', async () => {
    await open('Qualifier');
    expect(details().textContent).toContain('Written in plain words. The assistant can rewrite it for you.');
    expect(within(details()).getByRole('link', { name: 'The assistant' }).getAttribute('href')).toBe('/crm/automation/assistant?automation=au1');
  });

  it('saves what was changed, naming the revision it was read at', async () => {
    await open('Qualifier');
    expect(button('Save agent').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: '  Fit checker ' } });
    fireEvent.change(jobBox(), { target: { value: 'Decide whether the lead is a fit.' } });
    fireEvent.click(right('Send email'));
    fireEvent.click(right('Add notes and follow-ups'));
    fireEvent.click(right('Ask me before it acts'));
    expect(button('Save agent').disabled).toBe(false);
    fireEvent.click(button('Save agent'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Agent saved.'));
    expect(bodies('agents/ag2', 'PATCH')).toEqual([{
      name: 'Fit checker', job: 'Decide whether the lead is a fit.', rights: ['change_lead_step', 'send_email'], askFirst: true, revision: 4,
    }]);
    expect(chainNames()).toEqual(['Researcher', 'Fit checker', 'Writer', 'Chaser']);
    // Its line in the chain now follows the new job.
    expect(chainItems()[1].textContent).toContain('Decide whether the lead is a fit.');
    expect(nameBox().value).toBe('Fit checker');
    expect(button('Save agent').disabled).toBe(true);

    // A second save names the revision the server answered with.
    fireEvent.change(nameBox(), { target: { value: 'Qualifier' } });
    fireEvent.click(button('Save agent'));
    await waitFor(() => expect(bodies('agents/ag2', 'PATCH')).toHaveLength(2));
    expect(bodies('agents/ag2', 'PATCH')[1]).toMatchObject({ name: 'Qualifier', revision: 5 });
  });

  it('needs a name and a job before it can be saved', async () => {
    await open('Qualifier');
    fireEvent.change(nameBox(), { target: { value: '   ' } });
    expect(button('Save agent').disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: 'Q' } });
    fireEvent.change(jobBox(), { target: { value: '' } });
    expect(button('Save agent').disabled).toBe(true);
    expect(within(details()).getByText('An agent needs a name and a job.')).toBeTruthy();
  });

  it('puts everything back on Discard', async () => {
    await open('Qualifier');
    fireEvent.change(nameBox(), { target: { value: 'Other' } });
    fireEvent.click(right('Send email'));
    fireEvent.click(button('Discard'));
    expect(nameBox().value).toBe('Qualifier');
    expect(isOn(right('Send email'))).toBe(false);
    expect(button('Save agent').disabled).toBe(true);
    expect(bodies('agents/ag2', 'PATCH')).toEqual([]);
  });

  it('shows the server’s sentence where the save was tried, and keeps what was typed', async () => {
    serve({ 'agents/ag2': () => { throw new AutomationError('An agent’s job can be 4,000 characters at most.', 400); } });
    await open('Qualifier');
    fireEvent.change(jobBox(), { target: { value: 'A new job.' } });
    fireEvent.click(button('Save agent'));
    expect((await within(details()).findByRole('alert')).textContent).toBe('An agent’s job can be 4,000 characters at most.');
    expect(jobBox().value).toBe('A new job.');
    expect(button('Save agent').disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reloads and says the agent was changed elsewhere on a 409', async () => {
    serve({ 'agents/ag2': (_body, method) => {
      if (method !== 'PATCH') throw new AutomationError('Not found.', 404);
      agents = agents.map((a) => (a.id === 'ag2' ? { ...a, name: 'Fit judge', job: 'Judge the fit.', revision: 5 } : a));
      throw new AutomationError('This agent was changed elsewhere. Reload it before saving.', 409);
    } });
    await open('Qualifier');
    fireEvent.change(jobBox(), { target: { value: 'My own words.' } });
    fireEvent.click(button('Save agent'));

    expect(await within(details()).findByText('This agent was changed elsewhere. The latest version is shown, and your changes were not saved.')).toBeTruthy();
    expect(nameBox().value).toBe('Fit judge');
    expect(jobBox().value).toBe('Judge the fit.');
    expect(chainNames()).toEqual(['Researcher', 'Fit judge', 'Writer', 'Chaser']);
    expect(calls('agents', undefined).filter((c) => c[1] === undefined)).toHaveLength(2);

    // The next save names the new revision.
    serve();
    fireEvent.change(jobBox(), { target: { value: 'My own words.' } });
    fireEvent.click(button('Save agent'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Agent saved.'));
    expect(bodies('agents/ag2', 'PATCH').at(-1)).toMatchObject({ job: 'My own words.', revision: 5 });
  });

  it('pauses and resumes', async () => {
    await open();
    fireEvent.click(button('Pause'));
    expect(await within(details()).findByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(bodies('agents/ag1/pause')).toEqual([{}]);
    expect(within(details()).getByText('Paused')).toBeTruthy();
    expect(chainItems()[0].textContent).toContain('Paused');

    fireEvent.click(button('Resume'));
    expect(await within(details()).findByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(bodies('agents/ag1/resume')).toEqual([{}]);
    expect(within(details()).queryByText('Paused')).toBeNull();
  });

  it('keeps what is being typed while it is paused, and saves with the newer revision', async () => {
    await open();
    fireEvent.change(nameBox(), { target: { value: 'Finder' } });
    fireEvent.click(button('Pause'));
    await within(details()).findByRole('button', { name: 'Resume' });
    expect(nameBox().value).toBe('Finder');
    fireEvent.click(button('Save agent'));
    await waitFor(() => expect(bodies('agents/ag1', 'PATCH')).toHaveLength(1));
    expect(bodies('agents/ag1', 'PATCH')[0]).toMatchObject({ name: 'Finder', revision: researcher.revision + 1 });
  });

  it('tests the agent on a sample lead and shows the result', async () => {
    await open();
    fireEvent.click(button('Test on a sample lead'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Researcher was tried on Priya Nair. Nothing was changed or sent.')).toBeTruthy();
    expect(bodies('agents/ag1/test')).toEqual([{}]);
    expect(dialog.textContent).toContain('Add a note with the summary');
    expect(dialog.textContent).not.toContain('unsaved changes');
  });

  it('says the saved version was tested when there are unsaved changes', async () => {
    await open();
    fireEvent.change(jobBox(), { target: { value: 'Something else.' } });
    fireEvent.click(button('Test on a sample lead'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This tries the saved agent. Your unsaved changes are not used.')).toBeTruthy();
  });

  it('shows a failed test’s sentence in the dialog', async () => {
    const slow = deferred<never>();
    serve({ 'agents/ag1/test': () => slow.promise });
    await open();
    fireEvent.click(button('Test on a sample lead'));
    const dialog = await screen.findByRole('dialog');
    await act(async () => { slow.reject(new AutomationError('The test needs ANTHROPIC_API_KEY, which is not set.', 503)); });
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The test needs ANTHROPIC_API_KEY, which is not set.');
  });

  it('deletes after asking', async () => {
    await open('Greeter');
    fireEvent.click(button('Delete agent'));
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain('Delete Greeter?');
    expect(calls('agents/ag9', 'DELETE')).toEqual([]);
    fireEvent.click(within(question).getByRole('button', { name: 'Keep agent' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls('agents/ag9', 'DELETE')).toEqual([]);

    fireEvent.click(button('Delete agent'));
    await confirm('Delete agent');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Not in a chain' })).toBeNull());
    expect(calls('agents/ag9', 'DELETE')).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Greeter was deleted.');
    // The first agent of the chain is open again.
    expect(within(details()).getByRole('heading', { name: 'Researcher' })).toBeTruthy();
  });

  it('shows the server’s sentence when the agent is still used', async () => {
    serve({ 'agents/ag3': (_body, method) => {
      if (method === 'DELETE') throw new AutomationError('Writer is still used by “New lead to project”. Remove it from the chain first.', 409);
      throw new AutomationError('Not found.', 404);
    } });
    await open('Writer');
    fireEvent.click(button('Delete agent'));
    await confirm('Delete agent');
    expect((await within(details()).findByRole('alert')).textContent)
      .toBe('Writer is still used by “New lead to project”. Remove it from the chain first.');
    expect(chainNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    expect(within(details()).getByRole('heading', { name: 'Writer' })).toBeTruthy();
  });
});

describe('a new agent', () => {
  it('opens blank from the address, and is made with what was filled in', async () => {
    await open(undefined, '/crm/automation/agents?new=1');
    expect(within(details()).getByRole('heading', { name: 'New agent' })).toBeTruthy();
    expect(nameBox().value).toBe('');
    expect(jobBox().value).toBe('');
    expect(RIGHTS.map((entry) => isOn(right(entry.label)))).toEqual([false, false, false, false, false]);
    for (const name of ['Pause', 'Test on a sample lead', 'Delete agent', 'Remove from the chain']) {
      expect(within(details()).queryByRole('button', { name })).toBeNull();
    }
    expect(button('Save agent').disabled).toBe(true);

    fireEvent.change(nameBox(), { target: { value: 'Thanker' } });
    fireEvent.change(jobBox(), { target: { value: 'Add a thank-you note to the deal.' } });
    fireEvent.click(right('Add notes and follow-ups'));
    fireEvent.click(right('Ask me before it acts'));
    fireEvent.click(button('Save agent'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Agent created.'));
    expect(bodies('agents', undefined).filter(Boolean)).toEqual([
      { name: 'Thanker', job: 'Add a thank-you note to the deal.', rights: ['add_notes_followups'], askFirst: true },
    ]);
    expect(otherNames()).toEqual(['Greeter', 'Thanker']);
    expect(pickButton('Thanker').getAttribute('aria-pressed')).toBe('true');
    expect(within(details()).getByRole('heading', { name: 'Thanker' })).toBeTruthy();
    expect(within(details()).getByRole('button', { name: 'Delete agent' })).toBeTruthy();
    // It joins no chain by itself.
    expect(bodies('automations/au1', 'PATCH')).toEqual([]);
  });

  it('opens from the "New agent" button', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    expect(within(details()).getByRole('heading', { name: 'New agent' })).toBeTruthy();
    expect(pickButton('Researcher').getAttribute('aria-pressed')).toBe('false');
    // Discarding a new agent goes back to the chain's first one.
    fireEvent.change(nameBox(), { target: { value: 'Half' } });
    fireEvent.click(button('Discard'));
    expect(within(details()).getByRole('heading', { name: 'Researcher' })).toBeTruthy();
  });

  it('keeps the form when it cannot be made', async () => {
    serve({ agents: (body) => {
      if (body === undefined) return agents;
      throw new AutomationError('An agent with that name already exists.', 409);
    } });
    await open(undefined, '/crm/automation/agents?new=1');
    fireEvent.change(nameBox(), { target: { value: 'Writer' } });
    fireEvent.change(jobBox(), { target: { value: 'Write.' } });
    fireEvent.click(button('Save agent'));
    expect((await within(details()).findByRole('alert')).textContent).toBe('An agent with that name already exists.');
    expect(nameBox().value).toBe('Writer');
    expect(within(details()).getByRole('heading', { name: 'New agent' })).toBeTruthy();
  });
});

describe('unsaved changes', () => {
  it('are guarded when another agent is picked', async () => {
    await open('Qualifier');
    fireEvent.change(nameBox(), { target: { value: 'Half done' } });
    pick('Writer');
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain('Leave without saving?');
    fireEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(nameBox().value).toBe('Half done');
    expect(pickButton('Qualifier').getAttribute('aria-pressed')).toBe('true');

    pick('Writer');
    await confirm('Discard changes');
    await within(details()).findByRole('heading', { name: 'Writer' });
    expect(nameBox().value).toBe('Writer');

    // Nothing was saved, and going back shows the agent as it was.
    pick('Qualifier');
    expect(nameBox().value).toBe('Qualifier');
    expect(bodies('agents/ag2', 'PATCH')).toEqual([]);
  });

  it('are guarded when a new agent is started', async () => {
    await open('Qualifier');
    fireEvent.change(jobBox(), { target: { value: 'Half done' } });
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    await confirm('Keep editing');
    expect(jobBox().value).toBe('Half done');
  });

  it('do not ask when nothing was changed', async () => {
    await open('Qualifier');
    pick('Writer');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(details()).getByRole('heading', { name: 'Writer' })).toBeTruthy();
  });
});

describe('a member', () => {
  it('reads the agents and cannot change anything', async () => {
    ov = overview({ role: 'Member' });
    await open('Qualifier');
    expect(screen.getByText('Only a workspace owner or admin can change agents. You can read them here.')).toBeTruthy();
    expect(nameBox().disabled).toBe(true);
    expect(jobBox().disabled).toBe(true);
    expect((right('Send email') as HTMLButtonElement).disabled).toBe(true);
    expect((right('Ask me before it acts') as HTMLButtonElement).disabled).toBe(true);
    for (const name of [
      'New agent', 'Add an agent to the chain', 'Save agent', 'Discard', 'Pause', 'Test on a sample lead',
      'Remove from the chain', 'Delete agent', 'Move step 1 up', 'Move step 2 down',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // They can still look at another agent.
    pick('Writer');
    expect(nameBox().value).toBe('Writer');
  });

  it('is not given a blank agent by the address', async () => {
    ov = overview({ role: 'Member' });
    await open(undefined, '/crm/automation/agents?new=1');
    expect(within(details()).getByRole('heading', { name: 'Researcher' })).toBeTruthy();
  });
});
