import { describe, expect, it } from 'vitest';
import type { Agreement, Field, Participant } from '../../../../api/_signroom/shared/types';
import {
  FIELD_LABELS, geometryAllows, hasRequiredSignature, meFirst, missingGuestFields, moveField, placeField,
  resizeField, savePayload, sendBlockers, signatureForEachSigner, signerNames,
} from '@/lib/signroom/agreementFields';

const person = (id: string, name: string, email: string, role: 'signer' | 'copy' = 'signer', order = 1): Participant => ({
  id, name, email, role, order, progress: 'waiting', version: 0,
});
const field = (over: Partial<Field> = {}): Field => ({
  id: 'f1', participantId: 'p1', kind: 'signature', label: 'Signature', page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.055,
  required: true, ...over,
});
const draft = (over: Partial<Agreement> = {}): Agreement => ({
  id: 'a1', workspaceId: 'w', senderId: 'u1', clientId: 'cl1', type: 'NDA', title: 'NDA for Northwind Studio', status: 'Draft',
  revision: 4, content: 'Terms', sourceKind: 'authored', documentHash: 'hash1', pages: [{ width: 595, height: 842 }],
  participants: [person('p1', 'Elena Rossi', 'elena@northwind.example')], fields: [field()], sequential: false, deadline: '',
  reminderDays: 3, subject: '', message: '', created: '2026-11-02T10:00:00.000Z', updated: '2026-11-03T10:00:00.000Z',
  events: [], legalHold: false, ...over,
});
const me = { name: 'Sam', email: 'sam@example.com' };
const NOW = Date.parse('2026-11-19T12:00:00.000Z');

describe('placing fields', () => {
  it('sizes a field by its kind and keeps it on the page', () => {
    expect(placeField({ id: 'n', kind: 'signature', participantId: 'p1', page: 2 })).toEqual({
      id: 'n', participantId: 'p1', kind: 'signature', label: 'Signature', page: 2, x: 0.12, y: 0.72, width: 0.3, height: 0.055, required: true,
    });
    const box = placeField({ id: 'n', kind: 'checkbox', participantId: 'p1', page: 1, x: 0.99, y: -0.2 });
    expect([box.width, box.height]).toEqual([0.045, 0.033]);
    expect(box.x).toBeCloseTo(0.955);
    expect(box.y).toBe(0);
    expect(placeField({ id: 'n', kind: 'full_name', participantId: 'p1', page: 1 }).label).toBe(FIELD_LABELS.full_name);
  });
  it('adds one signature for each signer on the last page, two to a row', () => {
    const people = [person('p1', 'Elena Rossi', 'e@x.example'), person('c', 'Copy', 'c@x.example', 'copy'), person('p2', 'Sam', 's@x.example'), person('p3', 'Priya', 'p@x.example')];
    let n = 0;
    const made = signatureForEachSigner(people, 3, () => `id${++n}`);
    expect(made.map((f) => [f.id, f.participantId, f.page])).toEqual([['id1', 'p1', 3], ['id2', 'p2', 3], ['id3', 'p3', 3]]);
    expect(made.map((f) => f.x)).toEqual([0.1, 0.55, 0.1]);
    expect(made[2].y).toBeCloseTo(0.8);
    expect(made.every((f) => f.kind === 'signature' && f.required && f.width === 0.35)).toBe(true);
  });
  it('moves and resizes inside the page', () => {
    expect(moveField(field(), 0.9, 0.9)).toEqual({ x: 0.7, y: 1 - 0.055 });
    expect(moveField(field(), -0.9, -0.9)).toEqual({ x: 0, y: 0 });
    expect(resizeField(field(), 2, 2)).toEqual({ width: 0.9, height: expect.closeTo(0.3) });
    expect(resizeField(field(), -2, -2)).toEqual({ width: 0.025, height: 0.015 });
  });
  it('accepts a typed size or position only when the field still fits', () => {
    expect(geometryAllows(field(), 'x', 0.5)).toBe(true);
    expect(geometryAllows(field(), 'x', 0.8)).toBe(false);
    expect(geometryAllows(field(), 'width', 0.01)).toBe(false);
    expect(geometryAllows(field(), 'height', 0.005)).toBe(false);
    expect(geometryAllows(field(), 'y', 0.99)).toBe(false);
  });
  it('names signers only', () => {
    expect(signerNames([person('p1', 'Elena Rossi', 'e@x.example'), person('p2', '', 's@x.example'), person('c', 'Copy', 'c@x.example', 'copy')]))
      .toEqual({ p1: 'Elena Rossi', p2: 'Unnamed signer' });
  });
  it('knows whether a signer has a required signature field', () => {
    expect(hasRequiredSignature([field()], 'p1')).toBe(true);
    expect(hasRequiredSignature([field({ required: false })], 'p1')).toBe(false);
    expect(hasRequiredSignature([field({ kind: 'initials' })], 'p1')).toBe(false);
    expect(hasRequiredSignature([field()], 'p2')).toBe(false);
  });
});

