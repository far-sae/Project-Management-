import type { VoiceConfig } from "./config.js";

/**
 * Asks the phone provider (Twilio) itself whether the settings work: the Auth
 * Token, the API key, the TwiML app and the numbers. A setting can have the
 * right shape and still be wrong (a secret from another key, a key made in
 * another region, an app that points somewhere else), and the provider then
 * refuses the call with nothing a person can act on. This names the setting.
 *
 * Only a definite answer from the provider counts. When it cannot be reached,
 * or answers in a way this does not know, nothing is reported: a failing check
 * must never be the reason calls stop working.
 */

export const AUTH_TOKEN_MESSAGE =
  "Twilio did not accept TWILIO_AUTH_TOKEN for the account in TWILIO_ACCOUNT_SID. Copy both again from the Twilio console's home page, save them in Vercel's environment variables and redeploy.";
export const API_KEY_MESSAGE =
  "Twilio did not accept the API key. TWILIO_API_KEY_SECRET must be the secret shown once when the key in TWILIO_API_KEY_SID was created, and that key must belong to the account in TWILIO_ACCOUNT_SID. The quickest fix: in Twilio create a new Standard API key (region United States, US1), put its SID and secret in Vercel's environment variables and redeploy.";
export const apiKeyRegionMessage = (region: string): string =>
  `The API key in TWILIO_API_KEY_SID was created in Twilio's ${region} region, and calls run in the United States (US1) region. In Twilio create a new Standard API key with the region set to United States (US1), put its SID and secret in Vercel's environment variables and redeploy.`;
export const APP_MISSING_MESSAGE =
  "TWILIO_TWIML_APP_SID is not a TwiML app of this Twilio account. In Twilio open Voice, then TwiML apps, and copy the app's SID (it starts with AP).";
export const appUrlMessage = (expected: string): string =>
  `The TwiML app in Twilio must have its Voice Request URL set to ${expected} with the method POST. Change it in Twilio under Voice, then TwiML apps.`;
export const numberMessage = (setting: string): string =>
  `The number in ${setting} is not a phone number of this Twilio account. Use a number you bought in this account, written like +14155550132.`;
export const accountStatusMessage = (status: string): string => `Your Twilio account is ${status}, so it cannot place calls. Check the account in the Twilio console.`;

/** Other regions a key may have been made in, and the address the provider answers at for each. */
const OTHER_REGIONS: Array<[string, string]> = [
  ["api.dublin.ie1.twilio.com", "Ireland (IE1)"],
  ["api.sydney.au1.twilio.com", "Australia (AU1)"],
];

const TIMEOUT_MS = 6000;

type Reply = { status: number; body: Record<string, unknown> } | null;

async function ask(fetchFn: typeof fetch, host: string, path: string, user: string, pass: string): Promise<Reply> {
  try {
    const r = await fetchFn(`https://${host}/2010-04-01/Accounts/${path}`, {
      headers: { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"), Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await r.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: r.status, body };
  } catch {
    return null;
  }
}

/** True when the app's address is this site's calling address: https, our host (or its www twin), /api/voice?path=twiml. */
function isOurVoiceUrl(value: unknown, site: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value.trim());
    const host = new URL(site).hostname.toLowerCase();
    const twin = host.startsWith("www.") ? host.slice(4) : "www." + host;
    return u.protocol === "https:" && [host, twin].includes(u.hostname.toLowerCase()) && u.pathname === "/api/voice" && u.searchParams.get("path") === "twiml";
  } catch {
    return false;
  }
}

/** What is wrong with the settings, as one sentence that names the setting and never its value, or null. */
export async function checkAccount(config: VoiceConfig, fetchFn: typeof fetch, site: string | null): Promise<string | null> {
  const us1 = "api.twilio.com";
  const ac = config.accountSid;
  const app = `${ac}/Applications/${config.appSid}.json`;
  const [account, keyed] = await Promise.all([
    ask(fetchFn, us1, `${ac}.json`, ac, config.authToken),
    // An API key may not read the account itself, so it is tried on the TwiML app.
    ask(fetchFn, us1, app, config.apiKeySid, config.apiKeySecret),
  ]);

  if (account?.status === 401) return AUTH_TOKEN_MESSAGE;
  if (account?.status === 200 && typeof account.body.status === "string" && account.body.status !== "active") return accountStatusMessage(account.body.status);

  if (keyed?.status === 401) {
    for (const [host, region] of OTHER_REGIONS) {
      const there = await ask(fetchFn, host, `${ac}/Applications.json?PageSize=1`, config.apiKeySid, config.apiKeySecret);
      if (there?.status === 200) return apiKeyRegionMessage(region);
    }
    return API_KEY_MESSAGE;
  }

  // The rest needs the Auth Token to have worked.
  if (account?.status !== 200) return null;

  const found = await ask(fetchFn, us1, app, ac, config.authToken);
  if (found?.status === 404) return APP_MISSING_MESSAGE;
  if (found?.status === 200 && site) {
    const method = typeof found.body.voice_method === "string" ? found.body.voice_method.toUpperCase() : "POST";
    if (!isOurVoiceUrl(found.body.voice_url, site) || method !== "POST") return appUrlMessage(`${site}/api/voice?path=twiml`);
  }

  const settings: Array<["US" | "GB", string]> = [["US", "TWILIO_NUMBER_US"], ["GB", "TWILIO_NUMBER_UK"]];
  for (const [country, setting] of settings) {
    const number = config.numbers[country];
    if (!number) continue;
    const q = `?PhoneNumber=${encodeURIComponent(number)}&PageSize=1`;
    const bought = await ask(fetchFn, us1, `${ac}/IncomingPhoneNumbers.json${q}`, ac, config.authToken);
    if (bought?.status !== 200) continue;
    if (Array.isArray(bought.body.incoming_phone_numbers) && bought.body.incoming_phone_numbers.length > 0) continue;
    // A number verified as a caller ID may be called from as well.
    const verified = await ask(fetchFn, us1, `${ac}/OutgoingCallerIds.json${q}`, ac, config.authToken);
    if (verified?.status !== 200) continue;
    if (Array.isArray(verified.body.outgoing_caller_ids) && verified.body.outgoing_caller_ids.length > 0) continue;
    return numberMessage(setting);
  }
  return null;
}

/** How long an answer is kept: a good one for ten minutes, a problem for half a minute (so a fix shows soon). */
export const GOOD_FOR_MS = 10 * 60_000;
export const PROBLEM_FOR_MS = 30_000;

/** checkAccount, remembered for a while so opening a lead does not ask the provider every time. */
export function accountChecker(fetchFn: typeof fetch, site: () => string | null, now: () => number = Date.now) {
  let kept: { key: string; at: number; problem: string | null } | null = null;
  return async (config: VoiceConfig): Promise<string | null> => {
    const key = [config.accountSid, config.apiKeySid, config.appSid, config.numbers.US ?? "", config.numbers.GB ?? "", config.authToken.length, config.apiKeySecret.length].join("|");
    if (kept && kept.key === key && now() - kept.at < (kept.problem ? PROBLEM_FOR_MS : GOOD_FOR_MS)) return kept.problem;
    const problem = await checkAccount(config, fetchFn, site());
    kept = { key, at: now(), problem };
    return problem;
  };
}
