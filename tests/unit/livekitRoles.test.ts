import { describe, it, expect } from 'vitest';
import {
  livekitHttpUrl,
  isGuestIdentity,
  guestWaitingGrant,
  guestAdmittedPermission,
  memberGrant,
  roomAdminGrant,
  GUEST_WAITING_METADATA,
  GUEST_ADMITTED_METADATA,
  onlyGuestsRemain,
  guestsToEvict,
  classifyRoomServiceError,
  projectIdFromRoom,
  dmMembers,
  isDmMember,
  canManageGuests,
  isInviteSecretStrong,
} from '@/supabase-functions/_shared/livekitRoles.ts';

describe('livekitHttpUrl', () => {
  it('converts wss to https and strips trailing slash', () => {
    expect(livekitHttpUrl('wss://x.livekit.cloud/')).toBe('https://x.livekit.cloud');
    expect(livekitHttpUrl('wss://x.livekit.cloud')).toBe('https://x.livekit.cloud');
  });
  it('converts ws to http', () => {
    expect(livekitHttpUrl('ws://localhost:7880')).toBe('http://localhost:7880');
  });
  it('trims whitespace and leaves https alone', () => {
    expect(livekitHttpUrl('  https://x.livekit.cloud//  ')).toBe('https://x.livekit.cloud');
  });
});

