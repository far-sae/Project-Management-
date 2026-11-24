// The Delete button on an agreement. The owner asked for it, as for invoices.
// A draft goes after one question; a sent or signed agreement asks for a tick;
// one that is being signed, or is under a legal hold, cannot be deleted.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));

import { DeleteAgreementButton, deleteBlocked } from '@/components/signroom/agreements/DeleteAgreement';

type Target = React.ComponentProps<typeof DeleteAgreementButton>['agreement'];
const agreement = (over: Partial<Target> = {}): Target => ({ id: 'a1', title: 'Services agreement', status: 'Completed', legalHold: false, ...over });

const onDeleted = vi.fn();
const show = (a: Target = agreement()) => render(<DeleteAgreementButton agreement={a} onDeleted={onDeleted} />);
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  return screen.findByRole('alertdialog');
};
const confirm = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Delete agreement' }) as HTMLButtonElement;

beforeEach(() => {
  for (const fn of [sr.call, toast.success, toast.error, onDeleted]) fn.mockReset();
  sr.call.mockResolvedValue({ deleted: true, title: 'Services agreement' });
});
afterEach(cleanup);

describe('a draft', () => {
  it('is deleted after one plain question', async () => {
    show(agreement({ status: 'Draft' }));
    const dialog = await open();
    expect(within(dialog).getByText(/This draft was never sent/)).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(confirm(dialog));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('agreements/a1/delete-now', {}));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Services agreement was deleted.');
  });
});

describe('a signed agreement', () => {
  it('says what goes with it and what a signed agreement is', async () => {
    show();
    const dialog = await open();
    expect(within(dialog).getByText(/with its documents, its evidence and its history/)).toBeTruthy();
    expect(within(dialog).getByText(/the proof that both sides agreed/)).toBeTruthy();
  });

  it('cannot be deleted until the box is ticked', async () => {
    show();
    const dialog = await open();
    expect(confirm(dialog).disabled).toBe(true);
    expect(sr.call).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(confirm(dialog));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('agreements/a1/delete-now', {}));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('asks again each time it is opened', async () => {
    show();
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    dialog = await open();
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
});

describe('what cannot be deleted', () => {
  it('is an agreement people are signing right now', async () => {
    show(agreement({ status: 'Awaiting signatures' }));
    const dialog = await open();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/People are signing this agreement right now/);
    expect(within(dialog).queryByRole('button', { name: 'Delete agreement' })).toBeNull();
  });

  it('is an agreement under a legal hold', async () => {
    show(agreement({ legalHold: true }));
    const dialog = await open();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/legal hold/);
    expect(within(dialog).queryByRole('button', { name: 'Delete agreement' })).toBeNull();
    expect(deleteBlocked(agreement())).toBeNull();
  });
});

describe('when the server refuses', () => {
  it('says its sentence and keeps the agreement on screen', async () => {
    sr.call.mockRejectedValue(Object.assign(new Error('Only the workspace owner can do that.'), { status: 403 }));
    show(agreement({ status: 'Draft' }));
    fireEvent.click(confirm(await open()));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the workspace owner can do that.'));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
