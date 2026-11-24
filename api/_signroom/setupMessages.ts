/**
 * What to tell the owner when the database is behind the code: which SQL file
 * to run. The files are run by hand in the Supabase SQL editor, so the server
 * must work with 184 alone (invoices, agreements, email through the platform)
 * and name 186 only for the parts that 186 adds.
 */
export const TABLES_MISSING_MESSAGE =
  "Documents are not set up yet: the database tables are missing. Run supabase/migrations/184_signroom.sql in the Supabase SQL editor.";

export const MORE_MISSING_MESSAGE =
  "This part of Documents is not set up yet: run supabase/migrations/186_signroom_more.sql in the Supabase SQL editor.";

export const SERVICE_LINK_MISSING_MESSAGE =
  "Invoices cannot be tied to a client's service yet: run supabase/crm_setup.sql in the Supabase SQL editor, then try again.";

/** What 210 adds to the invoices table. */
const ADDED_BY_210 = ["crm_account_id", "crm_billing_month"];

/** What 186 adds: its tables (sr_email_oauth_states is covered by sr_email_oauth) and its one new column. */
const ADDED_BY_186 = ["sr_projects", "sr_ai_usage", "sr_mailboxes", "sr_email_oauth", "project_id"];

/**
 * 184's rule for templates, which 186 relaxes so a template can be renamed or
 * deleted. Until 186 is run the database still answers with this sentence.
 */
const TEMPLATES_FROZEN = "templates cannot change";

/**
 * The sentence for a database error that means "a migration has not been run",
 * or null for any other error. Supabase says a table, column or function is
 * not there in two ways ("... in the schema cache", "... does not exist").
 */
export function setupSentence(message: string): string | null {
  const m = String(message ?? "").toLowerCase();
  if (m.includes(TEMPLATES_FROZEN)) return MORE_MISSING_MESSAGE;
  if (!m.includes("schema cache") && !m.includes("does not exist")) return null;
  // The tie between an invoice and a client's service (the lead's Accounts tab) is newer still.
  if (ADDED_BY_210.some((name) => m.includes(name))) return SERVICE_LINK_MISSING_MESSAGE;
  if (ADDED_BY_186.some((name) => m.includes(name))) return MORE_MISSING_MESSAGE;
  return m.includes("sr_") ? TABLES_MISSING_MESSAGE : null;
}
