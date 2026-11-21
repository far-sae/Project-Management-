import { isUnansweredCallEntry } from "../_voice/shared/types.js";
import { stopRun } from "./engine.js";
import type { Env } from "./execute.js";
import { subjectOf } from "./leadContext.js";
import { LEAD_STATUSES } from "./shared/types.js";
import type { LeadStatus } from "./shared/types.js";
import type { AutoStore, StoredEvent, StoredRun } from "./store.js";

/**
 * What the runner does with one thing that happened in the CRM: a new lead
 * starts a run of every automation that is on; a reply (a logged call, email
 * or meeting, or a person moving the lead forward) is noted on the lead's
 * runs and wakes them; a won deal wakes the run that waits for it; a lead
 * marked unqualified, or a deal marked lost, by a person stops the run.
 *
 * Changes the automation made itself never get here (they are marked as its
 * own), so an agent's action cannot set off another one.
 */

/** A lead whose source says it came from an import (a CSV file, a spreadsheet, an upload). */
export const fromImport = (source: string): boolean => /import|csv|spreadsheet|upload|bulk/i.test(source);

/** How far along a status is: a person moving a lead to a later one counts as a reply. */
const rank = (status: unknown): number => LEAD_STATUSES.indexOf(status as LeadStatus);
const STOPS: unknown[] = ["unqualified", "bad_timing"];
const FORWARD: unknown[] = ["attempted_to_contact", "in_progress", "connected", "open_deal"];

/** Starts one run of every automation that is on for this lead. A lead already in a run of one is left to it. */
async function startRuns(env: Env, contactId: string): Promise<void> {
  const { store } = env.deps;
  const ws = env.workspace.workspaceId;
  const lead = await store.getLead(ws, contactId);
  // Someone added straight in as a customer is not a lead to be worked.
  if (!lead || lead.lifecycleStage === "customer" || lead.lifecycleStage === "evangelist") return;
  const company = lead.companyId ? await store.getCompany(ws, lead.companyId) : null;
  for (const a of await store.listAutomations(ws)) {
    if (a.status !== "on" || a.steps.length === 0 || a.trigger.type !== "lead_created") continue;
    if (a.trigger.skipImports && fromImport(lead.source)) continue;
    await store.insertRun({ workspaceId: ws, automationId: a.id, automationName: a.name, contactId: lead.id, dealId: null, subject: subjectOf(lead, company), steps: a.steps, wakeAt: env.now.toISOString() });
  }
}

/**
 * Notes a reply on every run of the lead that has not ended, and wakes the
 * ones that were waiting for a reply or counting the days without one.
 */
export async function markReplied(store: AutoStore, workspaceId: string, contactId: string, reply: { positive: boolean | null; note: string; at: string }): Promise<StoredRun[]> {
  const out: StoredRun[] = [];
  for (const run of await store.activeRuns(workspaceId, { contactId })) {
    const waiting = run.status === "waiting" && (run.waitingOn === "reply" || run.waitingOn === "time");
    out.push(
      await store.updateRun(workspaceId, run.id, {
        repliedAt: reply.at,
        replyPositive: reply.positive,
        replyNote: reply.note.replace(/\s+/g, " ").trim().slice(0, 500),
        ...(waiting ? { status: "running" as const, wakeAt: reply.at, waitingOn: null, waitingFor: null } : {}),
      }),
    );
  }
  return out;
}

export async function handleEvent(env: Env, event: StoredEvent): Promise<void> {
  const { store } = env.deps;
  const ws = env.workspace.workspaceId;
  if (event.own || event.workspaceId !== ws) return;
  const at = env.now.toISOString();
  const text = (v: unknown): string => (typeof v === "string" ? v : "");

  switch (event.type) {
    case "lead_created":
      if (event.contactId) await startRuns(env, event.contactId);
      return;
    case "lead_status_changed": {
      if (!event.contactId) return;
      const to = event.payload.new;
      if (STOPS.includes(to)) {
        for (const run of await store.activeRuns(ws, { contactId: event.contactId })) await stopRun(env, run, `Stopped: the lead was marked ${to === "unqualified" ? "unqualified" : "bad timing"}.`);
      } else if (FORWARD.includes(to) && rank(to) > rank(event.payload.old)) {
        await markReplied(store, ws, event.contactId, { positive: null, note: "A person moved the lead forward.", at });
      }
      return;
    }
    case "activity_logged": {
      if (!event.contactId) return;
      const kind = text(event.payload.activity_type) || "conversation";
      const said = text(event.payload.description);
      // A call nobody answered is someone trying, not the lead replying: the chaser must still go out.
      if (kind === "call" && isUnansweredCallEntry(said)) return;
      await markReplied(store, ws, event.contactId, { positive: null, note: `A ${kind} was logged${said ? `: ${said}` : "."}`, at });
      return;
    }
    case "deal_created": {
      if (!event.contactId || !event.dealId) return;
      for (const run of await store.activeRuns(ws, { contactId: event.contactId })) {
        const won = event.payload.status === "won" && run.status === "waiting" && run.waitingOn === "deal_won";
        if (run.dealId && !won) continue;
        await store.updateRun(ws, run.id, { ...(run.dealId ? {} : { dealId: event.dealId }), ...(won ? { status: "running" as const, wakeAt: at, waitingOn: null, waitingFor: null } : {}) });
      }
      return;
    }
    case "deal_changed": {
      const runs = await store.activeRuns(ws, { contactId: event.contactId, dealId: event.dealId });
      if (event.payload.new_status === "won") {
        for (const run of runs) if (run.status === "waiting" && run.waitingOn === "deal_won") await store.updateRun(ws, run.id, { status: "running", wakeAt: at, waitingOn: null, waitingFor: null });
      } else if (event.payload.new_status === "lost" && event.payload.old_status !== "lost") {
        for (const run of runs) await stopRun(env, run, "Stopped: the deal was marked lost.");
      }
      return;
    }
  }
}
