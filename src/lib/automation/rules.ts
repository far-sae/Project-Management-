// Workspace rules: what the screen shows and sends, the checks before a save, and the words it uses.
import type { Autonomy, WorkspaceRules, WorkspaceRulesInput } from '../../../api/_automation/shared/types';
import { TIMEZONES } from '@/lib/timezones';
import { DEFAULT_COLUMNS } from '@/types/task';

/** The most and least the server takes. */
export const LIMITS = {
  budgetDollars: 100_000,
  emailsPerLead: 10,
  nameTemplate: 120,
  columns: 12,
  columnTitle: 60,
  tasks: 20,
  taskTitle: 160,
  taskDays: 365,
} as const;

/** In the project template, "whoever owns the deal" instead of one person. */
export const DEAL_OWNER = 'deal_owner';

/** One board column on the screen. `key` only tells the rows apart while they are moved. */
export interface ColumnRow { key: string; title: string }
/** One kick-off task on the screen. `days` is as typed. */
export interface TaskRow { key: string; title: string; days: string }

/** The rules as the screen holds them: numbers a person types are kept as typed until they are checked. */
export interface RulesForm {
  enabled: boolean;
  autonomy: Autonomy;
  /** AI spend per month in US dollars, as typed. */
  budget: string;
  emailsPerLead: string;
  weekdaysOnly: boolean;
  startHour: number;
  endHour: number;
  timeZone: string;
  webResearch: boolean;
  nameTemplate: string;
  /** DEAL_OWNER, or one person's user id. */
  lead: string;
  addEveryone: boolean;
  columns: ColumnRow[];
  tasks: TaskRow[];
  agentMayAddTasks: boolean;
}

let rowCount = 0;
/** A name for a new row that no other row has. */
export const rowKey = (): string => `row-${++rowCount}`;

// ── Dollars and cents ───────────────────────────────────────────────────

/** Cents as the dollars a person would type: 5000 → "50", 4950 → "49.50". */
export function dollarsOf(cents: number): string {
  const whole = Math.round(cents);
  return whole % 100 === 0 ? String(whole / 100) : (whole / 100).toFixed(2);
}

