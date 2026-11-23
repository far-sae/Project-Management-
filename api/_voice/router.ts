import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { orgMayCall, type ConfigState, type VoiceConfig } from "./config.js";
import { dialable, formatNumber, COUNTRY_NAME, type CallCountry } from "./shared/numbers.js";
import { NO_REASON_DETAIL, OUTCOME_LABEL, OUTCOMES, STATUS_SENTENCE, type CallActivityMeta, type CallList, type CallResult, type CallListItem, type CallOutcome, type CallStatus, type StartedCall, type VoiceSetup } from "./shared/types.js";
import type { Call, CallPatch, VoiceStore } from "./store.js";
import { isIdentity } from "./token.js";
import { dialTwiml, emptyTwiml, hangupTwiml, noticeTwiml, RING_SECONDS } from "./twiml.js";

/**
 * The calling server's routes.
 *
 * From the page (signed in):
 *   GET  setup                 can calls be placed, and if not, what is missing
 *   GET  calls                 the calls of a workspace, newest first, with how the month went
 *   POST calls                 start a call to a lead, a company, or (the dialer) any number for a workspace
 *   POST calls/<id>/end        how the call went, in the caller's words
 *   GET  calls/<id>/recording  the recording, as audio
 *   GET  calls/<id>/result     why the call ended, as the phone provider reported it
 *   DELETE calls/<id>          remove a call, its recording and its timeline entry (the owner only)
 *   GET  contacts/<id>/calls   the calls made to one lead, for a copy of that person's data
 *   DELETE contacts/<id>/calls remove every call made to one lead, with the recordings (the owner only)
 * From the phone provider (checked by its signature in api/voice.ts):
 *   twiml      what to ring for a call a browser just placed
 *   notice     what the person called hears first
 *   done       the call is over: how long, and how it ended
 *   recording  the recording is ready
 *
 * Only an organisation's owner and admins may place calls and hear recordings.
 */

export const OWNER_ONLY_MESSAGE = "Only the owner and admins can place calls.";
export const NOT_FOUND_MESSAGE = "This lead or company is not in your CRM.";
export const CALL_NOT_FOUND_MESSAGE = "This call was not found.";
export const ORG_NOT_ALLOWED_MESSAGE = "Calling is not switched on for this organisation.";
export const LEAD_NOT_FOUND_MESSAGE = "This lead was not found.";
export const CHOOSE_WORKSPACE_MESSAGE = "Choose a workspace.";
export const CALLS_OWNER_ONLY_MESSAGE = "Only the owner and admins can see calls.";
export const NO_WORKSPACE_MESSAGE = "This record is not in a workspace, so its call could not be logged. Add it to a workspace first.";
export const TABLES_MISSING_MESSAGE = "Calling is not set up yet: run supabase/migrations/188_crm_calls.sql in the Supabase SQL editor.";
export const TOO_MANY_MESSAGE = "Too many calls in one minute. Wait a moment, then try again.";
export const NO_RECORDING_MESSAGE = "This call has no recording.";
export { NO_REASON_DETAIL };
export const RECORDING_UNAVAILABLE_MESSAGE = "The recording could not be loaded. Please try again.";
export const DELETE_OWNER_ONLY_MESSAGE = "Only the owner can delete a call.";
export const CALL_IN_PROGRESS_MESSAGE = "This call is still in progress. Delete it once it has ended.";
export const RECORDING_NOT_DELETED_MESSAGE = "The recording could not be deleted at the phone provider, so the call was kept. Please try again.";
export const noNumberMessage = (country: CallCountry): string =>
  `There is no ${COUNTRY_NAME[country]} number to call from yet: add ${country === "GB" ? "TWILIO_NUMBER_UK" : "TWILIO_NUMBER_US"} in Vercel's environment variables.`;

/** Calls one person may start in a minute, and the longest note kept with a call. */
export const CALLS_PER_MINUTE = 6;
export const NOTE_MAX = 2000;
/** Calls on one page of the list, and the days the summary above it covers. */
export const PAGE_SIZE = 50;
export const SUMMARY_DAYS = 30;
/** How long after "Call" was pressed the browser may still connect it. */
export const START_WINDOW_MS = 5 * 60_000;

