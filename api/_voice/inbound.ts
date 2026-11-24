/**
 * When a lead calls back.
 *
 * The calling numbers used to call out only. Now an organisation says who
 * takes the calls that come in: a short list of people and their phone
 * numbers, anywhere in the world. They are rung one after the other. When one
 * does not answer within the ring time (12 seconds unless changed), the next
 * one is rung. A call nobody took is logged as missed, and the owner and
 * admins are told.
 *
 * Whose call it is: the provider's numbers are one set for the whole site, so
 * the caller's number is looked up in the calls that were placed. The
 * organisation that called that number last gets the call. A caller nobody
 * has called goes to the one organisation that has call-backs switched on, or
 * hears that nobody is available when there are several.
 *
 * Taking a call: a mobile's voicemail answers like a person does, and the call
 * would end there. So (unless switched off) the person who picks up hears who
 * is calling and presses any key. Only then are the two connected, and only
 * then does the call count as answered.
 */
import type { Call } from "./store.js";
import type { CallCountry } from "./shared/numbers.js";
import { MAX_CALL_SECONDS, callbackUrl, emptyTwiml, hangupTwiml, xml } from "./twiml.js";

export type ForwardPerson = { name: string; number: string };
export type Forwarding = { enabled: boolean; people: ForwardPerson[]; ringSeconds: number; screen: boolean };

export const DEFAULT_FORWARDING: Forwarding = { enabled: false, people: [], ringSeconds: 12, screen: true };
export const PEOPLE_MAX = 5;
export const RING_MIN = 5;
export const RING_MAX = 60;
/** A phone number in international form: +, country code, number. */
export const E164 = /^\+[1-9]\d{7,14}$/;

/** "+91 98123-45678" as it is kept: "+919812345678". "" when it is not a number in international form. */
export function cleanNumber(typed: unknown): string {
  const digits = typeof typed === "string" ? typed.replace(/[\s().-]/g, "") : "";
  return E164.test(digits) ? digits : "";
}

/** What was sent to be saved, as it will be kept, or the sentence that says what is wrong with it. */
export function readForwarding(input: Record<string, unknown>): { value: Forwarding; problem: string | null } {
  const raw = Array.isArray(input.people) ? input.people : [];
  const people: ForwardPerson[] = [];
  let problem: string | null = null;
  for (const item of raw.slice(0, PEOPLE_MAX + 1)) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 60) : "";
    const typed = typeof row.number === "string" ? row.number.trim() : "";
    if (!name && !typed) continue;
    const number = cleanNumber(typed);
    if (!number) problem = problem ?? `The number of ${name || "one person"} must be in international form, starting with + and the country code. For example +91 98123 45678.`;
    else if (people.some((p) => p.number === number)) problem = problem ?? "The same number is in the list twice.";
    else people.push({ name: name || "Team", number });
  }
  if (raw.length > PEOPLE_MAX) problem = problem ?? `At most ${PEOPLE_MAX} people can take call-backs.`;
  const seconds = Math.round(Number(input.ringSeconds));
  const ringSeconds = Number.isFinite(seconds) ? Math.min(RING_MAX, Math.max(RING_MIN, seconds)) : DEFAULT_FORWARDING.ringSeconds;
  const enabled = input.enabled === true;
  if (enabled && people.length === 0) problem = problem ?? "Add at least one person with a phone number before switching call-backs on.";
  return { value: { enabled, people, ringSeconds, screen: input.screen !== false }, problem };
}

/** A stored row as the app works with it. Anything odd falls back to the default. */
export function forwardingOf(row: Record<string, unknown> | null): Forwarding {
  if (!row) return { ...DEFAULT_FORWARDING };
  const people = (Array.isArray(row.people) ? row.people : []).map((item) => {
    const p = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return { name: typeof p.name === "string" ? p.name : "", number: cleanNumber(p.number) };
  }).filter((p) => p.number).slice(0, PEOPLE_MAX);
  const seconds = Math.round(Number(row.ring_seconds));
  return {
    enabled: row.enabled === true && people.length > 0, people,
    ringSeconds: Number.isFinite(seconds) ? Math.min(RING_MAX, Math.max(RING_MIN, seconds)) : DEFAULT_FORWARDING.ringSeconds,
    screen: row.screen !== false,
  };
}

