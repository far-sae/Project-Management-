// Logging something by hand on a lead: when it happened and how a call went.
import { describe, expect, it } from 'vitest';
import { localInputValue, loggedDescription, occurredAtFrom } from '@/lib/crmLoggedActivity';
import { isUnansweredCallEntry } from '../../api/_voice/shared/types';

describe('hand-logged activity', () => {
  const now = new Date(2026, 10, 21, 9, 30, 0);

  it('writes a date the way the date-and-time field wants it', () => {
    expect(localInputValue(now)).toBe('2026-11-21T09:30');
    expect(localInputValue(new Date(2026, 0, 5, 7, 4))).toBe('2026-01-05T07:04');
  });

  it('takes the time that was typed, and "now" for anything empty, unreadable or in the future', () => {
    expect(occurredAtFrom('2026-11-20T16:15', now).getTime()).toBe(new Date(2026, 10, 20, 16, 15).getTime());
    expect(occurredAtFrom('', now)).toBe(now);
    expect(occurredAtFrom('not a date', now)).toBe(now);
    expect(occurredAtFrom('2026-11-22T09:00', now)).toBe(now);
  });

  it('starts a call with how it went, in the words the dialler uses', () => {
    expect(loggedDescription('call', 'no_answer', '')).toBe('No answer.');
    expect(loggedDescription('call', 'voicemail', '  Asked her to ring back ')).toBe('Left a voicemail. Asked her to ring back');
    expect(loggedDescription('call', 'connected', 'Wants a quote')).toBe('Spoke to them. Wants a quote');
    // Other kinds, and a call with no outcome, are only what was typed.
    expect(loggedDescription('email', 'no_answer', ' Sent the brochure ')).toBe('Sent the brochure');
    expect(loggedDescription('call', null, 'Rang twice')).toBe('Rang twice');
    expect(loggedDescription('note', null, '   ')).toBe('');
  });

  it('lets the automation tell a hand-logged call nobody answered from a conversation', () => {
    for (const outcome of ['no_answer', 'voicemail', 'busy', 'wrong_number'] as const) {
      expect(isUnansweredCallEntry(loggedDescription('call', outcome, '')), outcome).toBe(true);
      expect(isUnansweredCallEntry(loggedDescription('call', outcome, 'will try again on Monday')), outcome).toBe(true);
    }
    expect(isUnansweredCallEntry(loggedDescription('call', 'connected', 'No answer. at first, then we talked'))).toBe(false);
    // Free text is never judged, even when it begins with similar words.
    expect(isUnansweredCallEntry('No answer the first time, then she rang back and we talked.')).toBe(false);
  });
});
