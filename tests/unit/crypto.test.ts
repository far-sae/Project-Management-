import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from '../../supabase/functions/_shared/crypto';

describe('crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const key = await generateKey();
    const ciphertext = await encrypt('hello world', key);
    expect(ciphertext).not.toBe('hello world');
    const plaintext = await decrypt(ciphertext, key);
    expect(plaintext).toBe('hello world');
  });

  it('produces different ciphertext each call for the same plaintext (random IV)', async () => {
    const key = await generateKey();
    const a = await encrypt('same input', key);
    const b = await encrypt('same input', key);
    expect(a).not.toBe(b);
    expect(await decrypt(a, key)).toBe('same input');
    expect(await decrypt(b, key)).toBe('same input');
  });

  it('fails to decrypt with the wrong key', async () => {
    const keyA = await generateKey();
    const keyB = await generateKey();
    const ciphertext = await encrypt('secret', keyA);
    await expect(decrypt(ciphertext, keyB)).rejects.toThrow();
  });

  it('accepts long inputs (refresh tokens can be 200+ chars)', async () => {
    const key = await generateKey();
    const long = 'r'.repeat(2048);
    const ct = await encrypt(long, key);
    expect(await decrypt(ct, key)).toBe(long);
  });
});
