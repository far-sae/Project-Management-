// The Delete button on an invoice. The owner asked for it. Any invoice can be
// deleted by the owner; for one that was issued the window says plainly what a
// real invoice is, offers a copy first, and asks for a tick.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoice, issued, payment, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  return { call, pdf, state: { client: { call, pdf, upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const org = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => org }));

import { DeleteInvoiceButton } from '@/components/signroom/billing/DeleteInvoiceButton';

const onDeleted = vi.fn();
const show = (inv = invoice()) => render(<DeleteInvoiceButton invoice={inv} onDeleted={onDeleted} />);
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  return screen.findByRole('alertdialog');
};
const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /^Delete / }) as HTMLButtonElement;

beforeEach(() => {
  stubBrowser();
  org.isAdmin = true;
  for (const fn of [sr.call, sr.pdf, toast.success, toast.error, onDeleted]) fn.mockReset();
  sr.call.mockResolvedValue({ deleted: true, number: 'INV-2026-00001' });
  sr.pdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
});
afterEach(cleanup);

describe('who sees it', () => {
  it('is there for an owner or admin', () => {
    show();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('is not there for anybody else', () => {
    org.isAdmin = false;
    show();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('a draft', () => {
  it('is deleted after one plain question', async () => {
    const draft = invoice();
    show(draft);
    const dialog = await open();
    expect(within(dialog).getByText(`Delete ${draft.number}?`)).toBeTruthy();
    expect(within(dialog).getByText(/This draft was never issued/)).toBeTruthy();
    // No tick is asked for something that was never sent to anybody.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(sr.call).not.toHaveBeenCalled();
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith(`billing/${draft.id}/delete`, {}));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(`${draft.number} was deleted.`);
  });
});

describe('an invoice that was issued', () => {
  const paid = () => issued({ status: 'Paid', payments: [payment()] });

  it('says what goes with it, and what a real invoice is', async () => {
    show(paid());
    const dialog = await open();
    expect(within(dialog).getByText(/its payments and receipts/)).toBeTruthy();
    expect(within(dialog).getByText(/A real invoice that was sent to a client is a business record/)).toBeTruthy();
    expect(within(dialog).getByText(/cannot be brought back/)).toBeTruthy();
  });

  it('cannot be deleted until the box is ticked', async () => {
    const inv = paid();
    show(inv);
    const dialog = await open();
    expect(confirmButton(dialog).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirmButton(dialog).disabled).toBe(false);
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith(`billing/${inv.id}/delete`, {}));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('offers a copy of the PDF first', async () => {
    const inv = paid();
    show(inv);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download a copy first' }));
    await waitFor(() => expect(sr.pdf).toHaveBeenCalledWith(`billing/${inv.id}/artifact`));
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('asks again each time it is opened', async () => {
    show(paid());
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    dialog = await open();
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(confirmButton(dialog).disabled).toBe(true);
  });
});

describe('when the server refuses', () => {
  it('says its sentence and keeps the invoice on screen', async () => {
    sr.call.mockRejectedValue(Object.assign(new Error('Only the owner can delete an invoice.'), { status: 403 }));
    show();
    fireEvent.click(confirmButton(await open()));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the owner can delete an invoice.'));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
