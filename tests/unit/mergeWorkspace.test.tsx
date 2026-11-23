// Putting one workspace into another (the old "General" into the workspace
// that is really used), and removing the first. The database does the moving
// in one step; here: that the person is asked properly, and what the database
// file promises.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Workspace } from '@/types/workspace';

const h = vi.hoisted(() => ({
  mergeWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn(async () => {}),
  select: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ refreshWorkspaces: h.refreshWorkspaces, select: h.select }) }));
vi.mock('@/services/supabase/workspaces', () => ({ mergeWorkspace: h.mergeWorkspace }));

import { MergeWorkspaceDialog } from '@/components/workspace/MergeWorkspaceDialog';

const workspace = (workspaceId: string, name: string, isDefault = false): Workspace =>
  ({ workspaceId, name, isDefault, organizationId: 'org-1', createdAt: new Date(), updatedAt: new Date() }) as Workspace;
const general = workspace('w-general', 'General', true);
const securovix = workspace('w-main', 'Northwind Studio');
const sales = workspace('w-sales', 'Sales');

const onOpenChange = vi.fn();
const onMerged = vi.fn();
const show = (workspaces: Workspace[] = [general, securovix, sales]) =>
  render(<MergeWorkspaceDialog workspace={general} workspaces={workspaces} onOpenChange={onOpenChange} onMerged={onMerged} />);
const choose = async (option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Move it into' }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};
const button = () => screen.getByRole('button', { name: /^Move everything/ }) as HTMLButtonElement;

beforeEach(() => {
  for (const fn of [h.mergeWorkspace, h.refreshWorkspaces, h.select, h.toast.success, h.toast.error, onOpenChange, onMerged]) fn.mockClear();
  h.mergeWorkspace.mockResolvedValue({ moved: 42 });
});
afterEach(cleanup);

describe('asking', () => {
  it('says what happens, and does nothing until a workspace is chosen and the box is ticked', async () => {
    show();
    expect(screen.getByRole('heading', { name: 'Move everything out of General' })).toBeTruthy();
    expect(button().disabled).toBe(true);
    await choose('Northwind Studio');
    expect(screen.getByText(/Nothing is deleted\. Every project, lead and deal of General is in Northwind Studio afterwards/)).toBeTruthy();
    expect(screen.getByText(/if any part cannot be moved, nothing is changed/)).toBeTruthy();
    expect(button().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /General is removed afterwards, and that this cannot be undone/ }));
    expect(button().disabled).toBe(false);
    expect(h.mergeWorkspace).not.toHaveBeenCalled();
  });

  it('asks for the box again when another workspace is chosen', async () => {
    show();
    await choose('Northwind Studio');
    fireEvent.click(screen.getByRole('checkbox'));
    await choose('Sales');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(button().disabled).toBe(true);
  });

  it('chooses the only other workspace by itself, and never offers the workspace being emptied', async () => {
    show([general, securovix]);
    expect(screen.getByRole('combobox', { name: 'Move it into' }).textContent).toContain('Northwind Studio');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Move it into' }), { key: 'ArrowDown' });
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Northwind Studio']);
  });

  it('says so when there is nowhere to move it', () => {
    show([general]);
    expect(screen.getByText(/There is no other workspace to move it into/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Move everything/ })).toBeNull();
  });
});

describe('doing it', () => {
  const confirm = async () => {
    show();
    await choose('Northwind Studio');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button());
  };

  it('moves everything, opens the workspace it went into, and says what was done', async () => {
    await confirm();
    await waitFor(() => expect(h.mergeWorkspace).toHaveBeenCalledWith('w-general', 'w-main'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Everything from General is now in Northwind Studio. General was removed.'));
    expect(h.refreshWorkspaces).toHaveBeenCalled();
    expect(h.select).toHaveBeenCalledWith('w-main');
    expect(onMerged).toHaveBeenCalledWith('w-main');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes on the database’s own reason when it refuses, and keeps the window open', async () => {
    h.mergeWorkspace.mockRejectedValue(new Error('This workspace has agreements, invoices or billing plans. They are legal records and keep their own numbers, so the workspace cannot be put into another one.'));
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0]![0])).toContain('legal records');
    expect(h.select).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('never shows a technical reason as it came', async () => {
    h.mergeWorkspace.mockRejectedValue({ message: 'insert or update on table "crm_deals" violates foreign key constraint' });
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0]![0])).not.toMatch(/crm_deals|foreign key/);
  });
});

describe('the database file', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/204_merge_workspace.sql'), 'utf8');

  it('lets only the owner and admins run it, on two workspaces of one organisation', () => {
    expect(sql).toContain('create or replace function public.merge_workspace(p_from uuid, p_into uuid)');
    expect(sql).toContain('if not public.is_org_admin_or_owner(v_org) then');
    expect(sql).toContain('if v_org is distinct from v_org_into then');
    expect(sql).toContain('revoke all on function public.merge_workspace(uuid, uuid) from public;');
  });

  it('refuses before it touches anything, in the order the set-up check relies on', () => {
    // The set-up check calls it with nothing: it must answer "two different workspaces" and change nothing.
    expect(sql.indexOf("'Choose two different workspaces.'")).toBeGreaterThan(-1);
    expect(sql.indexOf("'Choose two different workspaces.'")).toBeLessThan(sql.indexOf('update public.'));
  });

  it('never moves agreements or invoices', () => {
    expect(sql).toContain("array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates']");
    expect(sql).toMatch(/legal records/);
  });

  it('removes the workspace only when nothing still points at it', () => {
    const check = sql.indexOf('Nothing may be left behind');
    const remove = sql.indexOf('delete from public.workspaces where workspace_id = p_from');
    expect(check).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(check);
  });

  it('switches the deal rules off only around the stage change, and on again', () => {
    const off = sql.indexOf("alter table public.crm_deals disable trigger user");
    const on = sql.indexOf("alter table public.crm_deals enable trigger user");
    expect(off).toBeGreaterThan(-1);
    expect(on).toBeGreaterThan(off);
  });
});
