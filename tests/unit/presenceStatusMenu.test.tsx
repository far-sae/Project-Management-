// The status menu: who you are, how you appear now, and the choices with what each one does.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', displayName: 'Sam Example', email: 'sam@example.com' } }),
}));

import { PresenceStatusAvatarMenu } from '@/components/presence/PresenceStatusMenu';
import { chimeMutedByStatus } from '@/hooks/usePresenceStatusPreference';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const openMenu = (preference: 'auto' | 'appear_offline' | 'dnd' | 'holiday', onChange = vi.fn()) => {
  render(<PresenceStatusAvatarMenu preference={preference} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /your status/i }), { key: 'Enter' });
  return { menu: screen.getByRole('menu'), onChange };
};

describe('Status menu', () => {
  it('says the current status on the button, so it reads without opening', () => {
    render(<PresenceStatusAvatarMenu preference="dnd" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Your status: Do not disturb' })).toBeTruthy();
  });

  it('opens with who I am and how I appear now', () => {
    const { menu } = openMenu('dnd');
    expect(within(menu).getByText('Sam Example')).toBeTruthy();
    expect(within(menu).getByText('sam@example.com')).toBeTruthy();
    expect(within(menu).getByText('Do not disturb', { selector: '[data-current-status]' })).toBeTruthy();
  });

  it('lists the four choices and marks the one in use', () => {
    const { menu } = openMenu('holiday');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    expect(items.map((i) => within(i).getByTestId('status-label').textContent)).toEqual([
      'Online', 'Do not disturb', 'On holiday', 'Appear offline',
    ]);
  });

  it('changes my status when I pick another one', () => {
    const { menu, onChange } = openMenu('auto');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /appear offline/i }));
    expect(onChange).toHaveBeenCalledWith('appear_offline');
  });
});

describe('Do not disturb', () => {
  it('mutes message sounds, and only then', () => {
    expect(chimeMutedByStatus()).toBe(false);
    localStorage.setItem('presenceStatusPreferenceV1', 'dnd');
    expect(chimeMutedByStatus()).toBe(true);
    localStorage.setItem('presenceStatusPreferenceV1', 'holiday');
    expect(chimeMutedByStatus()).toBe(false);
  });
});