// ── What the provider is told ────────────────────────────────────────────

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

export const RECORDED_NOTICE = "This call may be recorded.";
export const NOBODY_FREE = "Thank you for calling. Nobody can take your call right now. We will call you back.";

/** Ring one person. The caller keeps hearing ringing until somebody has taken the call. */
export function ringTwiml(a: { base: string; callId: string; index: number; person: ForwardPerson; callerId: string; seconds: number; screen: boolean; notice: boolean }): string {
  const at = `&i=${a.index}`;
  return (
    HEAD +
    "<Response>" +
    (a.notice ? `<Say>${xml(RECORDED_NOTICE)}</Say>` : "") +
    `<Dial callerId="${xml(a.callerId)}" answerOnBridge="true" timeout="${a.seconds}" timeLimit="${MAX_CALL_SECONDS}"` +
    ` record="record-from-answer-dual" recordingStatusCallback="${xml(callbackUrl(a.base, "recording", a.callId))}" recordingStatusCallbackEvent="completed"` +
    ` action="${xml(callbackUrl(a.base, "next", a.callId, at))}" method="POST">` +
    (a.screen
      ? `<Number url="${xml(callbackUrl(a.base, "screen", a.callId, at))}" method="POST">${xml(a.person.number)}</Number>`
      : `<Number>${xml(a.person.number)}</Number>`) +
    "</Dial>" +
    "</Response>"
  );
}

/** What the person who picked up hears: who is calling, and to press a key. No key within ten seconds: the phone is put down again. */
export function screenTwiml(a: { base: string; callId: string; index: number; who: string }): string {
  return (
    HEAD +
    "<Response>" +
    `<Gather numDigits="1" timeout="10" action="${xml(callbackUrl(a.base, "accept", a.callId, `&i=${a.index}`))}" method="POST">` +
    `<Say>Call back from ${xml(a.who)}. Press any key to answer.</Say>` +
    "</Gather>" +
    "<Hangup/>" +
    "</Response>"
  );
}

// ── The provider's requests ──────────────────────────────────────────────

export const INBOUND_WEBHOOKS = ["incoming", "next", "screen", "accept"] as const;
export type InboundWebhook = (typeof INBOUND_WEBHOOKS)[number];

export type IncomingCall = Pick<Call, "organizationId" | "workspaceId" | "userId" | "contactId" | "companyId" | "fromNumber" | "toNumber" | "country"> & { callSid: string | null };

/** What the call-backs need from the database. */
export interface InboundStore {
  forwarding(organizationId: string): Promise<Forwarding>;
  /** The organisations that have call-backs switched on. */
  forwardingOrgs(): Promise<string[]>;
  /** The last call we placed to this number: whose lead it is. */
  lastCallTo(number: string): Promise<Pick<Call, "organizationId" | "workspaceId" | "userId" | "contactId" | "companyId"> | null>;
  orgOwner(organizationId: string): Promise<string | null>;
  /** The owner and the admins of an organisation. */
  orgAdmins(organizationId: string): Promise<string[]>;
  insertIncoming(call: IncomingCall): Promise<Call>;
  getCall(id: string): Promise<Call | null>;
  patchCall(id: string, patch: { status?: Call["status"]; seconds?: number; endedAt?: string; answeredBy?: string }): Promise<Call | null>;
  /** The name of the lead or company a call belongs to, or "". */
  nameOf(call: Pick<Call, "contactId" | "companyId">): Promise<string>;
  /** A notice in the bell of each person. */
  notify(userIds: string[], title: string, message: string, link: string): Promise<void>;
}

