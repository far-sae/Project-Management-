// Deleting a workspace together with everything in it (the old "General").
// The database does the deleting in one step; here: that the person is shown
// what will go, is asked properly, and what the database file promises.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Workspace } from '@/types/workspace';

const h = vi.hoisted(() => ({
  deleteWorkspaceWithData: vi.fn(),
  refreshWorkspaces: vi.fn(async () => {}),
  select: vi.fn(),
  selectedId: 'w-general',
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({
  useSelectedWorkspace: () => ({ refreshWorkspaces: h.refreshWorkspaces, select: h.select, selectedId: h.selectedId }),
  ALL_WORKSPACES_ID: '__ALL_WORKSPACES__',
}));
vi.mock('@/services/supabase/workspaces', () => ({ deleteWorkspaceWithData: h.deleteWorkspaceWithData }));

import { DeleteWorkspaceDialog, deletedSummary, documentSummary } from '@/components/workspace/DeleteWorkspaceDialog';

const workspace = (workspaceId: string, name: string, isDefault = false): Workspace =>
  ({ workspaceId, name, isDefault, organizationId: 'org-1', createdAt: new Date(), updatedAt: new Date() }) as Workspace;
const general = workspace('w-general', 'General', true);
const studio = workspace('w-main', 'Northwind Studio');

const COUNTS = { projects: 3, tasks: 41, crm_contacts: 120, crm_companies: 8, crm_deals: 4, crm_tasks: 9, crm_activities: 300, social_content: 2, crm_visibility: 1 };

const onOpenChange = vi.fn();
const onDeleted = vi.fn();
const show = (workspaces: Workspace[] = [general, studio]) =>
  render(<DeleteWorkspaceDialog workspace={general} workspaces={workspaces} onOpenChange={onOpenChange} onDeleted={onDeleted} />);
const button = () => screen.getByRole('button', { name: /^Delete General/ }) as HTMLButtonElement;
const box = () => screen.getAllByRole('checkbox')[0] as HTMLInputElement;

beforeEach(() => {
  for (const fn of [h.deleteWorkspaceWithData, h.refreshWorkspaces, h.select, h.toast.success, h.toast.error, onOpenChange, onDeleted]) fn.mockClear();
  h.selectedId = 'w-general';
  h.deleteWorkspaceWithData.mockImplementation(async (_id: string, confirm: boolean) => ({ deleted: confirm, name: 'General', counts: COUNTS, documents: {} }));
});
afterEach(cleanup);

describe('what will go', () => {
  it('is counted first, and shown in plain words', async () => {
    show();
    await waitFor(() => expect(h.deleteWorkspaceWithData).toHaveBeenCalledWith('w-general', false));
    expect(await screen.findByText('3 projects')).toBeTruthy();
    expect(screen.getByText('41 tasks')).toBeTruthy();
    expect(screen.getByText('120 leads')).toBeTruthy();
    expect(screen.getByText('8 companies')).toBeTruthy();
    expect(screen.getByText('4 deals')).toBeTruthy();
    expect(screen.getByText('9 follow-ups')).toBeTruthy();
    expect(screen.getByText('2 social posts')).toBeTruthy();
    // The rest is added up, not listed by its table.
    expect(screen.getByText('301 other records (notes, history, settings)')).toBeTruthy();
    expect(screen.queryByText(/crm_|social_content/)).toBeNull();
  });

  it('is said to be nothing when the workspace is empty', async () => {
    h.deleteWorkspaceWithData.mockResolvedValue({ deleted: false, name: 'General', counts: {} });
    show();
    expect(await screen.findByText('General has nothing in it.')).toBeTruthy();
  });

  it('writes one for one, and many for many', () => {
    expect(deletedSummary({ projects: 1, crm_contacts: 1, crm_deals: 2 }).map((l) => l.text)).toEqual(['1 project', '1 lead', '2 deals']);
    expect(deletedSummary({ odd_table: 1 }).map((l) => l.text)).toEqual(['1 other record (notes, history, settings)']);
  });
});

describe('asking', () => {
  it('does nothing until the box is ticked', async () => {
    show();
    await screen.findByText('3 projects');
    expect(screen.getByRole('heading', { name: 'Delete General and everything in it' })).toBeTruthy();
    expect(screen.getByText(/cannot be brought back/)).toBeTruthy();
    expect(button().disabled).toBe(true);
    fireEvent.click(box());
    expect(button().disabled).toBe(false);
    expect(h.deleteWorkspaceWithData).toHaveBeenCalledTimes(1);
  });

  it('cannot be confirmed before the count has arrived', () => {
    h.deleteWorkspaceWithData.mockReturnValue(new Promise(() => {}));
    show();
    expect(box().disabled).toBe(true);
    expect(button().disabled).toBe(true);
  });

  it('offers nothing to press when it is the only workspace', () => {
    show([general]);
    expect(screen.getByText(/This is your only workspace/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete General/ })).toBeNull();
    expect(h.deleteWorkspaceWithData).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  const confirm = async () => {
    show();
    await screen.findByText('3 projects');
    fireEvent.click(box());
    fireEvent.click(button());
  };

  it('deletes, reads the list again, moves off the deleted workspace and says so', async () => {
    await confirm();
    await waitFor(() => expect(h.deleteWorkspaceWithData).toHaveBeenCalledWith('w-general', true, false));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(h.refreshWorkspaces).toHaveBeenCalled();
    // The person was looking at General: they are put on the workspace that is left.
    expect(h.select).toHaveBeenCalledWith('w-main');
    expect(h.toast.success).toHaveBeenCalledWith('General was deleted, with everything in it.');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves the person where they are when they were looking at another workspace', async () => {
    h.selectedId = 'w-main';
    await confirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(h.select).not.toHaveBeenCalled();
  });

  it('passes on the database\'s own sentence when it refuses, and deletes nothing', async () => {
    h.deleteWorkspaceWithData.mockImplementation(async (_id: string, sure: boolean) => {
      if (sure) throw new Error('This workspace has recorded calls. Delete those calls on the Calls page first (that removes the recordings too), then delete the workspace.');
      return { deleted: false, name: 'General', counts: COUNTS };
    });
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(expect.stringContaining('recorded calls')));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('says plainly when what is inside cannot be counted, and never a raw error', async () => {
    h.deleteWorkspaceWithData.mockRejectedValue(new Error('function public.delete_workspace_with_data(uuid, boolean) does not exist'));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/function|does not exist/);
    expect(box().disabled).toBe(true);
  });
});

describe('legal records', () => {
  const DOCS = { invoices: 2, agreements: 1, billing_plans: 1, agreement_templates: 3 };
  beforeEach(() => {
    h.deleteWorkspaceWithData.mockImplementation(async (_id: string, confirm: boolean) => ({ deleted: confirm, name: 'General', counts: COUNTS, documents: DOCS }));
  });

  it('are named apart, with how many there are of each', async () => {
    show();
    const list = await screen.findByRole('list', { name: 'Legal records in this workspace' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['2 invoices', '1 agreement', '1 billing plan', '3 agreement templates']);
    expect(screen.getByText(/the law may ask you to keep them for years/)).toBeTruthy();
    expect(documentSummary({ invoices: 1 }).map((l) => l.text)).toEqual(['1 invoice']);
    expect(documentSummary({})).toEqual([]);
  });

  it('need a tick of their own: the first tick alone deletes nothing', async () => {
    show();
    await screen.findByText('3 projects');
    const [first, second] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(first);
    expect(button().disabled).toBe(true);
    fireEvent.click(second);
    expect(button().disabled).toBe(false);
    fireEvent.click(first);
    expect(button().disabled).toBe(true);
    expect(h.deleteWorkspaceWithData).toHaveBeenCalledTimes(1);
  });

  it('are deleted with the workspace once both boxes are ticked', async () => {
    show();
    await screen.findByText('3 projects');
    for (const tick of screen.getAllByRole('checkbox')) fireEvent.click(tick);
    fireEvent.click(button());
    await waitFor(() => expect(h.deleteWorkspaceWithData).toHaveBeenCalledWith('w-general', true, true));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('are not asked about in a workspace that has none', async () => {
    h.deleteWorkspaceWithData.mockImplementation(async (_id: string, confirm: boolean) => ({ deleted: confirm, name: 'General', counts: COUNTS, documents: {} }));
    show();
    await screen.findByText('3 projects');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByText(/Legal records/)).toBeNull();
  });
});

describe('the database file', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/205_delete_workspace_with_data.sql'), 'utf8');

  it('says it is safe to run more than once, and is in the one set-up file', () => {
    expect(sql).toMatch(/Safe to run more than once\./);
    expect(readFileSync(resolve(process.cwd(), 'supabase/crm_setup.sql'), 'utf8')).toContain('205_delete_workspace_with_data.sql');
  });

  it('is for the owner only, signed in', () => {
    expect(sql).toContain('o.owner_id = v_uid');
    expect(sql).toMatch(/revoke all on function public\.delete_workspace_with_data\(uuid, boolean, boolean\) from public/);
    expect(sql).not.toMatch(/grant execute[^;]*to anon/);
  });

  it('only counts unless it is told to delete', () => {
    expect(sql).toMatch(/p_confirm boolean default false, p_documents boolean default false/);
    expect(sql.indexOf('if not coalesce(p_confirm, false) then')).toBeLessThan(sql.indexOf("'delete from public.%I where workspace_id = $1'"));
  });

  it('deletes legal records only when told to, never one being signed or on hold, and never leaves a recording behind', () => {
    expect(sql).toContain('legal records');
    expect(sql).toContain('if v_documents <> \'\' and not coalesce(p_documents, false) then');
    expect(sql).toContain("status in ('Awaiting signatures', 'Finalising')");
    expect(sql).toContain('legal_hold');
    // It says how many of each are in the way, so the person knows what to delete first.
    expect(sql).toMatch(/v_count::text/);
    expect(sql).toContain("'invoice'");
    expect(sql).toContain("'agreement'");
    expect(sql).toContain('recording_sid is not null');
    expect(sql).toContain("not like 'sr\\_%'");
  });

  it('leaves one workspace, and keeps no copy in the recycle bin', () => {
    expect(sql).toContain('This is your only workspace');
    expect(sql).toContain("set_config('crm.skip_trash', 'on', true)");
  });
});
