/**
 * What a person may read when something goes wrong.
 *
 * Every message on its way to the screen goes through here. Three kinds:
 *
 *   1. Our own sentences ("Title is required"). Shown as they are.
 *   2. Raw errors from the database, the network or the browser ("relation
 *      crm_calls does not exist", "Failed to fetch", "x is not a function").
 *      Never shown to anybody: they mean nothing to the reader and describe the
 *      inside of the product. A plain sentence takes their place.
 *   3. Set-up messages ("run supabase/migrations/199... in the SQL editor",
 *      "TWILIO_AUTH_TOKEN is missing in Vercel"). Shown only to the people who
 *      run the site (see platform.ts). Everybody else reads that the feature
 *      is not switched on yet.
 */

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';
export const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.';
export const PERMISSION_MESSAGE = 'You do not have permission to do this.';
export const SIGN_IN_MESSAGE = 'Please sign in again.';
export const NOT_ON_YET_MESSAGE = 'This is not switched on yet. Please contact support.';

const NETWORK = /failed to fetch|networkerror|load failed|fetch failed|econnrefused|etimedout|getaddrinfo|network request failed/i;
const PERMISSION = /row-level security|permission denied for/i;
const SIGN_IN = /\bjwt\b.*(expired|invalid|malformed)|invalid jwt|refresh token/i;

/** The marks of an error written by a database, a network stack or a JavaScript engine. */
const TECHNICAL = new RegExp(
  [
    'row-level security', 'violates \\w[\\w -]* constraint', 'duplicate key value', 'relation "[^"]+"',
    'column "?[\\w.]+"? (of relation|does not exist)', 'schema cache', 'PGRST\\d{3}', 'permission denied for',
    '\\bJWT\\b', 'invalid input syntax', 'null value in column', 'foreign key constraint', 'syntax error at',
    'SQLSTATE', 'function [\\w.]+\\(.*\\) does not exist', "could not find the (table|function|'\\w+' column)",
    'is not a function', 'cannot read propert', 'cannot access', 'is not defined', 'is not iterable',
    'unexpected token', 'unexpected end of', 'status code \\d{3}', '\\b(Type|Reference|Syntax|Range)Error\\b',
    '^\\s*[{\\[]\\s*"', 'at [\\w.<>]+ \\(.*:\\d+:\\d+\\)',
  ].join('|'),
  'i',
);

/** The marks of a message about how the site is set up. */
const INTERNAL_WORDS = /supabase|migrations\/|\.sql\b|sql editor|vercel|railway|environment variable/i;
/** A setting's name, written the way settings are: TWILIO_AUTH_TOKEN. Capitals matter here. */
const SETTING_NAME = /\b[A-Z][A-Z0-9]{2,}(_[A-Z0-9]+)+\b/;

export const isTechnical = (text: string): boolean => NETWORK.test(text) || TECHNICAL.test(text);
export const isInternal = (text: string): boolean => INTERNAL_WORDS.test(text) || SETTING_NAME.test(text);

// Hidden until the app learns who is looking. A public page (a web form, a
// document to sign) never learns it, and so never shows a set-up message.
let internalsVisible = false;

const listeners = new Set<() => void>();

/** Called by the app when it knows whether this person runs the site. */
export function setInternalsVisible(visible: boolean): void {
  if (internalsVisible === visible) return;
  internalsVisible = visible;
  for (const tell of listeners) tell();
}

/** For screens that show or hide set-up words: be told when the answer changes. */
export function onInternalsChange(tell: () => void): () => void {
  listeners.add(tell);
  return () => { listeners.delete(tell); };
}

export const internalsAreVisible = (): boolean => internalsVisible;

/** A message as this person may read it. `fallback` is what the caller would say itself. */
export function publicText(text: string, fallback: string = GENERIC_MESSAGE): string {
  const message = text.trim();
  if (!message) return fallback;
  if (NETWORK.test(message)) return NETWORK_MESSAGE;
  if (PERMISSION.test(message)) return PERMISSION_MESSAGE;
  if (SIGN_IN.test(message)) return SIGN_IN_MESSAGE;
  if (TECHNICAL.test(message)) return fallback;
  if (isInternal(message)) return internalsVisible ? message : NOT_ON_YET_MESSAGE;
  return message;
}

/**
 * The sentence for an error of any shape: an Error, one of the database's
 * plain `{ message }` objects, a string that was thrown, or nothing at all.
 */
export function publicMessage(error: unknown, fallback: string = GENERIC_MESSAGE): string {
  const text =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message: string }).message)
        : '';
  return publicText(text, fallback);
}
