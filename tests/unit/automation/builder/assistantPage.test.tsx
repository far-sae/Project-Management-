// The assistant screen: the conversation, the draft it builds, testing it, and saving it.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AssistantReply, AutomationDraft, Overview } from '../../../../api/_automation/shared/types';
import {
  allAgents, assistantReply, automation, deferred, draft, overview, polyfillDom, testResult,
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

import { AutomationAssistantPage } from '@/pages/automation/Assistant';
import { AutomationError } from '@/services/automation/client';

const FIRST = 'When a new lead comes in, find out about their company and email the good ones our intro.';
const SECOND = 'Follow-ups can go out without asking me.';

type Handler = (body: any, method: string | undefined) => unknown;
let ov: Overview;
const serve = (overrides: Record<string, Handler> = {}) => {
  const base: Record<string, Handler> = {
    overview: () => ov,
    agents: () => allAgents(),
    'automations/au1': (body, method) => (method === 'PATCH' ? automation({ name: body.name, revision: 8 }) : automation()),
    assistant: () => assistantReply(),
    'automations/test-draft': () => testResult(),
    automations: (body: AutomationDraft) => automation({
      id: 'au9', name: body.name, revision: 1,
      steps: body.steps.map((s, i) => ({ id: `n${i}`, agentId: s.agent.id ?? `made${i}`, starts: s.starts })),
    }),
    'automations/au9': (body, method) => {
      if (method !== 'PATCH') throw new AutomationError('Not found.', 404);
      return automation({
        id: 'au9', name: body.name, revision: body.revision + 1,
        steps: body.steps.map((s: AutomationDraft['steps'][number], i: number) => ({ id: `n${i}`, agentId: s.agent.id ?? `made${i}`, starts: s.starts })),
      });
    },
    'automations/au9/turn-on': () => automation({ id: 'au9', status: 'on', revision: 2 }),
    'automations/au1/turn-on': () => automation({ status: 'on', revision: 9 }),
  };
  au.call.mockImplementation(async (path: string, body?: unknown, method?: string) => {
    const handler = overrides[path] ?? base[path];
    if (handler) return handler(body, method);
    throw new AutomationError('Not found.', 404);
  });
};

const renderPage = (entry = '/crm/automation/assistant') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/crm/automation/assistant" element={<AutomationAssistantPage />} />
      <Route path="/crm/automation" element={<div>overview page</div>} />
    </Routes>
  </MemoryRouter>,
);

const posted = (path: string) => au.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);
const paths = () => au.call.mock.calls.map((c) => c[0] as string);
const box = () => screen.getByRole('textbox', { name: 'Message the assistant' }) as HTMLTextAreaElement;
const ready = () => screen.findByRole('textbox', { name: 'Message the assistant' });
const say = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};
const steps = () => within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
const stepNames = () => steps().map((li) => within(li).getByTestId('step-agent').textContent);
const nameBox = () => screen.getByRole('textbox', { name: 'Automation name' }) as HTMLInputElement;
/** Opens the page and has the assistant build the sample draft. */
const withDraft = async () => {
  renderPage();
  await ready();
  say(FIRST);
  await screen.findByRole('list', { name: 'Steps' });
};

beforeAll(polyfillDom);
beforeEach(() => {
  ov = overview({ automation: null, chain: [] });
  au.state.workspaceId = 'w';
  au.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  window.sessionStorage.clear();
  serve();
});
afterEach(cleanup);

describe('before there is anything to build', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    au.state.workspaceId = null;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeTruthy();
    expect(screen.getByText('Pick a workspace in the sidebar to see its automation.')).toBeTruthy();
    expect(au.call).not.toHaveBeenCalled();
  });

  it('points to the overview when automation is not set up', async () => {
    ov = overview({ setUp: false, automation: null, chain: [] });
    renderPage();
    expect(await screen.findByText('Automation is not set up in Studio yet. Set it up on the overview first.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the overview' }).getAttribute('href')).toBe('/crm/automation');
    expect(screen.queryByRole('textbox', { name: 'Message the assistant' })).toBeNull();
    expect(paths()).toEqual(['overview']);
  });

  it('shows where it is loading, then the server’s sentence when that fails, and tries again', async () => {
    serve({ overview: () => { throw new AutomationError('Choose a workspace.', 403); } });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading the assistant' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a workspace.');
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await ready()).toBeTruthy();
  });

  it('starts empty, with the place the draft will appear', async () => {
    renderPage();
    await ready();
    expect(screen.getByRole('heading', { name: 'Tell me what should happen' })).toBeTruthy();
    expect(screen.getByText('Say it in your own words. I build the automation, you check it and turn it on.')).toBeTruthy();
    expect(screen.getByText(/The automation appears here/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and turn on' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(posted('assistant')).toEqual([]);
  });
});

