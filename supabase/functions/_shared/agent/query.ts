// supabase/functions/_shared/agent/query.ts
// Read-only queries for the chat bot. runQuery dispatches on intent.entity,
// runs an org-scoped select with optional scope/timeframe/status/stage
// filters, and returns a compact text list (cap 10 + "+N more").

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Intent, LinkedAccount } from "./types.ts";
import { formatLocal } from "./format.ts";

export type AdminLike = Pick<SupabaseClient, "from">;

const CAP = 10;

// Wall-clock offset (minutes) of `tz` at instant `d`: localWall - UTC.
const tzOffsetMinutes = (d: Date, tz: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - d.getTime()) / 60000;
};

// Start of "today" in tz, expressed as a UTC ISO instant.
const startOfTodayUtc = (nowIso: string, tz: string): Date => {
  const now = new Date(nowIso);
  const off = tzOffsetMinutes(now, tz);
  const local = new Date(now.getTime() + off * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - off * 60000);
};

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

export interface Range { gte?: string; lt?: string; }

/** Compute an inclusive-start/exclusive-end UTC range for a timeframe. */
export const timeframeRange = (
  nowIso: string,
  tz: string,
  tf: NonNullable<Intent["timeframe"]>,
): Range => {
  const start = startOfTodayUtc(nowIso, tz);
  switch (tf) {
    case "overdue":   return { lt: start.toISOString() };
    case "today":     return { gte: start.toISOString(), lt: addDays(start, 1).toISOString() };
    case "this_week": return { gte: start.toISOString(), lt: addDays(start, 7).toISOString() };
    case "this_month":return { gte: start.toISOString(), lt: addDays(start, 31).toISOString() };
    case "upcoming":  return { gte: nowIso };
  }
};

interface EntityCfg {
  table: string;
  cols: string;
  dateCol: string;
  ownerCol: string;
  order: { col: string; asc: boolean };
  line: (r: Record<string, unknown>, tz: string) => string;
  extraFilters?: (intent: Intent) => Array<["eq" | "neq" | "in", string, unknown]>;
}

const s = (v: unknown): string => (v == null ? "" : String(v));

const ENTITY: Record<string, EntityCfg> = {
  task: {
    table: "tasks", cols: "title, due_date, status", dateCol: "due_date",
    ownerCol: "created_by", order: { col: "due_date", asc: true },
    line: (r, tz) => `• ${s(r.title)}${r.due_date ? ` — due ${formatLocal(s(r.due_date), tz)}` : ""}`,
    extraFilters: (i) => i.status ? [["eq", "status", i.status]] : [["neq", "status", "done"]],
  },
  client_task: {
    table: "client_tasks", cols: "title, due_at, status", dateCol: "due_at",
    ownerCol: "assigned_to", order: { col: "due_at", asc: true },
    line: (r, tz) => `• ${s(r.title)}${r.due_at ? ` — due ${formatLocal(s(r.due_at), tz)}` : ""}`,
    extraFilters: (i) => i.status ? [["eq", "status", i.status]] : [["neq", "status", "done"]],
  },
  deal: {
    table: "deals", cols: "title, stage, value, currency, expected_close_date",
    dateCol: "expected_close_date", ownerCol: "owner_id", order: { col: "expected_close_date", asc: true },
    line: (r) => `• ${s(r.title)} — ${s(r.stage)}${r.value ? ` · ${s(r.value)} ${s(r.currency)}` : ""}${r.expected_close_date ? ` · closes ${s(r.expected_close_date)}` : ""}`,
    extraFilters: (i) => i.stage ? [["eq", "stage", i.stage.toLowerCase()]] : [],
  },
  lead: {
    table: "leads", cols: "first_name, last_name, company, created_at",
    dateCol: "created_at", ownerCol: "created_by", order: { col: "created_at", asc: false },
    line: (r) => `• ${[s(r.first_name), s(r.last_name)].filter(Boolean).join(" ")} — ${s(r.company)}`,
  },
  client: {
    table: "clients", cols: "name, created_at", dateCol: "created_at",
    ownerCol: "created_by", order: { col: "name", asc: true },
    line: (r) => `• ${s(r.name)}`,
  },
  meeting: {
    table: "meetings", cols: "title, start_at, status", dateCol: "start_at",
    ownerCol: "host_user_id", order: { col: "start_at", asc: true },
    line: (r, tz) => `• ${s(r.title)} — ${formatLocal(s(r.start_at), tz)}`,
  },
  call: {
    table: "calls", cols: "subject, call_status, call_start_at", dateCol: "call_start_at",
    ownerCol: "caller_user_id", order: { col: "call_start_at", asc: false },
    line: (r, tz) => `• ${s(r.subject)} — ${s(r.call_status)}${r.call_start_at ? ` · ${formatLocal(s(r.call_start_at), tz)}` : ""}`,
  },
};

const LABEL: Record<string, string> = {
  task: "tasks", client_task: "follow-ups", deal: "deals", lead: "leads",
  client: "clients", meeting: "meetings", call: "calls",
};

export const runQuery = async (
  admin: AdminLike,
  account: LinkedAccount,
  intent: Intent,
  tz: string,
  nowIso: string,
): Promise<string> => {
  const entity = intent.entity ?? "task";
  const cfg = ENTITY[entity];
  if (!cfg) return "I can list tasks, deals, leads, clients, meetings or calls. Try `show my open tasks`.";

  // deno-lint-ignore no-explicit-any
  let q: any = admin.from(cfg.table).select(cfg.cols).eq("organization_id", account.current_org_id);

  if (intent.scope === "mine") q = q.eq(cfg.ownerCol, account.user_id);
  for (const [op, col, val] of cfg.extraFilters?.(intent) ?? []) q = (q as Record<string, (c: string, v: unknown) => unknown>)[op](col, val);
  if (intent.timeframe) {
    const r = timeframeRange(nowIso, tz, intent.timeframe);
    if (r.gte) q = q.gte(cfg.dateCol, r.gte);
    if (r.lt) q = q.lt(cfg.dateCol, r.lt);
  }
  q = q.order(cfg.order.col, { ascending: cfg.order.asc });

  const { data, error } = await q.limit(CAP + 1);
  if (error) return `Couldn't read ${LABEL[entity]}: ${error.message}`;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return `No ${LABEL[entity]} found.`;

  const shown = rows.slice(0, CAP);
  const lines = shown.map((r) => cfg.line(r, tz));
  const footer = rows.length > CAP ? `\n…and ${rows.length - CAP} more — open TaskCalendar to see all.` : "";
  const header = `*${shown.length}${rows.length > CAP ? "+" : ""} ${LABEL[entity]}${intent.scope === "mine" ? " (yours)" : ""}*`;
  return `${header}\n${lines.join("\n")}${footer}`;
};
