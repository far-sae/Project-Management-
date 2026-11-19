// The public page a customer opens from an emailed link: confirm the email with a code, then the document.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowser } from './fixtures';

const guest = vi.hoisted(() => ({ call: vi.fn(), pdf: vi.fn(), upload: vi.fn() }));
vi.mock('@/services/signroom/client', () => ({ signroomClient: () => guest }));

import { InvoiceGuestPage } from '@/pages/signroom/InvoiceGuest';

type Reply = Record<string, unknown>;
function serve(over: Partial<Record<'intro' | 'code' | 'verify', () => Reply>> = {}) {
  guest.call.mockImplementation(async (path: string) => {
    const step = path.replace('billing-guest/', '') as 'intro' | 'code' | 'verify';
    if (over[step]) return over[step]!();
    if (step === 'intro') return { ok: true, sender: 'Sam Studio' };
    return { ok: true };
  });
  guest.pdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
}
const openLink = (hash = '#billing=tok123') => {
  window.history.replaceState(null, '', `/invoice${hash}`);
  return render(<InvoiceGuestPage />);
};
const step = (name: RegExp) => within(screen.getByRole('list', { name: 'Steps' })).getByText(name).closest('li') as HTMLElement;

beforeEach(() => {
  stubBrowser();
  guest.call.mockReset();
  guest.pdf.mockReset();
});
afterEach(cleanup);

describe('Customer invoice page', () => {
  it('reads the token once and takes it out of the address bar', async () => {
    serve();
    openLink();
    expect(await screen.findByText('From Sam Studio. Verify the invited email before viewing the invoice or receipt.')).toBeTruthy();
    expect(guest.call).toHaveBeenCalledWith('billing-guest/intro', { access: 'tok123' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invoice');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Private financial document');
  });

  it('starts on the code step, with the document step still to come', async () => {
    serve();
    openLink();
    await screen.findByText(/From Sam Studio/);
    expect(step(/Confirm your email/).getAttribute('aria-current')).toBe('step');
    expect(step(/Your document/).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy();
    expect(screen.queryByLabelText('Verification code')).toBeNull();
    expect(screen.queryByTitle('Financial document')).toBeNull();
  });

  it('emails a code, checks it, then shows the document with a download', async () => {
    serve();
    openLink();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    const code = await screen.findByLabelText('Verification code') as HTMLInputElement;
    expect(guest.call).toHaveBeenCalledWith('billing-guest/code', { access: 'tok123' });

    const view = screen.getByRole('button', { name: 'View document' }) as HTMLButtonElement;
    fireEvent.change(code, { target: { value: '12a34' } });
    expect(code.value).toBe('1234');
    expect(view.disabled).toBe(true);
    fireEvent.change(code, { target: { value: '123456' } });
    expect(view.disabled).toBe(false);
    fireEvent.click(view);

    expect(await screen.findByTitle('Financial document')).toBeTruthy();
    expect(guest.call).toHaveBeenCalledWith('billing-guest/verify', { access: 'tok123', code: '123456' });
    expect(guest.pdf).toHaveBeenCalledWith('billing-guest/artifact');
    expect(screen.getByRole('link', { name: /Download PDF/ }).getAttribute('download')).toBe('document.pdf');
    expect(step(/Your document/).getAttribute('aria-current')).toBe('step');
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
    expect(screen.queryByLabelText('Verification code')).toBeNull();
  });

  it('shows the amount due and the due date above the document when the server sends them', async () => {
    serve({
      verify: () => ({ ok: true, document: { kind: 'invoice', number: 'INV-0001', currency: 'GBP', totalMinor: 1800, balanceMinor: 1000, dueDate: '2026-12-01' } }),
    });
    openLink();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'View document' }));
    const due = within((await screen.findByText('Amount due')).parentElement as HTMLElement);
    expect(due.getByText('£10.00')).toBeTruthy();
    expect(within(screen.getByText('Due date').parentElement as HTMLElement).getByText('1 Dec 2026')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Invoice INV-0001');
    expect(screen.getByRole('link', { name: /Download PDF/ }).getAttribute('download')).toBe('INV-0001.pdf');
  });

  it('stays on the code step and shows the server sentence for a wrong code', async () => {
    serve({ verify: () => { throw new Error('Incorrect verification code.'); } });
    openLink();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'View document' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect verification code.');
    expect(screen.getByLabelText('Verification code')).toBeTruthy();
    expect(screen.queryByTitle('Financial document')).toBeNull();
    expect(guest.pdf).not.toHaveBeenCalled();
  });

  it('shows the server sentence when a code cannot be sent yet', async () => {
    serve({ code: () => { throw new Error('Wait one minute before requesting another code.'); } });
    openLink();
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Wait one minute before requesting another code.');
    expect(screen.queryByLabelText('Verification code')).toBeNull();
  });

  it('says so when the link has expired, and offers nothing else', async () => {
    serve({ intro: () => { throw new Error('This invoice or receipt link is expired or unavailable.'); } });
    openLink();
    expect((await screen.findByRole('alert')).textContent).toBe('This invoice or receipt link is expired or unavailable.');
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
    expect(screen.queryByText(/Verify the invited email/)).toBeNull();
  });

  it('says the link is incomplete when it carries no token, and calls nothing', async () => {
    serve();
    openLink('');
    expect(screen.getByRole('alert').textContent).toBe('This link is incomplete. Please open the link from your email again.');
    await waitFor(() => expect(guest.call).not.toHaveBeenCalled());
  });
});
