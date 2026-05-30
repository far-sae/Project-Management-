// src/services/supabase/activities.ts
//
// Activities-hub aggregator. The Activities page wants a single
// list/kanban of "things that happened or are scheduled" across three
// source tables (client_tasks, meetings, calls). This module fetches
// all three, normalizes them into a unified Activity type, and
// exposes the standard Zoho-style filter views.

import { getOrganizationClientTasks, type ClientTask, type ClientTaskPriority } from "./clientTasks";
import { listMeetings, type Meeting } from "./meetings";
import { listCalls, type Call, type CallStatus } from "./calls";

export type ActivityKind = "task" | "meeting" | "call";

/** Zoho-style filter views on the Activities page dropdown. Each
 *  resolves to a predicate the page applies after the union fetch. */
export type ActivityFilterView =
  | "all"
  | "my_activities"
  | "my_open_activities"
  | "my_meetings"
  | "my_open_tasks"
  | "my_closed_tasks"
  | "closed_activities"
  | "closed_tasks"
  | "my_calls"
  | "my_attended_calls"
  | "my_missed_calls"
  | "my_cancelled_calls"
  | "my_outgoing_calls"
  | "my_incoming_calls"
  | "my_scheduled_calls"
  | "my_todays_scheduled_calls"
  | "my_overdue_calls"
  | "attended_calls"
  | "cancelled_calls"
  | "incoming_calls"
  | "missed_calls";

export interface ActivityFilterOption {
  value: ActivityFilterView;
  label: string;
  group: "all" | "tasks" | "calls" | "meetings";
}

// Every view that ships with the page. Order mirrors Zoho's dropdown
// roughly — frequent ones first, then call sub-views grouped together.
export const ACTIVITY_FILTERS: ActivityFilterOption[] = [
  { value: "all",                       label: "All Activities",            group: "all" },
  { value: "my_activities",             label: "My Activities",             group: "all" },
  { value: "my_open_activities",        label: "My Open Activities",        group: "all" },
  { value: "closed_activities",         label: "Closed Activities",         group: "all" },
  { value: "my_meetings",               label: "My Meetings",               group: "meetings" },
  { value: "my_open_tasks",             label: "My Open Tasks",             group: "tasks" },
  { value: "my_closed_tasks",           label: "My Closed Tasks",           group: "tasks" },
  { value: "closed_tasks",              label: "Closed Tasks",              group: "tasks" },
  { value: "my_calls",                  label: "My Calls",                  group: "calls" },
  { value: "my_attended_calls",         label: "My Attended Calls",         group: "calls" },
  { value: "my_missed_calls",           label: "My Missed Calls",           group: "calls" },
  { value: "my_cancelled_calls",        label: "My Cancelled Calls",        group: "calls" },
  { value: "my_outgoing_calls",         label: "My Outgoing Calls",         group: "calls" },
  { value: "my_incoming_calls",         label: "My Incoming Calls",         group: "calls" },
  { value: "my_scheduled_calls",        label: "My Scheduled Calls",        group: "calls" },
  { value: "my_todays_scheduled_calls", label: "My Today's Scheduled Calls", group: "calls" },
  { value: "my_overdue_calls",          label: "My Overdue Calls",          group: "calls" },
  { value: "attended_calls",            label: "Attended Calls",            group: "calls" },
  { value: "cancelled_calls",           label: "Cancelled Calls",           group: "calls" },
  { value: "incoming_calls",            label: "Incoming Calls",            group: "calls" },
  { value: "missed_calls",              label: "Missed Calls",              group: "calls" },
];

/** Kanban grouping the Activities page uses by default — mirrors Zoho's
 *  "Customers / Open Deals / Leads/Contacts / Others" columns. */
export type ActivityCategory = "customers" | "open_deals" | "leads_contacts" | "others";

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  customers: "Customers",
  open_deals: "Open Deals",
  leads_contacts: "Leads/Contacts",
  others: "Others",
};

/** The shared shape every Activity card / row reads. Source rows are
 *  always reachable via `.source` if a screen wants to render kind-
 *  specific extras (e.g. a meeting's participants chips). */