export type VoiceDeps = {
  store: VoiceStore;
  config: () => ConfigState;
  /** The short-lived pass for one browser call. */
  token: (config: VoiceConfig, userId: string) => string;
  fetch: typeof fetch;
  /** Asks the provider whether the settings really work; a sentence naming what is wrong, or null. Nothing is asked when omitted. */
  check?: (config: VoiceConfig) => Promise<string | null>;
  now?: () => Date;
};

export type RouteRequest = { method: string; path: string[]; body: Record<string, unknown>; query?: Record<string, string>; user: { id: string } };
export type MediaStream = { type: string; length: string | null; body: ReadableStream<Uint8Array> };
export type RouteResult = { status: number; json?: unknown; media?: MediaStream };

const nowOf = (d: VoiceDeps): Date => (d.now ? d.now() : new Date());

function readyConfig(d: VoiceDeps): VoiceConfig {
  const state = d.config();
  if (!state.config) throw new AppError(state.problem ?? "Calling is not set up yet.", 503);
  return state.config;
}

async function refuseUnlessAdmin(d: VoiceDeps, organizationId: string, userId: string): Promise<void> {
  const role = await d.store.orgRole(organizationId, userId);
  if (role !== "owner" && role !== "admin") throw new AppError(OWNER_ONLY_MESSAGE, 403);
}

const DURATION = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
};

/** The timeline entry of a call: who was rung, how long, how it went, then the caller's own note. */
export function describeCall(call: Pick<Call, "toNumber" | "seconds" | "status" | "outcome" | "note">): string {
  const parts = [`Called ${formatNumber(call.toNumber)}.`];
  if (call.seconds > 0) parts.push(`${DURATION(call.seconds)}.`);
  if (call.outcome) parts.push(`${OUTCOME_LABEL[call.outcome]}.`);
  else if (STATUS_SENTENCE[call.status] && call.seconds === 0) parts.push(STATUS_SENTENCE[call.status] as string);
  const note = call.note.trim();
  return note ? `${parts.join(" ")}\n${note}` : parts.join(" ");
}

const metaOf = (call: Call): CallActivityMeta => ({
  callId: call.id,
  to: call.toNumber,
  country: call.country,
  status: call.status,
  seconds: call.seconds,
  outcome: call.outcome,
  recorded: Boolean(call.recordingSid),
});

/**
 * Writes the call's timeline entry from the row as it now stands. The
 * provider's report and the caller's own note can arrive together, so the row
 * is read once more afterwards and the entry rewritten if it moved on.
 */
async function writeEntry(d: VoiceDeps, call: Call): Promise<void> {
  // A number dialled by hand that is nobody's has no timeline to be written on. The call is on the Calls page.
  if (!call.contactId && !call.companyId) return;
  await d.store.saveActivity(call, describeCall(call), metaOf(call));
  const again = await d.store.getCall(call.id);
  if (again && again.updatedAt !== call.updatedAt) await d.store.saveActivity(again, describeCall(again), metaOf(again));
}

async function setup(d: VoiceDeps): Promise<RouteResult> {
  const state = d.config();
  const out: VoiceSetup = { configured: state.configured, ready: false, problem: state.problem, numbers: { US: false, GB: false } };
  if (state.config) {
    out.numbers = { US: Boolean(state.config.numbers.US), GB: Boolean(state.config.numbers.GB) };
    if (!(await d.store.tablesReady())) out.problem = TABLES_MISSING_MESSAGE;
    else {
      // Settings of the right shape can still be refused by the provider: say which one, before anyone calls.
      out.problem = d.check ? await d.check(state.config) : null;
      out.ready = !out.problem;
    }
  }
  return { status: 200, json: out };
}

