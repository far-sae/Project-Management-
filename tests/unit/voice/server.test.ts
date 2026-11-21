// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { readConfig, type VoiceConfig } from "../../../api/_voice/config";
import {
  CALLS_OWNER_ONLY_MESSAGE,
  LEAD_NOT_FOUND_MESSAGE,
  ORG_NOT_ALLOWED_MESSAGE,
  CALLS_PER_MINUTE,
  CALL_IN_PROGRESS_MESSAGE,
  CALL_NOT_FOUND_MESSAGE,
  CHOOSE_WORKSPACE_MESSAGE,
  DELETE_OWNER_ONLY_MESSAGE,
  describeCall,
  NO_WORKSPACE_MESSAGE,
  NOT_FOUND_MESSAGE,
  OWNER_ONLY_MESSAGE,
  PAGE_SIZE,
  RECORDING_NOT_DELETED_MESSAGE,
  route,
  TABLES_MISSING_MESSAGE,
  TOO_MANY_MESSAGE,
  webhook,
  type VoiceDeps,
} from "../../../api/_voice/router";
import { isUnansweredCallEntry, type CallList, type PersonCalls } from "../../../api/_voice/shared/types";
import type { Call, CallPatch, Target, VoiceStore } from "../../../api/_voice/store";
import { callToken, identityOf, TOKEN_SECONDS } from "../../../api/_voice/token";
import { dialTwiml, noticeTwiml, RECORDING_NOTICE } from "../../../api/_voice/twiml";
import { signedOrigin, voiceHandler, type VoiceHandlerDeps } from "../../../api/voice";

/**
 * The calling server: who may call, which numbers, what the phone provider is
 * told to do, and what a finished call leaves on the timeline. Nothing here
 * touches the network.
 */

const ORG = "0b000000-0000-4000-8000-000000000001";
const WS = "0a000000-0000-4000-8000-000000000001";
const WS2 = "0a000000-0000-4000-8000-000000000002";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const ADMIN = "0c000000-0000-4000-8000-000000000002";
const MEMBER = "0c000000-0000-4000-8000-000000000003";
const LEAD = "0d000000-0000-4000-8000-000000000001";
const LEAD_NO_WS = "0d000000-0000-4000-8000-000000000002";
const COMPANY = "0e000000-0000-4000-8000-000000000001";

const HEX = "0123456789abcdef0123456789abcdef";
const ENV = {
  TWILIO_ACCOUNT_SID: "AC" + HEX,
  TWILIO_AUTH_TOKEN: "auth-token-for-tests-0123456789",
  TWILIO_API_KEY_SID: "SK" + HEX,
  TWILIO_API_KEY_SECRET: "api-key-secret-for-tests-0123456789",
  TWILIO_TWIML_APP_SID: "AP" + HEX,
  TWILIO_NUMBER_US: "+14155550100",
  TWILIO_NUMBER_UK: "+442079460000",
};
const CONFIG = readConfig(ENV).config as VoiceConfig;
const CALL_SID = "CA" + HEX;
const REC_SID = "RE" + HEX;

type Activity = { id: string; description: string; metadata: Record<string, unknown>; contactId: string | null; companyId: string | null; workspaceId: string | null };

