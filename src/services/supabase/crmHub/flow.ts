/**
 * The two big steps of the CRM flow that touch more than one record:
 * turning a lead into a deal, and turning a won deal into a project.
 */
import { publicMessage } from '@/lib/publicError';
import type { CrmContact, CrmDeal, CrmDealStage } from '@/types/crmHub';
import { DEFAULT_COLUMNS, type KanbanColumn, type TaskAssignee } from '@/types/task';
import type { HandoffTaskDraft } from '@/lib/crmFlow';
import { createProject, createTask as createProjectTask } from '../database';
import { createCompany } from './companies';
import { updateContact } from './contacts';
import { createDeal, linkDealHandoff } from './deals';

// ── Lead → deal ─────────────────────────────────────────────────────────

export interface ConvertLeadInput {
  lead: CrmContact;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  dealName: string;
  value: number;
  /** ISO code the value is in. Leave out (or null) for the company currency. */
  currency?: string | null;
  stage: Pick<CrmDealStage, 'id' | 'probability' | 'status'>;
  expectedCloseDate?: string | null;
  /** Existing company to attach, or … */
  companyId?: string | null;
  /** … the name of a new company to create for this lead. */
  newCompanyName?: string | null;
}

/**
 * Convert a qualified lead: make (or reuse) its company, open a deal linked
 * to both, and mark the lead as having an open deal.
 */
export async function convertLeadToDeal(input: ConvertLeadInput): Promise<{ deal: CrmDeal; companyId: string | null }> {
  let companyId = input.companyId ?? input.lead.companyId ?? null;
  const newName = input.newCompanyName?.trim();
  if (!companyId && newName) {
    const company = await createCompany(
      { organizationId: input.organizationId, workspaceId: input.workspaceId, name: newName },
      input.actorId,
    );
    companyId = company.id;
  }

  const deal = await createDeal(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.dealName.trim(),
      stageId: input.stage.id,
      value: input.value,
      currency: input.currency ?? null,
      probability: input.stage.probability,
      status: input.stage.status,
      companyId,
      contactId: input.lead.id,
      expectedCloseDate: input.expectedCloseDate ?? null,
      source: input.lead.source,
    },
    input.actorId,
  );

  // The deal exists; a failure here must not look like the conversion failed.
  try {
    await updateContact(input.lead.id, {
      lifecycleStage: 'opportunity',
      leadStatus: 'open_deal',
      ...(companyId && companyId !== input.lead.companyId ? { companyId } : {}),
    });
  } catch {
    /* the lead keeps its old status; the deal is still linked to it */
  }
  return { deal, companyId };
}

// ── Won deal → project ──────────────────────────────────────────────────

/** A hand-off project starts with the same board every other project has. */
export const HANDOFF_COLUMNS: KanbanColumn[] = DEFAULT_COLUMNS;
/** The column the starter tasks land in. */
export const HANDOFF_TASK_STATUS = 'todo';

export interface HandoffInput {
  deal: CrmDeal;
  organizationId: string;
  workspaceId: string;
  actor: { userId: string; email: string; displayName: string; photoURL: string };
  projectName: string;
  description: string;
  startDate?: string | null;
  endDate?: string | null;
  /** Starter tasks to create in the To-do column. */
  tasks: HandoffTaskDraft[];
  /** Who the starter tasks are assigned to (usually the project lead). */
  assignee?: TaskAssignee | null;
  /** A project an earlier, half-finished attempt already created. */
  existingProjectId?: string | null;
}

/** Raised when the project exists but linking the deal to it failed. */
export class HandoffLinkError extends Error {
  constructor(
    message: string,
    public readonly projectId: string,
  ) {
    super(message);
    this.name = 'HandoffLinkError';
  }
}

const addDays = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d;
};

/**
 * Create the delivery project for a won deal, seed its starter tasks and link
 * the deal to it. Tasks that fail are reported, not fatal. If the final link
 * fails, a `HandoffLinkError` carries the project id so a retry does not
 * create a second project.
 */
export async function handoffDealToNewProject(
  input: HandoffInput,
): Promise<{ projectId: string; tasksCreated: number; tasksFailed: number }> {
  let projectId = input.existingProjectId ?? null;
  let tasksCreated = 0;
  let tasksFailed = 0;

  if (!projectId) {
    const project = await createProject(
      input.actor.userId,
      input.actor.email,
      input.actor.displayName,
      input.actor.photoURL,
      {
        name: input.projectName.trim(),
        description: input.description,
        coverColor: '#2563eb',
        workspaceId: input.workspaceId,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        columns: HANDOFF_COLUMNS,
      },
      input.organizationId,
    );
    projectId = project.projectId;

    for (const draft of input.tasks) {
      try {
        await createProjectTask(
          input.actor.userId,
          {
            projectId,
            projectName: project.name,
            title: draft.title,
            status: HANDOFF_TASK_STATUS,
            priority: draft.priority,
            dueDate: addDays(draft.dueInDays),
            assignees: input.assignee ? [input.assignee] : [],
            sourceCrmDealId: input.deal.id,
            sourceCrmContactId: input.deal.contactId,
          },
          input.organizationId,
        );
        tasksCreated += 1;
      } catch {
        tasksFailed += 1;
      }
    }
  }

  try {
    await linkDealHandoff(input.deal.id, { workspaceId: input.workspaceId, projectId });
  } catch (e) {
    throw new HandoffLinkError(publicMessage(e, 'Could not link the deal to the project.'), projectId);
  }

  // The lead behind the deal is now a customer.
  if (input.deal.contactId) {
    try {
      await updateContact(input.deal.contactId, { lifecycleStage: 'customer' });
    } catch {
      /* not worth failing the hand-off for */
    }
  }
  return { projectId, tasksCreated, tasksFailed };
}