export type InboundDeps = {
  store: InboundStore;
  /** Our own numbers, by the country they belong to. */
  numbers: Partial<Record<CallCountry, string>>;
  now: () => Date;
  /** Writes (or rewrites) the call's timeline entry. */
  writeEntry: (call: Call) => Promise<void>;
};

export type InboundRequest = { what: InboundWebhook; base: string; query: Record<string, string>; params: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const indexOf = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < PEOPLE_MAX ? n : 0;
};

/** What the provider says about the caller's own line once it is closed. */
const CALLER_GONE = ["completed", "canceled", "failed", "busy", "no-answer"];

/** A caller's number as the provider sends it, when it is a real one. "anonymous" and the like give "". */
const callerOf = (from: string | undefined): string => (typeof from === "string" && E164.test(from) ? from : "");

/** Which of our numbers was called, and the country it belongs to. Null for a number that is not ours. */
function ourNumber(numbers: InboundDeps["numbers"], to: string | undefined): { number: string; country: CallCountry } | null {
  for (const country of ["US", "GB"] as CallCountry[]) if (numbers[country] && numbers[country] === to) return { number: numbers[country] as string, country };
  return null;
}

async function missed(d: InboundDeps, call: Call): Promise<string> {
  const saved = (await d.store.patchCall(call.id, { status: "no_answer", seconds: 0, endedAt: d.now().toISOString() })) ?? call;
  await d.writeEntry(saved).catch(() => undefined);
  try {
    const who = (await d.store.nameOf(saved)) || saved.fromNumber;
    const link = saved.contactId ? `/crm/contacts/${saved.contactId}` : saved.companyId ? `/crm/companies/${saved.companyId}` : "/calls";
    await d.store.notify(await d.store.orgAdmins(saved.organizationId), "Missed call", `${who} called back and nobody answered.`, link);
  } catch {
    /* the call is logged; a notice that could not be written is not worth failing for */
  }
  return hangupTwiml(NOBODY_FREE);
}

