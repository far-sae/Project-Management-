import { describe, expect, it } from 'vitest';
import {
  isGenericMemberDisplayName,
  resolveMemberDisplayName,
} from '@/lib/memberIdentity';

describe('member identity labels', () => {
  it('rejects role words as person names', () => {
    expect(isGenericMemberDisplayName(' Member ')).toBe(true);
    expect(isGenericMemberDisplayName('OWNER')).toBe(true);
    expect(isGenericMemberDisplayName('Sam Rivera')).toBe(false);
  });

  it('uses the first real profile name', () => {
    expect(resolveMemberDisplayName(
      '20f9ef61-0000-0000-0000-000000000000',
      'sam@example.com',
      'Member',
      'Sam Rivera',
    )).toBe('Sam Rivera');
  });

  it('falls back to the email handle instead of Member', () => {
    expect(resolveMemberDisplayName(
      '20f9ef61-0000-0000-0000-000000000000',
      'sam.rivera@example.com',
      'Member',
    )).toBe('sam.rivera');
  });

  it('uses a stable teammate label when no identity data exists', () => {
    expect(resolveMemberDisplayName(
      '20f9ef61-0000-0000-0000-000000000000',
      '',
      'Member',
    )).toBe('Teammate 20f9ef');
  });
});
