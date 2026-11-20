// The Call window on a lead or company: it rings the number from the browser,
// shows the call while it runs, and asks how it went afterwards.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VoiceSetup } from '../../api/_voice/shared/types';

const h = vi.hoisted(() => ({
  startCall: vi.fn(),
  endCall: vi.fn(),
  openLine: vi.fn(),
  line: { hangUp: vi.fn(), mute: vi.fn(), press: vi.fn() },
  tell: null as null | ((event: 'ringing' | 'answered' | 'ended', problem?: string) => void),
}));

vi.mock('@/services/voice/client', () => ({
  startCall: h.startCall,
  endCall: h.endCall,
  errorSentence: (e: unknown) => (e instanceof Error && e.message ? e.message : 'The request could not be completed. Please try again.'),
}));
vi.mock('@/services/voice/device', () => ({ openLine: h.openLine }));

import { CallDialog } from '@/components/crmHub/CallDialog';

const READY: VoiceSetup = { configured: true, ready: true, problem: null, numbers: { US: true, GB: true } };
const LEAD = '0d000000-0000-4000-8000-000000000001';

const show = (over: Partial<React.ComponentProps<typeof CallDialog>> = {}) => {
  const onOpenChange = vi.fn();
  const onLogged = vi.fn();
  render(
    <CallDialog open onOpenChange={onOpenChange} name="Elena Rossi" phone="07700 900123" target={{ contactId: LEAD }} setup={READY} onLogged={onLogged} {...over} />,
  );
  return { onOpenChange, onLogged };
};

const callButton = () => screen.getByRole('button', { name: 'Call' });

beforeEach(() => {
  h.startCall.mockReset().mockResolvedValue({ id: 'call-1', to: '+447700900123', display: '+44 7700 900123', country: 'GB', token: 'tok' });
  h.endCall.mockReset().mockResolvedValue(undefined);
  h.line.hangUp.mockReset().mockImplementation(() => h.tell?.('ended'));
  h.line.mute.mockReset();
  h.line.press.mockReset();
  h.openLine.mockReset().mockImplementation(async (_token: string, _id: string, on: typeof h.tell) => {
    h.tell = on;
    return h.line;
  });
});
afterEach(cleanup);

