import { describe, it, expect } from 'vitest';
import {
  signInvite,
  verifyInvite,
  isValidRoomName,
  normalizeGuestName,
  INVITE_TTL_SECONDS,
  type InvitePayload,
} from '@/supabase-functions/_shared/callInvite.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const payload: InvitePayload = {
  room: 'project:abc-123',
  exp: 2_000_000_000,
  label: 'Kickoff',
  inviterName: 'Alex',
};

const b64u = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('callInvite', () => {
  it('has a 24h TTL', () => {
    expect(INVITE_TTL_SECONDS).toBe(86400);
  });

  it('round-trips sign -> verify', async () => {
    const token = await signInvite(payload, SECRET);
    expect(await verifyInvite(token, SECRET, payload.exp - 10)).toEqual(payload);
  });

  it('rejects an edited payload room', async () => {
    const token = await signInvite(payload, SECRET);
    const [, sig] = token.split('.');
    const forged = b64u(JSON.stringify({ ...payload, room: 'project:other' }));
    expect(await verifyInvite(`${forged}.${sig}`, SECRET, 1)).toBeNull();
  });

  it('rejects an edited signature', async () => {
    const token = await signInvite(payload, SECRET);
    const [body, sig] = token.split('.');
    const bad = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await verifyInvite(`${body}.${bad}`, SECRET, 1)).toBeNull();
  });

  it('rejects a wrong secret', async () => {
    const token = await signInvite(payload, SECRET);
    expect(await verifyInvite(token, 'other-secret', 1)).toBeNull();
  });

  it('rejects when expired (nowSec = exp)', async () => {
    const token = await signInvite(payload, SECRET);
    expect(await verifyInvite(token, SECRET, payload.exp)).toBeNull();
  });

  it('rejects malformed tokens without throwing', async () => {
    expect(await verifyInvite('garbage', SECRET, 1)).toBeNull();
    expect(await verifyInvite('a.b.c', SECRET, 1)).toBeNull();
    expect(await verifyInvite('!!!.???', SECRET, 1)).toBeNull();
    expect(await verifyInvite('', SECRET, 1)).toBeNull();
  });

  it('rejects a validly signed token with a bad room', async () => {
    const token = await signInvite({ ...payload, room: 'other:x' }, SECRET);
    expect(await verifyInvite(token, SECRET, 1)).toBeNull();
  });

  it('validates room names', () => {
    expect(isValidRoomName('project:abc_1:-x')).toBe(true);
    expect(isValidRoomName('dm:a__b')).toBe(true);
    expect(isValidRoomName('dm:ab')).toBe(false);
    expect(isValidRoomName('project:')).toBe(false);
    expect(isValidRoomName('project:a b')).toBe(false);
    expect(isValidRoomName('project:' + 'a'.repeat(129))).toBe(false);
    expect(isValidRoomName('')).toBe(false);
  });

  it('normalizes guest names', () => {
    expect(normalizeGuestName('  Jane   Doe ')).toBe('Jane Doe');
    expect(normalizeGuestName('   ')).toBeNull();
    expect(normalizeGuestName(42)).toBeNull();
    expect(normalizeGuestName('x'.repeat(200))!.length).toBe(60);
  });
});
