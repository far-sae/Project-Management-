// An open record follows the workspace switcher, and the switcher follows a record opened from a link.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ selectedId: 'w1', select: vi.fn(), navigate: vi.fn() }));

vi.mock('@/hooks/useSelectedWorkspace', () => ({
  useSelectedWorkspace: () => ({ selectedId: h.selectedId, select: h.select }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

import { useStayInWorkspace } from '@/hooks/useStayInWorkspace';

beforeEach(() => {
  h.selectedId = 'w1';
  h.select.mockClear();
  h.navigate.mockClear();
});

const open = (recordWorkspace: string | null) =>
  renderHook(() => useStayInWorkspace('deal-1', recordWorkspace, '/crm/deals'));

describe('useStayInWorkspace', () => {
  it('does nothing while the record is in the selected workspace', () => {
    open('w1');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('switches to the record’s workspace when the record is opened from somewhere else', () => {
    open('w2');
    expect(h.select).toHaveBeenCalledWith('w2');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('goes back to the list when the workspace is changed while the record is open', () => {
    const view = open('w1');
    h.selectedId = 'w3';
    view.rerender();
    expect(h.navigate).toHaveBeenCalledWith('/crm/deals', { replace: true });
    expect(h.select).not.toHaveBeenCalled();
  });

  it('leaves a record with no workspace alone', () => {
    const view = open(null);
    h.selectedId = 'w3';
    view.rerender();
    expect(h.select).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