function fakeStore() {
  const calls = new Map<string, Call>();
  const activities = new Map<string, Activity>();
  const roles: Record<string, "owner" | "admin" | "member"> = { [OWNER]: "owner", [ADMIN]: "admin", [MEMBER]: "member" };
  const targets: Record<string, Target> = {
    [LEAD]: { kind: "contact", id: LEAD, organizationId: ORG, workspaceId: WS },
    [LEAD_NO_WS]: { kind: "contact", id: LEAD_NO_WS, organizationId: ORG, workspaceId: null },
    [COMPANY]: { kind: "company", id: COMPANY, organizationId: ORG, workspaceId: WS },
  };
  let n = 0;
  let tick = 0;
  const state = { ready: true, now: new Date("2026-11-20T10:00:00Z") };
  const newestFirst = (a: Call, b: Call) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id));
  const store: VoiceStore = {
    tablesReady: async () => state.ready,
    workspaceOrg: async (id) => (id === WS || id === WS2 ? ORG : null),
    listCalls: async (workspaceId, opts) =>
      [...calls.values()]
        .filter((c) => c.workspaceId === workspaceId && c.status !== "starting" && (!opts.before || c.createdAt < opts.before))
        .sort(newestFirst)
        .slice(0, opts.limit),
    callResults: async (workspaceId, since) =>
      [...calls.values()].filter((c) => c.workspaceId === workspaceId && c.status !== "starting" && c.createdAt >= since).map((c) => ({ status: c.status, seconds: c.seconds })),
    names: async (ids) => ({
      contacts: Object.fromEntries(ids.contacts.filter((id) => id === LEAD).map((id) => [id, "Elena Rossi"])),
      companies: Object.fromEntries(ids.companies.filter((id) => id === COMPANY).map((id) => [id, "Harbour Dental"])),
      users: Object.fromEntries(ids.users.filter((id) => id === OWNER).map((id) => [id, "Sam"])),
    }),
    orgRole: async (org, user) => (org === ORG ? roles[user] ?? null : null),
    contact: async (id) => (targets[id]?.kind === "contact" ? targets[id] : null),
    company: async (id) => (targets[id]?.kind === "company" ? targets[id] : null),
    callsSince: async (user, since) => [...calls.values()].filter((c) => c.userId === user && c.createdAt >= since).length,
    insertCall: async (c) => {
      n += 1;
      const id = `0f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const call: Call = { ...c, id, status: "starting", callSid: null, seconds: 0, recordingSid: null, recordingSeconds: 0, outcome: null, note: "", createdAt: state.now.toISOString(), endedAt: null, updatedAt: `t${(tick += 1)}` };
      calls.set(id, call);
      return call;
    },
    getCall: async (id) => calls.get(id) ?? null,
    patchCall: async (id, patch: CallPatch) => {
      const call = calls.get(id);
      if (!call) return null;
      const next = { ...call, ...patch, updatedAt: `t${(tick += 1)}` };
      calls.set(id, next);
      return next;
    },
    deleteCall: async (id) => {
      calls.delete(id);
      activities.delete(id);
    },
    callsOfContact: async (contactId) => [...calls.values()].filter((c) => c.contactId === contactId).sort(newestFirst),
    saveActivity: async (call, description, metadata) => {
      activities.set(call.id, { id: call.id, description, metadata, contactId: call.contactId, companyId: call.companyId, workspaceId: call.workspaceId });
    },
  };
  return { store, calls, activities, roles, state };
}

function world() {
  const fake = fakeStore();
  const fetchMock = vi.fn(async () => new Response("mp3-bytes", { status: 200, headers: { "content-length": "9", "content-type": "audio/mpeg" } }));
  const deps: VoiceDeps = { store: fake.store, config: () => readConfig(ENV), token: () => "token-for-tests", fetch: fetchMock as never, now: () => fake.state.now };
  const as = (user: string) => ({
    get: (path: string, query: Record<string, string> = {}) => route(deps, { method: "GET", path: path.split("/"), body: {}, query, user: { id: user } }),
    post: (path: string, body: Record<string, unknown> = {}) => route(deps, { method: "POST", path: path.split("/"), body, user: { id: user } }),
    del: (path: string) => route(deps, { method: "DELETE", path: path.split("/"), body: {}, user: { id: user } }),
  });
  const hook = (what: "twiml" | "notice" | "done" | "recording", params: Record<string, string>, query: Record<string, string> = {}) =>
    webhook(deps, { what, base: "https://app.example.com", query, params: { AccountSid: CONFIG.accountSid, ...params } });
  const startCall = async (user = OWNER, body: Record<string, unknown> = { contactId: LEAD, to: "+44 7700 900123" }) => {
    const out = await as(user).post("calls", body);
    return (out.json as { id: string }).id;
  };
  return { ...fake, deps, as, hook, startCall, fetchMock };
}

describe("calling: settings", () => {
  it("is not configured while no setting exists, so the Call button stays as it was", () => {
    expect(readConfig({})).toEqual({ configured: false, config: null, problem: null });
  });

  it("names the first setting that is missing, never a value", () => {
    const { TWILIO_AUTH_TOKEN: _omit, ...rest } = ENV;
    expect(readConfig(rest).problem).toBe("Calling is not set up yet: TWILIO_AUTH_TOKEN is missing in Vercel's environment variables.");
    const wrong = readConfig({ ...ENV, TWILIO_TWIML_APP_SID: "not-an-app-sid" });
    expect(wrong.problem).toBe("Calling is not set up yet: TWILIO_TWIML_APP_SID in Vercel's environment variables must be the TwiML app's SID, which starts with AP.");
    expect(wrong.problem).not.toContain("not-an-app-sid");
  });

  it("needs each number to be of its own country", () => {
    expect(readConfig({ ...ENV, TWILIO_NUMBER_UK: "+14155550100" }).problem).toContain("TWILIO_NUMBER_UK");
    expect(readConfig({ ...ENV, TWILIO_NUMBER_US: "4155550100" }).problem).toContain("TWILIO_NUMBER_US");
    expect(readConfig({ ...ENV, TWILIO_NUMBER_US: "", TWILIO_NUMBER_UK: "" }).problem).toContain("TWILIO_NUMBER_US or TWILIO_NUMBER_UK");
    expect(readConfig({ ...ENV, TWILIO_NUMBER_UK: "" }).config?.numbers).toEqual({ US: "+14155550100" });
  });

  it("reports what is ready to the page", async () => {
    const w = world();
    expect((await w.as(MEMBER).get("setup")).json).toEqual({ configured: true, ready: true, problem: null, numbers: { US: true, GB: true } });
    w.state.ready = false;
    expect((await w.as(OWNER).get("setup")).json).toMatchObject({ configured: true, ready: false, problem: TABLES_MISSING_MESSAGE });
    w.deps.config = () => readConfig({});
    expect((await w.as(OWNER).get("setup")).json).toEqual({ configured: false, ready: false, problem: null, numbers: { US: false, GB: false } });
  });

  it("is not ready while the provider refuses a setting, and says which", async () => {
    const w = world();
    const check = vi.fn(async () => "Twilio did not accept the API key." as string | null);
    w.deps.check = check;
    expect((await w.as(OWNER).get("setup")).json).toEqual({ configured: true, ready: false, problem: "Twilio did not accept the API key.", numbers: { US: true, GB: true } });
    expect(check).toHaveBeenCalledWith(CONFIG);
    check.mockResolvedValue(null);
    expect((await w.as(OWNER).get("setup")).json).toMatchObject({ ready: true, problem: null });
    // The provider is not asked while something nearer is still missing.
    check.mockClear();
    w.state.ready = false;
    await w.as(OWNER).get("setup");
    expect(check).not.toHaveBeenCalled();
  });
});

describe("calling: the pass a browser calls with", () => {
  it("can only place calls through our app, as that person, for ten minutes", () => {
    const jwt = callToken(CONFIG, OWNER);
    const [head, body] = jwt.split(".").slice(0, 2).map((p) => JSON.parse(Buffer.from(p, "base64url").toString("utf8")));
    expect(head).toMatchObject({ alg: "HS256", typ: "JWT" });
    expect(body.iss).toBe(CONFIG.apiKeySid);
    expect(body.sub).toBe(CONFIG.accountSid);
    expect(body.exp - body.iat).toBe(TOKEN_SECONDS);
    // Outgoing through our app only; no permission to receive calls is in it at all.
    expect(body.grants).toEqual({ identity: identityOf(OWNER), voice: { outgoing: { application_sid: CONFIG.appSid } } });
    expect(identityOf(OWNER)).toMatch(/^[A-Za-z0-9_]+$/);
    expect(jwt).not.toContain(CONFIG.apiKeySecret);
  });
});

describe("calling: starting a call", () => {
  it("lets an owner or an admin call a lead, from the number of the country being rung", async () => {
    const w = world();
    const out = await w.as(OWNER).post("calls", { contactId: LEAD, to: "07700 900123" });
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ to: "+447700900123", display: "+44 7700 900123", country: "GB", token: "token-for-tests" });
    const call = [...w.calls.values()][0];
    expect(call).toMatchObject({ userId: OWNER, contactId: LEAD, companyId: null, workspaceId: WS, toNumber: "+447700900123", fromNumber: "+442079460000", status: "starting" });

    const us = await w.as(ADMIN).post("calls", { companyId: COMPANY, to: "(415) 555-0132" });
    expect(us.json).toMatchObject({ to: "+14155550132", country: "US" });
    expect([...w.calls.values()][1]).toMatchObject({ userId: ADMIN, contactId: null, companyId: COMPANY, fromNumber: "+14155550100" });
  });

  it("refuses a member, an outsider and a record that is not there", async () => {
    const w = world();
    expect(await w.as(MEMBER).post("calls", { contactId: LEAD, to: "+14155550132" })).toEqual({ status: 403, json: { error: OWNER_ONLY_MESSAGE } });
    expect((await w.as("0c000000-0000-4000-8000-000000000099").post("calls", { contactId: LEAD, to: "+14155550132" })).status).toBe(403);
    expect(await w.as(OWNER).post("calls", { contactId: COMPANY, to: "+14155550132" })).toEqual({ status: 404, json: { error: NOT_FOUND_MESSAGE } });
    expect((await w.as(OWNER).post("calls", { to: "+14155550132" })).status).toBe(404);
    expect(await w.as(OWNER).post("calls", { contactId: LEAD_NO_WS, to: "+14155550132" })).toEqual({ status: 409, json: { error: NO_WORKSPACE_MESSAGE } });
    expect(w.calls.size).toBe(0);
  });

  it("refuses numbers it must not ring, and a country with no number to call from", async () => {
    const w = world();
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+33 1 42 68 53 00" })).json).toEqual({ error: "Calls can go to United States and United Kingdom numbers only." });
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+1 900 555 0132" })).status).toBe(400);
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "555 0132" })).status).toBe(400);
    w.deps.config = () => readConfig({ ...ENV, TWILIO_NUMBER_UK: "" });
    const out = await w.as(OWNER).post("calls", { contactId: LEAD, to: "+44 7700 900123" });
    expect(out.status).toBe(409);
    expect((out.json as { error: string }).error).toContain("TWILIO_NUMBER_UK");
    expect(w.calls.size).toBe(0);
  });

  it("says what is missing while calling is not set up", async () => {
    const w = world();
    w.state.ready = false;
    expect(await w.as(OWNER).post("calls", { contactId: LEAD, to: "+14155550132" })).toEqual({ status: 503, json: { error: TABLES_MISSING_MESSAGE } });
    w.deps.config = () => readConfig({ TWILIO_ACCOUNT_SID: ENV.TWILIO_ACCOUNT_SID });
    const out = await w.as(OWNER).post("calls", { contactId: LEAD, to: "+14155550132" });
    expect(out.status).toBe(503);
    expect((out.json as { error: string }).error).toContain("TWILIO_AUTH_TOKEN");
  });

  it("stops a runaway: only so many calls a minute", async () => {
    const w = world();
    for (let i = 0; i < CALLS_PER_MINUTE; i += 1) expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+14155550132" })).status).toBe(200);
    expect(await w.as(OWNER).post("calls", { contactId: LEAD, to: "+14155550132" })).toEqual({ status: 429, json: { error: TOO_MANY_MESSAGE } });
    w.state.now = new Date(w.state.now.getTime() + 61_000);
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+14155550132" })).status).toBe(200);
  });
});

describe("calling: what the phone provider is told", () => {
  it("rings the number on our own row, records both sides and plays the notice first", async () => {
    const w = world();
    const id = await w.startCall();
    // The browser asks for another number: it is ignored, the row decides.
    const out = await w.hook("twiml", { callId: id, From: "client:" + identityOf(OWNER), CallSid: CALL_SID, To: "+19005550132" });
    expect(out).toContain("<Number");
    expect(out).toContain(">+447700900123</Number>");
    expect(out).not.toContain("+19005550132");
    expect(out).toContain('callerId="+442079460000"');
    expect(out).toContain('answerOnBridge="true"');
    expect(out).toContain('record="record-from-answer-dual"');
    expect(out).toContain(`recordingStatusCallback="https://app.example.com/api/voice?path=recording&amp;call=${id}"`);
    expect(out).toContain(`action="https://app.example.com/api/voice?path=done&amp;call=${id}"`);
    expect(out).toContain(`url="https://app.example.com/api/voice?path=notice&amp;call=${id}&amp;country=GB"`);
    expect(w.calls.get(id)).toMatchObject({ status: "ringing", callSid: CALL_SID });
  });

  it("hangs up for anyone else's call, a used one, a stale one and another account", async () => {
    const w = world();
    const id = await w.startCall();
    const from = "client:" + identityOf(OWNER);
    expect(await w.hook("twiml", { callId: id, From: "client:" + identityOf(ADMIN), CallSid: CALL_SID })).not.toContain("<Dial");
    expect(await w.hook("twiml", { callId: "nope", From: from, CallSid: CALL_SID })).not.toContain("<Dial");
    expect(await webhook(w.deps, { what: "twiml", base: "https://app.example.com", query: {}, params: { AccountSid: "AC" + "f".repeat(32), callId: id, From: from } })).not.toContain("<Dial");
    // Once it has been connected, the same id cannot place a second call.
    expect(await w.hook("twiml", { callId: id, From: from, CallSid: CALL_SID })).toContain("<Dial");
    expect(await w.hook("twiml", { callId: id, From: from, CallSid: CALL_SID })).not.toContain("<Dial");

    const late = await w.startCall();
    w.state.now = new Date(w.state.now.getTime() + 6 * 60_000);
    expect(await w.hook("twiml", { callId: late, From: from, CallSid: CALL_SID })).not.toContain("<Dial");
  });

  it("hangs up when the caller is no longer an admin", async () => {
    const w = world();
    const id = await w.startCall(ADMIN);
    w.roles[ADMIN] = "member";
    expect(await w.hook("twiml", { callId: id, From: "client:" + identityOf(ADMIN), CallSid: CALL_SID })).not.toContain("<Dial");
  });

  it("speaks the recording notice in the accent of the country rung", () => {
    expect(noticeTwiml("GB")).toContain(`<Say language="en-GB">${RECORDING_NOTICE}</Say>`);
    expect(noticeTwiml("US")).toContain('language="en-US"');
  });

  it("escapes what goes into the instructions", () => {
    const out = dialTwiml({ base: "https://app.example.com", callId: 'a"b<c', to: "+14155550132", callerId: "+14155550100", country: "US" });
    expect(out).not.toContain('a"b<c');
    expect(out).toContain("a%22b%3Cc");
  });
});

describe("calling: after the call", () => {
  it("logs an answered call on the lead with its length, then adds the recording", async () => {
    const w = world();
    const id = await w.startCall();
    await w.hook("twiml", { callId: id, From: "client:" + identityOf(OWNER), CallSid: CALL_SID });
    expect(w.activities.size).toBe(0);

    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "192" }, { call: id });
    expect(w.calls.get(id)).toMatchObject({ status: "completed", seconds: 192 });
    expect(w.activities.get(id)).toMatchObject({ description: "Called +44 7700 900123. 3 min 12 s.", contactId: LEAD, workspaceId: WS });
    expect(w.activities.get(id)?.metadata).toEqual({ callId: id, to: "+447700900123", country: "GB", status: "completed", seconds: 192, outcome: null, recorded: false });

    await w.hook("recording", { RecordingStatus: "completed", RecordingSid: REC_SID, RecordingDuration: "190" }, { call: id });
    expect(w.calls.get(id)).toMatchObject({ recordingSid: REC_SID, recordingSeconds: 190 });
    expect(w.activities.get(id)?.metadata).toMatchObject({ recorded: true });
    expect(w.activities.size).toBe(1);
  });

  it("logs a call nobody answered", async () => {
    const w = world();
    const id = await w.startCall();
    await w.hook("done", { DialCallStatus: "no-answer" }, { call: id });
    expect(w.activities.get(id)?.description).toBe("Called +44 7700 900123. No answer.");
    const busy = await w.startCall();
    await w.hook("done", { DialCallStatus: "busy" }, { call: busy });
    expect(w.activities.get(busy)?.description).toBe("Called +44 7700 900123. The line was busy.");
  });

  it("adds the caller's outcome and note to the same entry", async () => {
    const w = world();
    const id = await w.startCall();
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "45" }, { call: id });
    const out = await w.as(OWNER).post(`calls/${id}/end`, { outcome: "voicemail", note: "  Asked her to ring back on Friday. ", seconds: 44, answered: true });
    expect(out).toEqual({ status: 200, json: { ok: true } });
    expect(w.activities.size).toBe(1);
    expect(w.activities.get(id)?.description).toBe("Called +44 7700 900123. 45 s. Left a voicemail.\nAsked her to ring back on Friday.");
    // The provider's length stands, not the browser's.
    expect(w.calls.get(id)).toMatchObject({ seconds: 45, outcome: "voicemail" });
  });

  it("still logs the call when the provider's report never arrives", async () => {
    const w = world();
    const id = await w.startCall();
    await w.as(OWNER).post(`calls/${id}/end`, { seconds: 75, answered: true, outcome: "connected" });
    expect(w.calls.get(id)).toMatchObject({ status: "completed", seconds: 75 });
    expect(w.activities.get(id)?.description).toBe("Called +44 7700 900123. 1 min 15 s. Spoke to them.");
    // The report arriving afterwards corrects the length and keeps the outcome.
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "80" }, { call: id });
    expect(w.activities.get(id)?.description).toBe("Called +44 7700 900123. 1 min 20 s. Spoke to them.");
  });

  it("lets only the caller say how their call went", async () => {
    const w = world();
    const id = await w.startCall(OWNER);
    expect((await w.as(ADMIN).post(`calls/${id}/end`, { outcome: "connected" })).status).toBe(404);
    expect((await w.as(MEMBER).post(`calls/${id}/end`, { outcome: "connected" })).status).toBe(403);
    expect((await w.as(OWNER).post("calls/not-an-id/end", {})).status).toBe(404);
    // An outcome that is not one of ours is ignored rather than stored.
    await w.as(OWNER).post(`calls/${id}/end`, { outcome: "<b>hi</b>" });
    expect(w.calls.get(id)?.outcome).toBeNull();
  });

  it("can tell its own entry of an unanswered call from a conversation", () => {
    const base = { toNumber: "+14155550132", seconds: 0, status: "completed" as const, outcome: null, note: "" };
    for (const status of ["no_answer", "busy", "failed", "canceled"] as const) expect(isUnansweredCallEntry(describeCall({ ...base, status })), status).toBe(true);
    for (const outcome of ["no_answer", "voicemail", "busy", "wrong_number"] as const) expect(isUnansweredCallEntry(describeCall({ ...base, seconds: 20, outcome })), outcome).toBe(true);
    expect(isUnansweredCallEntry(describeCall({ ...base, seconds: 192 }))).toBe(false);
    expect(isUnansweredCallEntry(describeCall({ ...base, seconds: 192, outcome: "connected", note: "No answer. at first" }))).toBe(false);
    // Only its own entries are judged, never what a person typed.
    expect(isUnansweredCallEntry("Called her, no answer.")).toBe(false);
    expect(isUnansweredCallEntry("")).toBe(false);
  });

  it("writes the entry in plain words", () => {
    const base = { toNumber: "+14155550132", seconds: 0, status: "completed" as const, outcome: null, note: "" };
    expect(describeCall({ ...base, seconds: 120 })).toBe("Called +1 (415) 555-0132. 2 min.");
    expect(describeCall({ ...base, status: "canceled" })).toBe("Called +1 (415) 555-0132. Hung up before it was answered.");
    expect(describeCall({ ...base, status: "failed" })).toBe("Called +1 (415) 555-0132. The call did not connect.");
    expect(describeCall({ ...base, status: "no_answer", outcome: "wrong_number" })).toBe("Called +1 (415) 555-0132. Wrong number.");
  });
});

describe("calling: the list of calls", () => {
  it("lists a workspace's calls newest first, with who was rung, by whom, and how the month went", async () => {
    const w = world();
    const first = await w.startCall(OWNER);
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "192" }, { call: first });
    await w.hook("recording", { RecordingStatus: "completed", RecordingSid: REC_SID, RecordingDuration: "190" }, { call: first });
    await w.as(OWNER).post(`calls/${first}/end`, { outcome: "connected", note: "Send the quote on Friday" });
    w.state.now = new Date(w.state.now.getTime() + 60_000);
    const second = await w.startCall(ADMIN, { companyId: COMPANY, to: "+1 415 555 0132" });
    await w.hook("done", { DialCallStatus: "no-answer" }, { call: second });
    // Pressed Call, but the line failed before the provider was reached: not a call.
    await w.startCall(OWNER);

    const out = await w.as(ADMIN).get("calls", { workspaceId: WS });
    expect(out.status).toBe(200);
    const body = out.json as CallList;
    expect(body.calls.map((c) => c.id)).toEqual([second, first]);
    expect(body.calls[1]).toEqual({
      id: first,
      at: "2026-11-20T10:00:00.000Z",
      status: "completed",
      seconds: 192,
      outcome: "connected",
      note: "Send the quote on Friday",
      to: "+447700900123",
      display: "+44 7700 900123",
      country: "GB",
      recorded: true,
      contact: { id: LEAD, name: "Elena Rossi" },
      company: null,
      caller: { id: OWNER, name: "Sam" },
    });
    expect(body.calls[0]).toMatchObject({ status: "no_answer", recorded: false, contact: null, company: { id: COMPANY, name: "Harbour Dental" }, caller: { id: ADMIN, name: "" } });
    expect(body.more).toBe(false);
    expect(body.summary).toEqual({ days: 30, total: 2, answered: 1, seconds: 192 });
  });

  it("is for the owner and admins of that workspace's organisation only", async () => {
    const w = world();
    expect(await w.as(MEMBER).get("calls", { workspaceId: WS })).toEqual({ status: 403, json: { error: CALLS_OWNER_ONLY_MESSAGE } });
    expect(await w.as("0c000000-0000-4000-8000-000000000099").get("calls", { workspaceId: WS })).toEqual({ status: 403, json: { error: CHOOSE_WORKSPACE_MESSAGE } });
    expect(await w.as(OWNER).get("calls", { workspaceId: "0a000000-0000-4000-8000-000000000009" })).toEqual({ status: 403, json: { error: CHOOSE_WORKSPACE_MESSAGE } });
    expect((await w.as(OWNER).get("calls", {})).status).toBe(403);
    w.state.ready = false;
    expect(await w.as(OWNER).get("calls", { workspaceId: WS })).toEqual({ status: 503, json: { error: TABLES_MISSING_MESSAGE } });
  });

  it("keeps each workspace's calls to itself", async () => {
    const w = world();
    const id = await w.startCall(OWNER);
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "30" }, { call: id });
    expect(((await w.as(OWNER).get("calls", { workspaceId: WS2 })).json as CallList).calls).toEqual([]);
    expect(((await w.as(OWNER).get("calls", { workspaceId: WS2 })).json as CallList).summary.total).toBe(0);
  });

  it("hands out older calls a page at a time", async () => {
    const w = world();
    for (let i = 0; i < PAGE_SIZE + 3; i += 1) {
      w.state.now = new Date(w.state.now.getTime() + 61_000);
      const id = await w.startCall(OWNER);
      await w.hook("done", { DialCallStatus: "busy" }, { call: id });
    }
    const page = (await w.as(OWNER).get("calls", { workspaceId: WS })).json as CallList;
    expect(page.calls).toHaveLength(PAGE_SIZE);
    expect(page.more).toBe(true);
    const older = (await w.as(OWNER).get("calls", { workspaceId: WS, before: page.calls[PAGE_SIZE - 1].at })).json as CallList;
    expect(older.calls).toHaveLength(3);
    expect(older.more).toBe(false);
    expect(new Set([...page.calls, ...older.calls].map((c) => c.id)).size).toBe(PAGE_SIZE + 3);
    // A `before` that is not a time is ignored rather than trusted.
    expect(((await w.as(OWNER).get("calls", { workspaceId: WS, before: "'; drop" })).json as CallList).calls).toHaveLength(PAGE_SIZE);
  });
});

describe("calling: recordings", () => {
  it("fetches the recording for an owner or admin, with the account's own key", async () => {
    const w = world();
    const id = await w.startCall();
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "30" }, { call: id });
    expect((await w.as(OWNER).get(`calls/${id}/recording`)).status).toBe(404);
    await w.hook("recording", { RecordingStatus: "completed", RecordingSid: REC_SID, RecordingDuration: "29" }, { call: id });

    const out = await w.as(ADMIN).get(`calls/${id}/recording`);
    expect(out.status).toBe(200);
    expect(out.media).toMatchObject({ type: "audio/mpeg", length: "9" });
    const [url, init] = w.fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${CONFIG.accountSid}/Recordings/${REC_SID}.mp3`);
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString("base64"));
    expect((await w.as(MEMBER).get(`calls/${id}/recording`)).status).toBe(403);
  });

  it("ignores a recording id that is not one", async () => {
    const w = world();
    const id = await w.startCall();
    await w.hook("recording", { RecordingStatus: "completed", RecordingSid: "../../Calls", RecordingDuration: "5" }, { call: id });
    expect(w.calls.get(id)?.recordingSid).toBeNull();
  });
});

