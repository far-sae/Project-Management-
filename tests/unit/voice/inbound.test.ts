// @vitest-environment node
// When a lead calls one of our numbers back: who is rung, in which order, how
// long each phone rings, what counts as answered, and what is kept of a call
// nobody took.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORWARDING, NOBODY_FREE, cleanNumber, forwardingOf, inboundWebhook, incomingAddress, linkNumbers, readForwarding,
  type Forwarding, type InboundDeps, type InboundStore, type InboundWebhook,
} from "../../../api/_voice/inbound";
import { CALL_BACKS_NOT_SET_UP_MESSAGE, CALL_BACKS_OWNER_ONLY_MESSAGE, describeCall, route, type VoiceDeps } from "../../../api/_voice/router";
import type { VoiceStore } from "../../../api/_voice/store";
import type { Call } from "../../../api/_voice/store";

const BASE = "https://app.example.com";
const US = "+14155550100";
const CALLER = "+14155550132";
const ORG = "22222222-2222-4222-8222-222222222222";
const PRIYA = { name: "Priya", number: "+919812345678" };
const SAM = { name: "Sam", number: "+447700900123" };
const NOW = new Date("2026-11-25T15:00:00Z");

function setUp(over: { forwarding?: Partial<Forwarding>; called?: boolean; orgs?: string[]; insertFails?: boolean } = {}) {
  const forwarding: Forwarding = { enabled: true, people: [PRIYA, SAM], ringSeconds: 12, screen: true, ...over.forwarding };
  const calls = new Map<string, Call>();
  const entries: Call[] = [];
  const notices: Array<{ users: string[]; title: string; message: string; link: string }> = [];
  let n = 0;
  const store: InboundStore = {
    forwarding: async () => forwarding,
    forwardingOrgs: async () => over.orgs ?? [ORG],
    lastCallTo: async (number) => (over.called === false || number !== CALLER ? null : { organizationId: ORG, workspaceId: "ws-1", userId: "u-caller", contactId: "lead-1", companyId: null }),
    orgOwner: async () => "u-owner",
    orgAdmins: async () => ["u-owner", "u-admin"],
    insertIncoming: async (c) => {
      if (over.insertFails) throw new Error("column direction does not exist");
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const call: Call = {
        id, organizationId: c.organizationId, workspaceId: c.workspaceId, userId: c.userId, contactId: c.contactId, companyId: c.companyId,
        toNumber: c.toNumber, fromNumber: c.fromNumber, country: c.country, status: "ringing", callSid: c.callSid, seconds: 0, recordingSid: null, recordingSeconds: 0,
        outcome: null, note: "", createdAt: NOW.toISOString(), endedAt: null, updatedAt: NOW.toISOString(), direction: "in", answeredBy: null,
      };
      calls.set(id, call);
      return call;
    },
    getCall: async (id) => calls.get(id) ?? null,
    patchCall: async (id, patch) => {
      const call = calls.get(id);
      if (!call) return null;
      Object.assign(call, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return call;
    },
    nameOf: async (call) => (call.contactId === "lead-1" ? "Elena Rossi" : ""),
    notify: async (users, title, message, link) => { notices.push({ users, title, message, link }); },
  };
  const deps: InboundDeps = { store, numbers: { US, GB: "+442079460958" }, now: () => NOW, writeEntry: async (call) => { entries.push({ ...call }); } };
  const ask = (what: InboundWebhook, query: Record<string, string> = {}, params: Record<string, string> = {}) => inboundWebhook(deps, { what, base: BASE, query, params });
  const ring = () => ask("incoming", {}, { From: CALLER, To: US, CallSid: `CA${"a".repeat(32)}` });
  const only = () => [...calls.values()][0];
  return { ask, ring, calls, entries, notices, only };
}
const numbersRung = (twiml: string) => [...twiml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((m) => m[1]);
const attr = (twiml: string, name: string) => (twiml.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1]?.replace(/&amp;/g, "&");

describe("who takes call-backs, as it is saved", () => {
  it("keeps numbers in international form, with a name for each", () => {
    expect(cleanNumber("+91 98123-45678")).toBe("+919812345678");
    expect(cleanNumber("09812345678")).toBe("");
    const read = readForwarding({ enabled: true, people: [{ name: " Priya ", number: "+91 98123 45678" }, { name: "", number: "" }, { name: "Sam", number: "+44 7700 900123" }], ringSeconds: 12, screen: true });
    expect(read).toEqual({ value: { enabled: true, people: [PRIYA, SAM], ringSeconds: 12, screen: true }, problem: null });
  });

  it("says what is wrong, in words for the person", () => {
    expect(readForwarding({ enabled: true, people: [{ name: "Priya", number: "98123 45678" }] }).problem).toBe("The number of Priya must be in international form, starting with + and the country code. For example +91 98123 45678.");
    expect(readForwarding({ enabled: true, people: [] }).problem).toBe("Add at least one person with a phone number before switching call-backs on.");
    expect(readForwarding({ enabled: false, people: [PRIYA, { name: "Again", number: PRIYA.number }] }).problem).toBe("The same number is in the list twice.");
    expect(readForwarding({ enabled: false, people: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, number: `+9198123456${i}0` })) }).problem).toBe("At most 5 people can take call-backs.");
  });

  it("keeps the ring time between five seconds and a minute, twelve unless said", () => {
    expect(readForwarding({ people: [PRIYA] }).value.ringSeconds).toBe(12);
    expect(readForwarding({ people: [PRIYA], ringSeconds: 2 }).value.ringSeconds).toBe(5);
    expect(readForwarding({ people: [PRIYA], ringSeconds: 500 }).value.ringSeconds).toBe(60);
  });

  it("reads a stored row, and is off when there is none or nobody to ring", () => {
    expect(forwardingOf(null)).toEqual(DEFAULT_FORWARDING);
    expect(forwardingOf({ enabled: true, people: [], ring_seconds: 12, screen: true }).enabled).toBe(false);
    expect(forwardingOf({ enabled: true, people: [PRIYA, { name: "Bad", number: "12" }], ring_seconds: 20, screen: false })).toEqual({ enabled: true, people: [PRIYA], ringSeconds: 20, screen: false });
  });
});

