// Workspace rules: what the agents may do alone in a workspace, their limits, and the project a won deal becomes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Overview, WorkspaceRow, WorkspaceRules, WorkspaceRulesInput } from '../../../../api/_automation/shared/types';
import { overview, people, rules, savedBody, stubBrowser, workspaceRows } from './fixtures';

const auto = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call }, workspaceId: 'w1' as string | null, workspaceName: 'Studio' } };
});
const scope = vi.hoisted(() => ({ select: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/hooks/useAutomation', () => ({ useAutomation: () => auto.state }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => scope }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'sign-in-token' } } }) } },
}));

import { AutomationError } from '@/services/automation/client';
import { AutomationRulesPage } from '@/pages/automation/Rules';

/** What the pretend server holds and how it answers. */
interface Server {
  rules: WorkspaceRules;
  overview: Overview;
  rows: WorkspaceRow[];
  people: Array<{ userId: string; name: string }>;
  /** Thrown instead of an answer, once, by the call with this name ("POST rules", "overview"…). */
  fail: Record<string, unknown>;
}
let server: Server;

function serve(over: Partial<Server> = {}): Server {
  server = { rules: rules(), overview: overview(), rows: workspaceRows(), people: people(), fail: {}, ...over };
  auto.call.mockImplementation(async (path: string, body?: unknown) => {
    const name = body === undefined ? path : `POST ${path}`;
    if (name in server.fail) {
      const failure = server.fail[name];
      delete server.fail[name];
      throw failure;
    }
    if (path === 'overview') return server.overview;
    if (path === 'workspaces') return server.rows;
    if (path === 'people') return server.people;
    if (path === 'rules' && body === undefined) return server.rules;
    if (path === 'rules') {
      const { revision, ...rest } = body as WorkspaceRulesInput;
      server.rules = { ...rest, workspaceId: 'w1', revision: revision + 1, updated: '2026-11-20T10:00:00Z' };
      return server.rules;
    }
    throw new Error(`unexpected ${path}`);
  });
  return server;
}

/** The page at its address, with the overview beside it. A new element each time, so a second render is not skipped. */
const app = () => (
  <MemoryRouter initialEntries={['/crm/automation/rules']}>
    <Routes>
      <Route path="/crm/automation/rules" element={<AutomationRulesPage />} />
      <Route path="/crm/automation" element={<p>Overview page</p>} />
    </Routes>
  </MemoryRouter>
);
const show = () => render(app());
const open = async () => {
  const view = show();
  await screen.findByLabelText('AI spend per month');
  return view;
};

