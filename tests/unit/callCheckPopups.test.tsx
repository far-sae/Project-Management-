import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  requestCallAlerts: vi.fn(),
  showNotification: vi.fn(async () => undefined),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'me', displayName: 'Me' } }) }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('@/services/livekit/fetchLiveKitToken', () => ({ dmRoomName: vi.fn(), fetchLiveKitToken: vi.fn() }));
vi.mock('@/services/calling/incomingAlert', () => ({
  NOTIFICATION_ICON: '/logo.png',
  requestCallAlerts: h.requestCallAlerts,
}));
vi.mock('@/services/calling/callWorker', () => ({
  callWorkerRegistration: () => ({ showNotification: h.showNotification }),
  registerCallWorker: vi.fn(async () => null),
}));

import { CallCheck } from '@/pages/CallCheck';

const setPermission = (permission: NotificationPermission) => {
  (window as unknown as { Notification: unknown }).Notification = { permission };
};

beforeEach(() => {
  h.requestCallAlerts.mockReset();
  h.showNotification.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Call check — pop-ups when minimised', () => {
  it('offers to turn pop-ups on when they are off', async () => {
    setPermission('default');
    h.requestCallAlerts.mockImplementation(async () => {
      setPermission('granted');
      return 'granted';
    });
    render(<CallCheck />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /turn on pop-ups/i }));
    });
    expect(h.requestCallAlerts).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send a test pop-up/i })).toBeTruthy();
  });

  it('explains how to unblock them when the browser blocked pop-ups', () => {
    setPermission('denied');
    render(<CallCheck />);
    expect(screen.queryByRole('button', { name: /turn on pop-ups/i })).toBeNull();
    expect(screen.getAllByText(/padlock/i).length).toBeGreaterThan(0);
  });

  it('sends a test pop-up after a few seconds so you can minimise first', async () => {
    vi.useFakeTimers();
    setPermission('granted');
    render(<CallCheck />);
    fireEvent.click(screen.getByRole('button', { name: /send a test pop-up/i }));
    expect(h.showNotification).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(h.showNotification).toHaveBeenCalledWith(
      'Test call from TaskCalendar',
      expect.objectContaining({ icon: '/logo.png' }),
    );
  });
});
