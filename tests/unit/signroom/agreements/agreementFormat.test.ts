import { describe, expect, it } from 'vitest';
import type { AgreementSummary, AgreementTemplateSummary } from '../../../../api/_signroom/shared/types';
import {
  activityNote, canHold, canTrash, deliveryState, filterAgreements, initials, isLive, newestTemplates,
  progressLabel, sentLabel, shortDate, signedCount, sortAgreements, statusCounts, statusTone, typeHint, utcDateTime,
} from '@/lib/signroom/agreementFormat';

const summary = (over: Partial<AgreementSummary> = {}): AgreementSummary => ({
  id: 'a1', workspaceId: 'w', senderId: 'u1', clientId: 'cl1', type: 'NDA', title: 'NDA for Northwind Studio',
  status: 'Draft', revision: 1, sourceKind: 'authored', pages: [], participants: [], sequential: false,
  deadline: '', reminderDays: 3, subject: '', message: '', created: '2026-11-02T10:00:00.000Z',
  updated: '2026-11-03T10:00:00.000Z', legalHold: false, ...over,
});

const signer = (id: string, name: string, progress: 'waiting' | 'signed' = 'waiting') => ({
  id, name, email: `${id}@example.com`, role: 'signer' as const, order: 1, progress, version: 0,
});

describe('dates and names', () => {
  it('writes a short UTC date', () => {
    expect(shortDate('2026-11-02T23:30:00.000Z')).toBe('2 Nov 2026');
    expect(shortDate('2026-11-30')).toBe('30 Nov 2026');
  });
  it('writes a UTC date and time', () => {
    expect(utcDateTime('2026-11-02T09:05:00.000Z')).toBe('02/11/2026, 09:05:00 UTC');
  });
  it('takes two initials', () => {
    expect(initials('Elena Rossi')).toBe('ER');
    expect(initials('  sam  ')).toBe('S');
    expect(initials('')).toBe('');
  });
});

describe('status wording', () => {
  it('maps each status to a tone', () => {
    expect(statusTone('Completed')).toBe('success');
    expect(statusTone('signed')).toBe('success');
    expect(statusTone('Awaiting signatures')).toBe('warning');
    expect(statusTone('viewed')).toBe('warning');
    expect(statusTone('Finalising')).toBe('info');
    expect(statusTone('Declined')).toBe('danger');
    expect(statusTone('Expired')).toBe('danger');
    expect(statusTone('Draft')).toBe('neutral');
    expect(statusTone('waiting')).toBe('neutral');
  });
  it('labels a recipient by role and progress', () => {
    expect(progressLabel({ role: 'copy', progress: 'waiting' })).toBe('Completion copy');
    expect(progressLabel({ role: 'signer', progress: 'viewed' })).toBe('Viewed');
  });
  it('says when and whether an agreement was sent', () => {
    expect(sentLabel(summary())).toBe('Not sent');
    expect(sentLabel(summary({ sentAt: '2026-11-04T08:00:00.000Z' }))).toBe('4 Nov 2026');
    expect(sentLabel(summary({ sentAt: '2026-11-04T08:00:00.000Z', senderReleasePending: true }))).toBe('Not sent to company');
  });
  it('describes the latest activity', () => {
    expect(activityNote(summary())).toBe('Draft saved');
    expect(activityNote(summary({ status: 'Completed' }))).toBe('All signatures collected');
    expect(activityNote(summary({ status: 'Awaiting signatures' }))).toBe('Waiting for recipient');
    expect(activityNote(summary({ status: 'Cancelled' }))).toBe('Cancelled');
  });
  it('explains each type', () => {
    expect(typeHint('NDA')).toBe('Keep shared information confidential');
    expect(typeHint('Contract')).toBe('Bring your own ordinary agreement');
  });
});

