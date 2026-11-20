import { dialable, type CallCountry } from "./shared/numbers.js";

/**
 * The phone provider's settings (Twilio), read from Vercel's environment
 * variables. Nothing here is ever sent to a browser except the short-lived
 * token made from it, and a sentence naming a setting that is missing.
 */

export type VoiceConfig = {
  accountSid: string;
  /** Checks that a request really came from the provider, and reads recordings. */
  authToken: string;
  /** Signs the short-lived token a browser calls with. */
  apiKeySid: string;
  apiKeySecret: string;
  /** The provider's "TwiML app": where it asks what to do with a call from a browser. */
  appSid: string;
  /** The numbers calls come from, by the country they ring. */
  numbers: Partial<Record<CallCountry, string>>;
};

export type ConfigState =
  | { configured: false; config: null; problem: null }
  | { configured: true; config: null; problem: string }
  | { configured: true; config: VoiceConfig; problem: null };

const REQUIRED: Array<[keyof Omit<VoiceConfig, "numbers">, string, RegExp]> = [
  ["accountSid", "TWILIO_ACCOUNT_SID", /^AC[0-9a-fA-F]{32}$/],
  ["authToken", "TWILIO_AUTH_TOKEN", /^\S{16,}$/],
  ["apiKeySid", "TWILIO_API_KEY_SID", /^SK[0-9a-fA-F]{32}$/],
  ["apiKeySecret", "TWILIO_API_KEY_SECRET", /^\S{16,}$/],
  ["appSid", "TWILIO_TWIML_APP_SID", /^AP[0-9a-fA-F]{32}$/],
];

const NUMBERS: Array<[CallCountry, string, string]> = [
  ["US", "TWILIO_NUMBER_US", "a United States number written like +14155550132"],
  ["GB", "TWILIO_NUMBER_UK", "a United Kingdom number written like +442079460958"],
];

export const missingSetting = (name: string): string => `Calling is not set up yet: ${name} is missing in Vercel's environment variables.`;
export const wrongSetting = (name: string, shape: string): string => `Calling is not set up yet: ${name} in Vercel's environment variables must be ${shape}.`;

const SHAPE: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "the Account SID, which starts with AC",
  TWILIO_AUTH_TOKEN: "the account's Auth Token",
  TWILIO_API_KEY_SID: "the API key's SID, which starts with SK",
  TWILIO_API_KEY_SECRET: "the API key's secret",
  TWILIO_TWIML_APP_SID: "the TwiML app's SID, which starts with AP",
};

/** The settings, or the first thing still missing as a sentence that names the setting and never its value. */
export function readConfig(env: Record<string, string | undefined> = process.env): ConfigState {
  const value = (name: string) => (env[name] ?? "").trim();
  const names = [...REQUIRED.map((r) => r[1]), ...NUMBERS.map((n) => n[1])];
  if (!names.some((n) => value(n))) return { configured: false, config: null, problem: null };

  const out: Partial<VoiceConfig> = {};
  for (const [key, name, shape] of REQUIRED) {
    const v = value(name);
    if (!v) return { configured: true, config: null, problem: missingSetting(name) };
    if (!shape.test(v)) return { configured: true, config: null, problem: wrongSetting(name, SHAPE[name]) };
    out[key] = v;
  }
  const numbers: Partial<Record<CallCountry, string>> = {};
  for (const [country, name, shape] of NUMBERS) {
    const v = value(name);
    if (!v) continue;
    const n = v.startsWith("+") ? dialable(v) : null;
    if (!n || !n.ok || n.country !== country) return { configured: true, config: null, problem: wrongSetting(name, shape) };
    numbers[country] = n.e164;
  }
  if (!numbers.US && !numbers.GB) return { configured: true, config: null, problem: missingSetting("TWILIO_NUMBER_US or TWILIO_NUMBER_UK") };
  return { configured: true, config: { ...(out as Omit<VoiceConfig, "numbers">), numbers }, problem: null };
}