describe("calling: deleting a call", () => {
  const finished = async (w: ReturnType<typeof world>, recorded: boolean) => {
    const id = await w.startCall(ADMIN);
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "60" }, { call: id });
    if (recorded) await w.hook("recording", { RecordingStatus: "completed", RecordingSid: REC_SID, RecordingDuration: "58" }, { call: id });
    return id;
  };

  it("lets the owner remove a call with its recording and its timeline entry", async () => {
    const w = world();
    const id = await finished(w, true);
    expect(w.activities.has(id)).toBe(true);
    w.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await w.as(OWNER).del(`calls/${id}`)).toEqual({ status: 200, json: { ok: true } });
    const [url, init] = w.fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${CONFIG.accountSid}/Recordings/${REC_SID}.json`);
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString("base64"));
    expect(w.calls.has(id)).toBe(false);
    expect(w.activities.has(id)).toBe(false);
    expect(((await w.as(OWNER).get("calls", { workspaceId: WS })).json as CallList).calls).toEqual([]);
  });

  it("is for the owner only, not an admin, a member or an outsider", async () => {
    const w = world();
    const id = await finished(w, false);
    // Even the admin who placed the call cannot delete it.
    expect(await w.as(ADMIN).del(`calls/${id}`)).toEqual({ status: 403, json: { error: DELETE_OWNER_ONLY_MESSAGE } });
    expect(await w.as(MEMBER).del(`calls/${id}`)).toEqual({ status: 403, json: { error: DELETE_OWNER_ONLY_MESSAGE } });
    expect(await w.as("0c000000-0000-4000-8000-000000000099").del(`calls/${id}`)).toEqual({ status: 404, json: { error: CALL_NOT_FOUND_MESSAGE } });
    expect(await w.as(OWNER).del("calls/not-an-id")).toEqual({ status: 404, json: { error: CALL_NOT_FOUND_MESSAGE } });
    expect(w.calls.has(id)).toBe(true);
    expect(w.fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the call when its recording cannot be deleted, so no recording is left behind", async () => {
    const w = world();
    const id = await finished(w, true);
    w.fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await w.as(OWNER).del(`calls/${id}`)).toEqual({ status: 502, json: { error: RECORDING_NOT_DELETED_MESSAGE } });
    w.fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect((await w.as(OWNER).del(`calls/${id}`)).status).toBe(502);
    expect(w.calls.has(id)).toBe(true);
    expect(w.activities.has(id)).toBe(true);
    // The provider no longer having it is fine: the call goes.
    w.fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await w.as(OWNER).del(`calls/${id}`)).status).toBe(200);
    expect(w.calls.has(id)).toBe(false);
  });

  it("deletes a call without a recording without asking the provider, and leaves a running call alone", async () => {
    const w = world();
    const id = await finished(w, false);
    expect((await w.as(OWNER).del(`calls/${id}`)).status).toBe(200);
    expect(w.fetchMock).not.toHaveBeenCalled();

    const live = await w.startCall(OWNER);
    await w.hook("twiml", { callId: live, From: "client:" + identityOf(OWNER), CallSid: CALL_SID });
    expect(await w.as(OWNER).del(`calls/${live}`)).toEqual({ status: 409, json: { error: CALL_IN_PROGRESS_MESSAGE } });
    // One whose end was never reported can be cleared away later.
    w.state.now = new Date(w.state.now.getTime() + 4 * 60 * 60_000);
    expect((await w.as(OWNER).del(`calls/${live}`)).status).toBe(200);
  });
});

describe("calling: only the organisations that are listed", () => {
  it("lets every organisation call while no list is set, as before", async () => {
    const w = world();
    expect(readConfig(ENV).config?.allowedOrgs).toEqual([]);
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+44 7700 900123" })).status).toBe(200);
  });

  it("refuses an organisation that is not on the list, before anything is dialled", async () => {
    const w = world();
    const other = "0b000000-0000-4000-8000-0000000000ff";
    w.deps.config = () => readConfig({ ...ENV, TWILIO_ALLOWED_ORGS: other });
    expect(await w.as(OWNER).post("calls", { contactId: LEAD, to: "+44 7700 900123" })).toEqual({ status: 403, json: { error: ORG_NOT_ALLOWED_MESSAGE } });
    expect(w.calls.size).toBe(0);
  });

  it("lets a listed organisation call, however the list is typed", async () => {
    const w = world();
    w.deps.config = () => readConfig({ ...ENV, TWILIO_ALLOWED_ORGS: ` 0b000000-0000-4000-8000-0000000000ff , ${ORG.toUpperCase()} ,not-an-id,` });
    expect(readConfig({ ...ENV, TWILIO_ALLOWED_ORGS: `x, ${ORG.toUpperCase()}` }).config?.allowedOrgs).toEqual([ORG]);
    expect((await w.as(OWNER).post("calls", { contactId: LEAD, to: "+44 7700 900123" })).status).toBe(200);
  });

  it("stops calling and says so when the list holds no proper id, instead of opening it to everybody", () => {
    const state = readConfig({ ...ENV, TWILIO_ALLOWED_ORGS: "my company" });
    expect(state.config).toBeNull();
    expect(state.problem).toContain("TWILIO_ALLOWED_ORGS");
    expect(state.problem).toContain("organisation ids");
    expect(state.problem).not.toContain("my company");
  });
});

describe("calling: one person's calls", () => {
  const finished = async (w: ReturnType<typeof world>, recorded: boolean) => {
    const id = await w.startCall(ADMIN);
    await w.hook("done", { DialCallStatus: "completed", DialCallDuration: "42" }, { call: id });
    if (recorded) await w.hook("recording", { RecordingStatus: "completed", RecordingSid: REC_SID, RecordingDuration: "40" }, { call: id });
    return id;
  };

  it("lists the calls made to a lead for the owner and admins, without the recording itself", async () => {
    const w = world();
    const id = await finished(w, true);
    const out = await w.as(ADMIN).get(`contacts/${LEAD}/calls`);
    expect(out.status).toBe(200);
    expect((out.json as PersonCalls).calls).toEqual([
      { id, at: w.state.now.toISOString(), to: "+447700900123", status: "completed", outcome: null, seconds: 42, note: "", recorded: true },
    ]);
    expect(JSON.stringify(out.json)).not.toContain(REC_SID);
    expect(await w.as(MEMBER).get(`contacts/${LEAD}/calls`)).toEqual({ status: 403, json: { error: CALLS_OWNER_ONLY_MESSAGE } });
    expect(await w.as("0c000000-0000-4000-8000-000000000099").get(`contacts/${LEAD}/calls`)).toEqual({ status: 404, json: { error: LEAD_NOT_FOUND_MESSAGE } });
    expect(await w.as(OWNER).get("contacts/not-an-id/calls")).toEqual({ status: 404, json: { error: LEAD_NOT_FOUND_MESSAGE } });
  });

  it("removes every call of a lead with its recording, for the owner only", async () => {
    const w = world();
    const first = await finished(w, true);
    const second = await finished(w, false);
    // A call to somebody else stays.
    const other = await w.startCall(OWNER, { companyId: COMPANY, to: "+44 7700 900999" });
    w.fetchMock.mockClear();

    expect(await w.as(ADMIN).del(`contacts/${LEAD}/calls`)).toEqual({ status: 403, json: { error: DELETE_OWNER_ONLY_MESSAGE } });
    expect(w.calls.has(first)).toBe(true);

    w.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await w.as(OWNER).del(`contacts/${LEAD}/calls`)).toEqual({ status: 200, json: { deleted: 2 } });
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
    expect((w.fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(`/Recordings/${REC_SID}.json`);
    expect(w.calls.has(first)).toBe(false);
    expect(w.calls.has(second)).toBe(false);
    expect(w.activities.has(first)).toBe(false);
    expect(w.calls.has(other)).toBe(true);
  });

  it("stops when a recording cannot be deleted, so no recording is left without its call", async () => {
    const w = world();
    const id = await finished(w, true);
    w.fetchMock.mockClear();
    w.fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await w.as(OWNER).del(`contacts/${LEAD}/calls`)).toEqual({ status: 502, json: { error: RECORDING_NOT_DELETED_MESSAGE } });
    expect(w.calls.has(id)).toBe(true);
  });

  it("has nothing to tell while calling was never set up", async () => {
    const w = world();
    w.state.ready = false;
    expect(await w.as(OWNER).get(`contacts/${LEAD}/calls`)).toEqual({ status: 200, json: { calls: [] } });
    expect(await w.as(OWNER).del(`contacts/${LEAD}/calls`)).toEqual({ status: 200, json: { deleted: 0 } });
  });
});

describe("calling: the way in", () => {
  const SITE = "https://app.example.com";
  type Res = { statusCode: number; body: unknown; headers: Record<string, string>; status(c: number): Res; json(b: unknown): Res; send(b: unknown): Res; setHeader(k: string, v: string): Res };
  const res = (): Res => {
    const r: Res = {
      statusCode: 200,
      body: undefined,
      headers: {},
      status(c) {
        r.statusCode = c;
        return r;
      },
      json(b) {
        r.body = b;
        return r;
      },
      send(b) {
        r.body = b;
        return r;
      },
      setHeader(k, v) {
        r.headers[k.toLowerCase()] = v;
        return r;
      },
    };
    return r;
  };
  const handlerDeps = (over: Partial<VoiceHandlerDeps> = {}): VoiceHandlerDeps => ({
    signedIn: vi.fn(async () => ({ id: OWNER })),
    route: vi.fn(async () => ({ status: 200, json: { ok: true } })),
    webhook: vi.fn(async () => "<Response/>"),
    build: () => ({}) as VoiceDeps,
    authToken: () => ENV.TWILIO_AUTH_TOKEN,
    ...over,
  });
  const fields = { AccountSid: CONFIG.accountSid, CallSid: CALL_SID, From: "client:x", callId: "abc" };
  const providerReq = (url: string, signature: string, host = "app.example.com") =>
    ({ method: "POST", url, headers: { host, "x-twilio-signature": signature }, query: Object.fromEntries(new URL(SITE + url).searchParams), body: fields }) as never;

  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_SITE_URL = SITE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("answers the provider only when its signature matches the address and the fields", async () => {
    const url = "/api/voice?path=twiml";
    const good = getExpectedTwilioSignature(ENV.TWILIO_AUTH_TOKEN, SITE + url, fields);
    const d = handlerDeps();
    const ok = res();
    await voiceHandler(d)(providerReq(url, good), ok as never);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/xml");
    expect(ok.body).toBe("<Response/>");
    expect(d.webhook).toHaveBeenCalledWith(expect.anything(), { what: "twiml", base: SITE, query: {}, params: fields });
    expect(d.signedIn).not.toHaveBeenCalled();

    for (const bad of [getExpectedTwilioSignature("another-token-0123456789", SITE + url, fields), getExpectedTwilioSignature(ENV.TWILIO_AUTH_TOKEN, SITE + url, { ...fields, callId: "other" }), ""]) {
      const d2 = handlerDeps();
      const no = res();
      await voiceHandler(d2)(providerReq(url, bad), no as never);
      expect(no.statusCode).toBe(403);
      expect(d2.webhook).not.toHaveBeenCalled();
    }
  });

  it("checks the call id in the address too", async () => {
    const url = "/api/voice?path=done&call=one";
    const signature = getExpectedTwilioSignature(ENV.TWILIO_AUTH_TOKEN, SITE + url, fields);
    const d = handlerDeps();
    const ok = res();
    await voiceHandler(d)(providerReq(url, signature), ok as never);
    expect(d.webhook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ what: "done", query: { call: "one" } }));
    // The same signature does not open another call's address.
    expect(signedOrigin(providerReq("/api/voice?path=done&call=two", signature), ENV.TWILIO_AUTH_TOKEN, fields)).toBeNull();
  });

  it("answers the provider 503 while calling is not set up", async () => {
    const out = res();
    await voiceHandler(handlerDeps({ authToken: () => null }))(providerReq("/api/voice?path=twiml", "x"), out as never);
    expect(out.statusCode).toBe(503);
  });

  it("lets the page in only from our own site and signed in", async () => {
    const pageReq = (over: Record<string, unknown> = {}) => ({ method: "GET", url: "/api/voice?path=setup", headers: { origin: SITE }, query: { path: "setup" }, body: {}, ...over }) as never;
    const d = handlerDeps();
    const ok = res();
    await voiceHandler(d)(pageReq(), ok as never);
    expect(ok.body).toEqual({ ok: true });
    expect(d.route).toHaveBeenCalledWith(expect.anything(), { method: "GET", path: ["setup"], body: {}, query: {}, user: { id: OWNER } });

    const foreign = res();
    await voiceHandler(handlerDeps())(pageReq({ headers: { origin: "https://evil.example" } }), foreign as never);
    expect(foreign.statusCode).toBe(403);

    const signedOut = handlerDeps({ signedIn: vi.fn(async (_req, r) => (r.status(401).json({ error: "Please sign in to use this tool." }), null)) as never });
    const out = res();
    await voiceHandler(signedOut)(pageReq(), out as never);
    expect(out.statusCode).toBe(401);
    expect(signedOut.route).not.toHaveBeenCalled();

    // A provider path is never answered to a page: it has no signature.
    const d3 = handlerDeps();
    const twiml = res();
    await voiceHandler(d3)(pageReq({ method: "POST", url: "/api/voice?path=twiml", query: { path: "twiml" } }), twiml as never);
    expect(twiml.statusCode).toBe(403);
    expect(d3.webhook).not.toHaveBeenCalled();
  });
});

describe("vercel.json", () => {
  const v = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));

  it("sends /api/voice/* to the function, before the rewrite that serves the app", () => {
    const at = v.rewrites.findIndex((r: { source: string }) => r.source === "/api/voice/:path*");
    const spa = v.rewrites.findIndex((r: { destination: string }) => r.destination === "/index.html");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(v.rewrites[at].destination).toBe("/api/voice?path=:path*");
    expect(spa).toBeGreaterThan(at);
    expect(v.functions["api/voice.ts"]).toEqual({ maxDuration: 60 });
  });
});

describe("migration 188", () => {
  const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/188_crm_calls.sql"), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("adds one table, can be run twice, and gives the browser no access", () => {
    expect([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(["crm_calls"]);
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(code).toContain("alter table public.crm_calls enable row level security");
    expect(code).toContain("revoke all on public.crm_calls from public, anon, authenticated");
    expect(code).not.toMatch(/create policy/i);
    expect(raw.toLowerCase()).toContain("safe to run more than once");
  });

  it("has a column for everything the server writes", () => {
    const store = readFileSync(resolve(process.cwd(), "api/_voice/store.ts"), "utf8");
    for (const col of ["organization_id", "workspace_id", "user_id", "contact_id", "company_id", "to_number", "from_number", "country", "status", "twilio_call_sid", "duration_seconds", "recording_sid", "recording_seconds", "outcome", "note", "created_at", "ended_at", "updated_at"]) {
      expect(code, col).toMatch(new RegExp(`\\n\\s+${col} `));
      expect(store, col).toContain(col);
    }
    expect(TABLES_MISSING_MESSAGE).toContain("188_crm_calls.sql");
  });
});
