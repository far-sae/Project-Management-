import { describe, it, expect } from 'vitest';
import {
  signInvite,
  verifyInvite,
  isValidRoomName,
  normalizeGuestName,
  INVITE_TTL_SECONDS,
  MEETING_AHEAD_DAYS,
  crmMeetingRoomName,
  meetingInviteExpiry,
  meetingLabel,
  workspaceIdFromCrmRoom,
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

// A meeting with a lead or a client: its own room, and a link that still
// works on the day of the meeting, however far ahead it was sent.
describe('a meeting with a lead', () => {
  const WS = '0a000000-0000-4000-8000-000000000001';
  const MEETING = '0b000000-0000-4000-8000-000000000002';
  const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
  const HOUR = 3600_000;

  it('has a room of its own, named after the workspace and the meeting', () => {
    const room = crmMeetingRoomName(WS, MEETING);
    expect(room).toBe(`crm:${WS}:${MEETING}`);
    expect(isValidRoomName(room)).toBe(true);
    expect(workspaceIdFromCrmRoom(room)).toBe(WS);
  });

  it('takes nothing but two ids as a room name', () => {
    for (const bad of [`crm:${WS}`, `crm:${WS}:`, `crm::${MEETING}`, `crm:${WS}:${MEETING}:more`, `crm:not an id:${MEETING}`, `crm:${WS}:../../x`, 'crm:']) {
      expect(isValidRoomName(bad), bad).toBe(false);
      expect(workspaceIdFromCrmRoom(bad), bad).toBeNull();
    }
    expect(workspaceIdFromCrmRoom('project:abc')).toBeNull();
    expect(workspaceIdFromCrmRoom(`dm:a__b`)).toBeNull();
  });

  it('keeps the link working until a day after the meeting starts', () => {
    const inAWeek = NOW + 7 * 24 * HOUR;
    expect(meetingInviteExpiry(inAWeek, NOW)).toBe(Math.floor((inAWeek + 24 * HOUR) / 1000));
    // A meeting that starts right now, or started a few minutes ago.
    expect(meetingInviteExpiry(NOW, NOW)).toBe(Math.floor((NOW + 24 * HOUR) / 1000));
    expect(meetingInviteExpiry(NOW - 10 * 60_000, NOW)).toBe(Math.floor((NOW - 10 * 60_000 + 24 * HOUR) / 1000));
  });

  it('makes no link for a time that is long past, too far ahead, or not a time', () => {
    expect(meetingInviteExpiry(NOW - 2 * HOUR, NOW)).toBeNull();
    expect(meetingInviteExpiry(NOW + (MEETING_AHEAD_DAYS + 1) * 24 * HOUR, NOW)).toBeNull();
    expect(meetingInviteExpiry(Number.NaN, NOW)).toBeNull();
    expect(meetingInviteExpiry(NOW + MEETING_AHEAD_DAYS * 24 * HOUR, NOW)).not.toBeNull();
  });

  it('a link for a meeting next month verifies on the day, and not after it has run out', async () => {
    const start = NOW + 30 * 24 * HOUR;
    const exp = meetingInviteExpiry(start, NOW) as number;
    const token = await signInvite({ room: crmMeetingRoomName(WS, MEETING), exp, label: 'Meeting with Northwind Studio', inviterName: 'Sam' }, SECRET);
    expect((await verifyInvite(token, SECRET, Math.floor(start / 1000)))?.room).toBe(`crm:${WS}:${MEETING}`);
    expect(await verifyInvite(token, SECRET, exp + 1)).toBeNull();
  });

  it('names the meeting in one short line', () => {
    expect(meetingLabel('  Meeting with\nNorthwind   Studio ')).toBe('Meeting with Northwind Studio');
    expect(meetingLabel('x'.repeat(300))).toHaveLength(120);
    expect(meetingLabel('')).toBe('Meeting');
    expect(meetingLabel(42)).toBe('Meeting');
  });
});
