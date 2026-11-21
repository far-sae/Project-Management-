// What a person may read when something goes wrong: our own sentences, never the
// database's or the browser's, and nothing about how the site is set up unless
// they run the site.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GENERIC_MESSAGE, NETWORK_MESSAGE, NOT_ON_YET_MESSAGE, PERMISSION_MESSAGE, SIGN_IN_MESSAGE,
  isInternal, isTechnical, publicMessage, publicText, setInternalsVisible,
} from '@/lib/publicError';
import { appOwnerIds, canSeeInternals } from '@/lib/platform';

beforeEach(() => setInternalsVisible(false));
afterEach(() => setInternalsVisible(true));

describe('raw errors never reach the screen', () => {
  const raw = [
    'new row violates row-level security policy for table "crm_contacts"',
    'duplicate key value violates unique constraint "crm_field_defs_name"',
    'relation "public.crm_calls" does not exist',
    'column crm_tasks.kind does not exist',
    "Could not find the 'line_items' column of 'crm_deals' in the schema cache",
    "Could not find the table 'public.crm_trash' in the schema cache",
    'permission denied for table email_inbox_events',
    'JWT expired',
    'invalid input syntax for type uuid: "local-abc"',
    'null value in column "name" of relation "crm_deals" violates not-null constraint',
    'insert or update on table "crm_deals" violates foreign key constraint "crm_deals_stage_id_fkey"',
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    "Cannot read properties of undefined (reading 'map')",
    'x.items is not a function',
    'foo is not defined',
    'Unexpected token < in JSON at position 0',
    'Request failed with status code 500',
    'TypeError: Load failed',
    'PGRST116: JSON object requested, multiple (or no) rows returned',
    '{"code":"42501","message":"denied"}',
  ];

  it('knows a technical message when it sees one', () => {
    for (const text of raw) expect(isTechnical(text), text).toBe(true);
  });

  it('replaces each with a plain sentence, whoever is looking', () => {
    for (const visible of [false, true]) {
      setInternalsVisible(visible);
      for (const text of raw) {
        const shown = publicText(text, 'The lead could not be saved.');
        expect(shown, text).not.toBe(text);
        expect(shown, text).not.toMatch(/relation|column|constraint|schema|PGRST|JWT|fetch|undefined|JSON|status code/i);
      }
    }
  });

  it('says the useful thing where there is one, and the caller’s own words otherwise', () => {
    expect(publicText('Failed to fetch', 'Could not save.')).toBe(NETWORK_MESSAGE);
    expect(publicText('permission denied for table crm_trash', 'Could not load.')).toBe(PERMISSION_MESSAGE);
    expect(publicText('new row violates row-level security policy', 'Could not save.')).toBe(PERMISSION_MESSAGE);
    expect(publicText('JWT expired', 'Could not load.')).toBe(SIGN_IN_MESSAGE);
    expect(publicText('relation "x" does not exist', 'The list could not be loaded.')).toBe('The list could not be loaded.');
    expect(publicText('relation "x" does not exist')).toBe(GENERIC_MESSAGE);
  });
});

describe('our own sentences are shown as they are', () => {
  const ours = [
    'Title is required',
    'Line 2: the quantity must be a number above zero.',
    'Only the owner can delete a call.',
    'This lead was not found.',
    'There is a field called Budget already.',
    'The workspace this belonged to was deleted, so it cannot be restored.',
    'This is already back in the CRM.',
    'Choose a project in this workspace',
    'Too many tries. Wait a few minutes and send it again.',
    'Budget must be a number.',
    'A follow-up on a project board does not repeat',
    '1 of 2 leads were given to Dana. Try the rest again.',
    'The recording could not be deleted.',
  ];

  it('passes them through untouched', () => {
    for (const text of ours) {
      expect(isTechnical(text), text).toBe(false);
      expect(isInternal(text), text).toBe(false);
      expect(publicText(text, 'x'), text).toBe(text);
    }
  });
});

describe('how the site is set up is told only to the people who run it', () => {
  const internal = [
    'Quotes are not set up yet: run supabase/migrations/199_crm_deal_quote.sql in the Supabase SQL editor.',
    "Calling is not set up yet: TWILIO_AUTH_TOKEN is missing in Vercel's environment variables.",
    'Draft with AI needs ANTHROPIC_API_KEY.',
    'The email worker is not running on Railway.',
  ];

  it('knows a set-up message when it sees one', () => {
    for (const text of internal) expect(isInternal(text), text).toBe(true);
  });

  it('gives everybody else one neutral sentence', () => {
    for (const text of internal) {
      const shown = publicText(text, 'x');
      expect(shown, text).toBe(NOT_ON_YET_MESSAGE);
      expect(shown).not.toMatch(/supabase|sql|vercel|twilio|railway|anthropic/i);
    }
  });

  it('shows the whole message to the people who run the site', () => {
    setInternalsVisible(true);
    for (const text of internal) expect(publicText(text, 'x'), text).toBe(text);
  });
});

describe('reading an error of any shape', () => {
  it('takes the sentence of an Error, and of the database’s plain objects', () => {
    expect(publicMessage(new Error('Title is required'), 'Could not save.')).toBe('Title is required');
    expect(publicMessage({ code: '42501', message: 'permission denied for table x' }, 'Could not save.')).toBe(PERMISSION_MESSAGE);
    expect(publicMessage({ message: 'This is already back in the CRM.' }, 'Could not restore.')).toBe('This is already back in the CRM.');
  });

  it('uses the caller’s words when there is nothing to read', () => {
    expect(publicMessage(undefined, 'Could not save.')).toBe('Could not save.');
    expect(publicMessage(null, 'Could not save.')).toBe('Could not save.');
    expect(publicMessage(new Error(''), 'Could not save.')).toBe('Could not save.');
    expect(publicMessage('plain text thrown', 'Could not save.')).toBe('plain text thrown');
    expect(publicMessage(42, 'Could not save.')).toBe('Could not save.');
  });
});

describe('who runs the site', () => {
  const ME = '0c000000-0000-4000-8000-000000000001';
  const OTHER = '0c000000-0000-4000-8000-0000000000ff';

  it('reads the app owners from the setting', () => {
    expect(appOwnerIds(` ${ME} ,, ${OTHER}`)).toEqual([ME, OTHER]);
    expect(appOwnerIds(undefined)).toEqual([]);
    expect(appOwnerIds('')).toEqual([]);
  });

  it('is the app owners, and nobody else, once they are named', () => {
    expect(canSeeInternals([ME], ME, { isOwner: false })).toBe(true);
    // The owner of another organisation is not the owner of the site.
    expect(canSeeInternals([ME], OTHER, { isOwner: true })).toBe(false);
  });

  it('while nobody is named yet, is the owner of each organisation, so the site can still be set up', () => {
    expect(canSeeInternals([], OTHER, { isOwner: true })).toBe(true);
    expect(canSeeInternals([], OTHER, { isOwner: false })).toBe(false);
  });

  it('is nobody when nobody is signed in: public pages never show internals', () => {
    expect(canSeeInternals([], null, { isOwner: false })).toBe(false);
    expect(canSeeInternals([ME], undefined, { isOwner: true })).toBe(false);
  });
});
