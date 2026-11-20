import { randomUUID } from "node:crypto";
import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { isTimeZone } from "./defaults.js";
import { LIMITS, RIGHTS } from "./shared/types.js";
import type { AgentInput, Autonomy, AutomationDraft, AutomationInput, AutomationStep, DraftStep, ProjectTemplate, Right, StepStart, Trigger, WorkspaceRules } from "./shared/types.js";

/**
 * Reads what a screen sent into the shared shapes, refusing anything that does
 * not fit with a sentence a person can act on. Nothing from a request body is
 * used before it has been through here.
 */

type Body = Record<string, unknown>;

const isObject = (v: unknown): v is Body => !!v && typeof v === "object" && !Array.isArray(v);
const RIGHT_KEYS = RIGHTS.map((r) => r.key);

/** Trimmed text with the control characters taken out (a new line and a tab stay). */
export function clean(value: unknown, max: number): string {
  const kept = Array.from(typeof value === "string" ? value : "")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || (c >= 32 && c !== 127);
    })
    .join("");
  return kept.trim().slice(0, max);
}

/** One line of text: as clean(), with every run of white space made one space. */
export const oneLine = (value: unknown, max: number): string => clean(value, max * 2).replace(/\s+/g, " ").slice(0, max).trim();

function whole(value: unknown, min: number, max: number, sentence: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new AppError(sentence);
  return value;
}

export function revisionOf(b: Body): number {
  return whole(b.revision, 1, 1_000_000_000, "Reload the page and try again.");
}

