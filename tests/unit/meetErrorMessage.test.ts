import { describe, expect, it } from 'vitest';
import { meetErrorMessage } from '@/services/integrations/googleMeet';

describe('meetErrorMessage', () => {
  it('tells the user to reconnect Google when its access expired (412)', () => {
    const msg = meetErrorMessage(412, { error: 'google_not_connected', message: 'no refresh token' });
    expect(msg).toMatch(/Reconnect Google in Settings → Integrations/);
    expect(msg).toMatch(/task was saved/);
  });

  it('keeps other server messages', () => {
    expect(meetErrorMessage(400, { error: 'invalid_start_time' })).toBe('invalid_start_time');
    expect(meetErrorMessage(500, {})).toBe('Meet creation failed: 500');
  });
});
