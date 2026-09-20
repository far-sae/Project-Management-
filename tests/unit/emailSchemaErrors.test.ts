import { describe, expect, it } from 'vitest';

import { describeSchemaError, loadFailureMessage } from '@/lib/email/schemaErrors';

describe('describeSchemaError', () => {
  it('names the migration when a table is missing', () => {
    // What a person actually sees today when Templates fails: PostgREST's own
    // words, which say nothing about what to do.
    const error = {
      code: 'PGRST205',
      message: "Could not find the table 'public.email_templates' in the schema cache",
    };

    const message = describeSchemaError(error);

    expect(message).toContain('162');
    expect(message).toMatch(/has not been run/i);
    // And it says where to go, because "run the migrations" is only useful to
    // somebody who already knows where they live.
    expect(message).toContain('supabase/migrations');
  });

  it('names the migration when a column is missing', () => {
    const error = { code: '42703', message: 'column crm_contacts.pain_point does not exist' };
    expect(describeSchemaError(error)).toContain('162');
  });

  it('recognises the write-side code too', () => {
    // PGRST204 is what an INSERT gets; 42703 is what a SELECT gets. The same
    // cause, two codes.
    const error = {
      code: 'PGRST204',
      message: "Could not find the 'template_id' column of 'email_campaigns' in the schema cache",
    };
    expect(describeSchemaError(error)).toContain('162');
  });

  it('distinguishes the migrations from each other', () => {
    expect(
      describeSchemaError({
        code: 'PGRST205',
        message: "Could not find the table 'public.email_sequences' in the schema cache",
      }),
    ).toContain('158');

    expect(
      describeSchemaError({ code: '42703', message: 'column track_opens does not exist' }),
    ).toContain('161');
  });

  it('says nothing about migrations for an error that is not one', () => {
    // Null, not a hedge. Telling somebody their database might be out of date
    // when their connection dropped sends them to run migrations that are
    // already there.
    expect(describeSchemaError({ message: 'Failed to fetch' })).toBeNull();
    expect(describeSchemaError({ code: '23505', message: 'duplicate key value' })).toBeNull();
    expect(describeSchemaError(null)).toBeNull();
    expect(describeSchemaError(new Error('network timeout'))).toBeNull();
  });

  it('does not claim a migration for an unknown table', () => {
    // A missing table we have no entry for is still a real failure, but this
    // module has nothing specific to say about it and must not invent a
    // number.
    expect(
      describeSchemaError({
        code: 'PGRST205',
        message: "Could not find the table 'public.something_else' in the schema cache",
      }),
    ).toBeNull();
  });
});

describe('loadFailureMessage', () => {
  it('prefers the migration sentence', () => {
    const message = loadFailureMessage(
      { code: 'PGRST205', message: "Could not find the table 'public.email_groups' in the schema cache" },
      'Failed to load groups',
    );
    expect(message).toContain('162');
  });

  it('falls back to the underlying message', () => {
    expect(loadFailureMessage({ message: 'Failed to fetch' }, 'Failed to load groups')).toBe(
      'Failed to fetch',
    );
    expect(loadFailureMessage(new Error('boom'), 'Failed to load groups')).toBe('boom');
  });

  it('never returns an empty string', () => {
    // A blank error box is the same problem this module exists to fix, one
    // level further in.
    expect(loadFailureMessage({ message: '   ' }, 'Failed to load groups')).toBe(
      'Failed to load groups',
    );
    expect(loadFailureMessage(undefined, 'Failed to load groups')).toBe('Failed to load groups');
    expect(loadFailureMessage({}, 'Failed to load groups')).toBe('Failed to load groups');
  });
});