const asked = (path: string) => auto.call.mock.calls.filter((c) => c[0] === path && c[1] === undefined).length;
const sends = () => auto.call.mock.calls.filter((c) => c[0] === 'rules' && c[1] !== undefined).map((c) => c[1] as WorkspaceRulesInput);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const press = (name: string) => fireEvent.click(button(name));
const toggle = (name: string) => screen.getByRole('switch', { name }) as HTMLButtonElement;
const isOn = (name: string) => toggle(name).getAttribute('aria-checked') === 'true';
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const combo = (name: string) => screen.getByRole('combobox', { name });
/** Picks from a drop-down the way the keyboard does. */
const choose = async (name: string, option: string) => {
  fireEvent.keyDown(combo(name), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  await waitFor(() => expect(combo(name).textContent).toContain(option));
};
const saveButton = () => button('Save rules');
/** Saves and gives back what was sent. */
const save = async () => {
  const before = sends().length;
  fireEvent.click(saveButton());
  await waitFor(() => expect(sends().length).toBe(before + 1));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Workspace rules saved.'));
  return sends()[before];
};
/** Presses Save when something is wrong: nothing may be sent. */
const refusedSave = () => {
  const before = sends().length;
  fireEvent.click(saveButton());
  expect(sends().length).toBe(before);
};
const columnTitles = () => screen.getAllByLabelText(/^Column \d+$/).map((input) => (input as HTMLInputElement).value);
const taskTitles = () => screen.getAllByLabelText(/^Task \d+$/).map((input) => (input as HTMLInputElement).value);
const taskDays = () => screen.getAllByLabelText(/^Days until task \d+ is due$/).map((input) => (input as HTMLInputElement).value);
const workspacesCard = () => within(screen.getByRole('region', { name: 'Each workspace runs on its own' }));
const rowOf = (workspace: string) => within(workspacesCard().getByRole('row', { name: new RegExp(`^${workspace}`) }));

beforeEach(() => {
  stubBrowser();
  auto.state.workspaceId = 'w1';
  auto.state.workspaceName = 'Studio';
  auto.call.mockReset();
  scope.select.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Workspace rules: what is saved', () => {
  it('asks the server for the overview, the workspaces, the rules and the people, once each', async () => {
    serve();
    await open();
    expect(asked('overview')).toBe(1);
    expect(asked('workspaces')).toBe(1);
    expect(asked('rules')).toBe(1);
    expect(asked('people')).toBe(1);
    expect(auto.call).toHaveBeenCalledTimes(4);
  });

  it('shows the rules of the workspace', async () => {
    serve();
    await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace rules' })).toBeTruthy();

    expect(isOn('Run automation in Studio')).toBe(true);
    expect(screen.getByText('Off means nothing runs in Studio and new leads start no run. Runs already waiting stay where they are.')).toBeTruthy();

    expect(screen.getByRole('radiogroup', { name: 'How much may the agents do alone in Studio?' })).toBeTruthy();
    expect(screen.getByText('You can still set this per agent. This is the limit for the whole workspace.')).toBeTruthy();
    expect(radio('Suggest only').checked).toBe(false);
    expect(radio('Ask before anything leaves or closes').checked).toBe(true);
    expect(radio('Fully automatic').checked).toBe(false);
    expect(screen.getByText('Agents prepare everything and wait. You approve every step.')).toBeTruthy();
    expect(screen.getByText('Notes, follow-ups, lead steps and the project are automatic. Sending an email and marking a deal won or lost wait for you.')).toBeTruthy();
    expect(screen.getByText('From new lead to project with nobody in between. You get a summary of each run.')).toBeTruthy();
    expect(screen.getByText('Recommended to start')).toBeTruthy();

    expect(field('AI spend per month').value).toBe('50');
    expect(screen.getByText('In US dollars. At the limit, agents pause and you are told.')).toBeTruthy();
    expect(field('Emails per lead').value).toBe('3');
    expect(screen.getByText('After that the lead is left to a person.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sends only during' })).toBeTruthy();
    expect(isOn('Weekdays only')).toBe(true);
    expect(combo('From').textContent).toContain('09:00');
    expect(combo('To').textContent).toContain('18:00');
    expect(combo('Time zone').textContent).toContain('Europe/London');
    expect(screen.getByText('Drafted any time, sent in these hours.')).toBeTruthy();
    expect(isOn('Let agents look companies up on the web')).toBe(false);

    expect(screen.getByRole('region', { name: 'The project a won deal becomes in Studio' })).toBeTruthy();
    expect(screen.getByText('The last agent builds this. Another workspace can have a different one.')).toBeTruthy();
    expect(field('Project name').value).toBe('{company} – {deal}');
    expect(screen.getByText('For example: Northwind Studio – Website redesign')).toBeTruthy();
    expect(combo('Project lead').textContent).toContain('Whoever owns the deal');
    expect(isOn('Add everyone in Studio to the project')).toBe(true);
    expect(columnTitles()).toEqual(['Undefined task', 'To-do', 'Done']);
    expect(taskTitles()).toEqual(['Kick-off call with the customer', 'Confirm scope and what was promised in the deal']);
    expect(taskDays()).toEqual(['2', '3']);
    expect(isOn('Let the agent add tasks it finds in the deal notes')).toBe(true);
  });

  it('says where emails go from, with the way to Document settings', async () => {
    serve();
    await open();
    const sentence = 'Emails go from the mailbox connected in Document settings, or from TaskCalendar when none is connected.';
    expect(screen.getByText((_text, element) => element?.tagName === 'P' && element.textContent === sentence)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Document settings' }).getAttribute('href')).toBe('/crm/document-settings');
  });

  it('shows a saved project lead by name, and a time zone the list does not have', async () => {
    const saved = rules();
    serve({ rules: { ...saved, sendWindow: { ...saved.sendWindow, timeZone: 'America/Halifax' }, project: { ...saved.project, lead: 'u2' } } });
    await open();
    expect(combo('Project lead').textContent).toContain('Elena Rossi');
    expect(combo('Time zone').textContent).toContain('America/Halifax');
  });

  it('still shows a project lead who has left the workspace, and saves it untouched', async () => {
    const saved = rules();
    serve({ rules: { ...saved, project: { ...saved.project, lead: 'u9' } } });
    await open();
    expect(combo('Project lead').textContent).toContain('Someone no longer in this workspace');
    type('Emails per lead', '4');
    expect((await save()).project.lead).toBe('u9');
  });

  it('keeps Save off until something changed, then sends the whole of the rules with the revision read', async () => {
    serve();
    await open();
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    type('Emails per lead', '5');
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(await save()).toEqual({ ...savedBody(), emailsPerLead: 5 });

    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    // The next save names the revision the server answered with.
    type('Emails per lead', '6');
    expect(await save()).toEqual({ ...savedBody(), emailsPerLead: 6, revision: 5 });
  });

  it('is not changed by typing something and then putting it back', async () => {
    serve();
    await open();
    type('AI spend per month', '75');
    expect(saveButton().disabled).toBe(false);
    type('AI spend per month', '50');
    expect(saveButton().disabled).toBe(true);
  });

  it('shows the workspace as it now is in the list of workspaces after a save', async () => {
    serve();
    await open();
    expect(rowOf('Studio').getByText('On')).toBeTruthy();
    fireEvent.click(toggle('Run automation in Studio'));
    fireEvent.click(radio('Suggest only'));
    await save();
    await waitFor(() => expect(rowOf('Studio').getByText('Off')).toBeTruthy());
    expect(rowOf('Studio').getByText('Suggests only')).toBeTruthy();
    expect(asked('workspaces')).toBe(1);
  });
});

describe('Workspace rules: every control changes what is saved', () => {
  it('turns automation off and on', async () => {
    serve();
    await open();
    fireEvent.click(toggle('Run automation in Studio'));
    expect(isOn('Run automation in Studio')).toBe(false);
    expect(await save()).toEqual({ ...savedBody(), enabled: false });
    fireEvent.click(toggle('Run automation in Studio'));
    expect(await save()).toEqual({ ...savedBody(), enabled: true, revision: 5 });
  });

  it('changes how much the agents may do alone', async () => {
    serve();
    await open();
    fireEvent.click(radio('Suggest only'));
    expect(radio('Suggest only').checked).toBe(true);
    expect(radio('Ask before anything leaves or closes').checked).toBe(false);
    expect(await save()).toEqual({ ...savedBody(), autonomy: 'suggest' });
  });

  it('changes the spend and the emails per lead, in cents and whole numbers', async () => {
    serve();
    await open();
    type('AI spend per month', '120.50');
    type('Emails per lead', '0');
    expect(await save()).toEqual({ ...savedBody(), monthlyBudgetCents: 12050, emailsPerLead: 0 });
    // What the server stored is shown the way a person would type it.
    await waitFor(() => expect(field('AI spend per month').value).toBe('120.50'));
  });

  it('changes when emails are sent', async () => {
    serve();
    await open();
    fireEvent.click(toggle('Weekdays only'));
    await choose('From', '07:00');
    await choose('To', '20:00');
    await choose('Time zone', 'America/New York');
    expect(await save()).toEqual({
      ...savedBody(), sendWindow: { weekdaysOnly: false, startHour: 7, endHour: 20, timeZone: 'America/New_York' },
    });
  });

  it('lets the agents look companies up on the web', async () => {
    serve();
    await open();
    expect(screen.getByText("Agents with that right search public web pages for the lead's company. Every look-up adds to the AI spend.")).toBeTruthy();
    fireEvent.click(toggle('Let agents look companies up on the web'));
    expect(await save()).toEqual({ ...savedBody(), webResearch: true });
  });

  it('changes the project name by typing and by inserting a placeholder, with a live example', async () => {
    serve();
    await open();
    type('Project name', 'Project for ');
    expect(screen.getByText('For example: Project for')).toBeTruthy();
    const name = field('Project name');
    name.setSelectionRange(name.value.length, name.value.length);
    press('Insert {company}');
    expect(name.value).toBe('Project for {company}');
    expect(screen.getByText('For example: Project for Northwind Studio')).toBeTruthy();
    press('Insert {deal}');
    press('Insert {lead}');
    expect(name.value).toBe('Project for {company}{deal}{lead}');
    expect(screen.getByText('For example: Project for Northwind StudioWebsite redesignElena Rossi')).toBeTruthy();
    const body = await save();
    expect(body).toEqual({ ...savedBody(), project: { ...savedBody().project, nameTemplate: 'Project for {company}{deal}{lead}' } });
  });

  it('puts a placeholder where the cursor is', async () => {
    serve();
    await open();
    const name = field('Project name');
    // The cursor is put at the start, and leaves the box when the button is pressed.
    fireEvent.focus(name);
    name.setSelectionRange(0, 0);
    fireEvent.blur(name);
    press('Insert {lead}');
    expect(name.value).toBe('{lead}{company} – {deal}');
    // It comes back right after what was put in, so the next one follows it.
    expect(document.activeElement).toBe(name);
    press('Insert {deal}');
    expect(name.value).toBe('{lead}{deal}{company} – {deal}');
  });

  it('puts a placeholder at the end when the cursor was never in the name', async () => {
    serve();
    await open();
    press('Insert {lead}');
    expect(field('Project name').value).toBe('{company} – {deal}{lead}');
  });

  it('changes who leads the project and who is added to it', async () => {
    serve();
    await open();
    await choose('Project lead', 'Elena Rossi');
    fireEvent.click(toggle('Add everyone in Studio to the project'));
    fireEvent.click(toggle('Let the agent add tasks it finds in the deal notes'));
    expect(await save()).toEqual({
      ...savedBody(), project: { ...savedBody().project, lead: 'u2', addEveryone: false, agentMayAddTasks: false },
    });
    await choose('Project lead', 'Whoever owns the deal');
    expect((await save()).project.lead).toBe('deal_owner');
  });

  it('adds, renames, moves and removes board columns', async () => {
    serve();
    await open();
    type('Column 2', 'Doing');
    press('Move column 1 down');
    expect(columnTitles()).toEqual(['Doing', 'Undefined task', 'Done']);
    press('Move column 3 up');
    expect(columnTitles()).toEqual(['Doing', 'Done', 'Undefined task']);
    press('Remove column 3');
    expect(columnTitles()).toEqual(['Doing', 'Done']);
    press('Add a column');
    expect(columnTitles()).toEqual(['Doing', 'Done', '']);
    expect(document.activeElement).toBe(field('Column 3'));
    type('Column 3', ' Signed off ');
    expect((await save()).project.columns).toEqual(['Doing', 'Done', 'Signed off']);
  });

  it('keeps at least one column, stops at twelve, and can go back to the standard columns', async () => {
    serve();
    await open();
    expect(button('Move column 1 up').disabled).toBe(true);
    expect(button('Move column 3 down').disabled).toBe(true);
    press('Remove column 1');
    press('Remove column 1');
    expect(columnTitles()).toEqual(['Done']);
    expect(button('Remove column 1').disabled).toBe(true);

    press('Use the standard columns');
    expect(columnTitles()).toEqual(['Undefined task', 'To-do', 'On-Progress', 'Done', 'Need review']);
    for (let n = 6; n <= 12; n += 1) { press('Add a column'); type(`Column ${n}`, `Extra ${n}`); }
    expect(columnTitles()).toHaveLength(12);
    expect(button('Add a column').disabled).toBe(true);
    expect((await save()).project.columns).toHaveLength(12);
  });

  it('adds, edits, moves and removes kick-off tasks', async () => {
    serve();
    await open();
    type('Task 1', 'Kick-off call');
    type('Days until task 1 is due', '1');
    press('Move task 1 down');
    expect(taskTitles()).toEqual(['Confirm scope and what was promised in the deal', 'Kick-off call']);
    expect(taskDays()).toEqual(['3', '1']);
    press('Move task 2 up');
    expect(taskTitles()).toEqual(['Kick-off call', 'Confirm scope and what was promised in the deal']);
    press('Remove task 2');
    press('Add a task');
    expect(document.activeElement).toBe(field('Task 2'));
    type('Task 2', 'Collect access, files and information');
    type('Days until task 2 is due', '5');
    expect((await save()).project.tasks).toEqual([
      { title: 'Kick-off call', days: 1 }, { title: 'Collect access, files and information', days: 5 },
    ]);
  });

  it('can have no kick-off tasks at all, and stops at twenty', async () => {
    serve();
    await open();
    press('Remove task 1');
    press('Remove task 1');
    expect(screen.getByText('No kick-off tasks. The project starts with an empty board.')).toBeTruthy();
    expect((await save()).project.tasks).toEqual([]);
    for (let n = 1; n <= 20; n += 1) { press('Add a task'); type(`Task ${n}`, `Task number ${n}`); }
    expect(button('Add a task').disabled).toBe(true);
    expect((await save()).project.tasks).toHaveLength(20);
  });
});

describe('Workspace rules: checks before saving', () => {
  const problem = (sentence: string) => screen.queryByText(sentence);

  it('says nothing until Save is pressed, then marks what is wrong and sends nothing', async () => {
    serve();
    await open();
    type('AI spend per month', 'lots');
    expect(problem('Enter an amount from $0 to $100,000.')).toBeNull();
    refusedSave();
    expect(problem('Enter an amount from $0 to $100,000.')).toBeTruthy();
    expect(field('AI spend per month').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Check the marked fields, then save again.');
    expect(toast.error).toHaveBeenCalledWith('Check the marked fields, then save again.');

    // Once it is put right the sentence goes, and the save goes through.
    type('AI spend per month', '100000');
    expect(problem('Enter an amount from $0 to $100,000.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await save()).monthlyBudgetCents).toBe(10_000_000);
  });

  it('wants a spend from 0 to 100,000 dollars', async () => {
    serve();
    await open();
    for (const bad of ['100000.01', '', '-5', '12.345']) {
      type('AI spend per month', bad);
      refusedSave();
      expect(problem('Enter an amount from $0 to $100,000.')).toBeTruthy();
    }
    type('AI spend per month', '0');
    expect(problem('Enter an amount from $0 to $100,000.')).toBeNull();
  });

  it('wants 0 to 10 emails per lead', async () => {
    serve();
    await open();
    for (const bad of ['11', '2.5', '']) {
      type('Emails per lead', bad);
      refusedSave();
      expect(problem('Enter a whole number from 0 to 10.')).toBeTruthy();
      expect(field('Emails per lead').getAttribute('aria-invalid')).toBe('true');
    }
    type('Emails per lead', '10');
    expect(problem('Enter a whole number from 0 to 10.')).toBeNull();
  });

  it('wants sending to start before it ends', async () => {
    serve();
    await open();
    await choose('From', '19:00');
    refusedSave();
    expect(problem('The start hour must be earlier than the end hour.')).toBeTruthy();
    await choose('To', '24:00');
    expect(problem('The start hour must be earlier than the end hour.')).toBeNull();
    expect((await save()).sendWindow).toMatchObject({ startHour: 19, endHour: 24 });
  });

  it('wants a project name of up to 120 characters', async () => {
    serve();
    await open();
    type('Project name', '   ');
    refusedSave();
    expect(problem('Enter a name for the project.')).toBeTruthy();
    type('Project name', 'x'.repeat(121));
    expect(problem('Keep the project name to 120 characters or fewer.')).toBeTruthy();
    expect(field('Project name').getAttribute('aria-invalid')).toBe('true');
    type('Project name', 'x'.repeat(120));
    expect(problem('Keep the project name to 120 characters or fewer.')).toBeNull();
  });

  it('wants every column to have a name', async () => {
    serve();
    await open();
    type('Column 2', '  ');
    refusedSave();
    expect(problem('Give every column a name.')).toBeTruthy();
    expect(field('Column 2').getAttribute('aria-invalid')).toBe('true');
    expect(field('Column 1').getAttribute('aria-invalid')).not.toBe('true');
    type('Column 2', 'x'.repeat(61));
    expect(problem('Keep each column name to 60 characters or fewer.')).toBeTruthy();
  });

  it('wants every task to have a title of up to 160 characters, due in 0 to 365 days', async () => {
    serve();
    await open();
    type('Task 1', '');
    refusedSave();
    expect(problem('Give every task a title.')).toBeTruthy();
    expect(field('Task 1').getAttribute('aria-invalid')).toBe('true');
    type('Task 1', 'x'.repeat(161));
    expect(problem('Keep each task title to 160 characters or fewer.')).toBeTruthy();
    type('Task 1', 'Call');
    type('Days until task 2 is due', '366');
    expect(problem('Each task is due in a whole number of days, from 0 to 365.')).toBeTruthy();
    expect(field('Days until task 2 is due').getAttribute('aria-invalid')).toBe('true');
    expect(field('Days until task 1 is due').getAttribute('aria-invalid')).not.toBe('true');
    type('Days until task 2 is due', '365');
    expect(problem('Each task is due in a whole number of days, from 0 to 365.')).toBeNull();
    expect((await save()).project.tasks[1]).toEqual({ title: 'Confirm scope and what was promised in the deal', days: 365 });
  });
});

describe('Workspace rules: fully automatic', () => {
  const question = 'Let the agents work fully on their own in Studio?';

  it('asks in plain words first, and changes nothing when the answer is no', async () => {
    serve();
    await open();
    fireEvent.click(radio('Fully automatic'));
    const ask = within(await screen.findByRole('alertdialog'));
    expect(ask.getByText(question)).toBeTruthy();
    expect(ask.getByText(
      'Agents will then email leads, mark deals won or lost and create projects without anyone looking first. '
      + 'You get a summary of each run afterwards. An agent set to ask first still asks. Nothing changes until you save the rules.',
    )).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Keep it as it is' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(radio('Fully automatic').checked).toBe(false);
    expect(radio('Ask before anything leaves or closes').checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it('saves it after a yes, and does not ask a second time', async () => {
    serve();
    await open();
    fireEvent.click(radio('Fully automatic'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, fully automatic' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(radio('Fully automatic').checked).toBe(true);

    fireEvent.click(radio('Suggest only'));
    fireEvent.click(radio('Fully automatic'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(radio('Fully automatic').checked).toBe(true);
    expect(await save()).toEqual({ ...savedBody(), autonomy: 'full' });
  });

  it('does not ask a workspace that is already fully automatic', async () => {
    serve({ rules: rules({ autonomy: 'full' }) });
    await open();
    expect(radio('Fully automatic').checked).toBe(true);
    fireEvent.click(radio('Suggest only'));
    fireEvent.click(radio('Fully automatic'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(radio('Fully automatic').checked).toBe(true);
  });
});

describe('Workspace rules: each workspace runs on its own', () => {
  it('lists the workspaces with what each does', async () => {
    serve();
    await open();
    expect(workspacesCard().getByText("Own agents, own pipeline, own mailbox, own limit. One never touches another's leads or projects.")).toBeTruthy();
    expect(workspacesCard().getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Workspace', 'Automation', 'How much it does alone', 'Projects it created', 'Open',
    ]);
    const cells = (name: string) => rowOf(name).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells('Studio')).toEqual(['Studio', 'On', 'Asks before anything leaves or closes', '4 this month', 'Editing now']);
    expect(cells('Retainers')).toEqual(['Retainers', 'Off', 'Fully automatic', '1 this month', 'Open rules']);
    expect(cells('Internal')).toEqual(['Internal', 'Off', 'Not set up', 'None', 'Set up']);
    expect(rowOf('Studio').queryByRole('button')).toBeNull();
  });

  it('opens another workspace\'s rules by switching the sidebar to it, staying on this page', async () => {
    serve();
    await open();
    fireEvent.click(rowOf('Retainers').getByRole('button', { name: 'Open rules for Retainers' }));
    expect(scope.select).toHaveBeenCalledWith('w2');
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace rules' })).toBeTruthy();
    expect(screen.queryByText('Overview page')).toBeNull();
  });

  it('loads the other workspace once the sidebar has switched, keeping the list in place', async () => {
    serve();
    const view = await open();
    auto.state.workspaceId = 'w2';
    auto.state.workspaceName = 'Retainers';
    server.rules = rules({ workspaceId: 'w2', autonomy: 'full', emailsPerLead: 7, revision: 2 });
    view.rerender(app());
    // The list stays while the rules are fetched, and now marks the other workspace.
    expect(rowOf('Retainers').getByText('Editing now')).toBeTruthy();
    expect(rowOf('Studio').getByRole('button', { name: 'Open rules for Studio' })).toBeTruthy();
    await waitFor(() => expect(field('Emails per lead').value).toBe('7'));
    expect(screen.getByRole('region', { name: 'The project a won deal becomes in Retainers' })).toBeTruthy();
    expect(asked('rules')).toBe(2);
  });

  it('takes a workspace that is not set up to the overview, where it is set up', async () => {
    serve();
    await open();
    fireEvent.click(rowOf('Internal').getByRole('button', { name: 'Set up automation in Internal' }));
    expect(scope.select).toHaveBeenCalledWith('w3');
    expect(await screen.findByText('Overview page')).toBeTruthy();
  });

  it('shows the server sentence with Try again when the list cannot be loaded, and still shows the rules', async () => {
    serve({ fail: { workspaces: new AutomationError('The workspaces could not be listed.', 500) } });
    await open();
    expect(workspacesCard().getByRole('alert').textContent).toBe('The workspaces could not be listed.');
    fireEvent.click(workspacesCard().getByRole('button', { name: 'Try again' }));
    expect(await workspacesCard().findByText('Retainers')).toBeTruthy();
    expect(asked('workspaces')).toBe(2);
    expect(asked('rules')).toBe(1);
  });

  it('is left out when there is nothing to list', async () => {
    serve({ rows: [] });
    await open();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Each workspace runs on its own' })).toBeNull());
  });
});

describe('Workspace rules: a member', () => {
  it('sees everything and can change nothing', async () => {
    serve({ overview: overview({ role: 'Member' }), rows: [] });
    await open();
    expect(screen.getByText('Only a workspace owner or admin can change these rules.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();

    for (const name of [
      'Run automation in Studio', 'Weekdays only', 'Let agents look companies up on the web',
      'Add everyone in Studio to the project', 'Let the agent add tasks it finds in the deal notes',
    ]) expect(toggle(name).disabled).toBe(true);
    for (const name of ['Suggest only', 'Ask before anything leaves or closes', 'Fully automatic']) expect(radio(name).disabled).toBe(true);
    for (const label of ['AI spend per month', 'Emails per lead', 'Project name', 'Column 1', 'Task 1', 'Days until task 1 is due']) {
      expect(field(label).disabled).toBe(true);
    }
    for (const name of ['From', 'To', 'Time zone', 'Project lead']) expect((combo(name) as HTMLButtonElement).disabled).toBe(true);
    for (const name of [
      'Insert {company}', 'Insert {deal}', 'Insert {lead}', 'Add a column', 'Use the standard columns', 'Remove column 1',
      'Move column 1 down', 'Add a task', 'Remove task 1', 'Move task 1 down',
    ]) expect(button(name).disabled).toBe(true);

    // The values are still there to read.
    expect(field('AI spend per month').value).toBe('50');
    expect(radio('Ask before anything leaves or closes').checked).toBe(true);
    expect(sends()).toEqual([]);
  });

  it('is not told about people it cannot choose from anyway', async () => {
    const saved = rules();
    serve({
      overview: overview({ role: 'Member' }),
      rows: [],
      rules: { ...saved, project: { ...saved.project, lead: 'u2' } },
      fail: { people: new AutomationError('Only a workspace owner or admin can change the automation.', 403) },
    });
    await open();
    expect(combo('Project lead').textContent).toContain('One person');
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is not shown a failure for the list of workspaces it may not see', async () => {
    serve({
      overview: overview({ role: 'Member' }),
      fail: { workspaces: new AutomationError('Only a workspace owner or admin can change the automation.', 403) },
    });
    await open();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Each workspace runs on its own' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Workspace rules: not set up', () => {
  it('still lists the workspaces, and points to where automation is set up', async () => {
    serve({ overview: overview({ setUp: false, enabled: false }) });
    show();
    expect(await screen.findByText('Automation is not set up in Studio yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set it up on the overview' }).getAttribute('href')).toBe('/crm/automation');
    expect(await workspacesCard().findByText('Retainers')).toBeTruthy();
    expect(screen.queryByLabelText('AI spend per month')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();
    expect(asked('rules')).toBe(0);
    expect(asked('people')).toBe(0);
  });

  it('offers Set up, not Editing now, for the workspace in use', async () => {
    const rows = workspaceRows().map((row) => (row.workspaceId === 'w1' ? { ...row, setUp: false, enabled: false, autonomy: null } : row));
    serve({ overview: overview({ setUp: false, enabled: false }), rows });
    show();
    fireEvent.click(await workspacesCard().findByRole('button', { name: 'Set up automation in Studio' }));
    expect(await screen.findByText('Overview page')).toBeTruthy();
    expect(scope.select).not.toHaveBeenCalled();
  });
});

describe('Workspace rules: when the server says no', () => {
  it('loads the rules again after a 409 and says they were changed elsewhere', async () => {
    serve({ fail: { 'POST rules': new AutomationError('These rules were changed by someone else.', 409) } });
    await open();
    type('Emails per lead', '5');
    // Someone else saved meanwhile.
    server.rules = rules({ emailsPerLead: 8, revision: 5 });
    fireEvent.click(saveButton());
    const sentence = 'These rules were changed somewhere else while you were editing. The latest rules are shown now: make your changes again, then save.';
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(toast.error).toHaveBeenCalledWith(sentence);
    expect(asked('rules')).toBe(2);
    expect(field('Emails per lead').value).toBe('8');
    expect(saveButton().disabled).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();

    type('Emails per lead', '5');
    expect(await save()).toEqual({ ...savedBody(), emailsPerLead: 5, revision: 5 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server sentence when a save is refused, and keeps what was typed', async () => {
    serve({ fail: { 'POST rules': new AutomationError('Only a workspace owner or admin can change the automation.', 403) } });
    await open();
    type('Emails per lead', '5');
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Only a workspace owner or admin can change the automation.');
    expect(toast.error).toHaveBeenCalledWith('Only a workspace owner or admin can change the automation.');
    expect(field('Emails per lead').value).toBe('5');
    expect(saveButton().disabled).toBe(false);
    expect(asked('rules')).toBe(1);
  });
});

describe('Workspace rules: the states of the screen', () => {
  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    auto.state.workspaceId = null;
    auto.state.workspaceName = '';
    serve();
    show();
    expect(screen.getByText('Pick a workspace in the sidebar to see its automation rules.')).toBeTruthy();
    await Promise.resolve();
    expect(auto.call).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();
    expect(screen.queryByLabelText('AI spend per month')).toBeNull();
  });

  it('holds the place of the rules while they load', async () => {
    auto.call.mockImplementation(() => new Promise(() => {}));
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace rules' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading the workspace rules' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading the workspaces' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server sentence with Try again when the overview cannot be loaded', async () => {
    serve({ fail: { overview: new AutomationError('You do not have access to this workspace.', 403) } });
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
    expect(screen.queryByLabelText('AI spend per month')).toBeNull();
    press('Try again');
    expect(await screen.findByLabelText('AI spend per month')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server sentence with Try again when the rules cannot be loaded', async () => {
    serve({ fail: { rules: new AutomationError('The rules could not be read.', 500) } });
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('The rules could not be read.');
    press('Try again');
    expect(await screen.findByLabelText('AI spend per month')).toBeTruthy();
  });

  it('says a plain sentence when the server could not be reached at all', async () => {
    serve({ fail: { overview: new TypeError('Failed to fetch') } });
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('The request could not be completed. Please try again.');
  });

  it('shows quietly what is missing when the server is not ready (503)', async () => {
    const missing = 'Automation is not ready yet: run supabase/migrations/187_automation.sql in the Supabase SQL editor.';
    serve({
      fail: { overview: new AutomationError(missing, 503), workspaces: new AutomationError(missing, 503) },
    });
    show();
    expect(await screen.findByText(missing)).toBeTruthy();
    expect(screen.getAllByText(missing)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Each workspace runs on its own' })).toBeNull();
    expect(screen.queryByLabelText('AI spend per month')).toBeNull();
  });

  it('still shows the rules when the people cannot be loaded, and says so by the project lead', async () => {
    serve({ fail: { people: new AutomationError('The people could not be listed.', 500) } });
    await open();
    expect(combo('Project lead').textContent).toContain('Whoever owns the deal');
    expect(screen.getByText('The people in Studio could not be loaded, so only the deal owner can be chosen for now.')).toBeTruthy();
  });
});

describe('Leaving the workspace rules', () => {
  // The app's router builds a Request for every move. Node's Request refuses jsdom's AbortSignal, so stand in a plain one.
  class PlainRequest {
    readonly method = 'GET';
    readonly headers = new Headers();
    readonly signal: AbortSignal | null | undefined;
    constructor(readonly url: string, init?: RequestInit) { this.signal = init?.signal; }
  }
  beforeEach(() => { vi.stubGlobal('Request', PlainRequest); });

  const openInApp = async () => {
    const router = createMemoryRouter(
      [
        { path: '/crm/automation/rules', element: <AutomationRulesPage /> },
        { path: '/crm/automation/runs', element: <p>Runs page</p> },
        { path: '/crm/automation', element: <p>Overview page</p> },
      ],
      { initialEntries: ['/crm/automation/rules'] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByLabelText('AI spend per month');
  };
  const leavingIsStopped = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('asks before unsaved changes are lost, and stays or leaves as chosen', async () => {
    serve();
    await openInApp();
    expect(leavingIsStopped()).toBe(false);
    type('Emails per lead', '5');
    expect(leavingIsStopped()).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
    const ask = within(await screen.findByRole('alertdialog'));
    expect(ask.getByText('Leave without saving?')).toBeTruthy();
    expect(ask.getByText('Your changes to the workspace rules have not been saved. If you leave now they are lost.')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(field('Emails per lead').value).toBe('5');

    fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('Runs page')).toBeTruthy();
  });

  it('does not ask once the rules have been saved', async () => {
    serve();
    await openInApp();
    type('Emails per lead', '5');
    await save();
    await waitFor(() => expect(leavingIsStopped()).toBe(false));
    fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
    expect(await screen.findByText('Runs page')).toBeTruthy();
  });

  it('asks before switching to another workspace with unsaved changes', async () => {
    serve();
    await openInApp();
    type('Emails per lead', '5');
    fireEvent.click(rowOf('Retainers').getByRole('button', { name: 'Open rules for Retainers' }));
    const ask = within(await screen.findByRole('alertdialog'));
    expect(ask.getByText('Your changes to the workspace rules have not been saved. If you leave now they are lost.')).toBeTruthy();
    expect(scope.select).not.toHaveBeenCalled();
    fireEvent.click(ask.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(scope.select).not.toHaveBeenCalled();
    expect(field('Emails per lead').value).toBe('5');

    fireEvent.click(rowOf('Retainers').getByRole('button', { name: 'Open rules for Retainers' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(scope.select).toHaveBeenCalledWith('w2'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('asks once, not twice, before leaving to set up another workspace', async () => {
    serve();
    await openInApp();
    type('Emails per lead', '5');
    fireEvent.click(rowOf('Internal').getByRole('button', { name: 'Set up automation in Internal' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('Overview page')).toBeTruthy();
    expect(scope.select).toHaveBeenCalledWith('w3');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
