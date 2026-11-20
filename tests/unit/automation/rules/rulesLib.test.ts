// Workspace rules: the sums, the wording and the checks behind the screen.
import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_CHOICES, aloneWords, centsOf, dollarsOf, formChanged, hasProblems, hourLabel, insertAt, moved, nameExample,
  projectsWords, rulesBody, rulesFormOf, rulesProblems, standardColumns, timeZoneChoices, timeZoneLabel, wholeNumberOf,
  type RulesForm,
} from '@/lib/automation/rules';
import { rules, savedBody } from './fixtures';

const form = (over: Partial<RulesForm> = {}): RulesForm => ({ ...rulesFormOf(rules()), ...over });
const columns = (...titles: string[]) => titles.map((title, i) => ({ key: `c${i}`, title }));
const tasks = (...list: Array<[string, string]>) => list.map(([title, days], i) => ({ key: `t${i}`, title, days }));

describe('dollars and cents', () => {
  it('shows cents as dollars, with cents only when there are some', () => {
    expect(dollarsOf(5000)).toBe('50');
    expect(dollarsOf(0)).toBe('0');
    expect(dollarsOf(4950)).toBe('49.50');
    expect(dollarsOf(10_000_000)).toBe('100000');
    expect(dollarsOf(1)).toBe('0.01');
  });

  it('reads typed dollars as cents', () => {
    expect(centsOf('50')).toBe(5000);
    expect(centsOf(' 49.5 ')).toBe(4950);
    expect(centsOf('$1,250.75')).toBe(125075);
    expect(centsOf('0')).toBe(0);
    expect(centsOf('19.99')).toBe(1999);
    expect(centsOf('0.29')).toBe(29);
  });

  it('refuses what is not an amount of money', () => {
    for (const text of ['', '  ', 'abc', '12.345', '-5', '1e3', '5 dollars', '.', '$']) expect(centsOf(text)).toBeNull();
  });

  it('reads a whole number, and nothing else', () => {
    expect(wholeNumberOf('3')).toBe(3);
    expect(wholeNumberOf(' 10 ')).toBe(10);
    expect(wholeNumberOf('0')).toBe(0);
    for (const text of ['', '2.5', '-1', 'three', '1e2']) expect(wholeNumberOf(text)).toBeNull();
  });
});

