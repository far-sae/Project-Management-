// @vitest-environment node
// The one file that holds every CRM database file from 188 on: it must be the
// files themselves, in order, and every one of them must be safe to run again.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script, with no types of its own
import { OUTPUT, buildSetupSql, setupFiles } from '../../scripts/build-crm-setup-sql.mjs';
import { SETUP_PARTS } from '@/lib/crmSetup';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

describe('the one CRM set-up file', () => {
  const files = setupFiles() as string[];

  it('is up to date with the files it is built from (run: node scripts/build-crm-setup-sql.mjs)', () => {
    expect(read(OUTPUT as string)).toBe(buildSetupSql());
  });

  it('holds every file from 188 on, each once, in the order they must run', () => {
    expect(files[0]).toBe('188_crm_calls.sql');
    expect(files.map((f) => Number(f.slice(0, 3)))).toEqual([...files.keys()].map((i) => 188 + i));
    const built = read(OUTPUT as string);
    let at = -1;
    for (const name of files) {
      const next = built.indexOf(`-- ▼▼▼ ${name} ▼▼▼`);
      expect(next, name).toBeGreaterThan(at);
      at = next;
    }
  });

  it('can be run again: every part says it is safe to, and none ends a transaction on its own', () => {
    for (const name of files) {
      const sql = read(`supabase/migrations/${name}`);
      expect(sql.toLowerCase(), name).toMatch(/safe to run more than once|safe to re-run|can be run more than once|idempotent/);
      const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(code, name).not.toMatch(/^\s*(commit|rollback)\s*;/im);
    }
  });

  it('covers every part the set-up check knows from 188 on', () => {
    for (const part of SETUP_PARTS) {
      if (Number(part.file.slice(0, 3)) >= 188) expect(files, part.file).toContain(part.file);
    }
  });
});
