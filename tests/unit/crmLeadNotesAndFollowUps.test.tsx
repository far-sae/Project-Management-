// On the lead's page: the notes (write box on top, change, delete, history),
// and changing a follow-up where it is shown.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CrmActivity, CrmNote, CrmTask } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(), listNoteHistory: vi.fn(),
  updateTask: vi.fn(), deleteTask: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/crmHub/notes', () => ({
  createNote: h.createNote, updateNote: h.updateNote, deleteNote: h.deleteNote, listNoteHistory: h.listNoteHistory,
  NOTE_HISTORY_NOT_SET_UP_MESSAGE: 'The history of notes is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.',
}));
vi.mock('@/services/supabase/crmHub/tasks', () => ({ updateTask: h.updateTask, deleteTask: h.deleteTask }));

import { LeadNotes, loggedOnly, wasEdited } from '@/components/crmHub/LeadNotes';
import { FollowUpEditDialog, fromInput } from '@/components/crmHub/FollowUpEditDialog';

const at = (iso: string) => new Date(iso);
const note = (id: string, body: string, created: string, updated = created): CrmNote => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', userId: 'u1', body, contactId: 'lead-1', companyId: null, dealId: null, createdAt: at(created), updatedAt: at(updated),
});
const activity = (id: string, description: string, created: string, over: Partial<CrmActivity> = {}): CrmActivity => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', userId: 'u1', type: 'note', description, contactId: 'lead-1', companyId: null, dealId: null, taskId: null, metadata: {}, createdAt: at(created), ...over,
});

const onChanged = vi.fn(async () => undefined);

