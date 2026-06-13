// src/services/agent/useAgentActionRunner.ts
// Shared proposed-action executor hook reused by CrmAssistantChat and
// NextBestAction. Encapsulates the permission gate (canRunAction) → service
// call → sonner toast pipeline. Callers receive the created record (if any)
// via RunResult so they can chain further UI work (e.g. file attach).

import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useDeals } from '@/hooks/useDeals';
import { DEAL_STAGES, DealStage, STAGE_DEFAULT_PROBABILITY } from '@/services/supabase/deals';
import { createDeal, updateDeal } from '@/services/supabase/deals';
import { createLead, updateLead } from '@/services/supabase/leads';
import { createClient, createContact, createNote } from '@/services/supabase/clients';
import { createClientTask } from '@/services/supabase/clientTasks';
import { createTask } from '@/services/supabase/database';
import { createWorkspace } from '@/services/supabase/workspaces';
import { createMeeting } from '@/services/supabase/meetings';
import { createCall } from '@/services/supabase/calls';
import { draftAutomationFromText, upsertRecipe, enrollSegmentInAutomation } from '@/services/supabase/automations';
import { ProposedAction, canRunAction, ActionPerms } from '@/services/agent/agentActions';
import { useMemo } from 'react';

export interface RunResult {
  ok: boolean;
  /** The record created by this action, if any. Lets callers (e.g. chat) set
   *  their lastEntity for file attachment. */
  created?: { type: string; id: string; label: string };
}

/**
 * Returns a runner shared by the CRM chat and the Next-Best-Action widget.
 * Encapsulates: permission gate (canRunAction) → call the matching app service
 * → toast. Optional onCreated lets the caller track the created record.
 */