/** Typed dollars as cents, or null when it is not an amount of money. "$1,250.75" → 125075. */
export function centsOf(dollars: string): number | null {
  const match = /^\$?(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(dollars.trim());
  if (!match) return null;
  const whole = Number(match[1].replace(/,/g, ''));
  const part = Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(whole) ? whole * 100 + part : null;
}

/** A typed whole number (0, 1, 2…), or null. */
export function wholeNumberOf(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

// ── The form and the request ────────────────────────────────────────────

export function rulesFormOf(rules: WorkspaceRules): RulesForm {
  return {
    enabled: rules.enabled,
    autonomy: rules.autonomy,
    budget: dollarsOf(rules.monthlyBudgetCents),
    emailsPerLead: String(rules.emailsPerLead),
    weekdaysOnly: rules.sendWindow.weekdaysOnly,
    startHour: rules.sendWindow.startHour,
    endHour: rules.sendWindow.endHour,
    timeZone: rules.sendWindow.timeZone,
    webResearch: rules.webResearch,
    nameTemplate: rules.project.nameTemplate,
    lead: rules.project.lead || DEAL_OWNER,
    addEveryone: rules.project.addEveryone,
    columns: rules.project.columns.map((title) => ({ key: rowKey(), title })),
    tasks: rules.project.tasks.map((task) => ({ key: rowKey(), title: task.title, days: String(task.days) })),
    agentMayAddTasks: rules.project.agentMayAddTasks,
  };
}

/** What a save sends: the whole of the rules, and the revision they were read at. Check the form first. */
export function rulesBody(form: RulesForm, revision: number): WorkspaceRulesInput {
  return {
    enabled: form.enabled,
    autonomy: form.autonomy,
    monthlyBudgetCents: centsOf(form.budget) ?? 0,
    emailsPerLead: wholeNumberOf(form.emailsPerLead) ?? 0,
    sendWindow: { weekdaysOnly: form.weekdaysOnly, startHour: form.startHour, endHour: form.endHour, timeZone: form.timeZone },
    webResearch: form.webResearch,
    project: {
      nameTemplate: form.nameTemplate.trim(),
      lead: form.lead,
      addEveryone: form.addEveryone,
      columns: form.columns.map((column) => column.title.trim()),
      tasks: form.tasks.map((task) => ({ title: task.title.trim(), days: wholeNumberOf(task.days) ?? 0 })),
      agentMayAddTasks: form.agentMayAddTasks,
    },
    revision,
  };
}

/** The form without the names of its rows, to compare what a person would see. */
const shown = (form: RulesForm): string => JSON.stringify({
  ...form,
  columns: form.columns.map((column) => column.title),
  tasks: form.tasks.map((task) => [task.title, task.days]),
});

/** True when the two forms would not look the same on the screen. */
export const formChanged = (saved: RulesForm, now: RulesForm): boolean => shown(saved) !== shown(now);

/** The list with the row at `index` moved one place up (-1) or down (1). */
export function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** The columns every new board in the app starts with, in their order. */
export const standardColumns = (): string[] =>
  DEFAULT_COLUMNS.slice().sort((a, b) => a.order - b.order).map((column) => column.title);

// ── Checks before a save ────────────────────────────────────────────────

/** What is wrong, one sentence per field, and which rows of the two lists it is about. */
export interface RulesProblems {
  budget?: string;
  emailsPerLead?: string;
  hours?: string;
  nameTemplate?: string;
  columns?: string;
  tasks?: string;
  badColumns: number[];
  badTasks: number[];
}

const isHour = (hour: number): boolean => Number.isInteger(hour) && hour >= 0 && hour <= 24;
const indexesWhere = <T,>(list: T[], bad: (item: T) => boolean): number[] =>
  list.flatMap((item, index) => (bad(item) ? [index] : []));

export function rulesProblems(form: RulesForm): RulesProblems {
  const problems: RulesProblems = { badColumns: [], badTasks: [] };

  const cents = centsOf(form.budget);
  if (cents === null || cents > LIMITS.budgetDollars * 100) problems.budget = 'Enter an amount from $0 to $100,000.';

  const emails = wholeNumberOf(form.emailsPerLead);
  if (emails === null || emails > LIMITS.emailsPerLead) problems.emailsPerLead = 'Enter a whole number from 0 to 10.';

  if (!isHour(form.startHour) || !isHour(form.endHour)) problems.hours = 'Choose hours between 00:00 and 24:00.';
  else if (form.startHour >= form.endHour) problems.hours = 'The start hour must be earlier than the end hour.';

  const name = form.nameTemplate.trim();
  if (!name) problems.nameTemplate = 'Enter a name for the project.';
  else if (name.length > LIMITS.nameTemplate) problems.nameTemplate = 'Keep the project name to 120 characters or fewer.';

  const unnamed = indexesWhere(form.columns, (column) => !column.title.trim());
  const longNames = indexesWhere(form.columns, (column) => column.title.trim().length > LIMITS.columnTitle);
  if (form.columns.length === 0) problems.columns = 'A board needs at least one column.';
  else if (form.columns.length > LIMITS.columns) problems.columns = 'A board can have up to 12 columns.';
  else if (unnamed.length) { problems.columns = 'Give every column a name.'; problems.badColumns = unnamed; }
  else if (longNames.length) { problems.columns = 'Keep each column name to 60 characters or fewer.'; problems.badColumns = longNames; }

  const untitled = indexesWhere(form.tasks, (task) => !task.title.trim());
  const longTitles = indexesWhere(form.tasks, (task) => task.title.trim().length > LIMITS.taskTitle);
  const badDays = indexesWhere(form.tasks, (task) => {
    const days = wholeNumberOf(task.days);
    return days === null || days > LIMITS.taskDays;
  });
  if (form.tasks.length > LIMITS.tasks) problems.tasks = 'You can have up to 20 kick-off tasks.';
  else if (untitled.length) { problems.tasks = 'Give every task a title.'; problems.badTasks = untitled; }
  else if (longTitles.length) { problems.tasks = 'Keep each task title to 160 characters or fewer.'; problems.badTasks = longTitles; }
  else if (badDays.length) { problems.tasks = 'Each task is due in a whole number of days, from 0 to 365.'; problems.badTasks = badDays; }

  return problems;
}

export const hasProblems = (problems: RulesProblems): boolean =>
  Boolean(problems.budget || problems.emailsPerLead || problems.hours || problems.nameTemplate || problems.columns || problems.tasks);

// ── Words ───────────────────────────────────────────────────────────────

/** The three answers to "how much may the agents do alone?", from least to most. */
export const AUTONOMY_CHOICES: ReadonlyArray<{ value: Autonomy; title: string; note: string; recommended?: boolean }> = [
  { value: 'suggest', title: 'Suggest only', note: 'Agents prepare everything and wait. You approve every step.' },
  {
    value: 'ask_external',
    title: 'Ask before anything leaves or closes',
    note: 'Notes, follow-ups, lead steps and the project are automatic. Sending an email and marking a deal won or lost wait for you.',
    recommended: true,
  },
  { value: 'full', title: 'Fully automatic', note: 'From new lead to project with nobody in between. You get a summary of each run.' },
];

const ALONE: Record<Autonomy, string> = {
  suggest: 'Suggests only',
  ask_external: 'Asks before anything leaves or closes',
  full: 'Fully automatic',
};

/** How much a workspace does alone, for the list of workspaces. */
export const aloneWords = (row: { setUp: boolean; autonomy: Autonomy | null }): string =>
  row.setUp && row.autonomy ? ALONE[row.autonomy] : 'Not set up';

/** How many projects a workspace's agents created this month. */
export const projectsWords = (count: number): string => (count > 0 ? `${count} this month` : 'None');

/** What may stand in a project name, and what each becomes. */
export const PLACEHOLDERS: ReadonlyArray<{ token: string; means: string }> = [
  { token: '{company}', means: "the company's name" },
  { token: '{deal}', means: "the deal's name" },
  { token: '{lead}', means: "the lead's name" },
];

/** A made-up won deal, to show what a project name comes out as. */
export const NAME_SAMPLE = { company: 'Northwind Studio', deal: 'Website redesign', lead: 'Elena Rossi' };

/** The project name the template gives for the sample deal. Anything else in braces stays as typed. */
export function nameExample(template: string, sample: { company: string; deal: string; lead: string } = NAME_SAMPLE): string {
  return template
    .trim()
    .replace(/\{(company|deal|lead)\}/g, (_whole, word: 'company' | 'deal' | 'lead') => sample[word]);
}

/** `text` with `token` put where the cursor is (over what is selected), and where the cursor goes next. */
export function insertAt(text: string, token: string, start: number | null, end: number | null): { text: string; caret: number } {
  const from = Math.min(Math.max(start ?? text.length, 0), text.length);
  const to = Math.min(Math.max(end ?? from, from), text.length);
  return { text: text.slice(0, from) + token + text.slice(to), caret: from + token.length };
}

/** An hour of the day as a clock time: 9 → "09:00". */
export const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** The time zones to choose from, with the saved one first when it is not in the app's list. */
export const timeZoneChoices = (saved: string): string[] =>
  !saved || TIMEZONES.includes(saved) ? TIMEZONES : [saved, ...TIMEZONES];

/** A time zone as words: "America/New_York" → "America/New York". */
export const timeZoneLabel = (zone: string): string => zone.replace(/_/g, ' ');