describe('the form and the request', () => {
  it('starts from the saved rules', () => {
    const start = rulesFormOf(rules());
    expect(start).toMatchObject({
      enabled: true, autonomy: 'ask_external', budget: '50', emailsPerLead: '3', weekdaysOnly: true, startHour: 9, endHour: 18,
      timeZone: 'Europe/London', webResearch: false, nameTemplate: '{company} – {deal}', lead: 'deal_owner', addEveryone: true,
      agentMayAddTasks: true,
    });
    expect(start.columns.map((c) => c.title)).toEqual(['Undefined task', 'To-do', 'Done']);
    expect(start.tasks.map((t) => [t.title, t.days])).toEqual([
      ['Kick-off call with the customer', '2'], ['Confirm scope and what was promised in the deal', '3'],
    ]);
    // Every row has a name of its own, so the screen can tell them apart while they move.
    const keys = [...start.columns, ...start.tasks].map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sends back exactly what the server stores, with the revision it was read at', () => {
    expect(rulesBody(rulesFormOf(rules()), 4)).toEqual(savedBody());
  });

  it('sends the typed values as numbers and trims the words', () => {
    const body = rulesBody(form({
      budget: '$120.50', emailsPerLead: ' 5 ', startHour: 8, endHour: 20, nameTemplate: '  {lead} project ',
      columns: columns(' Backlog ', 'Done'), tasks: tasks([' Call them ', '0'], ['Plan', ' 14 ']),
    }), 9);
    expect(body).toMatchObject({
      monthlyBudgetCents: 12050, emailsPerLead: 5, revision: 9,
      sendWindow: { weekdaysOnly: true, startHour: 8, endHour: 20, timeZone: 'Europe/London' },
      project: {
        nameTemplate: '{lead} project', columns: ['Backlog', 'Done'],
        tasks: [{ title: 'Call them', days: 0 }, { title: 'Plan', days: 14 }],
      },
    });
  });

  it('knows when something changed, whatever the rows are called', () => {
    const saved = rulesFormOf(rules());
    expect(formChanged(saved, rulesFormOf(rules()))).toBe(false);
    expect(formChanged(saved, { ...saved, budget: '51' })).toBe(true);
    expect(formChanged(saved, { ...saved, columns: moved(saved.columns, 0, 1) })).toBe(true);
    expect(formChanged(saved, { ...saved, columns: moved(moved(saved.columns, 0, 1), 1, -1) })).toBe(false);
    expect(formChanged(saved, { ...saved, tasks: saved.tasks.slice(1) })).toBe(true);
  });

  it('moves a row one place and leaves the ends where they are', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('offers the columns every board starts with, in their order', () => {
    expect(standardColumns()).toEqual(['Undefined task', 'To-do', 'On-Progress', 'Done', 'Need review']);
  });
});

describe('checking the rules before they are sent', () => {
  it('finds nothing wrong with the saved rules', () => {
    const problems = rulesProblems(form());
    expect(problems).toEqual({ badColumns: [], badTasks: [] });
    expect(hasProblems(problems)).toBe(false);
  });

  it('wants a budget from 0 to 100,000 dollars', () => {
    const sentence = 'Enter an amount from $0 to $100,000.';
    expect(rulesProblems(form({ budget: '0' })).budget).toBeUndefined();
    expect(rulesProblems(form({ budget: '100000' })).budget).toBeUndefined();
    expect(rulesProblems(form({ budget: '100,000.00' })).budget).toBeUndefined();
    expect(rulesProblems(form({ budget: '100000.01' })).budget).toBe(sentence);
    expect(rulesProblems(form({ budget: '' })).budget).toBe(sentence);
    expect(rulesProblems(form({ budget: 'lots' })).budget).toBe(sentence);
    expect(hasProblems(rulesProblems(form({ budget: 'lots' })))).toBe(true);
  });

  it('wants 0 to 10 emails per lead', () => {
    const sentence = 'Enter a whole number from 0 to 10.';
    expect(rulesProblems(form({ emailsPerLead: '0' })).emailsPerLead).toBeUndefined();
    expect(rulesProblems(form({ emailsPerLead: '10' })).emailsPerLead).toBeUndefined();
    expect(rulesProblems(form({ emailsPerLead: '11' })).emailsPerLead).toBe(sentence);
    expect(rulesProblems(form({ emailsPerLead: '2.5' })).emailsPerLead).toBe(sentence);
    expect(rulesProblems(form({ emailsPerLead: '' })).emailsPerLead).toBe(sentence);
  });

  it('wants sending to start before it ends, inside the day', () => {
    expect(rulesProblems(form({ startHour: 0, endHour: 24 })).hours).toBeUndefined();
    expect(rulesProblems(form({ startHour: 18, endHour: 9 })).hours).toBe('The start hour must be earlier than the end hour.');
    expect(rulesProblems(form({ startHour: 9, endHour: 9 })).hours).toBe('The start hour must be earlier than the end hour.');
    expect(rulesProblems(form({ startHour: -1, endHour: 9 })).hours).toBe('Choose hours between 00:00 and 24:00.');
    expect(rulesProblems(form({ startHour: 9, endHour: 25 })).hours).toBe('Choose hours between 00:00 and 24:00.');
    expect(rulesProblems(form({ startHour: 9.5, endHour: 18 })).hours).toBe('Choose hours between 00:00 and 24:00.');
  });

  it('wants a project name of 1 to 120 characters', () => {
    expect(rulesProblems(form({ nameTemplate: 'x'.repeat(120) })).nameTemplate).toBeUndefined();
    expect(rulesProblems(form({ nameTemplate: '   ' })).nameTemplate).toBe('Enter a name for the project.');
    expect(rulesProblems(form({ nameTemplate: 'x'.repeat(121) })).nameTemplate).toBe('Keep the project name to 120 characters or fewer.');
  });

  it('wants 1 to 12 columns, each with a name', () => {
    expect(rulesProblems(form({ columns: [] })).columns).toBe('A board needs at least one column.');
    const twelve = Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`);
    expect(rulesProblems(form({ columns: columns(...twelve) })).columns).toBeUndefined();
    expect(rulesProblems(form({ columns: columns(...twelve, 'One more') })).columns).toBe('A board can have up to 12 columns.');
    const unnamed = rulesProblems(form({ columns: columns('To-do', '  ', 'Done', '') }));
    expect(unnamed.columns).toBe('Give every column a name.');
    expect(unnamed.badColumns).toEqual([1, 3]);
    const long = rulesProblems(form({ columns: columns('To-do', 'x'.repeat(61)) }));
    expect(long.columns).toBe('Keep each column name to 60 characters or fewer.');
    expect(long.badColumns).toEqual([1]);
  });

  it('wants at most 20 tasks, each with a title of 1 to 160 characters and due in 0 to 365 days', () => {
    expect(rulesProblems(form({ tasks: [] })).tasks).toBeUndefined();
    const twenty = Array.from({ length: 20 }, (_, i): [string, string] => [`Task ${i + 1}`, '1']);
    expect(rulesProblems(form({ tasks: tasks(...twenty) })).tasks).toBeUndefined();
    expect(rulesProblems(form({ tasks: tasks(...twenty, ['One more', '1']) })).tasks).toBe('You can have up to 20 kick-off tasks.');

    const untitled = rulesProblems(form({ tasks: tasks(['Call', '2'], [' ', '2']) }));
    expect(untitled.tasks).toBe('Give every task a title.');
    expect(untitled.badTasks).toEqual([1]);

    expect(rulesProblems(form({ tasks: tasks(['x'.repeat(160), '2']) })).tasks).toBeUndefined();
    const long = rulesProblems(form({ tasks: tasks(['x'.repeat(161), '2'], ['Call', '2']) }));
    expect(long.tasks).toBe('Keep each task title to 160 characters or fewer.');
    expect(long.badTasks).toEqual([0]);

    const days = 'Each task is due in a whole number of days, from 0 to 365.';
    expect(rulesProblems(form({ tasks: tasks(['Call', '0'], ['Plan', '365']) })).tasks).toBeUndefined();
    expect(rulesProblems(form({ tasks: tasks(['Call', '366']) })).tasks).toBe(days);
    expect(rulesProblems(form({ tasks: tasks(['Call', '']) })).tasks).toBe(days);
    expect(rulesProblems(form({ tasks: tasks(['Call', '1'], ['Plan', '1.5']) })).badTasks).toEqual([1]);
  });
});

describe('the words on the screen', () => {
  it('says how much a workspace does alone', () => {
    expect(aloneWords({ setUp: true, autonomy: 'suggest' })).toBe('Suggests only');
    expect(aloneWords({ setUp: true, autonomy: 'ask_external' })).toBe('Asks before anything leaves or closes');
    expect(aloneWords({ setUp: true, autonomy: 'full' })).toBe('Fully automatic');
    expect(aloneWords({ setUp: false, autonomy: null })).toBe('Not set up');
    expect(aloneWords({ setUp: true, autonomy: null })).toBe('Not set up');
  });

  it('says how many projects a workspace created this month', () => {
    expect(projectsWords(0)).toBe('None');
    expect(projectsWords(1)).toBe('1 this month');
    expect(projectsWords(4)).toBe('4 this month');
  });

  it('offers the three choices in the order of how much they allow, with one recommended', () => {
    expect(AUTONOMY_CHOICES.map((c) => [c.value, c.title])).toEqual([
      ['suggest', 'Suggest only'], ['ask_external', 'Ask before anything leaves or closes'], ['full', 'Fully automatic'],
    ]);
    expect(AUTONOMY_CHOICES.filter((c) => c.recommended).map((c) => c.value)).toEqual(['ask_external']);
    for (const choice of AUTONOMY_CHOICES) expect(choice.note.length).toBeGreaterThan(20);
  });

  it('shows an example of the project name', () => {
    expect(nameExample('{company} – {deal}')).toBe('Northwind Studio – Website redesign');
    expect(nameExample('{lead} at {company} ({company})')).toBe('Elena Rossi at Northwind Studio (Northwind Studio)');
    expect(nameExample('Onboarding')).toBe('Onboarding');
    expect(nameExample('  ')).toBe('');
    // Anything else in braces is not a placeholder and stays as typed.
    expect(nameExample('{customer} {deal}')).toBe('{customer} Website redesign');
    expect(nameExample('{deal}', { company: 'Acme', deal: 'Audit', lead: 'Priya' })).toBe('Audit');
  });

  it('puts a placeholder where the cursor is', () => {
    expect(insertAt('New project', '{company}', 0, 0)).toEqual({ text: '{company}New project', caret: 9 });
    expect(insertAt('For : kick-off', '{deal}', 4, 4)).toEqual({ text: 'For {deal}: kick-off', caret: 10 });
    // What is selected is replaced.
    expect(insertAt('Hello NAME!', '{lead}', 6, 10)).toEqual({ text: 'Hello {lead}!', caret: 12 });
    // With no cursor it goes at the end.
    expect(insertAt('Project for ', '{company}', null, null)).toEqual({ text: 'Project for {company}', caret: 21 });
  });

  it('writes hours as a clock time and keeps a saved time zone in the list', () => {
    expect(hourLabel(0)).toBe('00:00');
    expect(hourLabel(9)).toBe('09:00');
    expect(hourLabel(24)).toBe('24:00');
    expect(timeZoneChoices('Europe/London')).toContain('Europe/London');
    expect(timeZoneChoices('Europe/London').filter((zone) => zone === 'Europe/London')).toHaveLength(1);
    expect(timeZoneChoices('America/Halifax')[0]).toBe('America/Halifax');
    expect(timeZoneChoices('')).not.toContain('');
    expect(timeZoneLabel('America/New_York')).toBe('America/New York');
    expect(timeZoneLabel('UTC')).toBe('UTC');
  });
});
