// Turning "the database is behind" into a sentence that says so.
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// The email feature ships as twelve migrations and the deployment guide says,
// correctly, that a database may stop part way and keep sending. The cost of
// that flexibility is a class of failure with a terrible error message: a
// screen asks for a table or a column that its migration has not created, and
// PostgREST answers with something like
//
//   Could not find the table 'public.email_templates' in the schema cache
//
// which tells somebody running the product nothing about what to do. Worse,
// the screens used to swallow it and render "No templates yet", so a broken
// screen and an empty one looked identical and the real cause was invisible.
//
// This module recognises exactly that failure and names the migration.

/** Migrations that create the email feature's tables, newest last. */
const TABLE_MIGRATIONS: Array<{ table: string; migration: string; what: string }> = [
  { table: 'email_accounts', migration: '152', what: 'sending mailboxes' },
  { table: 'email_campaigns', migration: '152', what: 'campaigns' },
  { table: 'email_messages', migration: '152', what: 'the outbox' },
  { table: 'email_suppressions', migration: '152', what: 'the suppression list' },
  { table: 'email_settings', migration: '156', what: 'sending settings' },
  { table: 'mailbox_status', migration: '156', what: 'mailbox health' },
  { table: 'email_inbox_events', migration: '157', what: 'reply and bounce events' },
  { table: 'email_sequences', migration: '158', what: 'sequences' },
  { table: 'email_sequence_steps', migration: '158', what: 'sequence steps' },
  { table: 'email_sequence_enrollments', migration: '158', what: 'sequence enrollments' },
  { table: 'email_groups', migration: '162', what: 'groups' },
  { table: 'email_templates', migration: '162', what: 'templates' },
];

/** Columns a later migration adds to a table an earlier one created. */
const COLUMN_MIGRATIONS: Array<{ column: string; migration: string }> = [
  { column: 'track_opens', migration: '161' },
  { column: 'opened_count', migration: '161' },
  { column: 'opened_prefetch_count', migration: '161' },
  { column: 'open_was_prefetch', migration: '161' },
  { column: 'pain_point', migration: '162' },
  { column: 'group_id', migration: '162' },
  { column: 'template_id', migration: '162' },
];

/** The shape of the errors PostgREST and supabase-js hand back. */
interface PostgrestLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * A sentence naming the migration this failure is waiting on, or null when
 * the error is something else entirely.
 *
 * Null rather than a vague fallback: a caller that gets null should show the
 * real error, because inventing "the database might be out of date" for a
 * dropped connection sends somebody to run migrations that are already there.
 */
export function describeSchemaError(error: unknown): string | null {
  const e = error as PostgrestLike | null;
  if (!e) return null;

  const code = String(e.code ?? '');
  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.toLowerCase();

  // COLUMNS FIRST, because a column error names its table too and would
  // otherwise match the table rule and report the migration that created the
  // table rather than the one that added the column — which is the wrong
  // number to hand somebody, and confidently wrong.
  //
  // 42703 comes back from a read, PGRST204 from a write. Same cause, two codes.
  if (code === '42703' || code === 'PGRST204' || text.includes('column')) {
    const hit = COLUMN_MIGRATIONS.find((c) => text.includes(c.column));
    if (hit) {
      return (
        `This screen needs database migration ${hit.migration}, which adds the ` +
        `\`${hit.column}\` column. It has not been run on this database yet. ` +
        `Apply the migrations in supabase/migrations in numeric order, then reload.`
      );
    }
  }

  // A missing TABLE. PGRST205 is PostgREST's schema cache; 42P01 is Postgres
  // itself, which is what a `security definer` function raises from inside.
  const missingTable =
    code === 'PGRST205' ||
    code === '42P01' ||
    text.includes('could not find the table') ||
    text.includes('does not exist') ||
    text.includes('schema cache');

  if (missingTable) {
    const hit = TABLE_MIGRATIONS.find((t) => text.includes(t.table));
    if (hit) {
      return (
        `This screen needs database migration ${hit.migration}, which creates the ` +
        `${hit.what} table. It has not been run on this database yet. ` +
        `Apply the migrations in supabase/migrations in numeric order, then reload.`
      );
    }
  }

  return null;
}

/**
 * What to show a person when a screen failed to load: the migration sentence
 * where we recognise one, and otherwise the underlying message.
 *
 * Never an empty string — a screen showing a blank error box is the same
 * problem this module exists to fix, one level further in.
 */
export function loadFailureMessage(error: unknown, fallback: string): string {
  const schema = describeSchemaError(error);
  if (schema) return schema;

  const message = (error as PostgrestLike | null)?.message;
  if (typeof message === 'string' && message.trim() !== '') return message;

  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}
