import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../../supabase/functions/_shared/oauth-state';

const SECRET = 'test-secret-key-do-not-use-in-prod';

describe('oauth-state', () => {
  it('round-trips a payload through sign/verify', async () => {
    const payload = {
      userId: 'u_123',
      orgId: 'o_456',
      provider: 'google',
      nonce: 'n_789',
    };
    const token = await signState(payload, SECRET);
    const decoded = await verifyState(token, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'slack', nonce: 'n_1' },
      SECRET,
    );
    // Flip a byte in the payload portion
    const parts = token.split('.');
    const tampered = parts[0].slice(0, -1) + (parts[0].slice(-1) === 'a' ? 'b' : 'a') + '.' + parts[1];
    await expect(verifyState(tampered, SECRET)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'google', nonce: 'n_1' },
      SECRET,
    );
    await expect(verifyState(token, 'other-secret')).rejects.toThrow();
  });

  it('preserves null orgId', async () => {
    const token = await signState(
      { userId: 'u_1', orgId: null, provider: 'gmail', nonce: 'n_2' },
      SECRET,
    );
    const decoded = await verifyState(token, SECRET);
    expect(decoded.orgId).toBeNull();
  });
});
