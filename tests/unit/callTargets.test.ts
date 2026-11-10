import { describe, expect, it } from 'vitest';
import { buildProjectCallTargets } from '@/services/calling/callTargets';

const nameFor = (uid: string, stored: string) => stored || `name-${uid}`;

describe('buildProjectCallTargets', () => {
  it('rings every other member, not the caller', () => {
    const t = buildProjectCallTargets(
      [
        { userId: 'me', displayName: 'Me' },
        { userId: 'u1', displayName: 'Ana', photoURL: 'a.png' },
      ],
      'me',
      'me',
      nameFor,
    );
    expect(t).toEqual([{ userId: 'u1', displayName: 'Ana', photoURL: 'a.png' }]);
  });

  it('also rings the project owner when they are not in the member list', () => {
    const t = buildProjectCallTargets([{ userId: 'u1', displayName: 'Ana' }], 'owner', 'u1', nameFor);
    expect(t.map((x) => x.userId)).toEqual(['owner']);
    expect(t[0].displayName).toBe('name-owner');
  });

  it('never rings anyone twice and skips entries without an account', () => {
    const t = buildProjectCallTargets(
      [
        { userId: 'u1', displayName: 'Ana' },
        { userId: 'u1', displayName: 'Ana again' },
        { email: 'pending@x.com', displayName: 'Pending' },
        { userId: 'owner', displayName: 'Boss' },
      ],
      'owner',
      'me',
      nameFor,
    );
    expect(t.map((x) => x.userId)).toEqual(['u1', 'owner']);
  });
});