export function rightsOf(value: unknown): Right[] {
  if (!Array.isArray(value)) throw new AppError("Choose what the agent is allowed to do.");
  const out: Right[] = [];
  for (const v of value) {
    const key = RIGHT_KEYS.find((k) => k === v);
    if (!key) throw new AppError("That is not something an agent can be allowed to do.");
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function agentInput(b: Body): AgentInput {
  const name = oneLine(b.name, LIMITS.agentName + 1);
  if (!name || name.length > LIMITS.agentName) throw new AppError(`Give the agent a name of up to ${LIMITS.agentName} characters.`);
  const job = clean(b.job, LIMITS.agentJob + 1);
  if (job.length < 10 || job.length > LIMITS.agentJob) throw new AppError(`Describe the agent's one job in 10 to ${LIMITS.agentJob} characters.`);
  return { name, job, rights: rightsOf(b.rights), askFirst: b.askFirst === true };
}

export function startsOf(value: unknown): StepStart {
  const v = isObject(value) ? value : {};
  if (v.type === "after_previous" || v.type === "on_reply" || v.type === "on_deal_won") return { type: v.type };
  if (v.type === "no_reply_days") return { type: "no_reply_days", days: whole(v.days, 1, LIMITS.waitDays, `A step can wait 1 to ${LIMITS.waitDays} days for a reply.`) };
  throw new AppError("Choose when each step starts.");
}

export function triggerOf(value: unknown): Trigger {
  const v = isObject(value) ? value : {};
  if (v.type !== undefined && v.type !== "lead_created") throw new AppError("An automation starts when a lead is added.");
  return { type: "lead_created", skipImports: v.skipImports === true };
}

function nameOf(b: Body): string {
  const name = oneLine(b.name, LIMITS.automationName + 1);
  if (!name || name.length > LIMITS.automationName) throw new AppError(`Give the automation a name of up to ${LIMITS.automationName} characters.`);
  return name;
}

function stepList(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new AppError("An automation needs its steps.");
  if (value.length > LIMITS.steps) throw new AppError(`A chain can have up to ${LIMITS.steps} steps.`);
  return value;
}

/** A saved chain: every step names an agent by id. Step ids are kept when they are uuids, made otherwise. */
export function automationInput(b: Body): AutomationInput {
  const seen = new Set<string>();
  const steps: AutomationStep[] = stepList(b.steps).map((raw) => {
    const s = isObject(raw) ? raw : {};
    if (!isUuid(s.agentId)) throw new AppError("Every step needs an agent.");
    const id = isUuid(s.id) && !seen.has(s.id) ? s.id : randomUUID();
    seen.add(id);
    return { id, agentId: s.agentId, starts: startsOf(s.starts) };
  });
  return { name: nameOf(b), trigger: triggerOf(b.trigger), steps };
}

/** True when the body is a draft (its steps carry an `agent`), not a saved chain. */
export const isDraftBody = (b: Body): boolean => Array.isArray(b.steps) && b.steps.some((s) => isObject(s) && isObject(s.agent));

export function draftStep(raw: unknown): DraftStep {
  const s = isObject(raw) ? raw : {};
  const a = isObject(s.agent) ? s.agent : {};
  const input = agentInput(a);
  return {
    agent: { id: isUuid(a.id) ? a.id : null, ...input },
    starts: startsOf(s.starts),
    does: oneLine(s.does, 300),
    gives: oneLine(s.gives, 120),
  };
}

export function automationDraft(value: unknown): AutomationDraft {
  const b = isObject(value) ? value : {};
  return { name: nameOf(b), trigger: triggerOf(b.trigger), steps: stepList(b.steps).map(draftStep) };
}

function projectOf(value: unknown): ProjectTemplate {
  const v = isObject(value) ? value : {};
  const nameTemplate = oneLine(v.nameTemplate, LIMITS.projectName + 1);
  if (!nameTemplate || nameTemplate.length > LIMITS.projectName) throw new AppError(`Give the project a name of up to ${LIMITS.projectName} characters.`);
  const lead = v.lead === "deal_owner" ? "deal_owner" : isUuid(v.lead) ? v.lead : null;
  if (!lead) throw new AppError("Choose who leads the project.");
  if (!Array.isArray(v.columns) || v.columns.length < 1 || v.columns.length > LIMITS.columns) throw new AppError(`A project board has 1 to ${LIMITS.columns} columns.`);
  const columns = v.columns.map((c) => oneLine(c, LIMITS.columnTitle + 1));
  if (columns.some((c) => !c || c.length > LIMITS.columnTitle)) throw new AppError(`Give every board column a name of up to ${LIMITS.columnTitle} characters.`);
  if (!Array.isArray(v.tasks) || v.tasks.length > LIMITS.tasks) throw new AppError(`A project can start with up to ${LIMITS.tasks} kick-off tasks.`);
  const tasks = v.tasks.map((raw) => {
    const t = isObject(raw) ? raw : {};
    const title = oneLine(t.title, LIMITS.taskTitle + 1);
    if (!title || title.length > LIMITS.taskTitle) throw new AppError(`Give every kick-off task a title of up to ${LIMITS.taskTitle} characters.`);
    return { title, days: whole(t.days, 0, LIMITS.taskDays, `A kick-off task is due 0 to ${LIMITS.taskDays} days after the project starts.`) };
  });
  return { nameTemplate, lead, addEveryone: v.addEveryone === true, columns, tasks, agentMayAddTasks: v.agentMayAddTasks === true };
}

const AUTONOMY: Autonomy[] = ["suggest", "ask_external", "full"];

export function rulesInput(b: Body): { revision: number; rules: Omit<WorkspaceRules, "workspaceId" | "revision" | "updated"> } {
  const autonomy = AUTONOMY.find((a) => a === b.autonomy);
  if (!autonomy) throw new AppError("Choose how much the agents may do alone.");
  const w = isObject(b.sendWindow) ? b.sendWindow : {};
  const startHour = whole(w.startHour, 0, 24, "Choose the hours emails may be sent in, from 0 to 24.");
  const endHour = whole(w.endHour, 0, 24, "Choose the hours emails may be sent in, from 0 to 24.");
  if (endHour <= startHour) throw new AppError("The sending hours must end after they start.");
  if (!isTimeZone(w.timeZone)) throw new AppError("Choose a time zone for the sending hours.");
  return {
    revision: revisionOf(b),
    rules: {
      enabled: b.enabled === true,
      autonomy,
      monthlyBudgetCents: whole(b.monthlyBudgetCents, 0, LIMITS.monthlyBudgetCents, "Enter the AI spend allowed per month."),
      emailsPerLead: whole(b.emailsPerLead, 0, LIMITS.emailsPerLead, `Agents may send 0 to ${LIMITS.emailsPerLead} emails to one lead.`),
      sendWindow: { weekdaysOnly: w.weekdaysOnly === true, startHour, endHour, timeZone: w.timeZone },
      webResearch: b.webResearch === true,
      project: projectOf(b.project),
    },
  };
}
