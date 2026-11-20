import { randomUUID } from "node:crypto";
import { BOARD_COLUMNS } from "./defaults.js";
import { leadName } from "./leadContext.js";
import type { ProjectTemplate } from "./shared/types.js";
import type { AutoStore, BoardColumn, Company, Deal, Lead, Person, WorkspaceInfo } from "./store.js";

/**
 * Turning a won deal into a project, the same way the app's own hand-off does
 * (src/services/supabase/crmHub/flow.ts, handoffDealToNewProject): the
 * project, its board columns, the kick-off tasks for the project lead, the
 * deal linked to it, and the lead made a customer. What differs is where the
 * shape comes from: the workspace's own project template.
 */

/** Raised when the project cannot be made, with a sentence for the step's record. */
export class ProjectRefused extends Error {
  constructor(public why: string) {
    super(why);
    this.name = "ProjectRefused";
  }
}

/** The project's name from the template: {company}, {deal} and {lead} filled in, and the joins tidied when one is empty. */
export function projectName(template: string, deal: Pick<Deal, "name">, company: Pick<Company, "name"> | null, lead: Pick<Lead, "firstName" | "lastName" | "email">): string {
  const dealName = deal.name.trim();
  const companyName = company?.name.trim() ?? "";
  // The app's own rule: a deal already named after the company is not given the company twice.
  const repeated = !!companyName && dealName.toLowerCase().includes(companyName.toLowerCase());
  const filled = template
    .replace(/\{company\}/g, repeated ? "" : companyName)
    .replace(/\{deal\}/g, dealName)
    .replace(/\{lead\}/g, leadName(lead));
  const tidy = filled
    .replace(/\s+/g, " ")
    .replace(/^[\s–—\-:|/,]+|[\s–—\-:|/,]+$/g, "")
    .trim();
  return (tidy || dealName || companyName || "New project").slice(0, 160);
}

/** What was sold and to whom, for the delivery team (the app's handoffDescription). */
export function projectBrief(deal: Deal, company: Company | null, lead: Lead): string {
  const lines = [`Won deal: ${deal.name}`];
  if (deal.value) lines.push(`Value: ${deal.value}${deal.currency ? ` ${deal.currency}` : ""}`);
  if (company?.name) lines.push(`Customer: ${company.name}`);
  const email = lead.email.trim();
  lines.push(`Contact: ${leadName(lead)}${email && leadName(lead) !== email ? ` (${email})` : ""}`);
  if (deal.notes.trim()) lines.push("", deal.notes.trim());
  return lines.join("\n");
}

/** Board columns from their titles: a title the app knows keeps its id and colour, any other gets its own. */
export function boardColumns(titles: string[]): BoardColumn[] {
  const used = new Set<string>();
  return titles.map((title, order) => {
    const known = BOARD_COLUMNS.find((c) => c.title.toLowerCase() === title.trim().toLowerCase());
    let id = known?.id ?? (title.toLowerCase().replace(/[^a-z0-9]+/g, "") || `column${order + 1}`);
    while (used.has(id)) id = `${id}${order + 1}`;
    used.add(id);
    return { id, title: title.trim(), color: known?.color ?? "#9E9E9E", order };
  });
}

/** The column kick-off tasks land in: To-do when the board has it, else the board's first column. */
export const taskColumn = (columns: BoardColumn[]): string => columns.find((c) => c.id === "todo")?.id ?? columns[0]?.id ?? "todo";

/** `days` days from `now`, at 17:00 UTC (the app's own hand-off uses five in the afternoon). */
export function dueIn(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * 86_400_000);
  d.setUTCHours(17, 0, 0, 0);
  return d.toISOString();
}

/**
 * Who leads the project: the person the template names, else whoever owns the
 * deal, else the lead's owner, else the organisation's owner. Only someone who
 * is still an active member of the organisation can lead it: that is also the
 * app's own rule for the plan's project limit, which never stops a member.
 */
