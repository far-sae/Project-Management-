// A fact in a details panel (the company's website, phone, ...) can be
// changed, or taken away, where it stands.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));

import { EditableFact, factProblem, type FactKind } from '@/components/crmHub/EditableFact';

const onSave = vi.fn(async (_next: string | null) => undefined);
const show = (value: string, kind: FactKind = 'text', label = 'Website') =>
  render(<dl><EditableFact label={label} value={value} kind={kind} onSave={onSave}>{value || '—'}</EditableFact></dl>);

beforeEach(() => { onSave.mockReset().mockResolvedValue(undefined); h.toast.error.mockReset(); });
afterEach(cleanup);

describe('a fact that can be changed in its place', () => {
  it('shows the fact and a pencil, and no box until the pencil is pressed', () => {
    show('example.com');
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    expect((screen.getByRole('textbox', { name: 'Website' }) as HTMLInputElement).value).toBe('example.com');
  });

  it('saves what was typed, trimmed', async () => {
    show('example.com', 'url');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Website' }), { target: { value: '  northwind.studio ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('northwind.studio'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('saves nothing when nothing was changed, and Cancel or Escape leaves it as it was', () => {
    show('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other.com' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('takes a fact away with Remove, or by saving an empty box', async () => {
    show('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove website' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
    cleanup();
    onSave.mockClear();
    show('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it('offers no Remove for a fact that is not there', () => {
    show('');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    expect(screen.queryByRole('button', { name: 'Remove website' })).toBeNull();
  });

  it('will not save something that is not an email, a number, a phone or a web address', () => {
    expect(factProblem('email', 'sam@northwind')).toBe('This does not look like an email address.');
    expect(factProblem('email', 'sam@northwind.studio')).toBeNull();
    expect(factProblem('number', 'a lot')).toBe('Type a number, for example 250000.');
    expect(factProblem('number', '250,000')).toBeNull();
    expect(factProblem('tel', 'call me')).toBe('This does not look like a phone number.');
    expect(factProblem('tel', '+44 20 7946 0958')).toBeNull();
    expect(factProblem('url', 'my site')).toBe('This does not look like a web address.');
    expect(factProblem('url', 'linkedin.com/company/northwind')).toBeNull();
    // An empty box is always fine: it removes the fact.
    expect(factProblem('email', '  ')).toBeNull();

    show('', 'email', 'Email');
    fireEvent.click(screen.getByRole('button', { name: 'Edit email' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'not an email' } });
    expect(screen.getByRole('alert').textContent).toBe('This does not look like an email address.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves a number without its commas', async () => {
    show('', 'number', 'Annual revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Edit annual revenue' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '250,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('250000'));
  });

  it('keeps the box open and says so in plain words when it could not be saved', async () => {
    onSave.mockRejectedValue(new Error('new row violates row-level security policy for table "crm_companies"'));
    show('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit website' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/row-level|crm_companies/);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
