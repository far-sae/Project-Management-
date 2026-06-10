// tests/unit/pipelineStageDropdown.test.tsx
//
// Slice 6b — simplified pipeline. Covers the two correctness-critical bits of
// the stage-dropdown + assign-task UX:
//  1. resolveStageChange — the SHARED routing decision used by both the kanban
//     (moveDealToStage) and the list view (handleListStageChange). A Won pick
//     must route to 'won-confirm' (DealWonModal + handoff), never a plain
//     update; Lost and open stages route to 'update'; same-stage is a no-op.
//  2. DealsListView — the per-row "Assign task" action fires onAssignTask with
//     the row's deal, so the handoff dialog can open for ANY deal (not just won).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { resolveStageChange } from '@/services/supabase/deals';
import { DealsListView } from '@/components/deals/DealsListView';

// useFormatMoney / useOrgCurrency reach into auth + org context; stub them so
// the flat-list render stays a pure component test.
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => (n: number, c?: string) => `${c ?? 'USD'} ${n}`,
}));
vi.mock('@/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
}));

describe('resolveStageChange (shared kanban + list routing)', () => {
  it('routes a Won pick to the won-confirm modal, not a plain update', () => {
    expect(
      resolveStageChange('proposal', { key: 'won', isWon: true, isLost: false }),
    ).toBe('won-confirm');
  });

  it('routes Lost and open stages to a plain update', () => {
    expect(
      resolveStageChange('proposal', { key: 'lost', isWon: false, isLost: true }),
    ).toBe('update');
    expect(
      resolveStageChange('lead', { key: 'qualified', isWon: false, isLost: false }),
    ).toBe('update');
  });

  it('no-ops when the deal is already in the target stage', () => {
    expect(
      resolveStageChange('won', { key: 'won', isWon: true, isLost: false }),
    ).toBe('noop');
  });
});

const makeDeal = (over: Record<string, unknown> = {}) =>
  ({
    dealId: 'd1',
    organizationId: 'o1',
    pipelineId: 'p1',
    stageId: 's-lead',
    title: 'Acme renewal',
    clientName: 'Acme',
    stage: 'lead',
    value: 1000,
    currency: 'USD',
    probability: 10,
    ownerName: 'Rep',
    expectedCloseDate: null,
    tags: [],
    position: 1,
    customFields: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as any;

describe('DealsListView assign-task action', () => {
  beforeEach(() => vi.clearAllMocks());
  // The vitest setup doesn't auto-cleanup between tests; unmount so a
  // previous render's rows don't leak into the next query.
  afterEach(() => cleanup());

  it('fires onAssignTask with the row deal when "Assign task" is clicked', () => {
    const onAssignTask = vi.fn();
    render(
      <DealsListView
        deals={[makeDeal()]}
        onSelectDeal={() => {}}
        onAssignTask={onAssignTask}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /assign task/i }));
    expect(onAssignTask).toHaveBeenCalledTimes(1);
    expect(onAssignTask.mock.calls[0][0].dealId).toBe('d1');
  });

  it('hides the per-row stage dropdown + actions in read-only mode', () => {
    render(<DealsListView deals={[makeDeal()]} onSelectDeal={() => {}} />);
    expect(screen.queryByRole('button', { name: /assign task/i })).toBeNull();
    // The static stage label still renders (the deal's current stage).
    expect(screen.getByText('Lead')).toBeTruthy();
  });
});