export interface Activity {
  id: string;                 // <kind>:<rowId>, unique across the union
  kind: ActivityKind;
  organizationId: string;
  workspaceId: string | null;
  title: string;              // task title / meeting title / call subject
  description: string | null;
  /** When the activity happens (or happened). Tasks use dueAt; meetings
   *  use startAt; calls use callStartAt. Null = no time set. */
  whenAt: Date | null;
  /** Computed: is this overdue (past + still pending). Used by filters
   *  and to colour-code the row. */
  overdue: boolean;
  /** "Open" = something still requires action. Tasks pending, meetings
   *  scheduled, calls scheduled. Closed = done / held / completed /
   *  cancelled / no_show / missed. */
  open: boolean;
  /** UUID of the user this activity belongs to (assignee/host/caller).
   *  Used for "My …" filters. */
  ownerUserId: string | null;
  ownerName: string | null;
  /** Display priority for tasks; meetings & calls fall back to "normal". */
  priority: ClientTaskPriority;
  /** Stable category for the kanban grouping. */
  category: ActivityCategory;
  /** Display string for the related entity ("Acme Corp", "Website redesign
   *  deal", "Jack Fisher"). Empty when there's no relationship. */
  relatedToLabel: string | null;
  /** Underlying source — discriminated union so callers can drill in. */
  source:
    | { kind: "task";    row: ClientTask }
    | { kind: "meeting"; row: Meeting }
    | { kind: "call";    row: Call };
}

interface BuildContext {
  /** When set, deals[].dealId in this set is considered "open" — used to
   *  bucket activities into "Open Deals" vs "Customers" / "Others".
   *  Pass an empty Set if you don't have deal status loaded yet. */
  openDealIds: Set<string>;
  /** Same but for client IDs that are 'customer' type. */
  customerClientIds: Set<string>;
}

const categorize = (
  hasOpenDeal: boolean,
  hasCustomerClient: boolean,
  hasClientOrDealLink: boolean,
): ActivityCategory => {
  if (hasOpenDeal) return "open_deals";
  if (hasCustomerClient) return "customers";
  if (hasClientOrDealLink) return "leads_contacts";
  return "others";
};

const taskToActivity = (t: ClientTask, ctx: BuildContext): Activity => {
  const whenAt = t.dueAt ?? null;
  const open = t.status === "pending" || t.status === "snoozed";
  const overdue = Boolean(open && whenAt && whenAt.getTime() < Date.now());
  const hasOpenDeal = Boolean(t.dealId && ctx.openDealIds.has(t.dealId));
  const hasCustomer = Boolean(t.clientId && ctx.customerClientIds.has(t.clientId));
  return {
    id: `task:${t.taskId}`,
    kind: "task",
    organizationId: t.organizationId,
    workspaceId: null,
    title: t.title,
    description: t.description ?? null,
    whenAt,
    overdue,
    open,
    ownerUserId: t.assignedTo ?? null,
    ownerName: t.assignedToName ?? null,
    priority: t.priority ?? "normal",
    category: categorize(hasOpenDeal, hasCustomer, Boolean(t.dealId || t.clientId)),
    relatedToLabel: null,
    source: { kind: "task", row: t },
  };
};

const meetingToActivity = (m: Meeting, ctx: BuildContext): Activity => {
  const open = m.status === "scheduled";
  const overdue = Boolean(open && m.startAt.getTime() < Date.now());
  const hasOpenDeal = Boolean(m.dealId && ctx.openDealIds.has(m.dealId));
  const hasCustomer = Boolean(m.clientId && ctx.customerClientIds.has(m.clientId));
  return {
    id: `meeting:${m.meetingId}`,
    kind: "meeting",
    organizationId: m.organizationId,
    workspaceId: m.workspaceId,
    title: m.title,
    description: m.description ?? null,
    whenAt: m.startAt,
    overdue,
    open,
    ownerUserId: m.hostUserId ?? null,
    ownerName: m.hostName ?? null,
    priority: "normal",
    category: categorize(hasOpenDeal, hasCustomer, Boolean(m.dealId || m.clientId)),
    relatedToLabel: m.location ?? null,
    source: { kind: "meeting", row: m },
  };
};

const callToActivity = (c: Call, ctx: BuildContext): Activity => {
  const open = c.callStatus === "scheduled";
  const overdue = Boolean(open && c.callStartAt && c.callStartAt.getTime() < Date.now());
  const hasOpenDeal = Boolean(c.dealId && ctx.openDealIds.has(c.dealId));
  const hasCustomer = Boolean(c.clientId && ctx.customerClientIds.has(c.clientId));
  return {
    id: `call:${c.callId}`,
    kind: "call",
    organizationId: c.organizationId,
    workspaceId: c.workspaceId,
    title: c.subject,
    description: c.description ?? null,
    whenAt: c.callStartAt,
    overdue,
    open,
    ownerUserId: c.callerUserId ?? null,
    ownerName: c.callerName ?? null,
    priority: "normal",
    category: categorize(hasOpenDeal, hasCustomer, Boolean(c.dealId || c.clientId)),
    relatedToLabel: c.contactName ?? c.contactPhone ?? null,
    source: { kind: "call", row: c },
  };
};