describe('the conversation', () => {
  it('sends what was written and shows the reply with what it assumed', async () => {
    renderPage();
    await ready();
    say(`  ${FIRST}  `);
    expect(await screen.findByText('Done. I set this up as one automation with four agents. It is on the right.')).toBeTruthy();
    expect(posted('assistant')).toEqual([{ messages: [{ role: 'user', text: FIRST }], draft: null }]);

    const log = screen.getByRole('log');
    expect(within(log).getByText(FIRST)).toBeTruthy();
    expect(within(log).getByText('Two things I assumed, change them if they are wrong:')).toBeTruthy();
    expect(within(log).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Emails wait for your approval before they are sent.',
      '“Good fit” means a company with a work email.',
    ]);
    expect(box().value).toBe('');
    expect(stepNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
  });

  it('sends the whole conversation and the current draft with every message', async () => {
    await withDraft();
    serve({ assistant: () => assistantReply({ reply: 'Changed. Step 4 now runs on its own.', assumptions: [], draft: null }) });
    say(SECOND);
    expect(await screen.findByText('Changed. Step 4 now runs on its own.')).toBeTruthy();
    expect(posted('assistant')[1]).toEqual({
      messages: [
        { role: 'user', text: FIRST },
        { role: 'assistant', text: 'Done. I set this up as one automation with four agents. It is on the right.' },
        { role: 'user', text: SECOND },
      ],
      draft: draft(),
    });
    // A reply with no assumptions shows no list.
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('replaces the draft only when the reply brings one', async () => {
    await withDraft();
    serve({ assistant: () => assistantReply({ reply: 'Which email template should I use?', assumptions: [], draft: null }) });
    say(SECOND);
    await screen.findByText('Which email template should I use?');
    expect(stepNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);

    serve({ assistant: () => assistantReply({ reply: 'Shortened.', draft: draft({ name: 'Short chain', steps: draft().steps.slice(0, 2) }) }) });
    say('Only research and qualify.');
    await screen.findByText('Shortened.');
    expect(stepNames()).toEqual(['Researcher', 'Qualifier']);
    expect(nameBox().value).toBe('Short chain');
  });

  it('waits calmly, sends once however often Send is pressed, and Enter sends too', async () => {
    const slow = deferred<AssistantReply>();
    serve({ assistant: () => slow.promise });
    renderPage();
    await ready();
    fireEvent.change(box(), { target: { value: FIRST } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    const status = await screen.findByText(/This can take a minute/);
    expect(status.closest('[role="status"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(posted('assistant')).toHaveLength(1));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    // What was sent is already in the conversation.
    expect(within(screen.getByRole('log')).getByText(FIRST)).toBeTruthy();

    await act(async () => { slow.resolve(assistantReply()); });
    expect(await screen.findByRole('list', { name: 'Steps' })).toBeTruthy();
    expect(screen.queryByText(/This can take a minute/)).toBeNull();
    expect(posted('assistant')).toHaveLength(1);
  });

  it('does not send on Shift and Enter, which starts a new line', async () => {
    renderPage();
    await ready();
    fireEvent.change(box(), { target: { value: FIRST } });
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(posted('assistant')).toEqual([]);
  });

  it('can be cancelled, and then ignores a reply that arrives late', async () => {
    const slow = deferred<AssistantReply>();
    serve({ assistant: () => slow.promise });
    renderPage();
    await ready();
    say(FIRST);
    await waitFor(() => expect(posted('assistant')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(box().value).toBe(FIRST);
    expect(screen.getByText('Cancelled. Nothing was changed.')).toBeTruthy();
    expect(within(screen.getByRole('log')).queryByText(FIRST)).toBeNull();

    await act(async () => { slow.resolve(assistantReply()); });
    expect(screen.queryByText(/Done\. I set this up/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
    expect(box().value).toBe(FIRST);
  });

  it('ignores a late failure after cancelling too', async () => {
    const slow = deferred<AssistantReply>();
    serve({ assistant: () => slow.promise });
    renderPage();
    await ready();
    say(FIRST);
    await waitFor(() => expect(posted('assistant')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { slow.reject(new AutomationError('The assistant failed just now. Try again.', 503)); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [503, 'The assistant is not set up yet: ANTHROPIC_API_KEY is missing.'],
    [429, 'The workspace reached its AI budget for this month.'],
    [403, 'Only a workspace owner or admin can change the automation.'],
  ])('shows the server’s sentence for a %i where it was tried, and keeps what was typed', async (status, sentence) => {
    serve({ assistant: () => { throw new AutomationError(sentence, status); } });
    renderPage();
    await ready();
    say(FIRST);
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(box().value).toBe(FIRST);
    expect(within(screen.getByRole('log')).queryByText(FIRST)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();

    // Trying again sends a fresh request with the same words.
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('list', { name: 'Steps' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(posted('assistant')).toHaveLength(2);
    expect(posted('assistant')[1]).toEqual({ messages: [{ role: 'user', text: FIRST }], draft: null });
  });

  it('offers ideas that fill the box with an example sentence', async () => {
    renderPage();
    await ready();
    const ideas = within(screen.getByRole('group', { name: 'Ideas' })).getAllByRole('button');
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    expect(ideas.length).toBeLessThanOrEqual(4);
    fireEvent.click(ideas[0]);
    expect(box().value.length).toBeGreaterThan(20);
    const first = box().value;
    fireEvent.click(ideas[1]);
    expect(box().value).not.toBe(first);
    expect(posted('assistant')).toEqual([]);
  });
});

describe('keeping the conversation', () => {
  it('is still there after the page is opened again', async () => {
    await withDraft();
    fireEvent.change(nameBox(), { target: { value: 'Leads to projects' } });
    cleanup();
    renderPage();
    await ready();
    expect(within(screen.getByRole('log')).getByText(FIRST)).toBeTruthy();
    expect(screen.getByText('Two things I assumed, change them if they are wrong:')).toBeTruthy();
    expect(stepNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    expect(nameBox().value).toBe('Leads to projects');
    expect(posted('assistant')).toHaveLength(1);
  });

  it('is kept apart for each workspace', async () => {
    await withDraft();
    cleanup();
    au.state.workspaceId = 'other';
    renderPage();
    await ready();
    expect(within(screen.getByRole('log')).queryByText(FIRST)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  });

  it('works when the browser gives no storage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      await withDraft();
      expect(stepNames()).toHaveLength(4);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('clears on "Start again", after asking', async () => {
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(stepNames()).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull());
    expect(within(screen.getByRole('log')).queryByText(FIRST)).toBeNull();

    cleanup();
    renderPage();
    await ready();
    expect(within(screen.getByRole('log')).queryByText(FIRST)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  });
});

describe('the draft', () => {
  it('shows the trigger, each step and where it runs', async () => {
    await withDraft();
    const panel = screen.getByRole('region', { name: 'Draft automation' });
    expect(nameBox().value).toBe('New lead to project');
    expect(within(panel).getByText('Not turned on yet')).toBeTruthy();
    expect(within(panel).getByText('A new lead is added in Studio')).toBeTruthy();
    expect((within(panel).getByRole('checkbox', { name: 'Skip leads that came from an import' }) as HTMLInputElement).checked).toBe(false);
    expect(within(panel).getByText('Runs only in Studio. Other workspaces are not touched.')).toBeTruthy();

    const [first, , third, fourth] = steps();
    expect(first.textContent).toContain('Looks up the lead and their company.');
    expect(first.textContent).toContain('Hands on: the summary');
    expect(first.textContent).toContain('Starts as soon as the lead is added');
    expect(first.textContent).toContain('Automatic');
    // The writer asks first, so it always waits; without the workspace rules the rest is an honest "may".
    expect(third.textContent).toContain('Needs approval');
    expect(fourth.textContent).toContain('Starts after 3 days with no reply');
    expect(fourth.textContent).toContain('Automatic');
  });

  it('says "May need approval" only when it depends on rules it could not read', async () => {
    serve({ assistant: () => assistantReply({ draft: draft({ steps: draft().steps.map((s) => ({ ...s, agent: { ...s.agent, askFirst: false } })) }) }) });
    await withDraft();
    expect(steps()[2].textContent).toContain('May need approval');
    cleanup();
    window.sessionStorage.clear();

    serve({
      assistant: () => assistantReply({ draft: draft({ steps: draft().steps.map((s) => ({ ...s, agent: { ...s.agent, askFirst: false } })) }) }),
      rules: () => ({ autonomy: 'full' }),
    });
    await withDraft();
    await waitFor(() => expect(steps()[2].textContent).toContain('Automatic'));
    expect(steps()[2].textContent).not.toContain('May need approval');
  });

  it('can be renamed, told to skip imports, and have a step’s start changed', async () => {
    await withDraft();
    fireEvent.change(nameBox(), { target: { value: 'Leads to projects' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skip leads that came from an import' }));
    fireEvent.click(within(steps()[1]).getByRole('combobox', { name: 'When step 2 starts' }));
    fireEvent.click(screen.getByRole('option', { name: 'When the lead replies' }));
    expect(steps()[1].textContent).toContain('Starts when the lead replies');

    fireEvent.change(within(steps()[3]).getByRole('spinbutton'), { target: { value: '5' } });
    expect(steps()[3].textContent).toContain('Starts after 5 days with no reply');

    fireEvent.click(screen.getByRole('button', { name: 'Test on a sample lead' }));
    await screen.findByRole('dialog');
    const sent = posted('automations/test-draft')[0] as { draft: AutomationDraft };
    expect(sent.draft.name).toBe('Leads to projects');
    expect(sent.draft.trigger).toEqual({ type: 'lead_created', skipImports: true });
    expect(sent.draft.steps.map((s) => s.starts)).toEqual([
      { type: 'after_previous' }, { type: 'on_reply' }, { type: 'after_previous' }, { type: 'no_reply_days', days: 5 },
    ]);
  });

  it('can have steps moved and removed', async () => {
    await withDraft();
    fireEvent.click(within(steps()[1]).getByRole('button', { name: 'Move step 2 up' }));
    expect(stepNames()).toEqual(['Qualifier', 'Researcher', 'Writer', 'Chaser']);
    fireEvent.click(within(steps()[2]).getByRole('button', { name: 'Move step 3 down' }));
    expect(stepNames()).toEqual(['Qualifier', 'Researcher', 'Chaser', 'Writer']);
    fireEvent.click(within(steps()[1]).getByRole('button', { name: 'Remove step 2' }));
    expect(stepNames()).toEqual(['Qualifier', 'Chaser', 'Writer']);
    // The ends cannot move further.
    expect((within(steps()[0]).getByRole('button', { name: 'Move step 1 up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(steps()[2]).getByRole('button', { name: 'Move step 3 down' }) as HTMLButtonElement).disabled).toBe(true);

    // The next message to the assistant carries the draft as the person left it.
    say(SECOND);
    await waitFor(() => expect(posted('assistant')).toHaveLength(2));
    expect((posted('assistant')[1] as { draft: AutomationDraft }).draft.steps.map((s) => s.agent.name)).toEqual(['Qualifier', 'Chaser', 'Writer']);
  });

  it('cannot be tested or turned on with no steps left, or saved without a name', async () => {
    serve({ assistant: () => assistantReply({ draft: draft({ steps: draft().steps.slice(0, 1) }) }) });
    await withDraft();
    fireEvent.change(nameBox(), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Give the automation a name to save it.')).toBeTruthy();
    fireEvent.change(nameBox(), { target: { value: 'Leads' } });
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(steps()[0]).getByRole('button', { name: 'Remove step 1' }));
    expect((screen.getByRole('button', { name: 'Test on a sample lead' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save and turn on' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Add at least one step before it can be tested or turned on.')).toBeTruthy();
  });
});

describe('testing the draft', () => {
  it('shows what each step received, decided and would do, and what waits for a person', async () => {
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Test on a sample lead' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('New lead to project was tried on Priya Nair. Nothing was changed or sent.')).toBeTruthy();
    expect(posted('automations/test-draft')).toEqual([{ draft: draft() }]);

    const [one, two] = within(dialog).getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'OL');
    expect(one.textContent).toContain('Researcher');
    expect(one.textContent).toContain('The new lead Priya Nair.');
    expect(one.textContent).toContain('Northwind is a design studio of 12 people.');
    expect(one.textContent).toContain('Add a note with the summary');
    expect(one.textContent).not.toContain('Would wait for a person');
    expect(two.textContent).toContain('Send the intro email to priya@northwind.example');
    expect(two.textContent).toContain('Would wait for a person');
    expect(within(dialog).getByText('Step 4 waits 3 days for a reply.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says when a step would stop the run', async () => {
    serve({ 'automations/test-draft': () => testResult({
      steps: [{ n: 1, agentName: 'Qualifier', received: 'The summary.', decided: 'Not a fit.', wouldDo: [], needsApproval: false, stopsChain: true }],
      note: null,
    }) });
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Test on a sample lead' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Would stop the run here')).toBeTruthy();
    expect(dialog.textContent).toContain('Nothing.');
  });

  it('waits in the dialog, and shows the server’s sentence there with a way to try again', async () => {
    const slow = deferred<never>();
    serve({ 'automations/test-draft': () => slow.promise });
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Test on a sample lead' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Running the test…')).toBeTruthy();
    await act(async () => { slow.reject(new AutomationError('The test needs ANTHROPIC_API_KEY, which is not set.', 503)); });
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The test needs ANTHROPIC_API_KEY, which is not set.');
    expect(toast.error).not.toHaveBeenCalled();

    serve();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText(/was tried on Priya Nair/)).toBeTruthy();
    expect(posted('automations/test-draft')).toHaveLength(2);

    // The draft is still there behind the dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stepNames()).toHaveLength(4);
  });

  it('ignores a result that arrives after the dialog was closed', async () => {
    const slow = deferred<ReturnType<typeof testResult>>();
    serve({ 'automations/test-draft': () => slow.promise });
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Test on a sample lead' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop waiting' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => { slow.resolve(testResult()); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('saving', () => {
  it('saves the draft, turns it on, says so and goes to the overview', async () => {
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    expect(await screen.findByText('overview page')).toBeTruthy();
    expect(paths().filter((p) => p.startsWith('automations'))).toEqual(['automations', 'automations/au9/turn-on']);
    expect(posted('automations')).toEqual([draft()]);
    expect(posted('automations/au9/turn-on')).toEqual([{}]);
    expect(toast.success).toHaveBeenCalledWith('“New lead to project” is on. New leads in Studio start it.');

    // The conversation is finished with: opening the assistant again starts fresh.
    cleanup();
    renderPage();
    await ready();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  });

  it('saves as a draft and stays, and a later save changes that one instead of making another', async () => {
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved as a draft.'));
    expect(posted('automations')).toEqual([draft()]);
    expect(stepNames()).toHaveLength(4);
    expect(paths()).not.toContain('automations/au9/turn-on');

    fireEvent.change(nameBox(), { target: { value: 'Leads to projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    expect(await screen.findByText('overview page')).toBeTruthy();
    expect(posted('automations')).toHaveLength(1);
    const patch = au.call.mock.calls.find((c) => c[0] === 'automations/au9' && c[2] === 'PATCH');
    expect(patch?.[1]).toMatchObject({ name: 'Leads to projects', revision: 1 });
    // The agents the first save made are named by their ids, so they are not made twice.
    expect((patch?.[1] as AutomationDraft).steps.map((s) => s.agent.id)).toEqual(['made0', 'made1', 'made2', 'made3']);
    expect(paths().filter((p) => p.startsWith('automations'))).toEqual(['automations', 'automations/au9', 'automations/au9/turn-on']);
  });

  it('keeps the saved draft when it cannot be turned on, and says why', async () => {
    serve({ 'automations/au9/turn-on': () => { throw new AutomationError('An agent in this chain was deleted.', 409); } });
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Saved as a draft, but it could not be turned on. An agent in this chain was deleted.');
    expect(screen.queryByText('overview page')).toBeNull();
    expect(stepNames()).toHaveLength(4);

    // Trying again turns on the one already saved.
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    expect(await screen.findByText('overview page')).toBeTruthy();
    expect(posted('automations')).toHaveLength(1);
  });

  it('shows the server’s sentence when the draft cannot be saved, and keeps it', async () => {
    serve({ automations: () => { throw new AutomationError('Give the automation a name.', 400); } });
    await withDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give the automation a name.');
    expect(stepNames()).toHaveLength(4);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('changing a saved automation', () => {
  const OPEN = '/crm/automation/assistant?automation=au1';

  it('loads it with its agents as the draft', async () => {
    ov = overview();
    renderPage(OPEN);
    await ready();
    expect(nameBox().value).toBe('New lead to project');
    expect(stepNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    expect(paths()).toEqual(expect.arrayContaining(['overview', 'automations/au1', 'agents']));
    // The overview's one-line descriptions are used, and the chain says who each hands on to.
    expect(steps()[0].textContent).toContain('Reads the lead and company; writes a summary');
    expect(steps()[0].textContent).toContain('Hands on to Qualifier');
    expect(steps()[3].textContent).toContain('Needs approval');
    expect(posted('assistant')).toEqual([]);
  });

  it('saves with a PATCH that names the revision it was read at', async () => {
    ov = overview();
    renderPage(OPEN);
    await ready();
    fireEvent.change(nameBox(), { target: { value: 'Leads to projects' } });
    fireEvent.click(within(steps()[3]).getByRole('button', { name: 'Remove step 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved as a draft.'));

    const patch = au.call.mock.calls.find((c) => c[0] === 'automations/au1' && c[2] === 'PATCH');
    expect(patch?.[1]).toMatchObject({
      name: 'Leads to projects',
      trigger: { type: 'lead_created', skipImports: false },
      revision: 7,
    });
    expect((patch?.[1] as AutomationDraft).steps.map((s) => s.agent.id)).toEqual(['ag1', 'ag2', 'ag3']);
    expect(posted('automations')).toEqual([]);
  });

  it('turns it on without saving again when nothing was changed', async () => {
    ov = overview();
    renderPage(OPEN);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    expect(await screen.findByText('overview page')).toBeTruthy();
    expect(au.call.mock.calls.filter((c) => c[2] === 'PATCH')).toEqual([]);
    expect(posted('automations/au1/turn-on')).toEqual([{}]);
  });

  it('offers "Save changes" for one that is already on', async () => {
    ov = overview();
    serve({ 'automations/au1': (body, method) => (method === 'PATCH' ? automation({ name: body.name, status: 'on', revision: 8 }) : automation({ status: 'on' })) });
    renderPage(OPEN);
    await ready();
    expect(screen.getByText('Turned on')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and turn on' })).toBeNull();
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: 'Leads' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved.'));
    expect(paths().filter((p) => p.endsWith('turn-on'))).toEqual([]);
  });

  it('saves a paused one without turning it on, or turns it on again', async () => {
    ov = overview();
    serve({ 'automations/au1': (body, method) => (method === 'PATCH' ? automation({ name: body.name, status: 'paused', revision: 8 }) : automation({ status: 'paused' })) });
    renderPage(OPEN);
    await ready();
    expect(within(screen.getByRole('region', { name: 'Draft automation' })).getByText('Paused')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save and turn on' })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: 'Leads' } });
    fireEvent.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved.'));
    expect(au.call.mock.calls.find((c) => c[2] === 'PATCH')?.[1]).toMatchObject({ name: 'Leads', revision: 7 });
    expect(paths().filter((p) => p.endsWith('turn-on'))).toEqual([]);
  });

  it('says when it was changed elsewhere, and can load the saved version', async () => {
    ov = overview();
    serve({ 'automations/au1': (_body, method) => {
      if (method === 'PATCH') throw new AutomationError('This automation was changed elsewhere. Reload it before saving.', 409);
      return automation();
    } });
    renderPage(OPEN);
    await ready();
    fireEvent.change(nameBox(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This automation was changed elsewhere. Reload it before saving.');
    expect(nameBox().value).toBe('Mine');

    serve({ 'automations/au1': () => automation({ name: 'Theirs', revision: 8 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Load the saved version' }));
    await waitFor(() => expect(nameBox().value).toBe('Theirs'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server’s sentence when the automation cannot be found', async () => {
    renderPage('/crm/automation/assistant?automation=gone');
    expect((await screen.findByRole('alert')).textContent).toBe('Not found.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('a member', () => {
  it('reads the automation and cannot change or build anything', async () => {
    ov = overview({ role: 'Member' });
    renderPage();
    expect(await screen.findByText('Only a workspace owner or admin builds automations. You can read this one.')).toBeTruthy();
    expect(stepNames()).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    expect(screen.getByRole('heading', { name: 'New lead to project' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Skip leads that came from an import' }) as HTMLInputElement).disabled).toBe(true);
    for (const name of ['Send', 'Save and turn on', 'Save as draft', 'Test on a sample lead', 'Start again', 'Remove step 1']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(posted('assistant')).toEqual([]);
  });

  it('is told when there is no automation to read yet', async () => {
    ov = overview({ role: 'Member', automation: null, chain: [] });
    renderPage();
    expect(await screen.findByText('Only a workspace owner or admin builds automations. There is none in this workspace yet.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
  });
});
