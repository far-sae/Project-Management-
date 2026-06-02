// supabase/functions/_shared/agent/editConfig.ts
// Per-entity edit configuration + pure patch builders for the bot's `update`
// action. Knows nothing about the DB client — buildPatch returns the column
// map; agentActions applies it. Stage/probability lookup for deals (which
// needs pipeline_stages) is done in agentActions, not here.

import type { Intent } from "./types.ts";

export interface EditCfg {
  entity: string;
  table: string;
  pkCol: string;
  idField: string;
  pickPrefix: string;
  searchCol: string;
  label: string;
}

export const EDIT_CFG: Record<string, EditCfg> = {
  task:        { entity: "task",        table: "tasks",        pkCol: "task_id",   idField: "task_id",        pickPrefix: "picktask",    searchCol: "title",     label: "task" },
  client_task: { entity: "client_task", table: "client_tasks", pkCol: "task_id",   idField: "client_task_id", pickPrefix: "pickctask",   searchCol: "title",     label: "follow-up" },
  deal:        { entity: "deal",        table: "deals",        pkCol: "deal_id",   idField: "deal_id",        pickPrefix: "pickdeal",    searchCol: "title",     label: "deal" },
  lead:        { entity: "lead",        table: "leads",        pkCol: "lead_id",   idField: "lead_id",        pickPrefix: "picklead",    searchCol: "last_name", label: "lead" },
  meeting:     { entity: "meeting",     table: "meetings",     pkCol: "meeting_id",idField: "meeting_id",     pickPrefix: "pickmeeting", searchCol: "title",     label: "meeting" },
};

const TASK_STATUS: Record<string, string> = {
  done: "done", complete: "done", completed: "done", finish: "done", finished: "done",
  "in progress": "inprogress", inprogress: "inprogress", doing: "inprogress", started: "inprogress",
  todo: "todo", "to do": "todo", reopen: "todo", open: "todo", reset: "todo",
  review: "needreview", "needs review": "needreview", needreview: "needreview",
};

const CLIENT_TASK_STATUS: Record<string, string> = {
  done: "done", complete: "done", completed: "done",
  pending: "pending", reopen: "pending", open: "pending",
  snooze: "snoozed", snoozed: "snoozed",
};

const LEAD_STATUS = new Set([
  "new", "attempted_to_contact", "contact_in_future", "contacted", "junk_lead",
  "lost_lead", "not_contacted", "pre_qualified", "not_qualified", "converted",
]);

const MEETING_STATUS: Record<string, string> = {
  cancel: "cancelled", cancelled: "cancelled", canceled: "cancelled",
  held: "held", done: "held", complete: "held", "no show": "no_show", no_show: "no_show",
  scheduled: "scheduled",
};

export const mapTaskStatus = (raw: string | null | undefined): string | null =>
  raw ? (TASK_STATUS[raw.trim().toLowerCase()] ?? null) : null;

export type Patch = Record<string, unknown>;

/** Build the column patch for an entity from the intent's change fields.
 *  `nowIso` is used for completed_at/done_at stamps. Deal stage_id/probability
 *  are NOT set here (needs a pipeline_stages lookup in agentActions). */
export const buildPatch = (entity: string, intent: Intent, nowIso: string): Patch => {
  const patch: Patch = {};
  const norm = (s: string) => s.trim().toLowerCase();
  switch (entity) {
    case "task": {
      const st = mapTaskStatus(intent.status);
      if (st) { patch.status = st; if (st === "done") patch.completed_at = nowIso; }
      if (intent.due) patch.due_date = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      if (intent.priority && ["high", "medium", "low"].includes(norm(intent.priority))) patch.priority = norm(intent.priority);
      break;
    }
    case "client_task": {
      if (intent.status) {
        const st = CLIENT_TASK_STATUS[norm(intent.status)];
        if (st) { patch.status = st; if (st === "done") patch.done_at = nowIso; }
      }
      if (intent.due) patch.due_at = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      break;
    }
    case "deal": {
      if (intent.stage) patch.stage = norm(intent.stage);
      if (typeof intent.value === "number") patch.value = intent.value;
      if (intent.currency) patch.currency = intent.currency.toUpperCase();
      if (intent.due) patch.expected_close_date = intent.due.slice(0, 10);
      break;
    }
    case "lead": {
      if (intent.status && LEAD_STATUS.has(norm(intent.status).replace(/\s+/g, "_"))) {
        patch.lead_status = norm(intent.status).replace(/\s+/g, "_");
      }
      if (intent.email) patch.email = intent.email;
      if (intent.phone) patch.phone = intent.phone;
      break;
    }
    case "meeting": {
      if (intent.status) {
        const st = MEETING_STATUS[norm(intent.status)];
        if (st) patch.status = st;
      }
      if (intent.due) patch.start_at = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      break;
    }
  }
  return patch;
};