describe("a call comes in", () => {
  it("rings the first person for twelve seconds, shows our own number, and writes the call down", async () => {
    const s = setUp();
    const twiml = await s.ring();
    expect(numbersRung(twiml)).toEqual([PRIYA.number]);
    expect(attr(twiml, "timeout")).toBe("12");
    expect(attr(twiml, "callerId")).toBe(US);
    expect(attr(twiml, "answerOnBridge")).toBe("true");
    expect(twiml).toContain("This call may be recorded.");
    const call = s.only();
    expect(call).toMatchObject({ direction: "in", status: "ringing", organizationId: ORG, workspaceId: "ws-1", contactId: "lead-1", userId: "u-caller", fromNumber: CALLER, toNumber: US, country: "US" });
    // The provider comes back here when the ringing is over, and asks here what the person who picks up should hear.
    expect(attr(twiml, "action")).toBe(`${BASE}/api/voice?path=next&call=${call.id}&i=0`);
    expect(twiml).toContain(`path=screen&amp;call=${call.id}&amp;i=0`);
  });

  it("hands over to the next person when the first does not take it", async () => {
    const s = setUp();
    await s.ring();
    const id = s.only().id;
    const twiml = await s.ask("next", { call: id, i: "0" }, { DialCallStatus: "no-answer" });
    expect(numbersRung(twiml)).toEqual([SAM.number]);
    expect(attr(twiml, "timeout")).toBe("12");
    expect(attr(twiml, "action")).toBe(`${BASE}/api/voice?path=next&call=${id}&i=1`);
    // The notice is spoken once, not before every person.
    expect(twiml).not.toContain("This call may be recorded.");
  });

  it("rings them the other way round when the list is the other way round", async () => {
    const s = setUp({ forwarding: { people: [SAM, PRIYA] } });
    expect(numbersRung(await s.ring())).toEqual([SAM.number]);
    expect(numbersRung(await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "no-answer" }))).toEqual([PRIYA.number]);
  });

  it("uses the ring time that was set", async () => {
    const s = setUp({ forwarding: { ringSeconds: 20 } });
    expect(attr(await s.ring(), "timeout")).toBe("20");
  });
});