describe('filterAgreements', () => {
  const list = [
    summary({ id: 'a1', title: 'NDA for Northwind Studio', status: 'Draft', clientId: 'cl1' }),
    summary({ id: 'a2', title: 'Service agreement', type: 'Service agreement', status: 'Awaiting signatures', clientId: 'cl2', participants: [signer('p1', 'Elena Rossi')] }),
    summary({ id: 'a3', title: 'Old contract', type: 'Contract', status: 'Completed', archivedAt: '2026-11-05T00:00:00.000Z', created: '2026-10-01T00:00:00.000Z' }),
    summary({ id: 'a4', title: 'Binned', status: 'Draft', trashedAt: '2026-11-06T00:00:00.000Z' }),
  ];
  const names = { cl1: 'Northwind Studio', cl2: 'Harbour Dental' };
  const ids = (over: Parameters<typeof filterAgreements>[1]) => filterAgreements(list, over).map((a) => a.id);

  it('shows active agreements by default, leaving out archived and trashed', () => {
    expect(ids({})).toEqual(['a1', 'a2']);
  });
  it('shows the archived, trash and all views', () => {
    expect(ids({ scope: 'archived' })).toEqual(['a3']);
    expect(ids({ scope: 'trash' })).toEqual(['a4']);
    expect(ids({ scope: 'all' })).toEqual(['a1', 'a2', 'a3']);
  });
  it('filters by status and type', () => {
    expect(ids({ status: 'Awaiting signatures' })).toEqual(['a2']);
    expect(ids({ type: 'NDA' })).toEqual(['a1']);
  });
  it('searches title, company name and recipients', () => {
    expect(ids({ search: 'harbour', clientNames: names })).toEqual(['a2']);
    expect(ids({ search: 'ELENA' })).toEqual(['a2']);
    expect(ids({ search: 'p1@example.com' })).toEqual(['a2']);
    expect(ids({ search: 'nda for' })).toEqual(['a1']);
  });
  it('filters by the day it was created', () => {
    expect(ids({ scope: 'all', to: '2026-10-31' })).toEqual(['a3']);
    expect(ids({ scope: 'all', from: '2026-11-01' })).toEqual(['a1', 'a2']);
  });
  it('counts by status across everything given', () => {
    expect(statusCounts(list)).toEqual({ total: 4, awaiting: 1, completed: 1, drafts: 2 });
  });
});

describe('sortAgreements', () => {
  const list = [
    summary({ id: 'b', title: 'Beta', updated: '2026-11-03T00:00:00.000Z' }),
    summary({ id: 'a', title: 'Alpha', updated: '2026-11-01T00:00:00.000Z' }),
    summary({ id: 'c', title: 'Gamma', updated: '2026-11-05T00:00:00.000Z' }),
  ];
  it('sorts by latest activity, oldest activity and title', () => {
    expect(sortAgreements(list, 'newest').map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(sortAgreements(list, 'oldest').map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(sortAgreements(list, 'title').map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(list.map((a) => a.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('rules the screens share with the server', () => {
  it('counts signed signers, ignoring completion copies', () => {
    const a = summary({
      participants: [signer('p1', 'Elena Rossi', 'signed'), signer('p2', 'Sam'), { ...signer('p3', 'Copy'), role: 'copy' }],
    });
    expect(signedCount(a)).toEqual({ signed: 1, signers: 2 });
  });
  it('refuses Trash while signing is active or a legal hold is on', () => {
    expect(canTrash(summary())).toBe(true);
    expect(canTrash(summary({ status: 'Awaiting signatures' }))).toBe(false);
    expect(canTrash(summary({ status: 'Finalising' }))).toBe(false);
    expect(canTrash(summary({ legalHold: true }))).toBe(false);
  });
  it('offers retention controls to an owner on a settled or draft agreement outside Trash', () => {
    expect(canHold(summary({ status: 'Completed' }), true)).toBe(true);
    expect(canHold(summary({ status: 'Completed' }), false)).toBe(false);
    expect(canHold(summary({ status: 'Awaiting signatures' }), true)).toBe(false);
    expect(canHold(summary({ status: 'Completed', trashedAt: '2026-11-06T00:00:00.000Z' }), true)).toBe(false);
  });
  it('knows which statuses still change on their own', () => {
    expect(isLive('Awaiting signatures')).toBe(true);
    expect(isLive('Finalising')).toBe(true);
    expect(isLive('Completed')).toBe(false);
  });
  it('reads the latest delivery for a recipient', () => {
    const deliveries = [
      { id: 'd1', participantId: 'p1', state: 'sent' as const, at: '2026-11-01T00:00:00.000Z' },
      { id: 'd2', participantId: 'p1', state: 'failed' as const, at: '2026-11-02T00:00:00.000Z' },
    ];
    expect(deliveryState(deliveries, 'p1')).toBe('failed');
    expect(deliveryState(deliveries, 'p2')).toBeNull();
    expect(deliveryState(undefined, 'p1')).toBeNull();
  });
});

describe('newestTemplates', () => {
  const t = (id: string, name: string, type: string, version: number): AgreementTemplateSummary => ({
    id, name, type, version, created: '2026-11-01T00:00:00.000Z',
  });
  it('keeps only the newest version of each name, for the chosen type', () => {
    const all = [t('t1', 'Standard NDA', 'NDA', 1), t('t2', 'Standard NDA', 'NDA', 2), t('t3', 'Retainer', 'Service agreement', 1)];
    expect(newestTemplates(all, 'NDA').map((x) => x.id)).toEqual(['t2']);
    expect(newestTemplates(all, 'Contract')).toEqual([]);
  });
});
