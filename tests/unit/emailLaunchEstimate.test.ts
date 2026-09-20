import { describe, expect, it } from 'vitest';

import { launchEstimate } from '@/lib/email/launchEstimate';
import type { MailboxHealth, SendWindow } from '@/lib/email/types';

const WINDOW: SendWindow = {
  enabled: true,
  startHour: 8,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
  timezone: 'Europe/London',
};

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
    warmupEnabled: false,
    warmupStartedOn: null,
    warmupStartVolume: 5,
    warmupIncrement: 3,
    effectiveLimit: 40,
    sentToday: 0,
    ...over,
  } as MailboxHealth;
}

describe('launchEstimate', () => {
  it('says it all goes today when it fits in the remaining allowance', () => {
    const e = launchEstimate({
      recipients: 30,
      mailboxes: [mailbox()],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.days).toBe(1);
    expect(e.summary).toMatch(/today/i);
  });

  it('counts the days a warming pool will actually take', () => {
    // The case the product never told anybody about: 500 recipients from two
    // mailboxes ramping at 8 a day is not an afternoon, it is a month.
    const e = launchEstimate({
      recipients: 500,
      mailboxes: [
        mailbox({ effectiveLimit: 8 }),
        mailbox({ id: 'm2', effectiveLimit: 8 }),
      ],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.perDay).toBe(16);
    expect(e.days).toBeGreaterThan(20);
    expect(e.summary).toMatch(/days/);
  });

  it('subtracts what each mailbox has already sent today', () => {
    const e = launchEstimate({
      recipients: 10,
      mailboxes: [mailbox({ effectiveLimit: 40, sentToday: 38 })],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.remainingToday).toBe(2);
    expect(e.days).toBe(2);
  });

  it('never counts a negative remainder', () => {
    // sent_today can exceed the effective limit after a ramp is turned down.
    const e = launchEstimate({
      recipients: 10,
      mailboxes: [mailbox({ effectiveLimit: 5, sentToday: 40 })],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.remainingToday).toBe(0);
  });

  it('ignores a mailbox that is paused or in error', () => {
    const e = launchEstimate({
      recipients: 10,
      mailboxes: [
        mailbox({ isActive: false }),
        mailbox({ id: 'm2', status: 'error' }),
      ],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.perDay).toBe(0);
    expect(e.summary).toMatch(/no mailbox/i);
  });

  it('says when the queue is waiting for the window rather than stuck', () => {
    // Not an error: the queue waiting is the point of having a window. But
    // somebody pressing Send at 7pm deserves to know nothing leaves tonight.
    const e = launchEstimate({
      recipients: 10,
      mailboxes: [mailbox()],
      window: WINDOW,
      windowOpenNow: false,
    });
    expect(e.waitingForWindow).toBe(true);
    expect(e.summary).toMatch(/window is closed/i);
    expect(e.summary).toContain('Europe/London');
  });

  it('does not mention the window when the organisation has none', () => {
    const e = launchEstimate({
      recipients: 10,
      mailboxes: [mailbox()],
      window: { ...WINDOW, enabled: false },
      windowOpenNow: false,
    });
    expect(e.waitingForWindow).toBe(false);
    expect(e.summary).not.toMatch(/window/i);
  });

  it('says nothing confident about an empty selection', () => {
    const e = launchEstimate({
      recipients: 0,
      mailboxes: [mailbox()],
      window: WINDOW,
      windowOpenNow: true,
    });
    expect(e.days).toBe(0);
    expect(e.summary).toMatch(/no recipients/i);
  });
});
