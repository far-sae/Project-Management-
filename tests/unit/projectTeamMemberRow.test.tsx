// Project chat → Team tab: each person's row can message or call that one
// person. The call buttons at the top of the panel ring the whole project;
// these ring only the person on the row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  startCall: vi.fn(),
  status: 'idle' as string,
  mediaSupported: true,
}));

vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startCall: h.startCall }, state: { status: h.status } }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => h.mediaSupported }));

import { ProjectTeamMemberRow } from '@/components/project/ProjectTeamMemberRow';

const alice = {
  userId: 'alice',
  displayName: 'Alice Smith',
  email: 'alice@example.com',
  photoURL: 'https://example.com/alice.png',
};

const renderRow = (overrides: Partial<React.ComponentProps<typeof ProjectTeamMemberRow>> = {}) => {
  const props: React.ComponentProps<typeof ProjectTeamMemberRow> = {
    member: alice,
    roleLabel: 'Member',
    isSelf: false,
    peer: undefined,
    lastSeenAt: null,
    callsDisabled: false,
    onMessage: vi.fn(),
    ...overrides,
  };
  render(<ProjectTeamMemberRow {...props} />);
  return props;
};

beforeEach(() => {
  h.startCall.mockReset();
  h.status = 'idle';
  h.mediaSupported = true;
});
afterEach(cleanup);

describe('Project team member row', () => {
  it('shows the person, their role and whether they are online', () => {
    renderRow({
      peer: { userId: 'alice', displayName: 'Alice Smith', availability: 'online' } as never,
    });
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
  });

  it('voice call rings only that person', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Voice call Alice Smith' }));
    expect(h.startCall).toHaveBeenCalledTimes(1);
    const [context, media, target] = h.startCall.mock.calls[0];
    expect(context).toEqual({ type: 'dm', targetId: 'alice', label: 'Alice Smith' });
    expect(media).toBe('audio');
    expect(Array.isArray(target)).toBe(false);
    expect(target).toEqual({
      userId: 'alice',
      displayName: 'Alice Smith',
      photoURL: 'https://example.com/alice.png',
    });
  });

  it('video call rings only that person', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Video call Alice Smith' }));
    expect(h.startCall).toHaveBeenCalledTimes(1);
    const [context, media, target] = h.startCall.mock.calls[0];
    expect(context).toEqual({ type: 'dm', targetId: 'alice', label: 'Alice Smith' });
    expect(media).toBe('video');
    expect(target.userId).toBe('alice');
  });

  it('opens that person’s chat from the message button', () => {
    const props = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Message Alice Smith' }));
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    expect(h.startCall).not.toHaveBeenCalled();
  });

  it('has no message or call buttons on your own row', () => {
    renderRow({ isSelf: true });
    expect(screen.getByText('(you)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /message alice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /voice call/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /video call/i })).toBeNull();
  });

  it('has no call buttons for someone without an account yet', () => {
    renderRow({ member: { displayName: 'Pending Pat', email: 'pat@example.com' } });
    expect(screen.queryByRole('button', { name: /voice call/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /video call/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /message/i })).toBeNull();
  });

  it('hides the call buttons while a call is already in progress', () => {
    h.status = 'connected';
    renderRow();
    expect(screen.queryByRole('button', { name: /voice call/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /video call/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Message Alice Smith' })).toBeTruthy();
  });

  it('hides the call buttons when the browser cannot make calls', () => {
    h.mediaSupported = false;
    renderRow();
    expect(screen.queryByRole('button', { name: /voice call/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /video call/i })).toBeNull();
  });

  it('disables the call buttons for view-only users and never rings', () => {
    renderRow({ callsDisabled: true });
    const voice = screen.getByRole('button', { name: 'Voice call Alice Smith' }) as HTMLButtonElement;
    const video = screen.getByRole('button', { name: 'Video call Alice Smith' }) as HTMLButtonElement;
    expect(voice.disabled).toBe(true);
    expect(video.disabled).toBe(true);
    expect(voice.title).toMatch(/view-only/i);
    fireEvent.click(voice);
    fireEvent.click(video);
    expect(h.startCall).not.toHaveBeenCalled();
  });
});
