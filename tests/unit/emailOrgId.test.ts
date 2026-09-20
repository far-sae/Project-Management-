import { describe, expect, it } from 'vitest';

import { isRealOrgId, queryableOrgId } from '@/lib/email/orgId';

describe('isRealOrgId', () => {
  it('rejects the placeholder AuthContext uses before an organization resolves', () => {
    // The actual value seen in production, from the browser console:
    //   organization_id=eq.local-da9c3923-6233-43e5-99da-d4304deb637c  →  400
    // Every organization_id in this feature is a uuid column, and this is not
    // a uuid, so PostgREST rejects the filter outright rather than returning
    // an empty list.
    expect(isRealOrgId('local-da9c3923-6233-43e5-99da-d4304deb637c')).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isRealOrgId('')).toBe(false);
    expect(isRealOrgId(null)).toBe(false);
    expect(isRealOrgId(undefined)).toBe(false);
  });

  it('accepts a real id', () => {
    expect(isRealOrgId('da9c3923-6233-43e5-99da-d4304deb637c')).toBe(true);
  });

  it('does not reject an id that merely contains the word', () => {
    // The guard is a PREFIX check, because that is what AuthContext writes.
    // Matching anywhere would reject a legitimate id that happened to contain
    // the letters, which is a bug that would only show up for one customer.
    expect(isRealOrgId('da9c3923-local-43e5-99da-d4304deb637c')).toBe(true);
  });
});

describe('queryableOrgId', () => {
  it('turns a placeholder into the empty string every screen already guards on', () => {
    expect(queryableOrgId('local-abc')).toBe('');
    expect(queryableOrgId(undefined)).toBe('');
  });

  it('passes a real id through unchanged', () => {
    const id = 'da9c3923-6233-43e5-99da-d4304deb637c';
    expect(queryableOrgId(id)).toBe(id);
  });
});
