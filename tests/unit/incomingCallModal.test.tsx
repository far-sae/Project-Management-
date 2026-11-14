import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const alerts = vi.hoisted(() => ({
  stopRing: vi.fn(),
  closeNotification: vi.fn(),
  stopFlash: vi.fn(),
  startIncomingRing: vi.fn(),
  showIncomingCallNotification: vi.fn(),
  startTitleFlash: vi.fn(),
}));
vi.mock('@/services/calling/incomingAlert', () => ({
  startIncomingRing: () => {
    alerts.startIncomingRing();
    return alerts.stopRing;
  },
  showIncomingCallNotification: (p: unknown) => {
    alerts.showIncomingCallNotification(p);
    return alerts.closeNotification;
  },
  startTitleFlash: (t: string) => {
    alerts.startTitleFlash(t);
    return alerts.stopFlash;
  },
}));

import { IncomingCallModal } from '@/components/calling/IncomingCallModal';

afterEach(cleanup);

describe('IncomingCallModal', () => {
  it('rings, notifies and flashes the title while shown, and stops all on close', () => {
    const { unmount } = render(
      <IncomingCallModal
        caller={{ userId: 'u2', displayName: 'Sam' }}
        mediaType="video"
        contextLabel="Website"
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(alerts.startIncomingRing).toHaveBeenCalledTimes(1);
    expect(alerts.showIncomingCallNotification).toHaveBeenCalledWith({
      callerName: 'Sam',
      mediaType: 'video',
      contextLabel: 'Website',
    });
    expect(alerts.startTitleFlash).toHaveBeenCalledWith('📞 Sam is calling…');

    unmount();
    expect(alerts.stopRing).toHaveBeenCalled();
    expect(alerts.closeNotification).toHaveBeenCalled();
    expect(alerts.stopFlash).toHaveBeenCalled();
  });

  it('shows the notification if the user switches away while it is ringing', () => {
    render(
      <IncomingCallModal
        caller={{ userId: 'u2', displayName: 'Sam' }}
        mediaType="audio"
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    alerts.showIncomingCallNotification.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(alerts.showIncomingCallNotification).toHaveBeenCalledTimes(1);
  });

  it('is a corner card like Teams, not a screen-blocking popup', () => {
    render(
      <IncomingCallModal
        caller={{ userId: 'u2', displayName: 'Sam' }}
        mediaType="video"
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const card = screen.getByRole('alertdialog');
    expect(card.className).not.toMatch(/inset-0/);
    expect(card.className).toMatch(/bottom-/);
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText(/video call/i)).toBeTruthy();
  });

  it('lets you answer a video call with video or with audio only', () => {
    const onAccept = vi.fn();
    render(
      <IncomingCallModal
        caller={{ userId: 'u2', displayName: 'Sam' }}
        mediaType="video"
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /accept with video/i }));
    expect(onAccept).toHaveBeenLastCalledWith({ audioOnly: false });
    fireEvent.click(screen.getByRole('button', { name: /accept with audio/i }));
    expect(onAccept).toHaveBeenLastCalledWith({ audioOnly: true });
  });

  it('offers only audio and decline for a voice call', () => {
    const onReject = vi.fn();
    render(
      <IncomingCallModal
        caller={{ userId: 'u2', displayName: 'Sam' }}
        mediaType="audio"
        onAccept={vi.fn()}
        onReject={onReject}
      />,
    );
    expect(screen.queryByRole('button', { name: /accept with video/i })).toBeNull();
    expect(screen.getByRole('button', { name: /accept with audio/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onReject).toHaveBeenCalled();
  });
});