/** The calls of a workspace, for its organisation's owner and admins. */
async function list(d: VoiceDeps, r: RouteRequest): Promise<RouteResult> {
  const workspaceId = r.query?.workspaceId;
  const organizationId = isUuid(workspaceId) ? await d.store.workspaceOrg(workspaceId as string) : null;
  const role = organizationId ? await d.store.orgRole(organizationId, r.user.id) : null;
  // An outsider learns nothing about whether the workspace exists.
  if (!organizationId || !role) throw new AppError(CHOOSE_WORKSPACE_MESSAGE, 403);
  if (role !== "owner" && role !== "admin") throw new AppError(CALLS_OWNER_ONLY_MESSAGE, 403);
  if (!(await d.store.tablesReady())) throw new AppError(TABLES_MISSING_MESSAGE, 503);

  const before = typeof r.query?.before === "string" && !Number.isNaN(Date.parse(r.query.before)) ? new Date(r.query.before).toISOString() : undefined;
  const since = new Date(nowOf(d).getTime() - SUMMARY_DAYS * 24 * 3600_000).toISOString();
  const [rows, results] = await Promise.all([
    d.store.listCalls(workspaceId as string, { before, limit: PAGE_SIZE + 1 }),
    d.store.callResults(workspaceId as string, since),
  ]);
  const page = rows.slice(0, PAGE_SIZE);
  const unique = (ids: Array<string | null>) => [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = await d.store.names({
    contacts: unique(page.map((c) => c.contactId)),
    companies: unique(page.map((c) => c.companyId)),
    users: unique(page.map((c) => c.userId)),
  });
  const calls: CallListItem[] = page.map((c) => ({
    id: c.id,
    at: c.createdAt,
    status: c.status,
    seconds: c.seconds,
    outcome: c.outcome,
    note: c.note,
    to: c.toNumber,
    display: formatNumber(c.toNumber),
    country: c.country,
    recorded: Boolean(c.recordingSid),
    contact: c.contactId && c.contactId in names.contacts ? { id: c.contactId, name: names.contacts[c.contactId] } : null,
    company: c.companyId && c.companyId in names.companies ? { id: c.companyId, name: names.companies[c.companyId] } : null,
    caller: { id: c.userId, name: names.users[c.userId] ?? "" },
  }));
  const answered = results.filter((x) => x.status === "completed" && x.seconds > 0);
  const out: CallList = {
    calls,
    more: rows.length > PAGE_SIZE,
    summary: { days: SUMMARY_DAYS, total: results.length, answered: answered.length, seconds: answered.reduce((sum, x) => sum + x.seconds, 0) },
  };
  return { status: 200, json: out };
}

async function start(d: VoiceDeps, r: RouteRequest): Promise<RouteResult> {
  const config = readyConfig(d);
  const { contactId, companyId, workspaceId, to, country } = r.body;
  let target = isUuid(contactId) ? await d.store.contact(contactId as string) : isUuid(companyId) ? await d.store.company(companyId as string) : null;
  // The dialer: a number typed by hand, for a workspace, with no record behind it (yet).
  const dialled = !target && contactId === undefined && companyId === undefined && workspaceId !== undefined;
  if (dialled) {
    const organizationId = isUuid(workspaceId) ? await d.store.workspaceOrg(workspaceId as string) : null;
    const role = organizationId ? await d.store.orgRole(organizationId, r.user.id) : null;
    // An outsider learns nothing about whether the workspace exists.
    if (!organizationId || !role) throw new AppError(CHOOSE_WORKSPACE_MESSAGE, 403);
    target = { kind: "contact", id: "", organizationId, workspaceId: workspaceId as string };
  }
  if (!target) throw new AppError(NOT_FOUND_MESSAGE, 404);
  await refuseUnlessAdmin(d, target.organizationId, r.user.id);
  // The phone account is one for the whole site: when a list of organisations is set, only they may spend it.
  if (!orgMayCall(config, target.organizationId)) throw new AppError(ORG_NOT_ALLOWED_MESSAGE, 403);
  // The timeline entry a call leaves needs the record's workspace.
  if (!target.workspaceId) throw new AppError(NO_WORKSPACE_MESSAGE, 409);

  const number = dialable(typeof to === "string" ? to : "", country === "US" || country === "GB" ? country : null);
  if (!number.ok) throw new AppError(number.error, 400);
  const from = config.numbers[number.country];
  if (!from) throw new AppError(noNumberMessage(number.country), 409);

  if (!(await d.store.tablesReady())) throw new AppError(TABLES_MISSING_MESSAGE, 503);
  const since = new Date(nowOf(d).getTime() - 60_000).toISOString();
  if ((await d.store.callsSince(r.user.id, since)) >= CALLS_PER_MINUTE) throw new AppError(TOO_MANY_MESSAGE, 429);

  // A dialled number that is a lead's becomes that lead's call, so it lands on their timeline.
  const matched = dialled ? await leadWithNumber(d, target.workspaceId, number.e164, number.country) : null;
  const call = await d.store.insertCall({
    organizationId: target.organizationId,
    workspaceId: target.workspaceId,
    userId: r.user.id,
    contactId: dialled ? (matched?.id ?? null) : target.kind === "contact" ? target.id : null,
    companyId: !dialled && target.kind === "company" ? target.id : null,
    toNumber: number.e164,
    fromNumber: from,
    country: number.country,
  });
  const started: StartedCall = {
    id: call.id,
    to: call.toNumber,
    display: formatNumber(call.toNumber),
    country: call.country,
    token: d.token(config, r.user.id),
    contact: matched,
  };
  return { status: 200, json: started };
}

/**
 * The lead of the workspace whose phone is this number, however it was typed
 * on the lead ("020 7946 0958" and "+44 20 7946 0958" are one phone). The
 * oldest lead wins when two share a number. Never fails the call: when the
 * leads cannot be read, the number is simply nobody's.
 */
async function leadWithNumber(d: VoiceDeps, workspaceId: string, e164: string, country: "US" | "GB"): Promise<{ id: string; name: string } | null> {
  try {
    const found = (await d.store.leadPhones(workspaceId)).find((lead) => {
      const theirs = dialable(lead.phone, country);
      return theirs.ok && theirs.e164 === e164;
    });
    if (!found) return null;
    const names = await d.store.names({ contacts: [found.id], companies: [], users: [] });
    return { id: found.id, name: names.contacts[found.id] ?? "" };
  } catch {
    return null;
  }
}

/** The caller's own call, or 404; and they must still be an owner or admin. */
async function ownCall(d: VoiceDeps, id: string, userId: string): Promise<Call> {
  const call = isUuid(id) ? await d.store.getCall(id) : null;
  if (!call) throw new AppError(CALL_NOT_FOUND_MESSAGE, 404);
  await refuseUnlessAdmin(d, call.organizationId, userId);
  return call;
}

async function end(d: VoiceDeps, r: RouteRequest, id: string): Promise<RouteResult> {
  const call = await ownCall(d, id, r.user.id);
  if (call.userId !== r.user.id) throw new AppError(CALL_NOT_FOUND_MESSAGE, 404);
  const patch: CallPatch = {};
  const { outcome, note, seconds, answered } = r.body;
  if (outcome === null || (typeof outcome === "string" && (OUTCOMES as readonly string[]).includes(outcome))) patch.outcome = outcome as CallOutcome | null;
  if (typeof note === "string") patch.note = note.trim().slice(0, NOTE_MAX);
  // The provider's own report decides how the call ended and how long it was. Only when it has
  // not arrived does the browser's count stand in, so a call is never left without an entry.
  if (!call.endedAt) {
    const s = typeof seconds === "number" && Number.isFinite(seconds) ? Math.min(Math.max(0, Math.round(seconds)), 24 * 3600) : 0;
    patch.status = answered === true && s > 0 ? "completed" : "canceled";
    patch.seconds = answered === true ? s : 0;
    patch.endedAt = nowOf(d).toISOString();
  }
  const saved = (await d.store.patchCall(call.id, patch)) ?? call;
  await writeEntry(d, saved);
  return { status: 200, json: { ok: true } };
}

async function recording(d: VoiceDeps, r: RouteRequest, id: string): Promise<RouteResult> {
  const config = readyConfig(d);
  const call = await ownCall(d, id, r.user.id);
  if (!call.recordingSid || !/^RE[0-9a-fA-F]{32}$/.test(call.recordingSid)) throw new AppError(NO_RECORDING_MESSAGE, 404);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Recordings/${call.recordingSid}.mp3`;
  let reply: Response;
  try {
    reply = await d.fetch(url, { headers: { Authorization: "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") } });
  } catch {
    throw new AppError(RECORDING_UNAVAILABLE_MESSAGE, 502);
  }
  if (!reply.ok || !reply.body) throw new AppError(RECORDING_UNAVAILABLE_MESSAGE, reply.status === 404 ? 404 : 502);
  return { status: 200, media: { type: "audio/mpeg", length: reply.headers.get("content-length"), body: reply.body as ReadableStream<Uint8Array> } };
}

/** How a call that was not answered ended, in one sentence for the caller. */
const RESULT_SENTENCE: Partial<Record<CallStatus, string>> = {
  no_answer: `Nobody answered within ${RING_SECONDS} seconds.`,
  busy: "The line was busy.",
  failed: "The phone company did not connect this call.",
  canceled: "The call ended before it was answered.",
};

/**
 * The provider blocks the call itself. For a United States or Canada number
 * the usual reason is that the provider account has no approved business
 * profile: without one it refuses every +1 number, while other countries work.
 */
const BLOCKED_HINT =
  "The provider blocks this call. For a United States or Canada number this usually means the provider account has no approved business profile yet: in the provider's console open Trust Hub, Customer Profiles, and submit a Primary Customer Profile. If one is approved already, ask the provider's support to review this number.";

/** What to do about the provider's most common refusals. Read by the people who run the site. */
const REFUSAL_HINT: Record<string, string> = {
  "13227": "Calls to this country are switched off in the provider's account: open Voice, Settings, Geo permissions there and allow the country.",
  "21215": "Calls to this country are switched off in the provider's account: open Voice, Settings, Geo permissions there and allow the country.",
  "21219": "The provider's account is a trial account, which can only call numbers verified in it: upgrade the account, or verify this number in it.",
  "14111": "The provider's account is a trial account, which can only call numbers verified in it: upgrade the account, or verify this number in it.",
  "13214": "The number we call from is not accepted as caller ID: check that it is a number of this provider account.",
  "13223": "The provider cannot call this number: it is not a valid phone number.",
  "13224": "The provider cannot call this number: it is not valid, or the provider does not reach it.",
  "13225": BLOCKED_HINT,
  "21216": BLOCKED_HINT,
};

/** The provider's own words, made short and plain: they can arrive as a form ("Msg=...&ErrorCode=..."). */
function providerWords(raw: unknown): string {
  let words = typeof raw === "string" ? raw : "";
  if (/(^|&)Msg=/.test(words)) words = new URLSearchParams(words).get("Msg") ?? "";
  return words.replace(/[^ -~]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 200).replace(/[.\s]+$/, "");
}

/** Why the provider refused a call, from its own log of that call. Null when it cannot be read. */
async function refusalDetail(d: VoiceDeps, config: VoiceConfig, callSid: string): Promise<string | null> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${callSid}/Notifications.json?PageSize=20`;
    const reply = await d.fetch(url, { headers: { Authorization: "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") } });
    if (!reply.ok) return null;
    const body = (await reply.json()) as { notifications?: Array<Record<string, unknown>> };
    const all = Array.isArray(body?.notifications) ? body.notifications : [];
    const found = all.find((n) => /^\d{3,6}$/.test(String(n?.error_code ?? "")));
    if (!found) return null;
    const code = String(found.error_code);
    const words = providerWords(found.message_text);
    return [`Phone provider error ${code}${words ? `: ${words}` : ""}.`, REFUSAL_HINT[code] ?? ""].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

/**
 * Why a call ended. The call window only knows that the line closed; the
 * provider knows whether nobody answered, the line was busy, or it refused to
 * place the call at all. For a refusal the provider's own reason is fetched,
 * so the people who run the site can read it without opening its console.
 */
async function result(d: VoiceDeps, r: RouteRequest, id: string): Promise<RouteResult> {
  const call = await ownCall(d, id, r.user.id);
  const final = Boolean(call.endedAt);
  const out: CallResult = { final, status: call.status, sentence: final ? RESULT_SENTENCE[call.status] ?? null : null, detail: null };
  if (final && call.status === "failed") {
    const config = d.config().config;
    const known = config && call.callSid && /^CA[0-9a-fA-F]{32}$/.test(call.callSid) ? await refusalDetail(d, config, call.callSid) : null;
    out.detail = known ?? NO_REASON_DETAIL;
  }
  return { status: 200, json: out };
}

/** How long a call may stay "ringing" before it counts as over (the longest call, and a little more). */
const STALE_MS = 3 * 60 * 60_000;

/**
 * Removes a call for good: its recording at the phone provider first, then the
 * call and the entry it left on the timeline. The organisation's owner only.
 * When the recording cannot be removed nothing is deleted, so no recording is
 * ever left behind without the call it belongs to.
 */
async function remove(d: VoiceDeps, r: RouteRequest, id: string): Promise<RouteResult> {
  const call = isUuid(id) ? await d.store.getCall(id) : null;
  const role = call ? await d.store.orgRole(call.organizationId, r.user.id) : null;
  // Someone outside the organisation gets the same answer as for a call that does not exist.
  if (!call || !role) throw new AppError(CALL_NOT_FOUND_MESSAGE, 404);
  if (role !== "owner") throw new AppError(DELETE_OWNER_ONLY_MESSAGE, 403);
  const age = nowOf(d).getTime() - new Date(call.createdAt).getTime();
  if (!call.endedAt && (call.status === "starting" || call.status === "ringing") && age < STALE_MS) throw new AppError(CALL_IN_PROGRESS_MESSAGE, 409);

  await removeCall(d, call);
  return { status: 200, json: { ok: true } };
}

/** Removes a call: its recording at the provider first, then the call and its timeline entry. */
async function removeCall(d: VoiceDeps, call: Call): Promise<void> {
  if (call.recordingSid && /^RE[0-9a-fA-F]{32}$/.test(call.recordingSid)) {
    const config = readyConfig(d);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Recordings/${call.recordingSid}.json`;
    let status = 0;
    try {
      const reply = await d.fetch(url, { method: "DELETE", headers: { Authorization: "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") } });
      status = reply.status;
    } catch {
      status = 0;
    }
    // 404: the provider no longer has it, which is what was wanted.
    if (!(status >= 200 && status < 300) && status !== 404) throw new AppError(RECORDING_NOT_DELETED_MESSAGE, 502);
  }
  await d.store.deleteCall(call.id);
}

/** The lead and the asker's role in its organisation. An outsider gets the same answer as for a lead that does not exist. */
async function leadFor(d: VoiceDeps, r: RouteRequest, contactId: string): Promise<{ role: "owner" | "admin" | "member" }> {
  const lead = isUuid(contactId) ? await d.store.contact(contactId) : null;
  const role = lead ? await d.store.orgRole(lead.organizationId, r.user.id) : null;
  if (!lead || !role) throw new AppError(LEAD_NOT_FOUND_MESSAGE, 404);
  return { role: role as "owner" | "admin" | "member" };
}

/**
 * GET contacts/<id>/calls: the calls made to one lead, for a copy of that
 * person's data. Owner and admins, like every other view of calls. An empty
 * list while calling was never set up: there are no calls to tell of.
 */
async function personCalls(d: VoiceDeps, r: RouteRequest, contactId: string): Promise<RouteResult> {
  const { role } = await leadFor(d, r, contactId);
  if (role !== "owner" && role !== "admin") throw new AppError(CALLS_OWNER_ONLY_MESSAGE, 403);
  if (!(await d.store.tablesReady())) return { status: 200, json: { calls: [] } };
  const calls = (await d.store.callsOfContact(contactId)).filter((c) => c.status !== "starting");
  return {
    status: 200,
    json: {
      calls: calls.map((c) => ({ id: c.id, at: c.createdAt, to: c.toNumber, status: c.status, outcome: c.outcome, seconds: c.seconds, note: c.note, recorded: Boolean(c.recordingSid) })),
    },
  };
}

/**
 * DELETE contacts/<id>/calls: every call made to one lead, with its recording,
 * for when the person is erased. The organisation's owner only. It stops at the
 * first recording the provider will not delete; what is left can be tried again.
 */
async function removePersonCalls(d: VoiceDeps, r: RouteRequest, contactId: string): Promise<RouteResult> {
  const { role } = await leadFor(d, r, contactId);
  if (role !== "owner") throw new AppError(DELETE_OWNER_ONLY_MESSAGE, 403);
  if (!(await d.store.tablesReady())) return { status: 200, json: { deleted: 0 } };
  let deleted = 0;
  for (const call of await d.store.callsOfContact(contactId)) {
    await removeCall(d, call);
    deleted += 1;
  }
  return { status: 200, json: { deleted } };
}

export async function route(d: VoiceDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    const [a, b, c] = r.path;
    if (r.path.length === 1 && a === "setup" && r.method === "GET") return await setup(d);
    if (r.path.length === 1 && a === "calls" && r.method === "GET") return await list(d, r);
    if (r.path.length === 1 && a === "calls" && r.method === "POST") return await start(d, r);
    if (r.path.length === 2 && a === "calls" && r.method === "DELETE") return await remove(d, r, b);
    if (r.path.length === 3 && a === "calls" && c === "end" && r.method === "POST") return await end(d, r, b);
    if (r.path.length === 3 && a === "calls" && c === "recording" && r.method === "GET") return await recording(d, r, b);
    if (r.path.length === 3 && a === "calls" && c === "result" && r.method === "GET") return await result(d, r, b);
    if (r.path.length === 3 && a === "contacts" && c === "calls" && r.method === "GET") return await personCalls(d, r, b);
    if (r.path.length === 3 && a === "contacts" && c === "calls" && r.method === "DELETE") return await removePersonCalls(d, r, b);
    return { status: 404, json: { error: "not found" } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    throw e;
  }
}

// ── The phone provider's requests ───────────────────────────────────────────

export const WEBHOOKS = ["twiml", "notice", "done", "recording"] as const;
export type Webhook = (typeof WEBHOOKS)[number];

export type WebhookRequest = {
  what: Webhook;
  /** The origin the provider reached us at; its later requests for this call come back to the same one. */
  base: string;
  query: Record<string, string>;
  /** The form fields the provider sent. */
  params: Record<string, string>;
};

/** The provider's words for how a dialled call ended, as ours. */
const DIAL_STATUS: Record<string, CallStatus> = {
  completed: "completed",
  answered: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

const SORRY = "Sorry, this call could not be placed.";

/** Answers one request from the provider with TwiML. The caller has already checked the signature. */
export async function webhook(d: VoiceDeps, r: WebhookRequest): Promise<string> {
  const state = d.config();
  const config = state.config;
  if (!config || r.params.AccountSid !== config.accountSid) return hangupTwiml();

  if (r.what === "notice") return noticeTwiml(r.query.country === "GB" ? "GB" : "US");

  if (r.what === "twiml") {
    // The browser sends only the id of the call it was given; what to ring comes from our own row.
    const id = r.params.callId;
    const call = isUuid(id) ? await d.store.getCall(id) : null;
    const fresh = call ? nowOf(d).getTime() - new Date(call.createdAt).getTime() <= START_WINDOW_MS : false;
    if (!call || call.status !== "starting" || !fresh || !isIdentity(r.params.From, call.userId)) return hangupTwiml(SORRY);
    const role = await d.store.orgRole(call.organizationId, call.userId);
    if (role !== "owner" && role !== "admin") return hangupTwiml(SORRY);
    const sid = typeof r.params.CallSid === "string" && /^CA[0-9a-fA-F]{32}$/.test(r.params.CallSid) ? r.params.CallSid : null;
    await d.store.patchCall(call.id, { status: "ringing", callSid: sid });
    return dialTwiml({ base: r.base, callId: call.id, to: call.toNumber, callerId: call.fromNumber, country: call.country });
  }

  const call = isUuid(r.query.call) ? await d.store.getCall(r.query.call) : null;
  if (!call) return emptyTwiml();

  if (r.what === "done") {
    const status = DIAL_STATUS[r.params.DialCallStatus] ?? "failed";
    const seconds = status === "completed" ? Math.max(0, Math.round(Number(r.params.DialCallDuration) || 0)) : 0;
    const saved = (await d.store.patchCall(call.id, { status, seconds, endedAt: nowOf(d).toISOString() })) ?? call;
    await writeEntry(d, saved);
    return hangupTwiml();
  }

  // recording
  const sid = r.params.RecordingSid;
  if (r.params.RecordingStatus === "completed" && typeof sid === "string" && /^RE[0-9a-fA-F]{32}$/.test(sid)) {
    const saved = (await d.store.patchCall(call.id, { recordingSid: sid, recordingSeconds: Math.max(0, Math.round(Number(r.params.RecordingDuration) || 0)) })) ?? call;
    // The entry exists once the call is over; a recording that arrives first is picked up when it is written.
    if (saved.endedAt) await writeEntry(d, saved);
  }
  return emptyTwiml();
}
