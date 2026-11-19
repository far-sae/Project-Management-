// The small rules behind Draft with AI: what counts as enough requirements, and whose name the draft uses.
import { describe, expect, it } from 'vitest';
import {
  AI_REQUIREMENTS_MAX, AI_REQUIREMENTS_MIN, requirementsCount, requirementsProblem, senderNameOf,
} from '@/lib/signroom/aiDraft';

describe('requirementsProblem', () => {
  it('needs at least 20 characters, not counting the space around them', () => {
    expect(AI_REQUIREMENTS_MIN).toBe(20);
    expect(requirementsProblem('')).toBe('Write at least 20 characters.');
    expect(requirementsProblem(`   ${'a'.repeat(19)}   `)).toBe('Write at least 20 characters.');
    expect(requirementsProblem('a'.repeat(20))).toBeNull();
  });

  it('allows up to 10,000 characters', () => {
    expect(AI_REQUIREMENTS_MAX).toBe(10_000);
    expect(requirementsProblem('a'.repeat(10_000))).toBeNull();
    expect(requirementsProblem('a'.repeat(10_001))).toBe('Keep the requirements to 10,000 characters or fewer.');
  });
});

describe('requirementsCount', () => {
  it('shows how much of the limit is used', () => {
    expect(requirementsCount('')).toBe('0 / 10,000');
    expect(requirementsCount('  Too short ')).toBe('9 / 10,000');
    expect(requirementsCount('a'.repeat(1234))).toBe('1,234 / 10,000');
  });
});

describe('senderNameOf', () => {
  it('uses the company name on the documents, or the workspace name without one', () => {
    expect(senderNameOf({ name: 'Acme', branding: { companyName: 'Acme Design Ltd' } })).toBe('Acme Design Ltd');
    expect(senderNameOf({ name: 'Acme', branding: { companyName: '  ' } })).toBe('Acme');
    expect(senderNameOf({ name: 'Acme' })).toBe('Acme');
  });
});
