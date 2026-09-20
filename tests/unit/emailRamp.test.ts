import { describe, expect, it } from 'vitest';

import {
  healthReport, limitOnDay, nextIncrease, rampProgress,
} from '@/lib/email/ramp';
import type { MailboxHealth } from '@/lib/email/types';

const DAY_1 = new Date('2026-09-01T12:00:00Z');
const DAY_5 = new Date('2026-09-05T12:00:00Z');

function mailbox(over: Partial<MailboxHealth> = {}): MailboxHealth {
  return {
    id: 'm1',
    organizationId: 'org-1',
    label: 'Sales',
    fromEmail: 'ada@acme.com',
    status: 'active',
    isActive: true,
    pausedReason: null,
    consecutiveFailures: 0,
    lastSentAt: null,
    dailyLimit: 40,
    warmupEnabled: true,
    warmupStartedOn: DAY_1,
    warmupStartVolume: 5,
    warmupIncrement: 3,
    effectiveLimit: 5,
    sentToday: 0,
    ...over,
  } as MailboxHealth;
}

describe('limitOnDay', () => {
  it('matches the view: start volume plus increment per elapsed day', () => {
    // Day 1 is day zero of the ramp.
    expect(limitOnDay(mailbox(), DAY_1)).toBe(5);
    expect(limitOnDay(mailbox(), DAY_5)).toBe(5 + 3 * 4);
  });

  it('never exceeds the mailbox’s own limit', () => {
    const far = new Date('2027-01-01T12:00:00Z');
    expect(limitOnDay(mailbox(), far)).toBe(40);
  });

  it('is the full limit when the ramp is off', () => {
    expect(limitOnDay(mailbox({ warmupEnabled: false }), DAY_1)).toBe(40);
  });

  it('is the start volume when the ramp has not been started', () => {
    // Migration 156's own warning: with no start date the ramp resolves to the
    // start volume and never climbs, because nothing sets the date on its own.
    expect(limitOnDay(mailbox({ warmupStartedOn: null }), DAY_5)).toBe(5);
  });
});

describe('nextIncrease', () => {
  it('says when the allowance next rises, and to what', () => {
    const next = nextIncrease(mailbox(), DAY_1);
    expect(next?.to).toBe(8);
  });

  it('is null once the ramp has reached the limit', () => {
    // One of three different situations the caller has to tell apart, which is
    // why this returns null rather than a zero increase.
    expect(nextIncrease(mailbox(), new Date('2027-01-01T12:00:00Z'))).toBeNull();
  });

  it('is null when the ramp is off or was never started', () => {
    expect(nextIncrease(mailbox({ warmupEnabled: false }), DAY_1)).toBeNull();
    expect(nextIncrease(mailbox({ warmupStartedOn: null }), DAY_1)).toBeNull();
  });

  it('is null for a ramp that cannot climb', () => {
    expect(nextIncrease(mailbox({ warmupIncrement: 0 }), DAY_1)).toBeNull();
  });
});

describe('rampProgress', () => {
  it('is a fraction of the distance from start volume to limit', () => {
    expect(rampProgress(mailbox(), DAY_1)).toBeCloseTo(0);
    expect(rampProgress(mailbox(), DAY_5)).toBeCloseTo(12 / 35);
  });

  it('is null when no ramp is running', () => {
    expect(rampProgress(mailbox({ warmupEnabled: false }), DAY_1)).toBeNull();
  });
});

describe('healthReport', () => {
  const measured = { sent30d: 200, bounced30d: 2, percent: 1 };

  it('reports a clean record as what it measured', () => {
    const r = healthReport(mailbox(), measured, 5);
    expect(r.state).toBe('good');
    expect(r.detail).toContain('200');
  });

  it('says NOT MEASURED rather than 0% when nothing has been sent', () => {
    // The dishonesty this function exists to avoid: showing 0% for silence
    // presents an absence of evidence as a clean bill of health, and somebody
    // acts on it by sending five hundred messages.
    const r = healthReport(mailbox(), { sent30d: 0, bounced30d: 0, percent: null }, 5);
    expect(r.state).toBe('unmeasured');
    expect(r.detail).toMatch(/no information|not a clean bill/i);
    expect(r.detail).not.toContain('0%');
  });

  it('refuses to judge too small a sample', () => {
    // Two bounces out of three is 67% and is evidence of nothing.
    const r = healthReport(mailbox(), { sent30d: 3, bounced30d: 2, percent: 66.7 }, 5);
    expect(r.state).toBe('unmeasured');
    expect(r.detail).toMatch(/too few/i);
  });

  it('warns before the threshold, not only at it', () => {
    const r = healthReport(mailbox(), { sent30d: 200, bounced30d: 6, percent: 3 }, 5);
    expect(r.state).toBe('watch');
  });

  it('is bad at or over the threshold, and says sending stops', () => {
    const r = healthReport(mailbox(), { sent30d: 200, bounced30d: 12, percent: 6 }, 5);
    expect(r.state).toBe('bad');
    expect(r.detail).toMatch(/pauses automatically/i);
  });

  it('leads with the pause reason when a mailbox is already out of rotation', () => {
    const r = healthReport(
      mailbox({ isActive: false, pausedReason: 'Paused automatically: 9% bounced.' }),
      measured,
      5,
    );
    expect(r.state).toBe('bad');
    expect(r.detail).toContain('9%');
  });

  it('reports an errored mailbox as bad whatever its bounce rate', () => {
    const r = healthReport(mailbox({ status: 'error' }), measured, 5);
    expect(r.state).toBe('bad');
    expect(r.detail).toMatch(/re-verified/i);
  });
});
