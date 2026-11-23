import type { CallCountry } from "./shared/numbers.js";

/**
 * The instructions the phone provider fetches for a call (TwiML, a small XML
 * document). Every value that goes into one is escaped here.
 */

export const xml = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

/** Longest a call may ring before it counts as not answered, and longest it may last (seconds). */
export const RING_SECONDS = 30;
export const MAX_CALL_SECONDS = 2 * 60 * 60;

/** What the person called hears as soon as they answer, before they are connected. */
export const RECORDING_NOTICE = "This call is being recorded.";

/** Where the provider reaches this server for one call: /api/voice?path=<what>&call=<id>. */
export const callbackUrl = (base: string, what: string, callId: string, extra = ""): string =>
  `${base}/api/voice?path=${what}&call=${encodeURIComponent(callId)}${extra}`;

/**
 * Ring `to` from `callerId` and connect the browser once it is answered.
 * The call is recorded from the moment it is answered (both sides, one channel
 * each), after the person called has heard the notice.
 */
export function dialTwiml(a: { base: string; callId: string; to: string; callerId: string; country: CallCountry }): string {
  const notice = callbackUrl(a.base, "notice", a.callId, `&country=${a.country}`);
  return (
    HEAD +
    "<Response>" +
    // ringTone: the caller hears that country's ringing straight away, also when the other side's phone company sends none.
    `<Dial callerId="${xml(a.callerId)}" answerOnBridge="true" ringTone="${a.country === "GB" ? "uk" : "us"}" timeout="${RING_SECONDS}" timeLimit="${MAX_CALL_SECONDS}"` +
    ` record="record-from-answer-dual" recordingStatusCallback="${xml(callbackUrl(a.base, "recording", a.callId))}"` +
    ` recordingStatusCallbackEvent="completed" action="${xml(callbackUrl(a.base, "done", a.callId))}" method="POST">` +
    `<Number url="${xml(notice)}" method="POST">${xml(a.to)}</Number>` +
    "</Dial>" +
    "</Response>"
  );
}

/** The recording notice, spoken to the person called in their own accent. */
export function noticeTwiml(country: CallCountry): string {
  return `${HEAD}<Response><Say language="${country === "GB" ? "en-GB" : "en-US"}">${xml(RECORDING_NOTICE)}</Say></Response>`;
}

/** End the call, optionally after one spoken sentence to the caller. */
export function hangupTwiml(say?: string): string {
  return `${HEAD}<Response>${say ? `<Say>${xml(say)}</Say>` : ""}<Hangup/></Response>`;
}

/** Nothing more to do. */
export const emptyTwiml = (): string => `${HEAD}<Response/>`;
