import { describe, expect, it } from 'vitest';
import * as timeEntries from '@/services/supabase/timeEntries';
import { STALE_SHIFT_HOURS } from '@/lib/attendance';

/**
 * The clock keeps running until the person clocks out. Closing the tab,
 * refreshing the page or a laptop going to sleep used to clock people out
 * (a request sent while the page was closing). That is gone.
 */
describe('the clock runs all day', () => {
  it('has no clock-out that fires when the page closes', () => {
    expect('clockOutKeepalive' in timeEntries).toBe(false);
  });

  it('closes a forgotten shift only after a whole day', () => {
    expect(STALE_SHIFT_HOURS).toBe(24);
  });
});
