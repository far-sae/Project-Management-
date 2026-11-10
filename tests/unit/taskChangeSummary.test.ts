import { describe, expect, it } from 'vitest';
import { describeTaskChanges } from '@/lib/taskChangeSummary';

describe('describeTaskChanges', () => {
  it('says which column the task moved to', () => {
    expect(
      describeTaskChanges({ previousStatus: 'todo', newStatus: 'inprogress', statusLabel: (id) => (id === 'inprogress' ? 'On-Progress' : id) }),
    ).toEqual(['moved it to On-Progress']);
  });

  it('reports a new or removed due date', () => {
    expect(
      describeTaskChanges({ previousDueDate: '2026-11-10T00:00:00Z', newDueDate: '2026-11-13T12:00:00Z', formatDate: () => 'Fri, 13 Nov' }),
    ).toEqual(['changed the due date to Fri, 13 Nov']);
    expect(describeTaskChanges({ previousDueDate: '2026-11-10T00:00:00Z', newDueDate: null })).toEqual([
      'removed the due date',
    ]);
  });

  it('ignores a due date that only differs in format', () => {
    expect(
      describeTaskChanges({ previousDueDate: new Date('2026-11-13T00:00:00Z'), newDueDate: '2026-11-13T00:00:00.000Z' }),
    ).toEqual([]);
  });

  it('reports a priority change', () => {
    expect(describeTaskChanges({ previousPriority: 'medium', newPriority: 'high' })).toEqual([
      'changed the priority to High',
    ]);
  });

  it('lists several changes together, and nothing when nothing changed', () => {
    expect(
      describeTaskChanges({
        previousStatus: 'todo',
        newStatus: 'needreview',
        previousPriority: 'low',
        newPriority: 'medium',
        assigneesChanged: true,
      }),
    ).toEqual(['moved it to needreview', 'changed the priority to Medium', "updated who's assigned"]);
    expect(describeTaskChanges({ previousStatus: 'todo', newStatus: 'todo', previousPriority: 'low', newPriority: 'low' })).toEqual([]);
  });

  it('reports a meeting being scheduled, moved or cancelled', () => {
    const fmt = () => 'Fri 13 Nov, 15:00';
    expect(describeTaskChanges({ previousMeetingAt: null, newMeetingAt: '2026-11-13T15:00:00Z', formatDateTime: fmt })).toEqual([
      'scheduled a meeting for Fri 13 Nov, 15:00',
    ]);
    expect(
      describeTaskChanges({ previousMeetingAt: '2026-11-12T15:00:00Z', newMeetingAt: '2026-11-13T15:00:00Z', formatDateTime: fmt }),
    ).toEqual(['moved the meeting to Fri 13 Nov, 15:00']);
    expect(describeTaskChanges({ previousMeetingAt: '2026-11-12T15:00:00Z', newMeetingAt: null })).toEqual([
      'cancelled the meeting',
    ]);
  });
});
