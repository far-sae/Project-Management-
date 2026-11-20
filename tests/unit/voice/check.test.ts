// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readConfig, type VoiceConfig } from "../../../api/_voice/config";
import {
  accountChecker,
  API_KEY_MESSAGE,
  apiKeyRegionMessage,
  APP_MISSING_MESSAGE,
  appUrlMessage,
  AUTH_TOKEN_MESSAGE,
  checkAccount,
  numberMessage,
} from "../../../api/_voice/check";

/**
 * Asking the phone provider itself whether the settings work, so a wrong one
 * is named in the Call window before anyone tries to call. Nothing here
 * touches the network.
 */

const HEX = "0123456789abcdef0123456789abcdef";
const CONFIG = readConfig({
  TWILIO_ACCOUNT_SID: "AC" + HEX,
  TWILIO_AUTH_TOKEN: "auth-token-for-tests-0123456789",
  TWILIO_API_KEY_SID: "SK" + HEX,
  TWILIO_API_KEY_SECRET: "api-key-secret-for-tests-0123456789",
  TWILIO_TWIML_APP_SID: "AP" + HEX,
  TWILIO_NUMBER_US: "+14155550100",
  TWILIO_NUMBER_UK: "+442079460000",
}).config as VoiceConfig;
const SITE = "https://app.example.com";
const VOICE_URL = `${SITE}/api/voice?path=twiml`;

const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const TOKEN = basic(CONFIG.accountSid, CONFIG.authToken);
const KEY = basic(CONFIG.apiKeySid, CONFIG.apiKeySecret);

type World = {
  tokenOk: boolean;
  keyOk: boolean;
  /** The region host the key works on, when it is not the usual one. */
  keyRegion: "ie1" | "au1" | null;
  account: Record<string, unknown>;
  app: Record<string, unknown> | null;
  numbers: string[];
  callerIds: string[];
  broken: boolean;
};

function twilio(over: Partial<World> = {}) {
  const w: World = {
    tokenOk: true,
    keyOk: true,
    keyRegion: null,
    account: { status: "active", type: "Full" },
    app: { voice_url: VOICE_URL, voice_method: "POST" },
    numbers: ["+14155550100", "+442079460000"],
    callerIds: [],
    broken: false,
    ...over,
  };
  const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
    if (w.broken) throw new Error("network down");
    const url = new URL(input);
    const auth = init?.headers?.Authorization ?? "";
    if (url.hostname !== "api.twilio.com") {
      const region = url.hostname.split(".")[2];
      return auth === KEY && w.keyRegion === region ? json(200, { applications: [] }) : json(401);
    }
    if (auth === TOKEN ? !w.tokenOk : auth === KEY ? !w.keyOk : true) return json(401, { code: 20003 });
    const path = url.pathname;
    if (path.endsWith(`/Accounts/${CONFIG.accountSid}.json`)) return json(200, w.account);
    if (path.endsWith(`/Applications/${CONFIG.appSid}.json`)) return w.app ? json(200, w.app) : json(404);
    const asked = url.searchParams.get("PhoneNumber") ?? "";
    if (path.endsWith("/IncomingPhoneNumbers.json")) return json(200, { incoming_phone_numbers: w.numbers.includes(asked) ? [{ phone_number: asked }] : [] });
    if (path.endsWith("/OutgoingCallerIds.json")) return json(200, { outgoing_caller_ids: w.callerIds.includes(asked) ? [{ phone_number: asked }] : [] });
    return json(404);
  });
  return { w, fetch: fetchMock as never, calls: fetchMock };
}

