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
 * True for the timeline entry of a call placed from the CRM in which the lead
 * was not spoken to (nobody answered, busy, voicemail, wrong number). Such an
 * entry is a record that someone tried; it is not the lead getting in touch.
 * Anything a person typed themselves is never judged here.
 */
export function isUnansweredCallEntry(description: string): boolean {
  const summary = String(description ?? "").split("\n")[0];
  if (!/^Called \+\d/.test(summary)) return false;
  const sentences = [...Object.values(STATUS_SENTENCE), ...NOT_SPOKEN_TO.map((o) => `${OUTCOME_LABEL[o]}.`)];
  return sentences.some((sentence) => summary.includes(` ${sentence}`));
}

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
export type StartCallInput = { contactId?: string; companyId?: string; to: string; country?: CallCountry };
export type StartedCall = { id: string; to: string; display: string; country: CallCountry; token: string };

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
};

export type CallSummary = { days: number; total: number; answered: number; seconds: number };

export type CallList = { calls: CallListItem[]; more: boolean; summary: CallSummary };
