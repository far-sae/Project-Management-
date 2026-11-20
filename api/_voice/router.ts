import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import type { ConfigState, VoiceConfig } from "./config.js";
import { dialable, formatNumber, COUNTRY_NAME, type CallCountry } from "./shared/numbers.js";
import { OUTCOME_LABEL, OUTCOMES, type CallActivityMeta, type CallOutcome, type CallStatus, type StartedCall, type VoiceSetup } from "./shared/types.js";
import type { Call, CallPatch, VoiceStore } from "./store.js";
import { isIdentity } from "./token.js";
import { dialTwiml, emptyTwiml, hangupTwiml, noticeTwiml } from "./twiml.js";

/**
 * The calling server's routes.
 *
 * From the page (signed in):
 *   GET  setup                 can calls be placed, and if not, what is missing
 *   POST calls                 start a call to a lead or a company
 *   POST calls/<id>/end        how the call went, in the caller's words
 *   GET  calls/<id>/recording  the recording, as audio
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
export const NO_WORKSPACE_MESSAGE = "This record is not in a workspace, so its call could not be logged. Add it to a workspace first.";
export const TABLES_MISSING_MESSAGE = "Calling is not set up yet: run supabase/migrations/188_crm_calls.sql in the Supabase SQL editor.";
export const TOO_MANY_MESSAGE = "Too many calls in one minute. Wait a moment, then try again.";
export const NO_RECORDING_MESSAGE = "This call has no recording.";
export const RECORDING_UNAVAILABLE_MESSAGE = "The recording could not be loaded. Please try again.";
export const noNumberMessage = (country: CallCountry): string =>
  `There is no ${COUNTRY_NAME[country]} number to call from yet: add ${country === "GB" ? "TWILIO_NUMBER_UK" : "TWILIO_NUMBER_US"} in Vercel's environment variables.`;

/** Calls one person may start in a minute, and the longest note kept with a call. */
export const CALLS_PER_MINUTE = 6;
export const NOTE_MAX = 2000;
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

export type RouteRequest = { method: string; path: string[]; body: Record<string, unknown>; user: { id: string } };
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

const STATUS_SENTENCE: Partial<Record<CallStatus, string>> = {
  no_answer: "No answer.",
  busy: "The line was busy.",
  failed: "The call did not connect.",
  canceled: "Hung up before it was answered.",
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

async function start(d: VoiceDeps, r: RouteRequest): Promise<RouteResult> {
  const config = readyConfig(d);
  const { contactId, companyId, to, country } = r.body;
  const target = isUuid(contactId) ? await d.store.contact(contactId as string) : isUuid(companyId) ? await d.store.company(companyId as string) : null;
  if (!target) throw new AppError(NOT_FOUND_MESSAGE, 404);
  await refuseUnlessAdmin(d, target.organizationId, r.user.id);
  // The timeline entry a call leaves needs the record's workspace.
  if (!target.workspaceId) throw new AppError(NO_WORKSPACE_MESSAGE, 409);

  const number = dialable(typeof to === "string" ? to : "", country === "US" || country === "GB" ? country : null);
  if (!number.ok) throw new AppError(number.error, 400);
  const from = config.numbers[number.country];
  if (!from) throw new AppError(noNumberMessage(number.country), 409);

  if (!(await d.store.tablesReady())) throw new AppError(TABLES_MISSING_MESSAGE, 503);
  const since = new Date(nowOf(d).getTime() - 60_000).toISOString();
  if ((await d.store.callsSince(r.user.id, since)) >= CALLS_PER_MINUTE) throw new AppError(TOO_MANY_MESSAGE, 429);

  const call = await d.store.insertCall({
    organizationId: target.organizationId,
    workspaceId: target.workspaceId,
    userId: r.user.id,
    contactId: target.kind === "contact" ? target.id : null,
    companyId: target.kind === "company" ? target.id : null,
    toNumber: number.e164,
    fromNumber: from,
    country: number.country,
  });
  const started: StartedCall = { id: call.id, to: call.toNumber, display: formatNumber(call.toNumber), country: call.country, token: d.token(config, r.user.id) };
  return { status: 200, json: started };
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

export async function route(d: VoiceDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    const [a, b, c] = r.path;
    if (r.path.length === 1 && a === "setup" && r.method === "GET") return await setup(d);
    if (r.path.length === 1 && a === "calls" && r.method === "POST") return await start(d, r);
    if (r.path.length === 3 && a === "calls" && c === "end" && r.method === "POST") return await end(d, r, b);
    if (r.path.length === 3 && a === "calls" && c === "recording" && r.method === "GET") return await recording(d, r, b);
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
