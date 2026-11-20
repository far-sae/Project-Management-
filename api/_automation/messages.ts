/**
 * The sentences the automation server answers with when it refuses, so every
 * module and every test names the same words. Each one is safe to show on the
 * page: it names a setting or a file, never a value.
 */

export const NOT_FOUND_MESSAGE = "Not found.";
export const FAILED_MESSAGE = "Something went wrong. Please try again.";
export const BODY_TOO_LARGE_MESSAGE = "That request is too large.";

/** A workspace the caller does not belong to (or only views), or none chosen. */
export const CHOOSE_WORKSPACE_MESSAGE = "Choose a workspace.";
export const OWNER_ONLY_MESSAGE = "Only a workspace owner or admin can change the automation.";
export const NOT_YOUR_LEAD_MESSAGE = "Only a workspace owner or admin, or the person who owns this lead, can do that.";

export const TABLES_MISSING_MESSAGE = "Automation is not set up yet: run supabase/migrations/187_automation.sql in the Supabase SQL editor.";
export const AI_OFF_MESSAGE = "The automation's AI is not set up yet: ANTHROPIC_API_KEY is missing in Vercel's environment variables.";
export const DATABASE_KEY_MESSAGE = "Automation is not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel's environment variables.";
export const DATABASE_URL_MESSAGE = "Automation is not set up yet: SUPABASE_URL is missing in Vercel's environment variables.";

export const NOT_SET_UP_MESSAGE = "Set up automation for this workspace first.";
export const STALE_MESSAGE = "This was changed by someone else while you were editing. Reload and try again.";
export const AI_FAILED_MESSAGE = "The AI could not answer just now. Please try again in a moment.";
export const AI_REFUSED_MESSAGE = "The AI declined to answer this. Try rewording it.";
export const AI_INCOMPLETE_MESSAGE = "The AI's answer was cut short. Try again, or ask for something smaller.";
export const NO_LEAD_MESSAGE = "Add a lead first: there is no lead in this workspace to test on.";
export const ALREADY_DECIDED_MESSAGE = "This approval was already decided.";
export const AUTOMATION_NAME_TAKEN = "This workspace already has an automation with that name.";
export const SWITCHED_OFF_MESSAGE = "Automation is switched off in this workspace. Switch it on in the workspace rules first.";
export const RUN_OVER_MESSAGE = "This run has already ended.";

/**
 * The sentence for a database error that means "migration 187 has not been
 * run", or null for any other error. Supabase says a table or column is not
 * there in two ways ("... in the schema cache", "... does not exist").
 */
export function setupSentence(message: string): string | null {
  const m = String(message ?? "").toLowerCase();
  if (!m.includes("schema cache") && !m.includes("does not exist")) return null;
  return m.includes("auto_") ? TABLES_MISSING_MESSAGE : null;
}