/** Answers one request of the provider about a call that came in. The caller has already checked the signature. */
export async function inboundWebhook(d: InboundDeps, r: InboundRequest): Promise<string> {
  if (r.what === "incoming") {
    const ours = ourNumber(d.numbers, r.params.To);
    if (!ours) return hangupTwiml();
    const from = callerOf(r.params.From);
    const last = from ? await d.store.lastCallTo(from) : null;
    let organizationId = last?.organizationId ?? null;
    if (!organizationId) {
      // Nobody has called this number. With one organisation taking call-backs, it is theirs.
      const orgs = await d.store.forwardingOrgs();
      organizationId = orgs.length === 1 ? orgs[0] : null;
    }
    if (!organizationId) return hangupTwiml(NOBODY_FREE);
    const forwarding = await d.store.forwarding(organizationId);
    const userId = last?.userId ?? (await d.store.orgOwner(organizationId));
    const sid = typeof r.params.CallSid === "string" && /^CA[0-9a-fA-F]{32}$/.test(r.params.CallSid) ? r.params.CallSid : null;

    // Written down first, so a call that is missed is still on record.
    let call: Call | null = null;
    if (userId && from) {
      try {
        call = await d.store.insertIncoming({
          organizationId, workspaceId: last?.workspaceId ?? null, userId, contactId: last?.contactId ?? null, companyId: last?.companyId ?? null,
          fromNumber: from, toNumber: ours.number, country: ours.country, callSid: sid,
        });
      } catch {
        call = null;
      }
    }
    if (!forwarding.enabled || forwarding.people.length === 0) return call ? missed(d, call) : hangupTwiml(NOBODY_FREE);
    // Without a row there is nothing for the later steps to hold on to: the first person is rung, with no second try.
    if (!call) {
      return `${HEAD}<Response><Dial callerId="${xml(ours.number)}" answerOnBridge="true" timeout="${forwarding.ringSeconds}" timeLimit="${MAX_CALL_SECONDS}"><Number>${xml(forwarding.people[0].number)}</Number></Dial></Response>`;
    }
    return ringTwiml({ base: r.base, callId: call.id, index: 0, person: forwarding.people[0], callerId: ours.number, seconds: forwarding.ringSeconds, screen: forwarding.screen, notice: true });
  }

  const call = UUID.test(r.query.call ?? "") ? await d.store.getCall(r.query.call) : null;
  if (!call || call.direction !== "in") return r.what === "screen" ? hangupTwiml() : emptyTwiml();
  const forwarding = await d.store.forwarding(call.organizationId);
  const index = indexOf(r.query.i);
  const person = forwarding.people[index];

  if (r.what === "screen") {
    return screenTwiml({ base: r.base, callId: call.id, index, who: (await d.store.nameOf(call)) || "a customer" });
  }

  if (r.what === "accept") {
    // A key was pressed: this person takes the call. An empty answer lets the two be connected.
    await d.store.patchCall(call.id, { status: "completed", answeredBy: person?.name ?? "Team" });
    return emptyTwiml();
  }

  // next: the ringing of one person is over.
  const again = (await d.store.getCall(call.id)) ?? call;
  const answered = forwarding.screen ? Boolean(again.answeredBy) : ["completed", "answered"].includes(r.params.DialCallStatus);
  if (answered) {
    const seconds = Math.max(0, Math.round(Number(r.params.DialCallDuration) || 0));
    const saved = (await d.store.patchCall(call.id, {
      status: "completed", seconds, endedAt: d.now().toISOString(), ...(again.answeredBy ? {} : { answeredBy: person?.name ?? "Team" }),
    })) ?? again;
    await d.writeEntry(saved).catch(() => undefined);
    return hangupTwiml();
  }
  // The caller put the phone down while it rang: there is nobody left to connect.
  if (CALLER_GONE.includes(r.params.CallStatus)) return missed(d, again);
  const next = forwarding.people[index + 1];
  if (forwarding.enabled && next) {
    return ringTwiml({ base: r.base, callId: call.id, index: index + 1, person: next, callerId: call.toNumber, seconds: forwarding.ringSeconds, screen: forwarding.screen, notice: false });
  }
  return missed(d, again);
}

// ── Pointing the numbers at this server ──────────────────────────────────

/**
 * Tells the provider to ask this server what to do when one of our numbers is
 * called. True when every number we have was set. The owner can also do this
 * by hand in the provider's console (the screen says how when this fails).
 */
export async function linkNumbers(a: { fetch: typeof fetch; accountSid: string; authToken: string; numbers: Partial<Record<CallCountry, string>>; base: string }): Promise<boolean> {
  const auth = { Authorization: "Basic " + Buffer.from(`${a.accountSid}:${a.authToken}`).toString("base64") };
  const root = `https://api.twilio.com/2010-04-01/Accounts/${a.accountSid}/IncomingPhoneNumbers`;
  const numbers = [...new Set(Object.values(a.numbers).filter((n): n is string => Boolean(n)))];
  if (numbers.length === 0) return false;
  let all = true;
  for (const number of numbers) {
    try {
      const found = await a.fetch(`${root}.json?PhoneNumber=${encodeURIComponent(number)}`, { headers: { ...auth, Accept: "application/json" } });
      const list = found.ok ? ((await found.json()) as { incoming_phone_numbers?: Array<{ sid?: string }> }) : {};
      const sid = list.incoming_phone_numbers?.[0]?.sid;
      if (!sid || !/^PN[0-9a-fA-F]{32}$/.test(sid)) { all = false; continue; }
      const body = new URLSearchParams({ VoiceUrl: `${a.base}/api/voice?path=incoming`, VoiceMethod: "POST", VoiceApplicationSid: "" });
      const set = await a.fetch(`${root}/${sid}.json`, { method: "POST", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!set.ok) all = false;
    } catch {
      all = false;
    }
  }
  return all;
}

/** The address the owner puts in the provider's console, when it could not be set from here. */
export const incomingAddress = (base: string): string => `${base}/api/voice?path=incoming`;