describe('sendBlockers', () => {
  it('is empty when everything the server asks for is there', () => {
    expect(sendBlockers(draft(), me, NOW)).toEqual([]);
  });
  it('asks for the PDF', () => {
    expect(sendBlockers(draft({ documentHash: undefined, pages: [] }), me, NOW)).toContain('Prepare and review the PDF first.');
  });
  it('asks for a signer', () => {
    expect(sendBlockers(draft({ participants: [person('c', 'Copy', 'c@x.example', 'copy')], fields: [] }), me, NOW))
      .toContain('Add at least one signer.');
  });
  it('asks for names, valid and unique email addresses', () => {
    const out = sendBlockers(draft({
      participants: [person('p1', '', 'not-an-email'), person('p2', 'Sam', 'SAM@x.example'), person('p3', 'Sam Two', 'sam@x.example ')],
      fields: [field(), field({ id: 'f2', participantId: 'p2' }), field({ id: 'f3', participantId: 'p3' })],
    }), me, NOW);
    expect(out).toEqual(['Every recipient needs a name.', 'Enter a valid email address.', 'Use unique email addresses for recipients.']);
  });
  it('asks for a required signature field for each named signer', () => {
    const out = sendBlockers(draft({
      participants: [person('p1', 'Elena Rossi', 'elena@northwind.example'), person('p2', 'Sam', 'sam@example.com')],
    }), me, NOW);
    expect(out).toEqual(['Add a required signature field for Sam.']);
  });
  it('refuses a deadline that has passed, and allows today', () => {
    expect(sendBlockers(draft({ deadline: '2026-11-18' }), me, NOW)).toEqual(['Choose a future deadline.']);
    expect(sendBlockers(draft({ deadline: '2026-11-19' }), me, NOW)).toEqual([]);
  });
  it('refuses unfilled template placeholders', () => {
    expect(sendBlockers(draft({ content: 'Between {{client_name}} and us' }), me, NOW)).toEqual(['Resolve all template placeholders.']);
  });
  it('needs the sender first and one other signer when signing first', () => {
    const sentence = 'Sign-first requires you as the first signer and at least one other signer.';
    expect(sendBlockers(draft({ senderFirst: true }), me, NOW)).toContain(sentence);
    const both = draft({
      senderFirst: true,
      participants: [person('m', 'Sam', 'sam@example.com'), person('p1', 'Elena Rossi', 'elena@northwind.example')],
      fields: [field({ participantId: 'm' }), field({ id: 'f2' })],
    });
    expect(sendBlockers(both, me, NOW)).toEqual([]);
    expect(sendBlockers({ ...both, participants: [...both.participants].reverse() }, me, NOW)).toEqual([sentence]);
  });
});

describe('meFirst', () => {
  it('puts the sender first as a signer and renumbers everyone', () => {
    const out = meFirst([person('p1', 'Elena Rossi', 'elena@northwind.example')], me, () => 'new');
    expect(out.map((p) => [p.id, p.name, p.order, p.role])).toEqual([['new', 'Sam', 1, 'signer'], ['p1', 'Elena Rossi', 2, 'signer']]);
  });
  it('reuses the sender when they are already a recipient', () => {
    const out = meFirst([person('p1', 'Elena Rossi', 'elena@northwind.example'), person('m', 'Sam', 'Sam@Example.com', 'copy', 2)], me, () => 'new');
    expect(out.map((p) => [p.id, p.order, p.role])).toEqual([['m', 1, 'signer'], ['p1', 2, 'signer']]);
  });
});

describe('savePayload', () => {
  it('sends only what the server saves, with the revision', () => {
    expect(savePayload(draft({ senderFirst: true, deadline: '2026-12-01' }), true)).toEqual({
      revision: 4, title: 'NDA for Northwind Studio', content: 'Terms', participants: draft().participants, fields: draft().fields,
      senderFirst: true, sequential: false, deadline: '2026-12-01', reminderDays: 3, subject: '', message: '', clearFields: true,
    });
  });
});

describe('missingGuestFields', () => {
  const fields = [
    field({ id: 's', kind: 'signature' }),
    field({ id: 'd', kind: 'date_signed', label: 'Date signed' }),
    field({ id: 'n', kind: 'full_name', label: 'Full name' }),
    field({ id: 'c', kind: 'checkbox', label: 'I agree' }),
    field({ id: 'o', kind: 'text', label: 'Notes', required: false }),
  ];
  it('lists required fields with nothing in them; the date is always filled by the server', () => {
    expect(missingGuestFields(fields, '', {}).map((f) => f.id)).toEqual(['s', 'n', 'c']);
    expect(missingGuestFields(fields, '  ', { n: 'Elena Rossi' }).map((f) => f.id)).toEqual(['s', 'c']);
    expect(missingGuestFields(fields, 'Elena Rossi', { n: 'Elena Rossi', c: true })).toEqual([]);
  });
});