/** Pull all three sources in parallel + map into the unified shape. */
export const listActivities = async (
  organizationId: string,
  ctx: BuildContext,
): Promise<Activity[]> => {
  const [tasks, meetings, calls] = await Promise.all([
    getOrganizationClientTasks(organizationId).catch(() => [] as ClientTask[]),
    listMeetings(organizationId).catch(() => [] as Meeting[]),
    listCalls(organizationId).catch(() => [] as Call[]),
  ]);
  const out: Activity[] = [
    ...tasks.map((t) => taskToActivity(t, ctx)),
    ...meetings.map((m) => meetingToActivity(m, ctx)),
    ...calls.map((c) => callToActivity(c, ctx)),
  ];
  // Open + nearest first; closed sorted newest first; nulls last.
  out.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    const at = a.whenAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.whenAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return a.open ? at - bt : bt - at;
  });
  return out;
};

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** Apply one of the predefined filter views. `myUserId` is required for
 *  the "My …" variants; pass null for global views. */
export const applyActivityFilter = (
  activities: Activity[],
  view: ActivityFilterView,
  myUserId: string | null,
): Activity[] => {
  const mine = (a: Activity) => myUserId !== null && a.ownerUserId === myUserId;
  const isCallStatus = (a: Activity, status: CallStatus) =>
    a.kind === "call" && a.source.kind === "call" && a.source.row.callStatus === status;
  const isCallType = (a: Activity, type: Call["callType"]) =>
    a.kind === "call" && a.source.kind === "call" && a.source.row.callType === type;

  switch (view) {
    case "all":
      return activities;
    case "my_activities":
      return activities.filter(mine);
    case "my_open_activities":
      return activities.filter((a) => mine(a) && a.open);
    case "closed_activities":
      return activities.filter((a) => !a.open);
    case "my_meetings":
      return activities.filter((a) => mine(a) && a.kind === "meeting");
    case "my_open_tasks":
      return activities.filter((a) => mine(a) && a.kind === "task" && a.open);
    case "my_closed_tasks":
      return activities.filter((a) => mine(a) && a.kind === "task" && !a.open);
    case "closed_tasks":
      return activities.filter((a) => a.kind === "task" && !a.open);
    case "my_calls":
      return activities.filter((a) => mine(a) && a.kind === "call");
    case "my_attended_calls":
      return activities.filter((a) => mine(a) && isCallStatus(a, "completed"));
    case "my_missed_calls":
      return activities.filter((a) => mine(a) && isCallStatus(a, "missed"));
    case "my_cancelled_calls":
      return activities.filter((a) => mine(a) && isCallStatus(a, "cancelled"));
    case "my_outgoing_calls":
      return activities.filter((a) => mine(a) && isCallType(a, "outbound"));
    case "my_incoming_calls":
      return activities.filter((a) => mine(a) && isCallType(a, "inbound"));
    case "my_scheduled_calls":
      return activities.filter((a) => mine(a) && isCallStatus(a, "scheduled"));
    case "my_todays_scheduled_calls": {
      const lo = startOfDay().getTime();
      const hi = endOfDay().getTime();
      return activities.filter((a) =>
        mine(a) && isCallStatus(a, "scheduled") && a.whenAt &&
        a.whenAt.getTime() >= lo && a.whenAt.getTime() <= hi,
      );
    }
    case "my_overdue_calls":
      return activities.filter((a) => mine(a) && a.kind === "call" && a.overdue);
    case "attended_calls":
      return activities.filter((a) => isCallStatus(a, "completed"));
    case "cancelled_calls":
      return activities.filter((a) => isCallStatus(a, "cancelled"));
    case "incoming_calls":
      return activities.filter((a) => isCallType(a, "inbound"));
    case "missed_calls":
      return activities.filter((a) => isCallStatus(a, "missed"));
    default:
      return activities;
  }
};

/** Group activities into the 4 kanban columns. */
export const groupByCategory = (activities: Activity[]): Record<ActivityCategory, Activity[]> => {
  const out: Record<ActivityCategory, Activity[]> = {
    customers: [], open_deals: [], leads_contacts: [], others: [],
  };
  for (const a of activities) out[a.category].push(a);
  return out;
};