describe("taking the call", () => {
  it("tells the person who picks up who is calling, and connects only after a key", async () => {
    const s = setUp();
    await s.ring();
    const id = s.only().id;
    const whisper = await s.ask("screen", { call: id, i: "0" });
    expect(whisper).toContain("Call back from Elena Rossi. Press any key to answer.");
    expect(whisper).toContain("<Hangup/>");
    expect(attr(whisper, "action")).toBe(`${BASE}/api/voice?path=accept&call=${id}&i=0`);
    expect(s.only().answeredBy).toBeNull();
    expect(await s.ask("accept", { call: id, i: "0" })).toContain("<Response/>");
    expect(s.only()).toMatchObject({ answeredBy: "Priya", status: "completed" });
  });

  it("logs an answered call with who took it and how long it was", async () => {
    const s = setUp();
    await s.ring();
    const id = s.only().id;
    await s.ask("accept", { call: id, i: "0" });
    const end = await s.ask("next", { call: id, i: "0" }, { DialCallStatus: "completed", DialCallDuration: "184" });
    expect(end).toContain("<Hangup/>");
    expect(s.only()).toMatchObject({ status: "completed", seconds: 184, answeredBy: "Priya", endedAt: NOW.toISOString() });
    expect(s.entries).toHaveLength(1);
    expect(describeCall(s.entries[0])).toBe("Call back from +1 (415) 555-0132. Answered by Priya. 3 min 4 s.");
    expect(s.notices).toEqual([]);
  });

  it("does not count a phone's voicemail as a person: no key, so the next one is rung", async () => {
    const s = setUp();
    await s.ring();
    // The voicemail picked up, so the provider says "completed", but nobody pressed a key.
    const twiml = await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "completed", DialCallDuration: "9" });
    expect(numbersRung(twiml)).toEqual([SAM.number]);
    expect(s.only().status).toBe("ringing");
  });

  it("with the key switched off, connects as soon as somebody picks up", async () => {
    const s = setUp({ forwarding: { screen: false } });
    const twiml = await s.ring();
    expect(twiml).not.toContain("path=screen");
    await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "completed", DialCallDuration: "60" });
    expect(s.only()).toMatchObject({ status: "completed", seconds: 60, answeredBy: "Priya" });
  });
});

describe("a call nobody took", () => {
  it("is logged as missed, the caller is told, and the owner and admins get a notice", async () => {
    const s = setUp();
    await s.ring();
    const id = s.only().id;
    await s.ask("next", { call: id, i: "0" }, { DialCallStatus: "no-answer" });
    const end = await s.ask("next", { call: id, i: "1" }, { DialCallStatus: "busy" });
    expect(end).toContain(NOBODY_FREE);
    expect(end).toContain("<Hangup/>");
    expect(s.only()).toMatchObject({ status: "no_answer", seconds: 0, answeredBy: null });
    expect(describeCall(s.entries[0])).toBe("Missed call back from +1 (415) 555-0132.");
    expect(s.notices).toEqual([{ users: ["u-owner", "u-admin"], title: "Missed call", message: "Elena Rossi called back and nobody answered.", link: "/crm/contacts/lead-1" }]);
  });

  it("stops ringing people when the caller has put the phone down, and logs the call as missed", async () => {
    const s = setUp();
    await s.ring();
    // The provider reports the end of the ringing, and that the caller's own line is closed.
    const end = await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "no-answer", CallStatus: "completed" });
    expect(numbersRung(end)).toEqual([]);
    expect(s.only()).toMatchObject({ status: "no_answer", answeredBy: null });
    expect(s.notices).toHaveLength(1);
  });

  it("keeps ringing the next person while the caller is still on the line", async () => {
    const s = setUp();
    await s.ring();
    const twiml = await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "no-answer", CallStatus: "in-progress" });
    expect(numbersRung(twiml)).toEqual([SAM.number]);
    expect(s.notices).toEqual([]);
  });

  it("is still written down while call-backs are switched off", async () => {
    const s = setUp({ forwarding: { enabled: false } });
    const twiml = await s.ring();
    expect(numbersRung(twiml)).toEqual([]);
    expect(twiml).toContain(NOBODY_FREE);
    expect(s.only().status).toBe("no_answer");
    expect(s.notices).toHaveLength(1);
  });
});

