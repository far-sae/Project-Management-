import { randomUUID } from "node:crypto";
import { closingStage, findStage, startingStage, statusLabel } from "./actions.js";
import type { AutoDeps } from "./deps.js";
import { leadName, pickDeal } from "./leadContext.js";
import { ownersOf, runPage, tell } from "./notify.js";
import { createProjectFromDeal, ProjectRefused } from "./project.js";
import type { AgentAction, Lead, RunPatch, StoredRules, StoredRun, WorkspaceInfo } from "./store.js";

/**
 * Carrying out one action on the CRM. Every write is made on the run's own
 * lead, in the run's own workspace, the way the app itself writes it, and
 * carries the agent's name so the lead's timeline shows who did what.
 *
 * Sending an email is not here: it has its own rules (email.ts).
 */

/** What every engine function is handed: the outside world, and the workspace it is working in. */
export type Env = { deps: AutoDeps; workspace: WorkspaceInfo; rules: StoredRules; now: Date };

/** Raised when, on a fresh look at the record, the action no longer makes sense. The step's record says why. */
export class Skip extends Error {
  constructor(public why: string) {
    super(why);
    this.name = "Skip";
  }
}

export type Done = { line: string; run?: RunPatch; projectId?: string };

/** The activity metadata of everything the automation writes: the CRM trigger reads `automation`. */
export const stamp = (agentName: string, runId: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ ...more, automation: true, agent: agentName, runId });

const signed = (text: string, agentName: string): string => `${text}\n\n(${agentName}, automation)`;

/** The chance of winning after a move: a deal that followed its old stage follows the new one (the app's probabilityAfterMove). */
function probabilityAfter(current: number, from: number | undefined, to: { probability: number; status: string }): number {
  if (to.status === "won") return 100;
  if (to.status === "lost") return 0;
  return current === 0 || (from !== undefined && current === from) ? to.probability : current;
}

const dayLabel = (iso: string): string => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso)).replace(/,/g, "");