export const useAgentActionRunner = (): {
  running: string | null;
  run: (action: ProposedAction) => Promise<RunResult>;
} => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, canEditModule } = useOrganization();
  const orgId = organization?.organizationId ?? user?.organizationId ?? null;
  const { update: updateDealHook } = useDeals();

  const uid = user?.userId ?? '';
  const uname = user?.displayName ?? '';

  const perms: ActionPerms = useMemo(
    () => ({ isAdmin: isOwner || isAdmin, canEditModule }),
    [isOwner, isAdmin, canEditModule],
  );

  const [running, setRunning] = useState<string | null>(null);

  const run = async (action: ProposedAction): Promise<RunResult> => {
    if (!canRunAction(action.type, perms)) {
      toast.error("You don't have access to do that");
      return { ok: false };
    }
    if (!orgId || !uid) {
      toast.error('Not signed in or missing organization');
      return { ok: false };
    }

    const id = `${action.type}-${JSON.stringify(action.payload)}`;
    setRunning(id);
    try {
      const p = action.payload;

      switch (action.type) {
        // ── Deal actions ──────────────────────────────────────────────────
        case 'move_deal_stage': {
          const dealId = String(p.deal_id ?? '');
          const newStage = String(p.new_stage ?? '') as DealStage;
          if (!dealId || !DEAL_STAGES.some((s) => s.id === newStage)) {
            toast.error('Bad action payload');
            return { ok: false };
          }
          await updateDealHook(dealId, {
            stage: newStage,
            probability: STAGE_DEFAULT_PROBABILITY[newStage],
          });
          toast.success(`Moved deal to ${DEAL_STAGES.find((s) => s.id === newStage)?.label ?? newStage}`);
          return { ok: true };
        }

        case 'create_deal': {
          const title = String(p.title ?? '');
          if (!title) { toast.error('Deal title is required'); return { ok: false }; }
          const created = await createDeal(orgId, uid, uname, {
            title,
            clientId: p.client_id ? String(p.client_id) : null,
            clientName: p.client_name ? String(p.client_name) : null,
            value: p.value != null ? Number(p.value) : 0,
            currency: p.currency ? String(p.currency) : 'USD',
            stage: (p.stage as DealStage) ?? 'lead',
            expectedCloseDate: p.expected_close_date
              ? new Date(String(p.expected_close_date))
              : null,
          });
          toast.success(`Deal "${title}" created`);
          return { ok: true, created: { type: 'deal', id: created.dealId, label: created.title } };
        }

        case 'update_deal': {
          const dealId = String(p.deal_id ?? '');
          if (!dealId) { toast.error('deal_id is required'); return { ok: false }; }
          await updateDeal(orgId, dealId, {
            title: p.title ? String(p.title) : undefined,
            value: p.value != null ? Number(p.value) : undefined,
            stage: p.stage ? (p.stage as DealStage) : undefined,
            expectedCloseDate: p.expected_close_date
              ? new Date(String(p.expected_close_date))
              : undefined,
          });
          toast.success('Deal updated');
          return { ok: true };
        }

        // ── Lead actions ──────────────────────────────────────────────────
        case 'create_lead': {
          const lastName = String(p.last_name ?? p.lastName ?? '');
          const company = String(p.company ?? '');
          if (!lastName || !company) {
            toast.error('last_name and company are required for a lead');
            return { ok: false };
          }
          const created = await createLead(orgId, uid, uname, {
            firstName: p.first_name ? String(p.first_name) : null,
            lastName,
            company,
            email: p.email ? String(p.email) : null,
            phone: p.phone ? String(p.phone) : null,
            leadStatus: (p.lead_status as Parameters<typeof createLead>[3]['leadStatus']) ?? 'new',
          });
          toast.success(`Lead "${lastName}" created`);
          return { ok: true, created: { type: 'lead', id: created.leadId, label: created.lastName ?? created.company } };
        }

        case 'update_lead_status': {
          const leadId = String(p.lead_id ?? '');
          if (!leadId) { toast.error('lead_id is required'); return { ok: false }; }
          await updateLead(orgId, leadId, {
            leadStatus: p.lead_status as Parameters<typeof updateLead>[2]['leadStatus'],
          });
          toast.success('Lead status updated');
          return { ok: true };
        }

        // ── Client / Contact / Note actions ──────────────────────────────
        case 'create_client': {
          const name = String(p.name ?? '');
          if (!name) { toast.error('Client name is required'); return { ok: false }; }
          const created = await createClient(orgId, uid, uname, {
            name,
            email: p.email ? String(p.email) : undefined,
            phone: p.phone ? String(p.phone) : undefined,
            industry: p.industry ? String(p.industry) : undefined,
          });
          toast.success(`Client "${name}" created`);
          return { ok: true, created: { type: 'client', id: created.clientId, label: created.name } };
        }

        case 'create_contact': {
          const clientId = String(p.client_id ?? '');
          const lastName = String(p.last_name ?? p.lastName ?? '');
          if (!clientId || !lastName) {
            toast.error('client_id and last_name are required for a contact');
            return { ok: false };
          }
          const created = await createContact(orgId, clientId, uid, {
            firstName: p.first_name ? String(p.first_name) : undefined,
            lastName,
            email: p.email ? String(p.email) : undefined,
            phone: p.phone ? String(p.phone) : undefined,
          });
          toast.success(`Contact "${lastName}" created`);
          return { ok: true, created: { type: 'contact', id: created.contactId, label: created.lastName ?? lastName } };
        }

        case 'log_note': {
          const clientId = String(p.client_id ?? '');
          const body = String(p.body ?? p.note ?? '');
          if (!clientId || !body) {
            toast.error('client_id and body are required to log a note');
            return { ok: false };
          }
          await createNote(orgId, clientId, uid, uname, {
            subject: p.subject ? String(p.subject) : null,
            body,
          });
          toast.success('Note logged');
          return { ok: true };
        }

        // ── Task actions ──────────────────────────────────────────────────
        case 'create_client_task': {
          const title = String(p.title ?? '');
          if (!title) { toast.error('Task title is required'); return { ok: false }; }
          // The edge fn proposes with assignee_id/assignee_name; accept either
          // those or the older assigned_to/assigned_to_name keys.
          const assigneeId = p.assignee_id ?? p.assigned_to;
          const assigneeName = p.assignee_name ?? p.assigned_to_name;
          await createClientTask(orgId, uid, uname, {
            title,
            clientId: p.client_id ? String(p.client_id) : null,
            dueAt: p.due_at ? new Date(String(p.due_at)) : null,
            assignedTo: assigneeId ? String(assigneeId) : null,
            assignedToName: assigneeName ? String(assigneeName) : null,
          });
          toast.success(`Task "${title}" created`);
          return { ok: true };
        }

        case 'create_pm_task':
        case 'assign_task': {
          const title = String(p.title ?? '');
          const projectId = String(p.project_id ?? '');
          if (!title || !projectId) {
            toast.error('title and project_id are required for a PM task');
            return { ok: false };
          }
          const created = await createTask(uid, {
            title,
            projectId,
            dueDate: p.due_date ? new Date(String(p.due_date)) : null,
            assignees: Array.isArray(p.assignees)
              ? (p.assignees as Array<{ userId: string; displayName: string }>)
              : [],
          }, orgId);
          toast.success(`PM task "${title}" created`);
          if (action.type === 'create_pm_task') {
            return { ok: true, created: { type: 'task', id: created.taskId, label: created.title } };
          }
          return { ok: true };
        }

        // ── Project / Workspace actions ───────────────────────────────────
        case 'create_project': {
          const name = String(p.name ?? '');
          if (!name) { toast.error('Project name is required'); return { ok: false }; }
          const { createProject } = await import('@/services/supabase/database');
          await createProject(uid, '', uname, '', {
            name,
            description: p.description ? String(p.description) : '',
            coverColor: p.cover_color ? String(p.cover_color) : '#6366f1',
          }, orgId);
          toast.success(`Project "${name}" created`);
          return { ok: true };
        }

        case 'create_workspace': {
          const name = String(p.name ?? '');
          if (!name) { toast.error('Workspace name is required'); return { ok: false }; }
          await createWorkspace({ name, organizationId: orgId });
          toast.success(`Workspace "${name}" created`);
          return { ok: true };
        }

        // ── Automation ────────────────────────────────────────────────────
        // The agent captures intent (name + plain-English description); we turn
        // it into a recipe via the NL author, then save it live (enabled).
        case 'create_automation': {
          const name = String(p.name ?? '').trim() || 'New automation';
          const description = String(p.description ?? '').trim();
          if (!description) { toast.error('Describe what the automation should do'); return { ok: false }; }
          const draft = await draftAutomationFromText(orgId, description);
          draft.name = name;
          draft.enabled = true;
          const recipe = await upsertRecipe(orgId, null, draft);
          toast.success(`Automation "${name}" is live`);
          return { ok: true, created: { type: 'automation', id: recipe.recipeId, label: name } };
        }

        // ── Campaign (a timed email sequence) ─────────────────────────────
        // Same path as an automation, but framed as a send_email + wait
        // sequence so the author produces an outreach recipe. Saved live.
        case 'create_campaign': {
          const name = String(p.name ?? '').trim() || 'New campaign';
          const description = String(p.description ?? '').trim();
          const segment = String(p.segment ?? '').trim();
          if (!description) { toast.error('Describe the campaign emails'); return { ok: false }; }
          const draft = await draftAutomationFromText(
            orgId,
            `Outreach email campaign (a timed sequence of send_email + wait steps): ${description}.${segment ? ` Target segment: ${segment}.` : ''}`,
          );
          draft.name = name;
          draft.enabled = true;
          const recipe = await upsertRecipe(orgId, null, draft);
          // Auto-enrol the target segment (leads by category) so the
          // sequence starts immediately. Best-effort: a failed/empty
          // enrolment never blocks campaign creation.
          let enrolled = 0;
          if (segment) {
            try {
              enrolled = await enrollSegmentInAutomation({ recipeId: recipe.recipeId, category: segment });
            } catch (err) {
              toast.warning(err instanceof Error ? `Campaign live, but enrolment failed: ${err.message}` : 'Campaign live, but segment enrolment failed');
            }
          }
          toast.success(
            enrolled > 0
              ? `Campaign "${name}" live · enrolled ${enrolled} lead${enrolled === 1 ? '' : 's'}`
              : `Campaign "${name}" created & live`,
          );
          return { ok: true, created: { type: 'campaign', id: recipe.recipeId, label: name } };
        }

        // ── Meeting / Call actions ────────────────────────────────────────
        case 'create_meeting': {
          const title = String(p.title ?? '');
          const startAt = p.start_at ? new Date(String(p.start_at)) : null;
          const endAt = p.end_at ? new Date(String(p.end_at)) : null;
          if (!title || !startAt || !endAt) {
            toast.error('title, start_at, and end_at are required for a meeting');
            return { ok: false };
          }
          const created = await createMeeting({
            organizationId: orgId,
            title,
            startAt,
            endAt,
            hostUserId: uid,
            hostName: uname,
            clientId: p.client_id ? String(p.client_id) : null,
            dealId: p.deal_id ? String(p.deal_id) : null,
            description: p.description ? String(p.description) : null,
          });
          toast.success(`Meeting "${title}" scheduled`);
          return { ok: true, created: { type: 'meeting', id: created.meetingId, label: created.title } };
        }

        case 'create_call': {
          const subject = String(p.subject ?? '');
          if (!subject) { toast.error('Call subject is required'); return { ok: false }; }
          const created = await createCall({
            organizationId: orgId,
            subject,
            callType: p.call_type ? (p.call_type as Parameters<typeof createCall>[0]['callType']) : 'outbound',
            callStatus: p.call_status ? (p.call_status as Parameters<typeof createCall>[0]['callStatus']) : 'scheduled',
            callerUserId: uid,
            callerName: uname,
            clientId: p.client_id ? String(p.client_id) : null,
            dealId: p.deal_id ? String(p.deal_id) : null,
            description: p.description ? String(p.description) : null,
          });
          toast.success(`Call "${subject}" logged`);
          return { ok: true, created: { type: 'call', id: created.callId, label: created.subject } };
        }

        // ── Email draft ───────────────────────────────────────────────────
        case 'draft_email': {
          const summary = `Draft email goal:\n${String(p.goal ?? '')}\n\n(Open the deal/contact, hit Email, and paste this as the starting point.)`;
          try { await navigator.clipboard.writeText(summary); } catch { /* ignore */ }
          toast.info('Draft prompt copied to your clipboard. Open the contact and paste into Email.');
          return { ok: true };
        }

        default: {
          const exhaustive: never = action.type as never;
          toast.info(`Action "${exhaustive}" isn't wired to a UI handler yet — payload logged.`);
          // eslint-disable-next-line no-console
          console.info('AI proposed action', action);
          return { ok: false };
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
      return { ok: false };
    } finally {
      setRunning(null);
    }
  };

  return { running, run };
};