describe("whose call it is", () => {
  it("goes to the one organisation that takes call-backs when the caller was never called", async () => {
    const s = setUp({ called: false });
    expect(numbersRung(await s.ring())).toEqual([PRIYA.number]);
    // Nobody called this number, so the call belongs to the owner and to no lead.
    expect(s.only()).toMatchObject({ userId: "u-owner", contactId: null, workspaceId: null });
  });

  it("rings nobody when several organisations could be meant, or none", async () => {
    for (const orgs of [[ORG, "33333333-3333-4333-8333-333333333333"], []]) {
      const s = setUp({ called: false, orgs });
      const twiml = await s.ring();
      expect(numbersRung(twiml)).toEqual([]);
      expect(twiml).toContain(NOBODY_FREE);
      expect(s.calls.size).toBe(0);
    }
  });

  it("answers nothing for a number that is not ours", async () => {
    const s = setUp();
    const twiml = await s.ask("incoming", {}, { From: CALLER, To: "+12025550199" });
    expect(numbersRung(twiml)).toEqual([]);
    expect(s.calls.size).toBe(0);
  });

  it("still rings the first person when the call could not be written down", async () => {
    const s = setUp({ insertFails: true });
    expect(numbersRung(await s.ring())).toEqual([PRIYA.number]);
  });

  it("does nothing for a call it does not know, or one we placed ourselves", async () => {
    const s = setUp();
    expect(numbersRung(await s.ask("next", { call: "99999999-9999-4999-8999-999999999999", i: "0" }, { DialCallStatus: "no-answer" }))).toEqual([]);
    expect(numbersRung(await s.ask("next", { call: "1 or 1=1", i: "0" }, {}))).toEqual([]);
    await s.ring();
    s.only().direction = "out";
    expect(numbersRung(await s.ask("next", { call: s.only().id, i: "0" }, { DialCallStatus: "no-answer" }))).toEqual([]);
  });
});

