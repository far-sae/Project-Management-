// Builds supabase/crm_setup.sql: every CRM database file from 188 on,
// one after the other, so they can be run in the Supabase SQL editor in one go.
//
// Run it after changing or adding one of those files:
//   node scripts/build-crm-setup-sql.mjs
//
// tests/unit/crmSetupSql.test.ts fails when the built file is out of date.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');

export const FIRST = 188;
export const OUTPUT = 'supabase/crm_setup.sql';

/** The files that go in, in the order they must run. */
export function setupFiles() {
  return readdirSync(dir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= FIRST)
    .sort();
}

export function buildSetupSql() {
  const files = setupFiles();
  const head = [
    '-- ============================================================================',
    '-- CRM set-up: every database file from 188 on, in one file.',
    '--',
    '-- How to use it: open the Supabase SQL editor, paste this whole file, press Run.',
    '-- Every part is safe to run more than once, so running this file again does no',
    '-- harm, also when you have already run some of the parts on their own.',
    '--',
    '-- It is built from the files in supabase/migrations by',
    '-- scripts/build-crm-setup-sql.mjs. Do not edit it by hand.',
    '--',
    '-- What is inside:',
    ...files.map((name) => `--   ${name}`),
    '-- ============================================================================',
    '',
  ].join('\n');
  const body = files
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd();
      return `\n-- ▼▼▼ ${name} ▼▼▼\n\n${sql}\n\n-- ▲▲▲ ${name} ▲▲▲\n`;
    })
    .join('');
  return `${head}${body}`;
}

// Run directly (not imported by the test): write the file.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, OUTPUT), buildSetupSql(), 'utf8');
  console.log(`${OUTPUT}: ${setupFiles().length} files`);
}
