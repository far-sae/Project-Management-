import { ACTION_RIGHT, LIMITS } from "./shared/types.js";
import type { Autonomy, LeadStatus, ProposedAction, Right } from "./shared/types.js";
import { ActionSchema, type RawAction } from "./schemas.js";
import type { AgentAction, Deal, Lead, PlanAction, PlanItem, Stage } from "./store.js";
import { clean, oneLine } from "./validate.js";

/**
 * The server's decision on what an agent proposed. An agent's output is never
 * trusted: each action is cut to size, checked against the agent's rights,
 * the workspace's rules and the lead's own record, and then either dropped
 * (with the reason, which goes into the step's record), carried out now, or
 * made to wait for a person.
 *
 * Nothing here reads an id, a workspace or a recipient from the agent: an
 * action has no such field, and anything extra the agent wrote was already
 * discarded when its reply was read.
 */

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  open: "Open",
  attempted_to_contact: "Attempted to contact",
  in_progress: "In progress",
  connected: "Connected",
  open_deal: "Deal open",
  bad_timing: "Bad timing",
  unqualified: "Unqualified",
};

export const statusLabel = (a: Extract<AgentAction, { type: "set_lead_status" }>): string => (a.qualified ? "Qualified" : STATUS_LABEL[a.status]);

/** How many extra kick-off tasks an agent may add to a project. */
export const EXTRA_TASKS = 5;

/** An action as the AI wrote it, cut to size. null when nothing usable is left. */
export function tidy(raw: RawAction): AgentAction | null {
  switch (raw.type) {
    case "add_note": {
      const text = clean(raw.text, 4000);
      return text ? { type: "add_note", text } : null;
    }
    case "set_lead_status":
      return raw.status === "qualified" ? { type: "set_lead_status", status: "connected", qualified: true } : { type: "set_lead_status", status: raw.status };
    case "create_follow_up": {
      const title = oneLine(raw.title, 200);
      const days = Number.isFinite(raw.dueInDays) ? Math.min(365, Math.max(0, Math.round(raw.dueInDays))) : 1;
      return title ? { type: "create_follow_up", title, dueInDays: days, note: clean(raw.note, 2000) } : null;
    }
    case "send_email":
      return { type: "send_email", subject: oneLine(raw.subject, LIMITS.emailSubject), body: clean(raw.body, LIMITS.emailBody) };
    case "create_deal": {
      const name = oneLine(raw.name, 160);
      const value = typeof raw.value === "number" && Number.isFinite(raw.value) && raw.value >= 0 && raw.value < 1e12 ? raw.value : null;
      return name ? { type: "create_deal", name, value } : null;
    }
    case "move_deal": {
      const stage = oneLine(raw.stage, 80);
      return stage ? { type: "move_deal", stage } : null;
    }
    case "mark_deal":
      return { type: "mark_deal", result: raw.result, reason: oneLine(raw.reason, 300) };
    case "create_project":
      return { type: "create_project", extraTasks: raw.extraTasks.map((t) => oneLine(t, LIMITS.taskTitle)).filter(Boolean).slice(0, EXTRA_TASKS) };
    case "notify_owner": {
      const text = oneLine(raw.text, 500);
      return text ? { type: "notify_owner", text } : null;
    }
    default:
      return null;
  }
}

/**
 * One entry of the agent's actions list, whatever it is. Something that is
 * not one of the actions on the list (an unknown type, a missing field)
 * becomes "unknown", which is only ever shown as dropped. Anything extra the
 * agent wrote on a real action (a recipient, an id, a workspace) is discarded
 * here, because the shape has no place for it. null when nothing is left.
 */
export function read(raw: unknown): PlanAction | null {
  const parsed = ActionSchema.safeParse(raw);
  return parsed.success ? tidy(parsed.data) : { type: "unknown" };
}

const ADDRESS = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

/** The lead's own address when it is one plain address; null otherwise. */
export function leadAddress(lead: Pick<Lead, "email">): string | null {
  const e = lead.email.trim().toLowerCase();
  return ADDRESS.test(e) && e.length <= 254 ? e : null;
}

