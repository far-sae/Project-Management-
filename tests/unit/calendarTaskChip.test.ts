// Calendar task chips are coloured by how loud the task is, so urgent work
// stands out in the month grid and finished work fades.
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_CHIP_CLASS,
  CALENDAR_CHIP_LEGEND,
  calendarChipClass,
  calendarChipLevel,
} from '@/pages/calendarTaskChip';

describe('calendarChipLevel', () => {
  it('a finished task is "done", even when it was urgent or high priority', () => {
    expect(calendarChipLevel({ status: 'done', urgent: true, priority: 'high' })).toBe('done');
  });

  it('urgent beats priority', () => {
    expect(calendarChipLevel({ status: 'todo', urgent: true, priority: 'low' })).toBe('urgent');
  });

  it('follows the priority for tasks that are not urgent', () => {
    expect(calendarChipLevel({ status: 'todo', priority: 'high' })).toBe('high');
    expect(calendarChipLevel({ status: 'todo', priority: 'medium' })).toBe('medium');
    expect(calendarChipLevel({ status: 'todo', priority: 'low' })).toBe('low');
  });

  it('a task with no priority is shown as low', () => {
    expect(calendarChipLevel({ status: 'todo' })).toBe('low');
    expect(calendarChipLevel({ status: 'todo', priority: null, urgent: null })).toBe('low');
  });
});

describe('calendarChipClass', () => {
  it('urgent is a solid red chip', () => {
    const cls = calendarChipClass({ status: 'todo', urgent: true });
    expect(cls).toContain('bg-destructive');
    expect(cls).toContain('text-destructive-foreground');
    expect(cls).not.toContain('bg-destructive-soft');
  });

  it('high is a soft red chip with a red border', () => {
    const cls = calendarChipClass({ status: 'todo', priority: 'high' });
    expect(cls).toContain('bg-destructive-soft');
    expect(cls).toContain('border-destructive/30');
  });

  it('medium is a soft amber chip', () => {
    expect(calendarChipClass({ status: 'todo', priority: 'medium' })).toContain('bg-warning-soft');
  });

  it('low is a grey chip', () => {
    expect(calendarChipClass({ status: 'todo', priority: 'low' })).toContain('bg-secondary');
  });

  it('done is plain and struck through', () => {
    const cls = calendarChipClass({ status: 'done', priority: 'high' });
    expect(cls).toContain('line-through');
    expect(cls).toContain('bg-background');
    expect(cls).not.toContain('destructive');
  });

  it('only uses theme tokens, never raw palette colours', () => {
    for (const cls of Object.values(CALENDAR_CHIP_CLASS)) {
      expect(cls).not.toMatch(/(red|emerald|green|amber|orange|blue|sky|violet|gray|slate)-\d/);
    }
  });
});

describe('CALENDAR_CHIP_LEGEND', () => {
  it('lists every level once, loudest first', () => {
    expect(CALENDAR_CHIP_LEGEND.map((l) => l.level)).toEqual(['urgent', 'high', 'medium', 'low', 'done']);
    expect(CALENDAR_CHIP_LEGEND.map((l) => l.label)).toEqual(['Urgent', 'High', 'Medium', 'Low', 'Done']);
  });
});
