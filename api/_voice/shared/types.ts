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