/** True when an email still has something to be filled in: {{name}}, [Your name] and the like. */
export const hasBlank = (text: string): boolean => /\{\{[^}]*\}\}|\{[a-z_ ]{2,30}\}|\[[^\]\n]*[A-Za-z][^\]\n]*\]/.test(text);

/** True when the workspace's rules, or the agent's own setting, make this action wait for a person. Telling the owner never waits: it is itself a message to a person. */
export function waitsForPerson(type: ProposedAction["type"], autonomy: Autonomy, askFirst: boolean): boolean {
  if (type === "notify_owner") return false;
  if (askFirst || autonomy === "suggest") return true;
  return autonomy === "ask_external" && (type === "send_email" || type === "mark_deal");
}

export type JudgeFacts = {
  rights: Right[];
  askFirst: boolean;
  autonomy: Autonomy;
  emailsPerLead: number;
  /** Emails already sent to this lead, or waiting to be. */
  emailsCounted: number;
  lead: Pick<Lead, "email" | "leadStatus" | "lifecycleStage">;
  deal: Deal | null;
  stages: Stage[];
  agentMayAddTasks: boolean;
};

export const findStage = (stages: Stage[], name: string): Stage | undefined => stages.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());

/** The stage a new deal starts in: "Qualified" when the pipeline has one, else its first open stage (as the app's own "Convert to deal" does). */
export function startingStage(stages: Stage[]): Stage | undefined {
  const open = stages.filter((s) => s.status === "open").sort((a, b) => a.sortOrder - b.sortOrder);
  return open.find((s) => /qualif/i.test(s.name)) ?? open[0];
}

export const closingStage = (stages: Stage[], result: "won" | "lost"): Stage | undefined => stages.filter((s) => s.status === result).sort((a, b) => a.sortOrder - b.sortOrder)[0];

/**
 * The verdict on every action of one step, in order. Later actions are judged
 * knowing what the earlier ones of the same step will have done (a deal just
 * opened can be moved; a lead just marked unqualified is not emailed).
 */