export function projectLead(template: ProjectTemplate, deal: Deal, lead: Lead, people: Person[]): Person | null {
  const byId = (id: string | null) => (id ? people.find((p) => p.userId === id && p.role !== "viewer") : undefined);
  return (
    (template.lead !== "deal_owner" ? byId(template.lead) : undefined) ??
    byId(deal.ownerId) ??
    byId(lead.ownerId) ??
    people.find((p) => p.role === "owner") ??
    people.find((p) => p.role === "admin") ??
    null
  );
}

export type ProjectMade = { projectId: string; name: string; tasks: number; tasksFailed: number; leadId: string };

/**
 * Makes the project. `memo` holds the id of a project an earlier, half-finished
 * attempt already made, and `remember` saves it before the deal is linked, so
 * trying again never makes a second project.
 */
export async function createProjectFromDeal(
  store: AutoStore,
  input: { workspace: WorkspaceInfo; template: ProjectTemplate; deal: Deal; lead: Lead; company: Company | null; people: Person[]; extraTasks: string[]; now: Date },
  memo: Record<string, string>,
  remember: (memo: Record<string, string>) => Promise<void>,
): Promise<ProjectMade> {
  const { workspace, template, deal, lead, company, people, now } = input;
  if (deal.status !== "won") throw new ProjectRefused("the deal is not won");
  if (deal.projectId) throw new ProjectRefused("the deal already has a project");
  const owner = projectLead(template, deal, lead, people);
  if (!owner) throw new ProjectRefused("nobody in this workspace's organisation can lead the project");

  const name = projectName(template.nameTemplate, deal, company, lead);
  let projectId = memo.projectId ?? "";
  let tasks = Number(memo.tasks ?? 0);
  let tasksFailed = Number(memo.tasksFailed ?? 0);

  if (!projectId) {
    projectId = randomUUID();
    const columns = boardColumns(template.columns);
    const at = now.toISOString();
    // As in the app, the project's owner is not repeated in its member list.
    const members = (template.addEveryone ? people.filter((p) => p.role !== "viewer" && p.userId !== owner.userId) : []).map((p) => ({
      userId: p.userId,
      email: p.email,
      displayName: p.name,
      photoURL: p.photoURL,
      role: "member" as const,
      addedAt: at,
    }));
    await store.insertProject({ id: projectId, organizationId: workspace.organizationId, workspaceId: workspace.workspaceId, ownerId: owner.userId, name, description: projectBrief(deal, company, lead), columns, members });

    const status = taskColumn(columns);
    const drafts = [...template.tasks, ...input.extraTasks.map((title) => ({ title, days: 7 }))];
    // As in the app: a task that cannot be written is counted, and the project still stands.
    for (const [position, draft] of drafts.entries()) {
      try {
        await store.insertProjectTask({
          id: randomUUID(),
          projectId,
          organizationId: workspace.organizationId,
          title: draft.title,
          status,
          dueDate: dueIn(now, draft.days),
          position,
          createdBy: owner.userId,
          assignee: { userId: owner.userId, displayName: owner.name, email: owner.email, photoURL: owner.photoURL },
          dealId: deal.id,
          contactId: deal.contactId,
        });
        tasks += 1;
      } catch (e) {
        console.error("[automation] kick-off task not written", e instanceof Error ? e.name : "unknown");
        tasksFailed += 1;
      }
    }
    await remember({ projectId, tasks: String(tasks), tasksFailed: String(tasksFailed) });
  }

  await store.updateDeal(workspace.workspaceId, deal.id, { projectId });
  await store.logActivity(lead, { type: "deal_updated", description: "Handed off to project", contactId: deal.contactId, companyId: deal.companyId, dealId: deal.id, metadata: { workspaceId: workspace.workspaceId, projectId, automation: true } });
  // The lead behind the deal is now a customer; not worth failing the hand-off for.
  try {
    await store.updateLead(lead, { lifecycleStage: "customer" });
  } catch (e) {
    console.error("[automation] lead not made a customer", e instanceof Error ? e.name : "unknown");
  }
  return { projectId, name, tasks, tasksFailed, leadId: owner.userId };
}
