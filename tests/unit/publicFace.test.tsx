// What the public sees: no raw errors in pop-ups or on the crash screen, no
// set-up instructions for people who do not run the site, no debug output in
// the live build, and no raw database text in the server's answers.
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: h.error, warning: h.warning, success: h.success } }));

import { toast } from 'sonner';
import { NOT_ON_YET_MESSAGE, setInternalsVisible } from '@/lib/publicError';
import { installPublicToasts } from '@/lib/publicToasts';
import { SetupHint } from '@/components/common/SetupHint';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

beforeEach(() => {
  h.error.mockClear();
  h.warning.mockClear();
  setInternalsVisible(false);
});
afterEach(() => { cleanup(); setInternalsVisible(true); vi.restoreAllMocks(); });

describe('pop-ups', () => {
  it('never show a raw error, whatever code raised them', () => {
    installPublicToasts();
    toast.error('new row violates row-level security policy for table "crm_contacts"');
    toast.error('relation "public.crm_calls" does not exist', { id: 'x' });
    toast.warning('Failed to fetch');
    expect(h.error.mock.calls[0][0]).toBe('You do not have permission to do this.');
    expect(h.error.mock.calls[1]).toEqual(['Something went wrong. Please try again.', { id: 'x' }]);
    expect(h.warning.mock.calls[0][0]).toBe('Could not reach the server. Check your connection and try again.');
  });

  it('show our own sentences as they are, and leave anything that is not text alone', () => {
    installPublicToasts();
    toast.error('Title is required');
    const node = <b>bold</b>;
    toast.error(node as unknown as string);
    expect(h.error.mock.calls[0][0]).toBe('Title is required');
    expect(h.error.mock.calls[1][0]).toBe(node);
  });

  it('hide set-up instructions from people who do not run the site', () => {
    installPublicToasts();
    toast.error('Direct messages aren’t enabled on this workspace yet. Apply migration 033_direct_messages.sql in Supabase.');
    expect(h.error.mock.calls[0][0]).toBe(NOT_ON_YET_MESSAGE);
    setInternalsVisible(true);
    toast.error('Apply migration 033_direct_messages.sql in Supabase.');
    expect(h.error.mock.calls[1][0]).toBe('Apply migration 033_direct_messages.sql in Supabase.');
  });
});

describe('set-up words on a screen', () => {
  it('are read by the people who run the site, and replaced for everybody else', () => {
    render(<p><SetupHint other="AI is not switched on yet.">Deploy the ai-chat Supabase function.</SetupHint></p>);
    expect(screen.getByText('AI is not switched on yet.')).toBeTruthy();
    expect(screen.queryByText(/Supabase/)).toBeNull();
    // The answer can change while the page is open (the organisation finishes loading).
    act(() => setInternalsVisible(true));
    expect(screen.getByText('Deploy the ai-chat Supabase function.')).toBeTruthy();
  });

  it('say "not switched on yet" when no other words are given', () => {
    render(<p><SetupHint>Run supabase/migrations/179.sql</SetupHint></p>);
    expect(screen.getByText(NOT_ON_YET_MESSAGE)).toBeTruthy();
  });
});

describe('the crash screen', () => {
  const crash = (error: Error) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken: React.FC = () => { throw error; };
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <ErrorBoundary /> }]);
    render(<RouterProvider router={router} />);
  };

  it('never shows what broke inside the app', async () => {
    crash(new TypeError("Cannot read properties of undefined (reading 'map')"));
    expect(await screen.findByText('Something Went Wrong')).toBeTruthy();
    expect(screen.getByText('Something went wrong on this page. Please reload it, or go back.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Cannot read|undefined|TypeError/);
    // The pop-up says the same plain thing.
    expect(String(h.error.mock.calls.at(-1)?.[0])).not.toMatch(/Cannot read|undefined/);
  });

  it('keeps what broke in the console, for the people who build the app', async () => {
    const broke = new TypeError('x is not a function');
    crash(broke);
    await screen.findByText('Something Went Wrong');
    expect((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.some((call) => call.includes(broke))).toBe(true);
  });
});

describe('the live build', () => {
  it('writes no debug lines to the browser’s console, and keeps real errors', () => {
    const config = read('vite.config.ts');
    for (const call of ['console.log', 'console.debug', 'console.info', 'console.warn']) expect(config, call).toContain(`'${call}'`);
    expect(config).toContain("mode === 'production'");
    expect(config).not.toContain("'console.error'");
    // No source maps: the code of the app is not handed out with it.
    expect(config).not.toMatch(/sourcemap:\s*true/);
  });

  it('keeps the phone library quiet', () => {
    expect(read('src/services/voice/device.ts')).toContain("logLevel: import.meta.env.PROD ? 'silent' : 'error'");
  });
});

describe('the server', () => {
  /** Every server file that answers a browser directly. */
  const entryFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const path = `${dir}/${name}`;
        if (statSync(join(root, path)).isDirectory()) { if (!name.startsWith('_')) walk(path); } else if (name.endsWith('.ts')) out.push(path);
      }
    };
    walk('api');
    return out;
  };

  it('never answers with the database’s own words', () => {
    const files = entryFiles();
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      // .message of a database error must not go into a JSON answer.
      expect(read(file), file).not.toMatch(/json\(\{\s*error:\s*\w*[eE]rror\.message\s*\}\)/);
    }
  });
});

describe('new code keeps to the rule', () => {
  const sourceFiles = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) sourceFiles(path, out);
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  };

  it('no screen turns an error into text by itself: it asks publicMessage()', () => {
    // "err instanceof Error ? err.message : 'our sentence'" shows the database's or the browser's
    // words whenever the error is theirs. publicMessage(err, 'our sentence') does not.
    const pattern = /\b(\w+) instanceof Error (?:&& \1\.message )?\? \1\.message : (['"`])[^'"`]*[A-Za-z]{3}/;
    const offenders = sourceFiles('src')
      .filter((file) => file !== 'src/lib/publicError.ts')
      .filter((file) => pattern.test(read(file)));
    expect(offenders).toEqual([]);
  });
});

const sourceFilesOf = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) sourceFilesOf(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
};

describe('small things a visitor would notice', () => {
  it('keeps the calendar icon of a date box at its right edge, not on top of the date', () => {
    const css = read('src/index.css').replace(/\s+/g, ' ');
    // As a flex box the browser packs the icon right after the text; as a block it goes to the edge.
    expect(css).toContain('input[type="date"], input[type="datetime-local"], input[type="month"], input[type="week"], input[type="time"] { display: block; }');
    expect(css).toContain('input[type="datetime-local"]::-webkit-calendar-picker-indicator');
  });

  it('names no other product in the app', () => {
    const offenders = sourceFilesOf('src').filter((file) => /HubSpot|Salesforce|Pipedrive/.test(read(file).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')));
    expect(offenders).toEqual([]);
  });
});