export function judge(actions: PlanAction[], f: JudgeFacts): PlanItem[] {
  let unqualified = f.lead.leadStatus === "unqualified";
  /** The deal as it will stand: for sure (`sure`) or only once a person approves. */
  let deal: { status: "open" | "won" | "lost"; sure: boolean; isProject: boolean } | null = f.deal ? { status: f.deal.status, sure: true, isProject: !!f.deal.projectId } : null;
  let stageId = f.deal?.stageId ?? null;
  let emails = f.emailsCounted;
  let emailed = false;
  let projectAsked = false;

  const drop = (action: PlanAction, why: string): PlanItem => ({ action, verdict: "drop", why, state: "done" });

  return actions.map((action): PlanItem => {
    if (action.type === "unknown") return drop(action, "this is not something an agent can do");
    if (!f.rights.includes(ACTION_RIGHT[action.type])) return drop(action, "the agent is not allowed to do this");
    const waits = waitsForPerson(action.type, f.autonomy, f.askFirst);
    const keep = (): PlanItem => ({ action, verdict: waits ? "ask" : "now", state: "todo" });

    switch (action.type) {
      case "add_note":
      case "create_follow_up":
      case "notify_owner":
        return keep();
      case "set_lead_status": {
        if (action.status === "open_deal" && !deal) return drop(action, "the lead has no deal");
        if (action.qualified ? f.lead.lifecycleStage === "sales_qualified_lead" : action.status === f.lead.leadStatus) return drop(action, `the lead is already ${statusLabel(action)}`);
        if (action.status === "unqualified") unqualified = true;
        return keep();
      }
      case "send_email": {
        if (emailed) return drop(action, "an agent sends one email per step");
        if (!leadAddress(f.lead)) return drop(action, "the lead has no email address on file");
        if (unqualified) return drop(action, "the lead is marked unqualified");
        if (emails >= f.emailsPerLead) return drop(action, f.emailsPerLead === 0 ? "this workspace does not let agents send email" : `the limit of ${f.emailsPerLead} emails for one lead is reached`);
        if (!action.subject || action.body.length < 20) return drop(action, "the email was empty");
        if (hasBlank(action.subject) || hasBlank(action.body)) return drop(action, "the email still had a blank to be filled in");
        emailed = true;
        emails += 1;
        return keep();
      }
      case "create_deal": {
        if (deal && deal.status === "open") return drop(action, "the lead already has an open deal");
        if (!startingStage(f.stages)) return drop(action, "this workspace's pipeline has no open stage");
        deal = { status: "open", sure: !waits, isProject: false };
        stageId = startingStage(f.stages)?.id ?? null;
        return keep();
      }
      case "move_deal": {
        if (!deal || !deal.sure) return drop(action, "the lead has no deal yet");
        if (deal.status !== "open") return drop(action, `the deal is already ${deal.status}`);
        const stage = findStage(f.stages, action.stage);
        if (!stage) return drop(action, `there is no stage called “${action.stage}”`);
        if (stage.status !== "open") return drop(action, "a deal is closed by marking it won or lost, not by moving it");
        if (stage.id === stageId) return drop(action, `the deal is already in ${stage.name}`);
        if (!waits) stageId = stage.id;
        return keep();
      }
      case "mark_deal": {
        if (!deal || !deal.sure) return drop(action, "the lead has no deal yet");
        if (deal.status !== "open") return drop(action, `the deal is already ${deal.status}`);
        if (!closingStage(f.stages, action.result)) return drop(action, `this workspace's pipeline has no “${action.result}” stage`);
        deal = { ...deal, status: action.result, sure: !waits };
        return keep();
      }
      case "create_project": {
        if (projectAsked) return drop(action, "one project per deal");
        if (!deal) return drop(action, "the lead has no deal");
        if (deal.status !== "won" || !deal.sure) return drop(action, "the deal is not won yet");
        if (deal.isProject) return drop(action, "the deal already has a project");
        projectAsked = true;
        const kept: AgentAction = { type: "create_project", extraTasks: f.agentMayAddTasks ? (action.extraTasks ?? []) : [] };
        return { action: kept, verdict: waits ? "ask" : "now", state: "todo" };
      }
      default:
        return drop(action, "this is not something an agent can do");
    }
  });
}

/** What an action is, as the person approving it reads it: "Send the first email to Priya Nair". */
export function whatOf(action: PlanAction, names: { lead: string; deal: string | null; emailNumber: number }): string {
  const deal = names.deal ? `“${names.deal}”` : "the deal";
  switch (action.type) {
    case "unknown":
      return "Do something that is not on the list of actions";
    case "add_note":
      return `Add a note on ${names.lead}`;
    case "create_follow_up":
      return `Create the follow-up “${action.title}”`;
    case "notify_owner":
      return `Tell the owner of ${names.lead}`;
    case "set_lead_status":
      return `Mark ${names.lead} as ${statusLabel(action)}`;
    case "send_email":
      return names.emailNumber <= 1 ? `Send the first email to ${names.lead}` : `Send a follow-up email to ${names.lead}`;
    case "create_deal":
      return `Open the deal “${action.name}”`;
    case "move_deal":
      return `Move ${deal} to ${action.stage}`;
    case "mark_deal":
      return `Mark ${deal} as ${action.result}`;
    case "create_project":
      return `Create the project for ${deal}`;
  }
}

/** The lines of a step's record that say what was done, what was not and why. Waiting actions say nothing yet. */
export function didLines(plan: PlanItem[], names: { lead: string; deal: string | null }): string[] {
  const out: string[] = [];
  for (const item of plan) {
    const what = item.what ?? whatOf(item.action, { ...names, emailNumber: 1 });
    if (item.verdict === "drop") out.push(`Not done (${lower(what)}): ${item.why ?? "it made no sense here"}.`);
    else if (item.state === "done" || item.state === "failed") out.push(item.line ?? what);
    else if (item.state === "rejected") out.push(item.line ?? `Not approved: ${lower(what)}`);
    else if (item.state === "waiting" && item.line) out.push(item.line);
  }
  return out;
}

export const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
