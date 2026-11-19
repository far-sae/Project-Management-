// The list of emails sent for an invoice or an agreement: when, to whom, what, and whether it went.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { shortDateTime } from '@/lib/signroom/billing';
import { emailDelivery, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});

// The first render loads every dialog and menu: give it room on a busy machine.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeliveryLog } from '@/components/signroom/DeliveryLog';

const open = (title?: string) => render(<DeliveryLog path="billing/i1/deliveries" title={title} />);
const item = (subject: string) => within(screen.getByText(subject).closest('li') as HTMLElement);

beforeEach(() => {
  stubBrowser();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
});
afterEach(cleanup);

describe('Delivery log', () => {
  it('lists each email with when it went, who to, what it was and where it was sent from', async () => {
    sr.call.mockResolvedValue({
      deliveries: [
        emailDelivery({ id: 'd2', subject: 'Receipt INV-0001-R01', purpose: 'receipt', route: 'securovix', created: '2026-11-10T10:00:00Z' }),
        emailDelivery(),
      ],
    });
    open();
    await screen.findByText('Receipt INV-0001-R01');
    const receipt = item('Receipt INV-0001-R01');
    expect(sr.call).toHaveBeenCalledWith('billing/i1/deliveries');
    expect(receipt.getByText('Sent').getAttribute('data-tone')).toBe('success');
    expect(receipt.getByText(/elena@northwind\.example/)).toBeTruthy();
    expect(receipt.getByText(/Receipt · from TaskCalendar/)).toBeTruthy();
    expect(receipt.getByText(shortDateTime('2026-11-10T10:00:00Z'))).toBeTruthy();

    const invoice = item('Invoice INV-0001 from Sam Studio');
    expect(invoice.getByText(/Invoice · from your mailbox/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Emails/ }).textContent).toContain('2');
    expect(document.body.textContent).not.toMatch(/securovix|signroom/i);
  });

  it('shows the error sentence for an email that failed, and one still on its way', async () => {
    sr.call.mockResolvedValue({
      deliveries: [
        emailDelivery({ id: 'd3', subject: 'Please sign: Services agreement', purpose: 'reminder', route: undefined, status: 'sending' }),
        emailDelivery({ id: 'd2', subject: 'Second try', status: 'failed', error: 'The mailbox refused the message.' }),
      ],
    });
    open('Emails sent');
    await screen.findByText('Second try');
    const failed = item('Second try');
    expect(failed.getByText('Failed').getAttribute('data-tone')).toBe('danger');
    expect(failed.getByText('The mailbox refused the message.')).toBeTruthy();
    const sending = item('Please sign: Services agreement');
    expect(sending.getByText('Reminder')).toBeTruthy();
    expect(sending.getByText('Sending').getAttribute('data-tone')).toBe('info');
    expect(sending.queryByText(/from your mailbox|from TaskCalendar/)).toBeNull();
    expect(screen.getByRole('heading', { name: /Emails sent/ })).toBeTruthy();
  });

  it('says so when nothing has been sent, and asks again on refresh', async () => {
    sr.call.mockResolvedValueOnce({ deliveries: [] });
    open();
    expect(await screen.findByText('No emails have been sent yet.')).toBeTruthy();
    sr.call.mockResolvedValueOnce({ deliveries: [emailDelivery()] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Invoice INV-0001 from Sam Studio')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledTimes(2);
  });

  it('says quietly that it is not set up yet when the server answers 503', async () => {
    sr.call.mockRejectedValue(Object.assign(new Error('Run the latest database update to see sent emails.'), { status: 503 }));
    open();
    const note = await screen.findByText('Run the latest database update to see sent emails.');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.className).not.toContain('destructive');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server sentence as an error for any other failure', async () => {
    sr.call.mockRejectedValue(Object.assign(new Error('You do not have access to this workspace.'), { status: 403 }));
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });

  it('calls nothing while no workspace is selected', async () => {
    sr.state.workspaceId = null;
    open();
    await waitFor(() => expect(screen.getByText('Pick a workspace in the sidebar to see the emails sent.')).toBeTruthy());
    expect(sr.call).not.toHaveBeenCalled();
  });
});
