import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

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
});
