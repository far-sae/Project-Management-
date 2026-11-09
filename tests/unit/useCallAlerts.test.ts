import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const m = vi.hoisted(() => ({
  unlockCallAudio: vi.fn(() => vi.fn()),
  shouldOfferCallAlerts: vi.fn(() => true),
  requestCallAlerts: vi.fn(async () => 'granted'),
  dismissCallAlertsOffer: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), message: vi.fn() }),
}));
vi.mock('@/services/calling/incomingAlert', () => ({
  unlockCallAudio: m.unlockCallAudio,
  shouldOfferCallAlerts: m.shouldOfferCallAlerts,
  requestCallAlerts: m.requestCallAlerts,
  dismissCallAlertsOffer: m.dismissCallAlertsOffer,
}));
vi.mock('sonner', () => ({ toast: m.toast }));

import { useCallAlerts } from '@/hooks/useCallAlerts';

type ToastOpts = {
  action: { label: string; onClick: () => void };
  cancel: { label: string; onClick: () => void };
};

describe('useCallAlerts', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockClear());
    m.shouldOfferCallAlerts.mockReturnValue(true);
  });

  it('unlocks call audio for signed-in users', () => {
    renderHook(() => useCallAlerts(true));
    expect(m.unlockCallAudio).toHaveBeenCalledTimes(1);
  });

  it('offers to enable call alerts once, shortly after sign-in', () => {
    renderHook(() => useCallAlerts(true));
    expect(m.toast).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(m.toast).toHaveBeenCalledTimes(1);
    const opts = m.toast.mock.calls[0][1] as ToastOpts;
    expect(opts.action.label).toBe('Enable');
    opts.action.onClick();
    expect(m.requestCallAlerts).toHaveBeenCalled();
  });

  it('"Not now" remembers the choice', () => {
    renderHook(() => useCallAlerts(true));
    act(() => vi.advanceTimersByTime(5000));
    (m.toast.mock.calls[0][1] as ToastOpts).cancel.onClick();
    expect(m.dismissCallAlertsOffer).toHaveBeenCalled();
  });

  it('does nothing when signed out or when alerts are already decided', () => {
    renderHook(() => useCallAlerts(false));
    act(() => vi.advanceTimersByTime(5000));
    expect(m.unlockCallAudio).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();

    m.shouldOfferCallAlerts.mockReturnValue(false);
    renderHook(() => useCallAlerts(true));
    act(() => vi.advanceTimersByTime(5000));
    expect(m.toast).not.toHaveBeenCalled();
  });
});