beforeEach(() => {
  for (const f of [h.createNote, h.updateNote, h.deleteNote, h.listNoteHistory, h.updateTask, h.deleteTask, h.toast.success, h.toast.error, onChanged]) f.mockReset();
  h.createNote.mockResolvedValue({});
  h.updateNote.mockResolvedValue({});
  h.deleteNote.mockResolvedValue(undefined);
  h.updateTask.mockResolvedValue({});
  h.deleteTask.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('the notes of a lead', () => {
  const NOTES = [
    note('n2', 'Application sent.', '2026-11-23T15:45:00Z'),
    note('n1', 'Asked to apply on the website.', '2026-11-23T14:41:00Z', '2026-11-23T16:00:00Z'),
  ];
  // Saving a note also writes a line on the timeline: that line is the same note. The third was only logged.
  const TIMELINE = [
    activity('a2', 'Application sent.', '2026-11-23T15:45:02Z'),
    activity('a1', 'Asked to apply', '2026-11-23T14:41:01Z'),
    activity('a0', 'Logged from a phone call.', '2026-11-20T10:00:00Z'),
    activity('c1', 'Spoke to them.', '2026-11-23T15:46:00Z', { type: 'call' }),
  ];
  const show = (notes = NOTES, activities = TIMELINE) =>
    render(<LeadNotes organizationId="org-1" workspaceId="ws-1" contactId="lead-1" userId="u1" notes={notes} activities={activities} onChanged={onChanged} />);

  it('has the box to write a note above the notes', () => {
    show();
    const box = screen.getByRole('textbox', { name: 'Add note' });
    const list = screen.getByRole('list', { name: 'Notes' });
    // 4 = the box comes before the list in the page.
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows every note once, newest first, with the ones that were only logged on the timeline', () => {
    show();
    const items = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.includes('Application sent.') ? 'n2' : li.textContent?.includes('Asked to apply on the website.') ? 'n1' : 'logged')).toEqual(['n2', 'n1', 'logged']);
    expect(items[2].textContent).toContain('Logged from a phone call.');
    expect(items[2].textContent).toContain('Logged on the timeline');
    // A logged line cannot be changed here.
    expect(within(items[2]).queryByRole('button')).toBeNull();
  });

  it('knows a timeline line that only mirrors a written note, and a note that was changed', () => {
    expect(loggedOnly(TIMELINE, NOTES).map((a) => a.id)).toEqual(['a0']);
    expect(loggedOnly([activity('x', 'Machine line', '2026-11-01T10:00:00Z', { metadata: { automation: 'true' } })], [])).toEqual([]);
    expect(wasEdited(NOTES[0])).toBe(false);
    expect(wasEdited(NOTES[1])).toBe(true);
  });

  it('saves a new note for this lead and empties the box', async () => {
    show();
    const box = screen.getByRole('textbox', { name: 'Add note' }) as HTMLTextAreaElement;
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '  Call back on Friday.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(h.createNote).toHaveBeenCalledWith({ organizationId: 'org-1', workspaceId: 'ws-1', body: 'Call back on Friday.', contactId: 'lead-1' }, 'u1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(box.value).toBe('');
  });

  it('changes a note in its place', async () => {
    show();
    const first = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem')[0];
    fireEvent.click(within(first).getByRole('button', { name: 'Change this note' }));
    const edit = screen.getByRole('textbox', { name: 'Change the note' }) as HTMLTextAreaElement;
    expect(edit.value).toBe('Application sent.');
    fireEvent.change(edit, { target: { value: 'Application sent on Monday.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateNote).toHaveBeenCalledWith('n2', 'Application sent on Monday.'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Note changed'));
  });

  it('does not save a note that was opened and left as it was', async () => {
    show();
    fireEvent.click(screen.getAllByRole('button', { name: 'Change this note' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Change the note' })).toBeNull());
    expect(h.updateNote).not.toHaveBeenCalled();
  });

  it('deletes a note only after asking', async () => {
    show();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete this note' })[1]);
    expect(h.deleteNote).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('earlier versions');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.deleteNote).toHaveBeenCalledWith('n1'));
  });

  it('offers History on a note that was changed, and shows what it said before', async () => {
    h.listNoteHistory.mockResolvedValue([{ id: 'v1', noteId: 'n1', body: 'Asked to apply.', writtenAt: at('2026-11-23T14:41:00Z'), changedAt: at('2026-11-23T16:00:00Z'), changedBy: 'u1' }]);
    show();
    const items = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
    expect(within(items[0]).queryByRole('button', { name: 'History of this note' })).toBeNull();
    fireEvent.click(within(items[1]).getByRole('button', { name: 'History of this note' }));
    const dialog = await screen.findByRole('dialog', { name: 'History of this note' });
    await waitFor(() => expect(within(dialog).getByText('Asked to apply.')).toBeTruthy());
    expect(within(dialog).getByText('Asked to apply on the website.')).toBeTruthy();
    expect(h.listNoteHistory).toHaveBeenCalledWith('n1');
  });

  it('says so plainly when no earlier version was kept', async () => {
    h.listNoteHistory.mockResolvedValue([]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'History of this note' }));
    expect(await screen.findByText(/No earlier version was kept/)).toBeTruthy();
  });

  it('never shows a raw error', async () => {
    h.createNote.mockRejectedValue(new Error('new row violates row-level security policy for table "crm_notes"'));
    show();
    fireEvent.change(screen.getByRole('textbox', { name: 'Add note' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/row-level|crm_notes/);
  });
});

describe('changing a follow-up on the lead page', () => {
  const task = (over: Partial<CrmTask> = {}): CrmTask => ({
    id: 't1', organizationId: 'org-1', workspaceId: 'ws-1', ownerId: 'u1', assignedTo: 'u1', contactId: 'lead-1', companyId: null, dealId: null, projectId: null, sharedTaskId: null,
    title: 'Call back about investment', description: null, dueDate: at('2026-11-25T10:00:00'), priority: 'medium', status: 'pending', completedAt: null,
    createdAt: at('2026-11-23T10:00:00Z'), updatedAt: at('2026-11-23T10:00:00Z'), kind: 'todo', repeatEvery: null, ...over,
  });
  const onOpenChange = vi.fn();
  const open = (t: CrmTask | null = task()) => render(<FollowUpEditDialog task={t} onOpenChange={onOpenChange} onChanged={onChanged} />);
  beforeEach(() => onOpenChange.mockReset());

  it('opens with what the follow-up says now', () => {
    open();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Call back about investment');
    expect((screen.getByLabelText('Due') as HTMLInputElement).value).toBe('2026-11-25T10:00');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('pending');
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('');
  });

  it('saves what was changed, and sends the kind and the repeat only when they changed', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call back on Friday' } });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-11-27T15:30' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'call' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateTask).toHaveBeenCalledTimes(1));
    expect(h.updateTask.mock.calls[0]).toEqual(['t1', {
      title: 'Call back on Friday', description: null, dueDate: fromInput('2026-11-27T15:30'), priority: 'high', status: 'pending', kind: 'call', repeatEvery: undefined,
    }]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onChanged).toHaveBeenCalled();
  });

  it('can mark it completed, and says when a repeating one made its next one', async () => {
    h.updateTask.mockResolvedValue({ nextFollowUp: task({ id: 't2' }) });
    open(task({ repeatEvery: 'weekly' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved. The next one was made, because it repeats.'));
    expect(h.updateTask.mock.calls[0][1]).toMatchObject({ status: 'completed', kind: undefined, repeatEvery: undefined });
  });

  it('cannot be saved without a title, and can lose its due date', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call' } });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateTask.mock.calls[0][1]).toMatchObject({ dueDate: null }));
  });

  it('deletes it only after a second press', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(h.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(h.deleteTask).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Follow-up deleted'));
  });

  it('shows nothing while no follow-up is chosen', () => {
    open(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