describe("pointing our numbers at this server", () => {
  const twilio = (reply: (url: string, init?: { method?: string; body?: string }) => { status?: number; json?: unknown }) => {
    const calls: Array<{ url: string; method: string; body: string; auth: string }> = [];
    const fetchFn = (async (url: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? "", auth: init?.headers?.Authorization ?? "" });
      const r = reply(String(url), init);
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  };
  const SID = `PN${"b".repeat(32)}`;

  it("finds each number at the provider and gives it this server's address for incoming calls", async () => {
    const t = twilio((url) => (url.includes("PhoneNumber=") ? { json: { incoming_phone_numbers: [{ sid: SID }] } } : { json: {} }));
    expect(await linkNumbers({ fetch: t.fetchFn, accountSid: "AC1", authToken: "tok", numbers: { US }, base: BASE })).toBe(true);
    expect(t.calls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(US)}`);
    expect(t.calls[1]).toMatchObject({ url: `https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers/${SID}.json`, method: "POST" });
    expect(new URLSearchParams(t.calls[1].body).get("VoiceUrl")).toBe(incomingAddress(BASE));
    expect(new URLSearchParams(t.calls[1].body).get("VoiceMethod")).toBe("POST");
    expect(t.calls[0].auth).toBe("Basic " + Buffer.from("AC1:tok").toString("base64"));
  });

  it("says so when a number was not found or the provider refused", async () => {
    expect(await linkNumbers({ fetch: twilio(() => ({ json: { incoming_phone_numbers: [] } })).fetchFn, accountSid: "AC1", authToken: "tok", numbers: { US }, base: BASE })).toBe(false);
    expect(await linkNumbers({ fetch: twilio((url) => (url.includes("PhoneNumber=") ? { json: { incoming_phone_numbers: [{ sid: SID }] } } : { status: 401 })).fetchFn, accountSid: "AC1", authToken: "tok", numbers: { US }, base: BASE })).toBe(false);
    expect(await linkNumbers({ fetch: twilio(() => ({})).fetchFn, accountSid: "AC1", authToken: "tok", numbers: {}, base: BASE })).toBe(false);
  });
});

describe("the settings, for the owner and admins", () => {
  const WS = "11111111-1111-4111-8111-111111111111";
  const SID = `PN${"b".repeat(32)}`;
  function settings(over: { role?: string | null; ready?: boolean; site?: string | null } = {}) {
    let stored: Forwarding = { ...DEFAULT_FORWARDING };
    const asked: string[] = [];
    const store = {
      workspaceOrg: async (id: string) => (id === WS ? ORG : null),
      orgRole: async () => (over.role === undefined ? "owner" : over.role),
      forwardingReady: async () => over.ready ?? true,
      forwarding: async () => stored,
      saveForwarding: async (_org: string, value: Forwarding) => { stored = value; },
    } as unknown as VoiceStore;
    const deps: VoiceDeps = {
      store,
      config: () => ({ configured: true, problem: null, config: { accountSid: "AC1", authToken: "tok", apiKeySid: "SK", apiKeySecret: "s", appSid: "AP", numbers: { US }, allowedOrgs: [] } }) as never,
      token: () => "t",
      fetch: (async (url: unknown) => {
        asked.push(String(url));
        return new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: SID }] }), { status: 200 });
      }) as unknown as typeof fetch,
      site: () => (over.site === undefined ? BASE : over.site),
    };
    const get = () => route(deps, { method: "GET", path: ["callbacks"], body: {}, query: { workspaceId: WS }, user: { id: "u1" } });
    const save = (body: Record<string, unknown>) => route(deps, { method: "POST", path: ["callbacks"], body: { workspaceId: WS, ...body }, query: {}, user: { id: "u1" } });
    return { get, save, asked, stored: () => stored };
  }

  it("starts switched off, with twelve seconds and our own numbers named", async () => {
    const out = await settings().get();
    expect(out).toEqual({ status: 200, json: { ready: true, enabled: false, people: [], ringSeconds: 12, screen: true, numbers: ["+1 (415) 555-0100"], linked: null } });
  });

  it("saves who is rung, and tells the provider to send incoming calls here", async () => {
    const s = settings();
    const out = await s.save({ enabled: true, people: [{ name: "Priya", number: "+91 98123 45678" }, SAM], ringSeconds: 12, screen: true });
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ enabled: true, people: [PRIYA, SAM], linked: true, address: `${BASE}/api/voice?path=incoming` });
    expect(s.stored()).toEqual({ enabled: true, people: [PRIYA, SAM], ringSeconds: 12, screen: true });
    expect(s.asked.some((url) => url.includes("IncomingPhoneNumbers"))).toBe(true);
  });

  it("leaves the provider alone when call-backs are saved switched off", async () => {
    const s = settings();
    const out = await s.save({ enabled: false, people: [PRIYA] });
    expect(out.json).toMatchObject({ enabled: false, linked: null });
    expect(s.asked).toEqual([]);
  });

  it("saves nothing that is wrong, and says what", async () => {
    const s = settings();
    const out = await s.save({ enabled: true, people: [{ name: "Priya", number: "98123" }] });
    expect(out.status).toBe(400);
    expect((out.json as { error: string }).error).toContain("international form");
    expect(s.stored()).toEqual(DEFAULT_FORWARDING);
  });

  it("is for the owner and admins only, and says so when the database is not ready", async () => {
    expect(await settings({ role: "member" }).get()).toEqual({ status: 403, json: { error: CALL_BACKS_OWNER_ONLY_MESSAGE } });
    expect(await settings({ role: null }).save({ enabled: false, people: [] })).toMatchObject({ status: 403 });
    expect(await settings({ ready: false }).save({ enabled: false, people: [] })).toEqual({ status: 503, json: { error: CALL_BACKS_NOT_SET_UP_MESSAGE } });
    expect((await settings({ ready: false }).get()).json).toMatchObject({ ready: false, enabled: false });
  });
});
