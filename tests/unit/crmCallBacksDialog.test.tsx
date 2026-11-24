// The "When somebody calls back" window on the Calls page: who is rung, in
// which order, for how long, and what the owner is told after saving.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CallBackSettings } from '../../api/_voice/shared/types';
import { setInternalsVisible } from '@/lib/publicError';

const h = vi.hoisted(() => ({
  callBacks: vi.fn(), saveCallBacks: vi.fn(), internals: { visible: true },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useInternalsVisible', () => ({ useInternalsVisible: () => h.internals.visible }));
vi.mock('@/services/voice/client', () => ({
  callBacks: h.callBacks, saveCallBacks: h.saveCallBacks,
  errorSentence: (error: unknown) => (error instanceof Error ? error.message : 'The request could not be completed. Please try again.'),
}));

import { CallBacksDialog, looksInternational } from '@/components/crmHub/CallBacksDialog';

const WS = '11111111-1111-4111-8111-111111111111';
const settings = (over: Partial<CallBackSettings> = {}): CallBackSettings => ({
  ready: true, enabled: false, people: [], ringSeconds: 12, screen: true, numbers: ['+1 (415) 555-0100'], linked: null, ...over,
});
const onOpenChange = vi.fn();
async function open(now: CallBackSettings = settings()) {
  h.callBacks.mockResolvedValue(now);
  render(<CallBacksDialog open workspaceId={WS} onOpenChange={onOpenChange} />);
  await screen.findByLabelText('Each phone rings for (seconds)');
}
const person = (n: number, name: string, number: string) => {
  fireEvent.change(screen.getByLabelText(`Name of person ${n}`), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(`Phone number of person ${n}`), { target: { value: number } });
};

beforeEach(() => {
  for (const f of [h.callBacks, h.saveCallBacks, h.toast.success, h.toast.error, onOpenChange]) f.mockReset();
  h.internals.visible = true;
  h.saveCallBacks.mockImplementation(async (_ws: string, input: Partial<CallBackSettings>) => settings({ ...input, linked: input.enabled ? true : null }));
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('who takes call-backs', () => {
  it('opens switched off, with twelve seconds and the number people call back', async () => {
    await open();
    expect(h.callBacks).toHaveBeenCalledWith(WS);
    expect((screen.getByLabelText('Each phone rings for (seconds)') as HTMLInputElement).value).toBe('12');
    expect(screen.getByRole('dialog').textContent).toContain('Your number: +1 (415) 555-0100.');
    expect((screen.getByRole('checkbox', { name: /Take call-backs/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('saves the people in the order they are listed, with the ring time', async () => {
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Take call-backs/ }));
    person(1, 'Priya', '+91 98123 45678');
    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    person(2, 'Sam', '+44 7700 900123');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveCallBacks).toHaveBeenCalledTimes(1));
    expect(h.saveCallBacks.mock.calls[0]).toEqual([WS, {
      enabled: true, people: [{ name: 'Priya', number: '+91 98123 45678' }, { name: 'Sam', number: '+44 7700 900123' }], ringSeconds: 12, screen: true,
    }]);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved. Calls to your number now ring these people.'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('can ring them the other way round', async () => {
    await open(settings({ enabled: true, people: [{ name: 'Priya', number: '+919812345678' }, { name: 'Sam', number: '+447700900123' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Ring person 2 earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveCallBacks).toHaveBeenCalledTimes(1));
    expect(h.saveCallBacks.mock.calls[0][1].people.map((p: { name: string }) => p.name)).toEqual(['Sam', 'Priya']);
  });

  it('will not save a number without its country code, and says how to write it', async () => {
    await open();
    person(1, 'Priya', '98123 45678');
    expect(screen.getByRole('alert').textContent).toBe('The number of Priya must start with + and the country code, for example +91 98123 45678.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(looksInternational('+91 98123-45678')).toBe(true);
    expect(looksInternational('0044 7700 900123')).toBe(false);
  });

  it('cannot be switched on with nobody to ring', async () => {
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Take call-backs/ }));
    expect(screen.getByRole('alert').textContent).toBe('Add at least one person before switching call-backs on.');
  });

  it('keeps the change of ring time and the key press', async () => {
    await open(settings({ people: [{ name: 'Priya', number: '+919812345678' }] }));
    fireEvent.change(screen.getByLabelText('Each phone rings for (seconds)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Press a key to take the call/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveCallBacks.mock.calls[0]?.[1]).toMatchObject({ ringSeconds: 20, screen: false, enabled: false }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved. Call-backs are off.'));
  });
});

describe('what the owner is told', () => {
  it('shows the address to set by hand when the phone provider could not be told, and stays open', async () => {
    h.saveCallBacks.mockResolvedValue(settings({ enabled: true, people: [{ name: 'Priya', number: '+919812345678' }], linked: false, address: 'https://app.example.com/api/voice?path=incoming' }));
    await open(settings({ enabled: true, people: [{ name: 'Priya', number: '+919812345678' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const note = await screen.findByText('Saved, but your phone provider was not told yet.');
    expect(note.closest('[role="status"]')?.textContent).toContain('https://app.example.com/api/voice?path=incoming');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('gives somebody who does not run the site one neutral sentence instead of the address', async () => {
    h.internals.visible = false;
    h.saveCallBacks.mockResolvedValue(settings({ enabled: true, people: [{ name: 'Priya', number: '+919812345678' }], linked: false, address: 'https://app.example.com/api/voice?path=incoming' }));
    await open(settings({ enabled: true, people: [{ name: 'Priya', number: '+919812345678' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const note = await screen.findByText('Saved, but your phone provider was not told yet.');
    const box = note.closest('[role="status"]')?.textContent ?? '';
    expect(box).toContain('Please ask the person who set up calling to finish this step.');
    expect(box).not.toContain('api/voice');
  });

  it('says to run the SQL when the database is not ready, and offers no Save', async () => {
    h.callBacks.mockResolvedValue(settings({ ready: false }));
    render(<CallBacksDialog open workspaceId={WS} onOpenChange={onOpenChange} />);
    expect((await screen.findByRole('status')).textContent).toContain('supabase/crm_setup.sql');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the server sentence when the settings cannot be read or saved', async () => {
    h.callBacks.mockRejectedValue(new Error('Only the owner and admins can change who takes call-backs.'));
    render(<CallBacksDialog open workspaceId={WS} onOpenChange={onOpenChange} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Only the owner and admins can change who takes call-backs.');
    cleanup();
    h.saveCallBacks.mockRejectedValue(new Error('The same number is in the list twice.'));
    await open(settings({ people: [{ name: 'Priya', number: '+919812345678' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The same number is in the list twice.'));
  });
});