describe('call window', () => {
  it('shows the number it will ring and that the call is recorded', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Call Elena Rossi' })).toBeTruthy();
    expect((screen.getByLabelText('Number') as HTMLInputElement).value).toBe('07700 900123');
    expect(screen.getByText('Rings +44 7700 900123, United Kingdom.')).toBeTruthy();
    expect(screen.getByText(/This call is recorded/)).toBeTruthy();
    expect(callButton().hasAttribute('disabled')).toBe(false);
  });

  it('places the call, follows it, and saves how it went to the timeline', async () => {
    const { onOpenChange, onLogged } = show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    expect(h.startCall).toHaveBeenCalledWith({ contactId: LEAD, to: '+447700900123', country: 'GB' });
    expect(h.openLine.mock.calls[0].slice(0, 2)).toEqual(['tok', 'call-1']);

    act(() => h.tell?.('ringing'));
    expect(screen.getByRole('status').textContent).toBe('Ringing…');
    act(() => h.tell?.('answered'));
    expect(screen.getByRole('status').textContent).toBe('00:00');
    expect(screen.getByText('Recording')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(h.line.mute).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keypad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Press 1' }));
    expect(h.line.press).toHaveBeenCalledWith('1');

    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(h.line.hangUp).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Call ended.');

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Send the quote on Friday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to timeline' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.endCall).toHaveBeenCalledTimes(1);
    expect(h.endCall).toHaveBeenCalledWith('call-1', expect.objectContaining({ outcome: 'connected', note: 'Send the quote on Friday', answered: true }));
    expect(onLogged).toHaveBeenCalled();
  });

  it('says so when nobody answered', async () => {
    show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    act(() => h.tell?.('ringing'));
    act(() => h.tell?.('ended'));
    expect(screen.getByRole('status').textContent).toBe('The call was not answered.');
    fireEvent.click(screen.getByRole('button', { name: 'Save to timeline' }));
    await waitFor(() => expect(h.endCall).toHaveBeenCalledWith('call-1', expect.objectContaining({ outcome: 'no_answer', answered: false, seconds: 0 })));
  });

  it('cannot be closed by accident while a call is running', async () => {
    const { onOpenChange } = show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    act(() => h.tell?.('answered'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(h.line.hangUp).not.toHaveBeenCalled();
  });

  it('still logs the call when the window is closed without saving', async () => {
    const { onOpenChange } = show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    act(() => h.tell?.('ended'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(h.endCall).toHaveBeenCalledWith('call-1', { seconds: 0, answered: false }));
  });

  it('hangs up even when pressed before the line is open', async () => {
    let release: (v: unknown) => void = () => undefined;
    h.startCall.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    show();
    fireEvent.click(callButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Hang up' }));
    await act(async () => { release({ id: 'call-1', to: '+447700900123', display: '+44 7700 900123', country: 'GB', token: 'tok' }); });
    expect(h.openLine).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('The call was not answered.');
  });

  it('will not ring a number it must not, and says why', () => {
    show({ phone: '+33 1 42 68 53 00' });
    expect(screen.getByText('Calls can go to United States and United Kingdom numbers only.')).toBeTruthy();
    expect(callButton().hasAttribute('disabled')).toBe(true);
  });

  it('asks for the country when the number does not show it', () => {
    show({ phone: '555 0132' });
    expect(screen.getByText('Choose the country of this number, or write it with +1 or +44.')).toBeTruthy();
    expect(screen.getByLabelText('Country')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '+1 415 555 0132' } });
    expect(screen.getByText('Rings +1 (415) 555-0132, United States.')).toBeTruthy();
    expect(screen.queryByLabelText('Country')).toBeNull();
  });

  it('shows what is missing while calling is not set up, with the phone app as a way out', () => {
    const problem = "Calling is not set up yet: TWILIO_AUTH_TOKEN is missing in Vercel's environment variables.";
    show({ setup: { configured: true, ready: false, problem, numbers: { US: false, GB: false } } });
    expect(screen.getByRole('alert').textContent).toContain(problem);
    expect(screen.getByRole('link', { name: 'Use my phone app instead' }).getAttribute('href')).toBe('tel:07700 900123');
    expect(callButton().hasAttribute('disabled')).toBe(true);
  });

  it('says when there is no number to call that country from', () => {
    show({ setup: { ...READY, numbers: { US: true, GB: false } } });
    expect(screen.getByRole('alert').textContent).toContain('You have no United Kingdom number to call from yet.');
    expect(callButton().hasAttribute('disabled')).toBe(true);
  });

  it("shows the server's reason when it refuses to start the call", async () => {
    h.startCall.mockRejectedValue(new Error('Only the owner and admins can place calls.'));
    show();
    fireEvent.click(callButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Only the owner and admins can place calls.');
    expect(h.openLine).not.toHaveBeenCalled();
    expect(callButton()).toBeTruthy();
  });

  it('goes back to the start, and logs nothing, when the line fails before the other phone rings', async () => {
    const { onOpenChange } = show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    act(() => h.tell?.('ended', 'Allow the microphone for this site in your browser, then call again.'));
    expect(screen.getByRole('alert').textContent).toBe('Allow the microphone for this site in your browser, then call again.');
    // It can be tried again straight away, and closing it leaves nothing on the timeline.
    expect(callButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.endCall).not.toHaveBeenCalled();
  });

  it('keeps the reason the line gave when the provider refuses the site', async () => {
    const reason = 'The phone provider did not accept this site. Check TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET in Vercel, redeploy, then reload this page.';
    h.openLine.mockImplementation(async (_token: string, _id: string, on: NonNullable<typeof h.tell>) => {
      on('ended', reason);
      throw new Error('AccessTokenInvalid');
    });
    show();
    fireEvent.click(callButton());
    expect((await screen.findByRole('alert')).textContent).toBe(reason);
    expect(callButton()).toBeTruthy();
    expect(h.endCall).not.toHaveBeenCalled();
  });

  it('shows why a call that had started dropped, and still logs it', async () => {
    show();
    fireEvent.click(callButton());
    await waitFor(() => expect(h.openLine).toHaveBeenCalled());
    act(() => h.tell?.('ringing'));
    act(() => h.tell?.('ended', 'The call could not be connected. Please try again.'));
    expect(screen.getByRole('alert').textContent).toBe('The call could not be connected. Please try again.');
    expect(screen.getByRole('status').textContent).toBe('The call was not answered.');
    fireEvent.click(screen.getByRole('button', { name: 'Save to timeline' }));
    await waitFor(() => expect(h.endCall).toHaveBeenCalledWith('call-1', expect.objectContaining({ answered: false })));
  });
});