describe('isGuestIdentity', () => {
  it('accepts guest: identities', () => {
    expect(isGuestIdentity('guest:a')).toBe(true);
    expect(isGuestIdentity('guest:0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
  });
  it('rejects members and malformed values', () => {
    expect(isGuestIdentity('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(false);
    expect(isGuestIdentity('guest:')).toBe(false);
    expect(isGuestIdentity('Guest:a')).toBe(false);
    expect(isGuestIdentity('xguest:a')).toBe(false);
    expect(isGuestIdentity('guest:a b')).toBe(false);
    expect(isGuestIdentity(undefined as unknown as string)).toBe(false);
    expect(isGuestIdentity(42 as unknown as string)).toBe(false);
  });
});

describe('grants and metadata', () => {
  it('waiting grant joins only the given room and cannot see, hear, publish or edit metadata', () => {
    const g = guestWaitingGrant('project:abc');
    expect(g.roomJoin).toBe(true);
    expect(g.room).toBe('project:abc');
    expect(g.canSubscribe).toBe(false);
    expect(g.canPublish).toBe(false);
    expect(g.canPublishData).toBe(false);
    expect(g.canUpdateOwnMetadata).toBe(false);
    expect((g as unknown as Record<string, unknown>).roomAdmin).toBeUndefined();
  });
  it('admitted permission allows camera + mic only', () => {
    const p = guestAdmittedPermission();
    expect(p).toEqual({
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canPublishSources: ['CAMERA', 'MICROPHONE'],
      canUpdateMetadata: false,
    });
  });
  it('member grant can update own metadata', () => {
    const g = memberGrant('dm:a__b');
    expect(g).toEqual({
      roomJoin: true,
      room: 'dm:a__b',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });
  });
  it('room admin grant is scoped to one room', () => {
    expect(roomAdminGrant('project:abc')).toEqual({ roomAdmin: true, room: 'project:abc' });
  });
  it('metadata constants are exact', () => {
    expect(GUEST_WAITING_METADATA).toBe('{"role":"guest","status":"waiting"}');
    expect(GUEST_ADMITTED_METADATA).toBe('{"role":"guest","status":"admitted"}');
  });
});

describe('onlyGuestsRemain', () => {
  it('is false for an empty room', () => {
    expect(onlyGuestsRemain([])).toBe(false);
  });
  it('is true when everyone is a guest', () => {
    expect(onlyGuestsRemain(['guest:a'])).toBe(true);
    expect(onlyGuestsRemain(['guest:a', 'guest:b'])).toBe(true);
  });
  it('is false when any member is present', () => {
    expect(onlyGuestsRemain(['guest:a', 'u1'])).toBe(false);
  });
});

describe('guestsToEvict', () => {
  const waiting = { identity: 'guest:w', metadata: GUEST_WAITING_METADATA };
  const admitted = { identity: 'guest:a', metadata: GUEST_ADMITTED_METADATA };
  it('evicts admitted guests left alone in the room', () => {
    expect(guestsToEvict([admitted])).toEqual(['guest:a']);
  });
  it('keeps waiting guests (they cannot see anything and may be early)', () => {
    expect(guestsToEvict([waiting, admitted])).toEqual(['guest:a']);
    expect(guestsToEvict([waiting])).toEqual([]);
  });
  it('treats guests with missing or malformed metadata as admitted', () => {
    expect(guestsToEvict([{ identity: 'guest:x' }, { identity: 'guest:y', metadata: 'nope' }]))
      .toEqual(['guest:x', 'guest:y']);
  });
  it('evicts nobody when a member is present', () => {
    expect(guestsToEvict([admitted, { identity: 'u1', metadata: '' }])).toEqual([]);
  });
  it('evicts nobody from an empty room', () => {
    expect(guestsToEvict([])).toEqual([]);
  });
});

describe('classifyRoomServiceError', () => {
  it('maps 404 to gone and everything else to error', () => {
    expect(classifyRoomServiceError(404)).toBe('gone');
    expect(classifyRoomServiceError(500)).toBe('error');
    expect(classifyRoomServiceError(401)).toBe('error');
  });
});

describe('room helpers', () => {
  const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('projectIdFromRoom returns the uuid of a project room', () => {
    expect(projectIdFromRoom(`project:${uuid}`)).toBe(uuid);
    expect(projectIdFromRoom('project:not-a-uuid')).toBeNull();
    expect(projectIdFromRoom(`dm:${uuid}__${uuid}`)).toBeNull();
  });
  it('dmMembers splits a dm room into two ids', () => {
    expect(dmMembers('dm:a__b')).toEqual(['a', 'b']);
    expect(dmMembers('dm:a__b__c')).toBeNull();
    expect(dmMembers('dm:a__')).toBeNull();
    expect(dmMembers('project:a__b')).toBeNull();
  });
  it('isDmMember only accepts the two participants', () => {
    expect(isDmMember('dm:a__b', 'a')).toBe(true);
    expect(isDmMember('dm:a__b', 'b')).toBe(true);
    expect(isDmMember('dm:a__b', 'c')).toBe(false);
    expect(isDmMember('dm:a__b', '')).toBe(false);
  });
});

describe('canManageGuests', () => {
  it('requires project access, a non-viewer role and not an org viewer', () => {
    expect(canManageGuests({ canAccess: true, role: 'admin', isOrgViewer: false })).toBe(true);
    expect(canManageGuests({ canAccess: true, role: 'member', isOrgViewer: false })).toBe(true);
    expect(canManageGuests({ canAccess: false, role: 'admin', isOrgViewer: false })).toBe(false);
    expect(canManageGuests({ canAccess: true, role: 'viewer', isOrgViewer: false })).toBe(false);
    expect(canManageGuests({ canAccess: true, role: 'none', isOrgViewer: false })).toBe(false);
    expect(canManageGuests({ canAccess: true, role: null, isOrgViewer: false })).toBe(false);
    expect(canManageGuests({ canAccess: true, role: 'admin', isOrgViewer: true })).toBe(false);
  });
});

describe('isInviteSecretStrong', () => {
  it('requires at least 32 bytes', () => {
    expect(isInviteSecretStrong(undefined)).toBe(false);
    expect(isInviteSecretStrong('')).toBe(false);
    expect(isInviteSecretStrong('a'.repeat(31))).toBe(false);
    expect(isInviteSecretStrong('a'.repeat(32))).toBe(true);
  });
});
