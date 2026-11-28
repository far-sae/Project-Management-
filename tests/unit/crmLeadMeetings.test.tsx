// Meetings with a lead: planning one (a room and a link from the call server,
// the meeting written down, the link emailed), and joining, copying, emailing
// again and cancelling the ones that are planned.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setInternalsVisible } from '@/lib/publicError';
import { defaultStart, meetingState, startOf, whenLabel } from '@/lib/crmMeetings';
import type { CrmMeeting } from '@/services/supabase/crmHub/meetings';

const h = vi.hoisted(() => ({
  listLeadMeetings: vi.fn(), createMeeting: vi.fn(), cancelMeeting: vi.fn(), emailMeetingInvite: vi.fn(),
  createMeetingInvite: vi.fn(), startMeeting: vi.fn(),
  call: { status: 'idle' },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/components/calling/CallProvider', () => ({ useCallContext: () => ({ actions: { startMeeting: h.startMeeting }, state: h.call }) }));
vi.mock('@/services/livekit/guestApi', () => ({ createMeetingInvite: h.createMeetingInvite }));
vi.mock('@/services/supabase/crmHub/meetings', () => ({
  listLeadMeetings: h.listLeadMeetings, createMeeting: h.createMeeting, cancelMeeting: h.cancelMeeting, emailMeetingInvite: h.emailMeetingInvite,
}));
vi.mock('@/services/automation/client', () => ({ errorSentence: (e: unknown) => (e instanceof Error ? e.message : 'The request could not be completed. Please try again.') }));

import { LeadMeetings } from '@/components/crmHub/LeadMeetings';

const NOW = new Date(2026, 10, 28, 12, 0, 0);
const ROOM = 'crm:ws-1:0b000000-0000-4000-8000-000000000002';
const LINK = 'https://taskcalendar.co.uk/join/token';
const meeting = (over: Partial<CrmMeeting> = {}): CrmMeeting => ({
  id: 'm1', organizationId: 'org-1', workspaceId: 'ws-1', contactId: 'lead-1', title: 'Website review', startsAt: new Date(2026, 11, 2, 15, 0, 0),
  durationMinutes: 30, roomName: ROOM, joinUrl: LINK, notes: null, invitedEmail: null, invitedAt: null, cancelledAt: null, ...over,
});

const Harness: React.FC<{ email?: string | null; startOpen?: boolean; onChanged?: () => void }> = ({ email = 'elena@northwind.example', startOpen = false, onChanged }) => {
  const [planning, setPlanning] = React.useState(startOpen);
  return (
    <LeadMeetings
      organizationId="org-1" workspaceId="ws-1" lead={{ id: 'lead-1', name: 'Elena Rossi', email }}
      planning={planning} onPlanning={setPlanning} onChanged={onChanged} now={() => NOW}
    />
  );
};
const show = async (props: React.ComponentProps<typeof Harness> = {}) => {
  render(<Harness {...props} />);
  await waitFor(() => expect(screen.queryByLabelText('Loading meetings')).toBeNull());
};

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => {
  for (const fn of [h.listLeadMeetings, h.createMeeting, h.cancelMeeting, h.emailMeetingInvite, h.createMeetingInvite, h.startMeeting, h.toast.success, h.toast.error, h.toast.message]) fn.mockReset();
  h.call.status = 'idle';
  h.listLeadMeetings.mockResolvedValue({ meetings: [meeting()], ready: true });
  h.createMeetingInvite.mockResolvedValue({ url: LINK, expiresAt: '2026-12-03T15:00:00.000Z', roomName: ROOM });
  h.createMeeting.mockImplementation(async (input: Record<string, unknown>) => meeting({ id: 'm-new', ...(input as Partial<CrmMeeting>) }));
  h.emailMeetingInvite.mockResolvedValue({ sentTo: 'elena@northwind.example' });
  h.cancelMeeting.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('the small sums', () => {
  it('opens the planner on tomorrow at ten', () => {
    expect(defaultStart(NOW)).toBe('2026-11-29T10:00');
    expect(startOf('2026-11-29T10:00')?.getHours()).toBe(10);
    expect(startOf('')).toBeNull();
    expect(startOf('2026-11')).toBeNull();
  });

  it('writes a start in the reader’s own time', () => {
    expect(whenLabel(new Date(2026, 11, 2, 15, 0, 0))).toBe('Wed 2 Dec 2026, 15:00');
  });

  it('knows a meeting that is on now, and one whose link no longer opens', () => {
    const m = { startsAt: new Date(2026, 10, 28, 12, 10, 0), durationMinutes: 30 };
    expect(meetingState(m, NOW)).toBe('now');
    expect(meetingState({ ...m, startsAt: new Date(2026, 10, 30, 9, 0, 0) }, NOW)).toBe('upcoming');
    // Ended earlier today: the link still opens for a day after the start.
    expect(meetingState({ ...m, startsAt: new Date(2026, 10, 28, 9, 0, 0) }, NOW)).toBe('upcoming');
    expect(meetingState({ ...m, startsAt: new Date(2026, 10, 27, 11, 0, 0) }, NOW)).toBe('over');
  });
});

describe('the meetings of a lead', () => {
  it('lists what is planned, with when it is and whether the invite went out', async () => {
    h.listLeadMeetings.mockResolvedValue({ meetings: [meeting({ invitedEmail: 'elena@northwind.example', invitedAt: new Date(2026, 10, 28, 9, 30, 0) })], ready: true });
    await show();
    expect(h.listLeadMeetings).toHaveBeenCalledWith('ws-1', 'lead-1');
    const row = screen.getByRole('listitem', { name: 'Website review' });
    expect(row.textContent).toContain('Wed 2 Dec 2026, 15:00 · 30 minutes');
    expect(row.textContent).toContain('Invite emailed to elena@northwind.example on Sat 28 Nov 2026, 09:30');
    expect(within(row).getByRole('button', { name: 'Email the invite again for Website review' })).toBeTruthy();
  });

  it('joins a meeting as the host, in the room the link leads to', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Join Website review' }));
    expect(h.startMeeting).toHaveBeenCalledWith({ type: 'meeting', targetId: 'm1', label: 'Website review', roomName: ROOM }, 'video');
  });

  it('does not offer to join while a call is on', async () => {
    h.call.status = 'connected';
    await show();
    expect((screen.getByRole('button', { name: 'Join Website review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('emails the invite from the list, and says who got it', async () => {
    const onChanged = vi.fn();
    await show({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Email the invite for Website review' }));
    await waitFor(() => expect(h.emailMeetingInvite).toHaveBeenCalledWith('ws-1', 'm1', { timeZone: expect.any(String) }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('The invite was emailed to elena@northwind.example.'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('says in plain words why an invite did not go out', async () => {
    h.emailMeetingInvite.mockRejectedValue(new Error('This person asked not to get emails from you, so the invite was not emailed. You can copy the link and send it another way.'));
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Email the invite for Website review' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/asked not to get emails/)));
  });

  it('cancels a meeting only after it is confirmed, and says the lead is not told', async () => {
    h.listLeadMeetings.mockResolvedValue({ meetings: [meeting({ invitedEmail: 'elena@northwind.example', invitedAt: new Date(2026, 10, 28, 9, 30, 0) })], ready: true });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Website review' }));
    expect(h.cancelMeeting).not.toHaveBeenCalled();
    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain('Elena Rossi is not told by itself');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel the meeting' }));
    await waitFor(() => expect(h.cancelMeeting).toHaveBeenCalledWith('m1'));
  });

  it('shows a meeting whose link no longer opens as over, with nothing to press', async () => {
    h.listLeadMeetings.mockResolvedValue({ meetings: [meeting({ startsAt: new Date(2026, 10, 20, 15, 0, 0) })], ready: true });
    await show();
    const row = screen.getByRole('listitem', { name: 'Website review' });
    expect(within(row).getByText('Over')).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('says so when nothing is planned', async () => {
    h.listLeadMeetings.mockResolvedValue({ meetings: [], ready: true });
    await show();
    expect(screen.getByText(/No meeting is planned/)).toBeTruthy();
  });

  it('offers nothing that would fail while meetings are not switched on, and uses no set-up words', async () => {
    setInternalsVisible(false);
    h.listLeadMeetings.mockResolvedValue({ meetings: [], ready: false });
    await show();
    expect((screen.getByRole('button', { name: 'Plan a meeting' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Meetings with leads are not switched on yet.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/crm_setup|SQL/);
  });
});

describe('planning a meeting', () => {
  const openPlanner = async (props: React.ComponentProps<typeof Harness> = {}) => {
    await show(props);
    fireEvent.click(screen.getByRole('button', { name: 'Plan a meeting' }));
    return screen.findByRole('dialog', { name: 'Plan a meeting' });
  };

  it('starts from the lead’s name, tomorrow at ten, half an hour, with the link emailed', async () => {
    const dialog = await openPlanner();
    expect((within(dialog).getByLabelText('What it is about') as HTMLInputElement).value).toBe('Meeting with Elena Rossi');
    expect((within(dialog).getByLabelText('Day and time') as HTMLInputElement).value).toBe('2026-11-29T10:00');
    expect((within(dialog).getByLabelText('How long') as HTMLSelectElement).value).toBe('30');
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Plan and email the link' })).toBeTruthy();
  });

  it('makes the link, writes the meeting down and emails the link, in that order', async () => {
    const onChanged = vi.fn();
    const dialog = await openPlanner({ onChanged });
    fireEvent.change(within(dialog).getByLabelText('What it is about'), { target: { value: ' Website review ' } });
    fireEvent.change(within(dialog).getByLabelText('Day and time'), { target: { value: '2026-12-02T15:00' } });
    fireEvent.change(within(dialog).getByLabelText('How long'), { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText('A note for the invite (optional)'), { target: { value: 'Bring the login details.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan and email the link' }));
    const startsAt = new Date(2026, 11, 2, 15, 0, 0);
    await waitFor(() => expect(h.emailMeetingInvite).toHaveBeenCalledTimes(1));
    expect(h.createMeetingInvite).toHaveBeenCalledWith({ workspaceId: 'ws-1', startsAt: startsAt.toISOString(), label: 'Website review' });
    expect(h.createMeeting).toHaveBeenCalledWith({
      organizationId: 'org-1', workspaceId: 'ws-1', contactId: 'lead-1', title: 'Website review', startsAt, durationMinutes: 45, roomName: ROOM, joinUrl: LINK,
    });
    expect(h.emailMeetingInvite).toHaveBeenCalledWith('ws-1', 'm-new', { timeZone: expect.any(String), message: 'Bring the login details.' });
    expect(h.createMeetingInvite.mock.invocationCallOrder[0]).toBeLessThan(h.createMeeting.mock.invocationCallOrder[0]);
    expect(h.createMeeting.mock.invocationCallOrder[0]).toBeLessThan(h.emailMeetingInvite.mock.invocationCallOrder[0]);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Meeting planned. The link was emailed to elena@northwind.example.'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(h.listLeadMeetings).toHaveBeenCalledTimes(2);
  });

  it('plans without an email for a lead with no address, and says to copy the link', async () => {
    const dialog = await openPlanner({ email: null });
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(dialog.textContent).toContain('This lead has no email address');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan the meeting' }));
    await waitFor(() => expect(h.createMeeting).toHaveBeenCalledTimes(1));
    expect(h.emailMeetingInvite).not.toHaveBeenCalled();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Meeting planned. Copy its link to send it yourself.'));
  });

  it('plans without an email when the box is unticked', async () => {
    const dialog = await openPlanner();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan the meeting' }));
    await waitFor(() => expect(h.createMeeting).toHaveBeenCalledTimes(1));
    expect(h.emailMeetingInvite).not.toHaveBeenCalled();
  });

  it('keeps the meeting when the email does not go out, and says both', async () => {
    h.emailMeetingInvite.mockRejectedValue(new Error('The invite could not be emailed from here. Copy the link and send it yourself.'));
    const dialog = await openPlanner();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan and email the link' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The meeting is planned, but the invite was not emailed. The invite could not be emailed from here. Copy the link and send it yourself.'));
    expect(h.createMeeting).toHaveBeenCalledTimes(1);
    expect(h.listLeadMeetings).toHaveBeenCalledTimes(2);
  });

  it('saves nothing when the link cannot be made', async () => {
    h.createMeetingInvite.mockRejectedValue(new Error('call-guest is not configured. Set CALL_INVITE_SECRET'));
    setInternalsVisible(false);
    const dialog = await openPlanner();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan and email the link' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/CALL_INVITE_SECRET|call-guest/);
    expect(h.createMeeting).not.toHaveBeenCalled();
    expect(h.emailMeetingInvite).not.toHaveBeenCalled();
    // The window stays open, so nothing typed is lost.
    expect(screen.getByRole('dialog', { name: 'Plan a meeting' })).toBeTruthy();
  });

  it('will not plan a meeting for a time that has passed', async () => {
    const dialog = await openPlanner();
    fireEvent.change(within(dialog).getByLabelText('Day and time'), { target: { value: '2026-11-27T09:00' } });
    expect(within(dialog).getByRole('alert').textContent).toBe('This time has passed. Choose a later one.');
    expect((within(dialog).getByRole('button', { name: 'Plan and email the link' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('can be opened from elsewhere on the page', async () => {
    await show({ startOpen: true });
    expect(await screen.findByRole('dialog', { name: 'Plan a meeting' })).toBeTruthy();
  });
});
