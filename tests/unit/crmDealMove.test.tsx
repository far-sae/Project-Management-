// Moving a deal: Lost asks why first, Won starts the hand-off, the chance follows the stage.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ moveDealToStage: vi.fn() }));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/services/supabase/crmHub/deals', () => ({ moveDealToStage: h.moveDealToStage }));
vi.mock('@/components/crmHub/DealHandoffDialog', () => ({
  DealHandoffDialog: ({ deal, open }: { deal: { name: string } | null; open: boolean }) =>
    open && deal ? <div role="dialog">Hand off {deal.name}</div> : null,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { useDealMove } from '@/components/crmHub/useDealMove';
import type { CrmDeal, CrmDealStage } from '@/types/crmHub';

const stage = (id: string, name: string, sortOrder: number, probability: number, status: 'open' | 'won' | 'lost' = 'open') =>
  ({ id, name, sortOrder, probability, status }) as CrmDealStage;
const stages = [
  stage('s1', 'New Lead', 1, 10),
  stage('s2', 'Qualified', 2, 25),
  stage('s3', 'Won', 3, 100, 'won'),
  stage('s4', 'Lost', 4, 0, 'lost'),
];
const deal = { id: 'd1', name: 'Website rebuild', stageId: 's1', probability: 10, status: 'open', projectId: null } as CrmDeal;

const onChanged = vi.fn();
const Harness: React.FC = () => {
  const { requestMove, dialogs } = useDealMove({ stages, onChanged });
  return (
    <>
      {stages.map((s) => (
        <button key={s.id} onClick={() => requestMove(deal, s.id)}>to {s.name}</button>
      ))}
      {dialogs}
    </>
  );
};

afterEach(cleanup);

beforeEach(() => {
  h.moveDealToStage.mockReset();
  onChanged.mockReset();
  h.moveDealToStage.mockImplementation(async (_id: string, stageId: string, status: string) => ({
    ...deal, stageId, status,
  }));
});

describe('moving a deal', () => {
  it('moves to an open stage straight away and takes the stage chance', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('to Qualified'));
    await waitFor(() => expect(h.moveDealToStage).toHaveBeenCalledTimes(1));
    expect(h.moveDealToStage).toHaveBeenCalledWith('d1', 's2', 'open', 'Qualified', {
      probability: 25, lostReason: undefined, actorId: 'u1',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing when the deal is already in that stage', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('to New Lead'));
    expect(h.moveDealToStage).not.toHaveBeenCalled();
  });

  it('asks why before marking a deal lost, and saves the reason', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('to Lost'));
    expect(h.moveDealToStage).not.toHaveBeenCalled();
    expect(screen.getByText('Mark “Website rebuild” as lost')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() => expect(h.moveDealToStage).toHaveBeenCalledTimes(1));
    expect(h.moveDealToStage.mock.calls[0][2]).toBe('lost');
    expect(h.moveDealToStage.mock.calls[0][4]).toMatchObject({ probability: 0, lostReason: 'Price' });
  });

  it('cancelling the lost dialog leaves the deal where it was', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('to Lost'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.moveDealToStage).not.toHaveBeenCalled();
  });

  it('opens the hand-off to a project as soon as a deal is won', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('to Won'));
    await waitFor(() => expect(screen.getByText('Hand off Website rebuild')).toBeTruthy());
    expect(h.moveDealToStage.mock.calls[0][4]).toMatchObject({ probability: 100 });
  });

  it('does not ask for a hand-off when the won deal already has a project', async () => {
    h.moveDealToStage.mockResolvedValue({ ...deal, stageId: 's3', status: 'won', projectId: 'p1' });
    render(<Harness />);
    fireEvent.click(screen.getByText('to Won'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText('Hand off Website rebuild')).toBeNull();
  });
});