export async function carryOut(
  env: Env,
  run: StoredRun,
  agentName: string,
  action: Exclude<AgentAction, { type: "send_email" }>,
  memo: Record<string, string>,
  remember: (memo: Record<string, string>) => Promise<void>,
): Promise<Done> {
  const { store } = env.deps;
  const ws = env.workspace.workspaceId;
  const lead: Lead | null = await store.getLead(ws, run.contactId);
  if (!lead) throw new Skip("the lead no longer exists");
  const meta = (more: Record<string, unknown> = {}) => stamp(agentName, run.id, more);
  const note = (description: string) => store.logActivity(lead, { type: "note", description, contactId: lead.id, companyId: lead.companyId, dealId: null, metadata: meta() });

  switch (action.type) {
    case "add_note": {
      await store.addNote(lead, signed(action.text, agentName));
      // The app logs a `note` activity with every note, so the timeline shows it.
      await note(action.text.length > 240 ? `${action.text.slice(0, 240)}…` : action.text);
      return { line: "Added a note on the lead" };
    }
    case "set_lead_status": {
      await store.updateLead(lead, action.qualified ? { lifecycleStage: "sales_qualified_lead", leadStatus: "connected" } : { leadStatus: action.status });
      await note(`${agentName} (automation) marked the lead ${statusLabel(action)}.`);
      return { line: `Marked the lead ${statusLabel(action)}` };
    }
    case "create_follow_up": {
      const deal = await pickDeal(store, ws, lead.id, run.dealId);
      const dueDate = new Date(env.now.getTime() + action.dueInDays * 86_400_000).toISOString();
      await store.addFollowUp(lead, { ownerId: lead.ownerId, contactId: lead.id, companyId: lead.companyId, dealId: deal?.status === "open" ? deal.id : null, title: action.title, description: signed(action.note, agentName), dueDate });
      await note(`${agentName} (automation) created the follow-up “${action.title}”.`);
      return { line: `Created the follow-up “${action.title}”, due ${dayLabel(dueDate)}` };
    }
    case "notify_owner": {
      const people = await store.orgPeople(env.workspace.organizationId);
      const owner = people.find((p) => p.userId === lead.ownerId);
      await tell(store, owner ? [owner.userId] : ownersOf(people), { title: `${agentName}: ${leadName(lead)}`, message: action.text, link: runPage(run.id), actorName: agentName });
      return { line: owner ? `Told ${owner.name} in the app` : "Told the workspace's owners in the app (the lead has no owner)" };
    }
    case "create_deal": {
      const stages = await store.listStages(ws);
      // A deal an earlier, half-finished attempt already opened is this one: it is not opened twice.
      const id = memo.dealId ?? randomUUID();
      const open = (await store.dealsOfLead(ws, lead.id)).find((d) => d.status === "open" && d.id !== id);
      if (open) throw new Skip("the lead already has an open deal");
      const stage = startingStage(stages);
      if (!stage) throw new Skip("this workspace's pipeline has no open stage");
      if (!memo.dealId) await remember({ dealId: id });
      if (!(await store.getDeal(ws, id))) {
        await store.insertDeal(lead, { id, ownerId: lead.ownerId, stageId: stage.id, companyId: lead.companyId, contactId: lead.id, name: action.name, value: action.value ?? 0, probability: stage.probability, status: "open", source: lead.source || null });
      }
      await store.logActivity(lead, { type: "deal_created", description: action.name, contactId: lead.id, companyId: lead.companyId, dealId: id, metadata: meta({ value: action.value ?? 0, currency: null }) });
      // As the app's "Convert to deal": the lead now has an open deal. The deal exists either way.
      try {
        await store.updateLead(lead, { lifecycleStage: "opportunity", leadStatus: "open_deal" });
      } catch (e) {
        console.error("[automation] lead not marked as having a deal", e instanceof Error ? e.name : "unknown");
      }
      return { line: `Opened the deal “${action.name}” in ${stage.name}`, run: { dealId: id } };
    }
    case "move_deal": {
      const deal = await pickDeal(store, ws, lead.id, run.dealId);
      if (!deal || deal.status !== "open") throw new Skip(deal ? `the deal is already ${deal.status}` : "the lead has no deal");
      const stages = await store.listStages(ws);
      const stage = findStage(stages, action.stage);
      if (!stage || stage.status !== "open") throw new Skip(`there is no open stage called “${action.stage}”`);
      if (stage.id === deal.stageId) throw new Skip(`the deal is already in ${stage.name}`);
      const from = stages.find((s) => s.id === deal.stageId);
      await store.updateDeal(ws, deal.id, { stageId: stage.id, status: "open", probability: probabilityAfter(deal.probability, from?.probability, stage), closedAt: null, lostReason: null });
      await store.logActivity(lead, { type: "deal_stage_changed", description: `Moved to ${stage.name}`, contactId: deal.contactId, companyId: deal.companyId, dealId: deal.id, metadata: meta({ stageId: stage.id, stageStatus: "open" }) });
      return { line: `Moved the deal “${deal.name}” to ${stage.name}`, run: { dealId: deal.id } };
    }
    case "mark_deal": {
      const deal = await pickDeal(store, ws, lead.id, run.dealId);
      if (!deal || deal.status !== "open") throw new Skip(deal ? `the deal is already ${deal.status}` : "the lead has no deal");
      const stage = closingStage(await store.listStages(ws), action.result);
      if (!stage) throw new Skip(`this workspace's pipeline has no “${action.result}” stage`);
      await store.updateDeal(ws, deal.id, { stageId: stage.id, status: action.result, probability: action.result === "won" ? 100 : 0, closedAt: env.now.toISOString(), lostReason: action.result === "lost" ? action.reason || null : null });
      await store.logActivity(lead, {
        type: action.result === "won" ? "deal_won" : "deal_lost",
        description: action.result === "lost" && action.reason ? `Lost: ${action.reason}` : `Moved to ${stage.name}`,
        contactId: deal.contactId,
        companyId: deal.companyId,
        dealId: deal.id,
        metadata: meta({ stageId: stage.id, stageStatus: action.result }),
      });
      return { line: action.result === "won" ? `Marked the deal “${deal.name}” as won` : `Marked the deal “${deal.name}” as lost${action.reason ? `: ${action.reason}` : ""}`, run: { dealId: deal.id } };
    }
    case "create_project": {
      const deal = await pickDeal(store, ws, lead.id, run.dealId);
      if (!deal) throw new Skip("the lead has no deal");
      const [company, people] = await Promise.all([lead.companyId ? store.getCompany(ws, lead.companyId) : Promise.resolve(null), store.orgPeople(env.workspace.organizationId)]);
      try {
        const made = await createProjectFromDeal(store, { workspace: env.workspace, template: env.rules.project, deal, lead, company, people, extraTasks: action.extraTasks ?? [], now: env.now }, memo, remember);
        const tasks = `${made.tasks} task${made.tasks === 1 ? "" : "s"}`;
        return { line: `Created the project “${made.name}” with ${tasks}`, run: { projectId: made.projectId, dealId: deal.id, result: `Project created with ${tasks}` }, projectId: made.projectId };
      } catch (e) {
        if (e instanceof ProjectRefused) throw new Skip(e.why);
        throw e;
      }
    }
  }
}
