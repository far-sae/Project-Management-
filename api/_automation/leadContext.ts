import type { AutoStore, Company, Deal, Lead, Person, Stage, TimelineItem, WorkspaceInfo } from "./store.js";

/**
 * Everything about one lead that an agent step works from, read fresh from
 * the CRM inside the run's own workspace: the lead, its company, its deal,
 * the pipeline, the recent timeline and how many emails the agents have sent.
 */
export type LeadContext = {
  workspace: WorkspaceInfo;
  lead: Lead;
  company: Company | null;
  /** The run's own deal when it has one, else the lead's newest open deal, else its newest deal. */
  deal: Deal | null;
  stages: Stage[];
  timeline: TimelineItem[];
  emailsSent: number;
  /** The lead's owner when they are still in the organisation. */
  owner: Person | null;
  people: Person[];
};

/** How many notes and how many activities an agent is shown. */
export const TIMELINE_LIMIT = 15;

export function leadName(lead: Pick<Lead, "firstName" | "lastName" | "email">): string {
  return [lead.firstName, lead.lastName].map((s) => s.trim()).filter(Boolean).join(" ") || lead.email.trim() || "Unnamed lead";
}

/** Who a run is about: the company name, else the lead's name. */
export const subjectOf = (lead: Lead, company: Company | null): string => company?.name.trim() || leadName(lead);

export async function pickDeal(store: AutoStore, workspaceId: string, contactId: string, dealId: string | null): Promise<Deal | null> {
  if (dealId) {
    const own = await store.getDeal(workspaceId, dealId);
    if (own) return own;
  }
  const deals = await store.dealsOfLead(workspaceId, contactId);
  return deals.find((d) => d.status === "open") ?? deals[0] ?? null;
}

/** null when the lead is gone (or was never in this workspace). */
export async function loadLeadContext(store: AutoStore, workspace: WorkspaceInfo, contactId: string, dealId: string | null): Promise<LeadContext | null> {
  const lead = await store.getLead(workspace.workspaceId, contactId);
  if (!lead) return null;
  const [company, deal, stages, timeline, emailsSent, people] = await Promise.all([
    lead.companyId ? store.getCompany(workspace.workspaceId, lead.companyId) : Promise.resolve(null),
    pickDeal(store, workspace.workspaceId, contactId, dealId),
    store.listStages(workspace.workspaceId),
    store.timeline(workspace.workspaceId, contactId, TIMELINE_LIMIT),
    store.countEmails(workspace.workspaceId, contactId),
    store.orgPeople(workspace.organizationId),
  ]);
  return { workspace, lead, company, deal, stages, timeline, emailsSent, owner: people.find((p) => p.userId === lead.ownerId) ?? null, people };
}