describe("calling: asking the provider whether the settings work", () => {
  it("finds nothing wrong with settings that work", async () => {
    const t = twilio();
    expect(await checkAccount(CONFIG, t.fetch, SITE)).toBeNull();
    // Nothing but the provider's own address was asked, and no secret went into an address.
    for (const [url] of t.calls.mock.calls) {
      expect(String(url).startsWith("https://api.twilio.com/2010-04-01/Accounts/" + CONFIG.accountSid)).toBe(true);
      expect(String(url)).not.toContain(CONFIG.authToken);
      expect(String(url)).not.toContain(CONFIG.apiKeySecret);
    }
  });

  it("names the Auth Token when the provider refuses it", async () => {
    expect(await checkAccount(CONFIG, twilio({ tokenOk: false }).fetch, SITE)).toBe(AUTH_TOKEN_MESSAGE);
  });

  it("names the API key when the provider refuses it, which is what stops a call from starting", async () => {
    const out = await checkAccount(CONFIG, twilio({ keyOk: false }).fetch, SITE);
    expect(out).toBe(API_KEY_MESSAGE);
    expect(out).toContain("TWILIO_API_KEY_SECRET");
    expect(out).not.toContain(CONFIG.apiKeySecret);
  });

  it("says so when the API key was made in another region", async () => {
    expect(await checkAccount(CONFIG, twilio({ keyOk: false, keyRegion: "ie1" }).fetch, SITE)).toBe(apiKeyRegionMessage("Ireland (IE1)"));
    expect(await checkAccount(CONFIG, twilio({ keyOk: false, keyRegion: "au1" }).fetch, SITE)).toBe(apiKeyRegionMessage("Australia (AU1)"));
  });

  it("names the TwiML app when it is not there or points somewhere else", async () => {
    expect(await checkAccount(CONFIG, twilio({ app: null }).fetch, SITE)).toBe(APP_MISSING_MESSAGE);
    expect(await checkAccount(CONFIG, twilio({ app: { voice_url: "", voice_method: "POST" } }).fetch, SITE)).toBe(appUrlMessage(VOICE_URL));
    expect(await checkAccount(CONFIG, twilio({ app: { voice_url: `${SITE}/api/voice/twiml`, voice_method: "POST" } }).fetch, SITE)).toBe(appUrlMessage(VOICE_URL));
    expect(await checkAccount(CONFIG, twilio({ app: { voice_url: "https://other.example/api/voice?path=twiml", voice_method: "POST" } }).fetch, SITE)).toBe(appUrlMessage(VOICE_URL));
    expect(await checkAccount(CONFIG, twilio({ app: { voice_url: VOICE_URL, voice_method: "GET" } }).fetch, SITE)).toBe(appUrlMessage(VOICE_URL));
    // The www twin of the site is the same site.
    expect(await checkAccount(CONFIG, twilio({ app: { voice_url: "https://www.app.example.com/api/voice?path=twiml", voice_method: "POST" } }).fetch, SITE)).toBeNull();
  });

  it("names a number that is not on the account, and accepts a verified caller ID", async () => {
    expect(await checkAccount(CONFIG, twilio({ numbers: ["+14155550100"] }).fetch, SITE)).toBe(numberMessage("TWILIO_NUMBER_UK"));
    expect(await checkAccount(CONFIG, twilio({ numbers: ["+442079460000"] }).fetch, SITE)).toBe(numberMessage("TWILIO_NUMBER_US"));
    expect(await checkAccount(CONFIG, twilio({ numbers: ["+14155550100"], callerIds: ["+442079460000"] }).fetch, SITE)).toBeNull();
  });

  it("says when the account itself is closed or suspended", async () => {
    expect(await checkAccount(CONFIG, twilio({ account: { status: "suspended", type: "Full" } }).fetch, SITE)).toContain("suspended");
  });

  it("never blocks calling because the provider could not be reached", async () => {
    expect(await checkAccount(CONFIG, twilio({ broken: true }).fetch, SITE)).toBeNull();
  });

  it("asks again only after a while", async () => {
    let now = 0;
    const bad = twilio({ keyOk: false });
    const check = accountChecker(bad.fetch, () => SITE, () => now);
    expect(await check(CONFIG)).toBe(API_KEY_MESSAGE);
    const asked = bad.calls.mock.calls.length;
    expect(await check(CONFIG)).toBe(API_KEY_MESSAGE);
    expect(bad.calls.mock.calls.length).toBe(asked);
    // A problem is asked about again soon, so a fix shows up quickly.
    now += 31_000;
    bad.w.keyOk = true;
    expect(await check(CONFIG)).toBeNull();
    const afterFix = bad.calls.mock.calls.length;
    now += 5 * 60_000;
    expect(await check(CONFIG)).toBeNull();
    expect(bad.calls.mock.calls.length).toBe(afterFix);
    now += 6 * 60_000;
    await check(CONFIG);
    expect(bad.calls.mock.calls.length).toBeGreaterThan(afterFix);
  });
});
