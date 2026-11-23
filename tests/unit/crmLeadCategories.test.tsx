// Lead categories can be renamed and deleted after they are made. A category
// is only a word on leads, so both act on every lead that carries it.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { LeadCategoriesDialog } from '@/components/crmHub/LeadCategoriesDialog';
import { CATEGORY_MAX, categoryCounts, categoryProblem, categorySpellings } from '@/lib/crmCategories';

const leads = [
  { category: 'VIP' }, { category: ' VIP ' }, { category: 'Warm intro' }, { category: null }, { category: '' }, { category: 'VIP' },
];

describe('what a category is', () => {
  it('is counted by the leads that carry it, whatever spaces were typed round it', () => {
    expect(categoryCounts(leads, ['VIP', 'Warm intro', 'Old list'])).toEqual([
      { name: 'Old list', count: 0 }, { name: 'VIP', count: 3 }, { name: 'Warm intro', count: 1 },
    ]);
  });

  it('is found on leads in every way it was typed, so none is left behind', () => {
    expect(categorySpellings(leads, 'VIP').sort()).toEqual([' VIP ', 'VIP']);
    expect(categorySpellings(leads, 'Nobody')).toEqual(['Nobody']);
  });

  it('needs a name that is not too long', () => {
    expect(categoryProblem('  ')).toBe('Give the category a name.');
    expect(categoryProblem('x'.repeat(CATEGORY_MAX + 1))).toBe(`Keep the name to ${CATEGORY_MAX} characters.`);
    expect(categoryProblem('Key clients')).toBeNull();
  });
});

describe('the window for editing categories', () => {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const show = () => render(
    <LeadCategoriesDialog
      open
      onOpenChange={() => {}}
      categories={[{ name: 'VIP', count: 3 }, { name: 'Warm intro', count: 1 }]}
      onRename={onRename}
      onDelete={onDelete}
    />,
  );
  const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

  beforeEach(() => {
    onRename.mockReset().mockResolvedValue(undefined);
    onDelete.mockReset().mockResolvedValue(undefined);
    toast.error.mockReset();
  });
  afterEach(cleanup);

  it('lists each category with how many leads are in it', () => {
    show();
    expect(row('VIP').textContent).toContain('3 leads');
    expect(row('Warm intro').textContent).toContain('1 lead');
  });

  it('renames a category on every lead that has it', async () => {
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Rename VIP' }));
    const box = screen.getByLabelText('New name for VIP') as HTMLInputElement;
    expect(box.value).toBe('VIP');
    fireEvent.change(box, { target: { value: '  Key clients ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('VIP', 'Key clients'));
  });

  it('saves with the Enter key and gives up with Escape', async () => {
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Rename VIP' }));
    fireEvent.keyDown(screen.getByLabelText('New name for VIP'), { key: 'Escape' });
    expect(screen.queryByLabelText('New name for VIP')).toBeNull();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Rename VIP' }));
    fireEvent.change(screen.getByLabelText('New name for VIP'), { target: { value: 'Top' } });
    fireEvent.keyDown(screen.getByLabelText('New name for VIP'), { key: 'Enter' });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('VIP', 'Top'));
  });

  it('does not save an empty name, or the same name again', () => {
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Rename VIP' }));
    fireEvent.change(screen.getByLabelText('New name for VIP'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Give the category a name.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New name for VIP'), { target: { value: 'VIP' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('says so when the new name is another category: the two become one', () => {
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Rename VIP' }));
    fireEvent.change(screen.getByLabelText('New name for VIP'), { target: { value: 'warm intro' } });
    expect(screen.getByText('“Warm intro” exists already. The 3 leads move into it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The existing spelling is kept, so there is still one category and not two.
    expect(onRename).toHaveBeenCalledWith('VIP', 'Warm intro');
  });

  it('deletes a category only after it is confirmed, and says the leads are kept', async () => {
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete VIP' }));
    expect(row('VIP').textContent).toContain('The 3 leads are kept, with no category.');
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete VIP' }));
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('VIP'));
  });

  it('says it in our own words when the change is refused', async () => {
    onDelete.mockRejectedValue({ message: 'new row violates row-level security policy for table "crm_contacts"' });
    show();
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete VIP' }));
    fireEvent.click(within(row('VIP')).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0]![0])).not.toMatch(/row-level|crm_contacts/);
  });

  it('says there is nothing to edit when there are no categories', () => {
    render(<LeadCategoriesDialog open onOpenChange={() => {}} categories={[]} onRename={onRename} onDelete={onDelete} />);
    expect(screen.getByText(/No categories yet/)).toBeTruthy();
  });
});
