import type { CallCountry } from "./numbers.js";

/** What the page and the calling server say to each other. */

/** How a call went, as the person who made it says. */
export const OUTCOMES = ["connected", "no_answer", "voicemail", "busy", "wrong_number"] as const;
export type CallOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  connected: "Spoke to them",
  no_answer: "No answer",
  voicemail: "Left a voicemail",
  busy: "Line was busy",
  wrong_number: "Wrong number",
};

/** Where a call stands: the provider's own words for it, kept short. */
export type CallStatus = "starting" | "ringing" | "completed" | "no_answer" | "busy" | "failed" | "canceled";

/** How a call that was not a conversation is written on the timeline, by how the line ended. */
export const STATUS_SENTENCE: Partial<Record<CallStatus, string>> = {
  no_answer: "No answer.",
  busy: "The line was busy.",
  failed: "The call did not connect.",
  canceled: "Hung up before it was answered.",
};

/** The outcomes a caller can pick that mean the lead was not spoken to. */
const NOT_SPOKEN_TO: CallOutcome[] = ["no_answer", "voicemail", "busy", "wrong_number"];

/**
 * True for the timeline entry of a call in which the lead was not spoken to
 * (nobody answered, busy, voicemail, wrong number). Such an entry is a record
 * that someone tried; it is not the lead getting in touch.
 *
 * Two kinds of entry are recognised: one the dialler wrote ("Called +44…. No
 * answer."), and one a person logged by hand with an outcome picked, which
 * begins with that outcome ("No answer. …"). Free text a person typed is
 * never judged.
 */
export function isUnansweredCallEntry(description: string): boolean {
  const summary = String(description ?? "").split("\n")[0];
  const outcomes = NOT_SPOKEN_TO.map((o) => `${OUTCOME_LABEL[o]}.`);
  if (outcomes.some((sentence) => summary === sentence || summary.startsWith(`${sentence} `))) return true;
  if (!/^Called \+\d/.test(summary)) return false;
  return [...Object.values(STATUS_SENTENCE), ...outcomes].some((sentence) => summary.includes(` ${sentence}`));
}

/** For the people who run the site, when the provider refused a call and gave no reason we could read (yet). */
export const NO_REASON_DETAIL = "The phone provider gave no reason here. It is in the provider's console, under Monitor, Logs, Errors.";

/** GET /api/voice/calls/<id>/result: why a call ended, as the phone provider reported it. */
export type CallResult = {
  /** False while the provider has not said how the call ended yet. */
  final: boolean;
  status: CallStatus;
  /** One plain sentence for the caller. Null when there is nothing to add. */
  sentence: string | null;
  /** What the provider itself said went wrong. For the people who run the site only. */
  detail: string | null;
};

/** GET /api/voice/setup */
export type VoiceSetup = {
  /** False while no phone provider setting exists at all: the Call button then works as it always did. */
  configured: boolean;
  /** True when a call can be placed. */
  ready: boolean;
  /** What is still missing, as one sentence, when configured but not ready. */
  problem: string | null;
  /** Which countries have a number to call from. */
  numbers: Record<CallCountry, boolean>;
};

/** POST /api/voice/calls */
/**
 * A call is placed to a lead (`contactId`), to a company (`companyId`), or, from
 * the dialer, to any number for a workspace (`workspaceId` alone).
 */
export type StartCallInput = { contactId?: string; companyId?: string; workspaceId?: string; to: string; country?: CallCountry };
export type StartedCall = {
  id: string;
  to: string;
  display: string;
  country: CallCountry;
  token: string;
  /** For a dialled number that turned out to be a lead's: the lead the call now belongs to. */
  contact: { id: string; name: string } | null;
};

/** POST /api/voice/calls/<id>/end */
export type EndCallInput = { outcome?: CallOutcome | null; note?: string; seconds?: number; answered?: boolean };

/** What a call leaves on the timeline entry it makes (crm_activities.metadata). */
export type CallActivityMeta = {
  callId: string;
  to: string;
  country: CallCountry;
  status: CallStatus;
  seconds: number;
  outcome: CallOutcome | null;
  recorded: boolean;
};

/** GET /api/voice/calls?workspaceId=<id>[&before=<time>]: the calls of a workspace, newest first. */
export type CallListItem = {
  id: string;
  /** When the call was placed. */
  at: string;
  status: CallStatus;
  seconds: number;
  outcome: CallOutcome | null;
  note: string;
  /** The number rung, in international form and as it is read. */
  to: string;
  display: string;
  country: CallCountry;
  recorded: boolean;
  /** The lead or the company the call was for; null when it has since been deleted. */
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  caller: { id: string; name: string };
  /** 'out': a call we placed. 'in': somebody called one of our numbers back. Absent on an older server: 'out'. */
  direction?: "out" | "in";
  /** Who took a call back. Null when nobody did, and for a call we placed. */
  answeredBy?: string | null;
};

/** Who takes the calls that come in, and how. */
export type CallBackPerson = { name: string; number: string };
export type CallBackSettings = {
  /** False until the database has been given the call-backs table (211). */
  ready: boolean;
  enabled: boolean;
  /** The people rung, in order. */
  people: CallBackPerson[];
  /** How long each phone rings before the next person is tried. */
  ringSeconds: number;
  /** The person who picks up presses a key to take the call, so a phone's voicemail cannot. */
  screen: boolean;
  /** Which of our numbers people can call back. */
  numbers: string[];
  /** After a save: whether the phone provider was told to send incoming calls here. Null when nothing was asked. */
  linked?: boolean | null;
  /** The address to give the phone provider by hand when `linked` is false. */
  address?: string;
};

export type CallSummary = { days: number; total: number; answered: number; seconds: number };

export type CallList = { calls: CallListItem[]; more: boolean; summary: CallSummary };

/** GET /api/voice/contacts/<id>/calls: the calls made to one lead, for a copy of that person's data. */
export type PersonCall = {
  id: string;
  at: string;
  to: string;
  status: string;
  outcome: string | null;
  seconds: number;
  note: string;
  /** True when a recording is kept. The recording itself is not part of the copy. */
  recorded: boolean;
};
export type PersonCalls = { calls: PersonCall[] };
