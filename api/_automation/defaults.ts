import { randomUUID } from "node:crypto";
import type { AgentKind, AutomationStep, ProjectTemplate, Right, StepStart, Trigger, WorkspaceRules } from "./shared/types.js";
import type { BoardColumn } from "./store.js";

/**
 * What a workspace starts with when "Set up automation" is pressed: the six
 * agents with their jobs and rights, the chain "New lead to project", and the
 * workspace rules. Everything here can be changed afterwards on the screens.
 */

export type DefaultAgent = { kind: Exclude<AgentKind, "custom">; name: string; job: string; rights: Right[]; starts: StepStart };

export const DEFAULT_AUTOMATION_NAME = "New lead to project";
export const DEFAULT_TRIGGER: Trigger = { type: "lead_created", skipImports: false };

/** In chain order. `starts` is when its step begins in the default chain. */
export const DEFAULT_AGENTS: ReadonlyArray<DefaultAgent> = [
  {
    kind: "researcher",
    name: "Researcher",
    job: "Find out who this lead is and what their company does. Read the lead's details and, when web look-ups are allowed, the company's public pages. Write a summary of at most five lines as a note on the lead: what the company does, roughly how big it is, what this person's role is, and anything that says why they got in touch.",
    rights: ["look_up_web", "add_notes_followups"],
    starts: { type: "after_previous" },
  },
  {
    kind: "qualifier",
    name: "Qualifier",
    job: "Decide whether this lead is a good fit for us. A good fit has a work email, a job title of manager or above, and a company of 5 people or more. Give a score from 1 to 5 and one sentence explaining it. Good fit: mark the lead Qualified and hand on the score and the reason. Not a fit: mark the lead Unqualified, add the reason as a note, and stop.",
    rights: ["change_lead_step", "add_notes_followups"],
    starts: { type: "after_previous" },
  },
  {
    kind: "writer",
    name: "Writer",
    job: "Write the first email to the lead: a short, plain introduction that says who we are, mentions one thing we learned about their company, and proposes one clear next step. No more than 120 words.",
    rights: ["send_email"],
    starts: { type: "after_previous" },
  },
  {
    kind: "chaser",
    name: "Chaser",
    job: "The lead has not replied. Create a follow-up for the person who owns the lead, due in two days, and write a short, polite next email that adds one new reason to reply. Do not repeat the first email.",
    rights: ["add_notes_followups", "send_email"],
    starts: { type: "no_reply_days", days: 3 },
  },
  {
    kind: "deal_keeper",
    name: "Deal keeper",
    job: "A reply or a conversation with the lead was logged. Read it. On a positive reply, open a deal for the lead and put it in the stage that matches what was said. If the lead already has a deal, keep its stage right. If the reply is a clear no, mark the lead Unqualified, say why in a note, and stop.",
    rights: ["change_deals_projects", "change_lead_step", "add_notes_followups"],
    starts: { type: "on_reply" },
  },
  {
    kind: "project_starter",
    name: "Project starter",
    job: "The deal is won. Create the project in this workspace from the workspace's project template, with the brief taken from the deal, the kick-off tasks for the project lead and the deal linked. Then tell the lead's owner the project is ready.",
    rights: ["change_deals_projects", "add_notes_followups"],
    starts: { type: "on_deal_won" },
  },
];

/** The default chain over the six agents' ids (in DEFAULT_AGENTS order). */
export function defaultChain(agentIds: string[]): AutomationStep[] {
  return DEFAULT_AGENTS.map((a, i) => ({ id: randomUUID(), agentId: agentIds[i], starts: a.starts }));
}

/** The board every project starts with (the same five columns, ids and colours the app gives a new project). */
export const BOARD_COLUMNS: ReadonlyArray<BoardColumn> = [
  { id: "undefined", title: "Undefined task", color: "#9E9E9E", order: 0 },
  { id: "todo", title: "To-do", color: "#FF9800", order: 1 },
  { id: "inprogress", title: "On-Progress", color: "#2196F3", order: 2 },
  { id: "done", title: "Done", color: "#4CAF50", order: 3 },
  { id: "needreview", title: "Need review", color: "#9C27B0", order: 4 },
];

export const DEFAULT_PROJECT: ProjectTemplate = {
  nameTemplate: "{company} – {deal}",
  lead: "deal_owner",
  addEveryone: true,
  columns: BOARD_COLUMNS.map((c) => c.title),
  tasks: [
    { title: "Kick-off call with the customer", days: 2 },
    { title: "Confirm scope and what was promised in the deal", days: 3 },
    { title: "Collect access, files and information", days: 5 },
    { title: "Agree the timeline and milestones", days: 5 },
    { title: "Plan the work and assign the team", days: 7 },
  ],
  agentMayAddTasks: true,
};

/** The zone the send window is in when the organisation never chose one. */
export const FALLBACK_TIME_ZONE = "Europe/London";

/** True for a zone name this runtime knows (an IANA name such as Europe/London). */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The organisation's own zone when it chose one; "UTC" is what the column
 * holds when nobody did, and 09:00 to 18:00 UTC suits few offices, so that
 * reads as "not chosen".
 */
export const defaultTimeZone = (organisationZone: string): string => (isTimeZone(organisationZone) && organisationZone !== "UTC" ? organisationZone : FALLBACK_TIME_ZONE);

export function defaultRules(workspaceId: string, organisationZone: string): Omit<WorkspaceRules, "revision" | "updated"> {
  return {
    workspaceId,
    enabled: true,
    autonomy: "ask_external",
    monthlyBudgetCents: 2000,
    emailsPerLead: 3,
    sendWindow: { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: defaultTimeZone(organisationZone) },
    webResearch: true,
    project: structuredClone(DEFAULT_PROJECT),
  };
}
