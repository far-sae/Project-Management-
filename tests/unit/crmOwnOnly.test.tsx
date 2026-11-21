// "Each person sees only their own leads and deals": the switch, and the database rules behind it.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  row: null as null | { own_only: boolean },
  readError: null as null | { code?: string; message?: string },
  writeError: null as null | { code?: string; message?: string },
  upserts: [] as Array<{ row: Record<string, unknown>; options: unknown }>,
  toast: { success: vi.fn(), error: vi.fn() },
  org: { isAdmin: true, organization: { organizationId: 'o' } },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (h.readError ? { data: null, error: h.readError } : { data: h.row, error: null }) }) }),
      upsert: async (row: Record<string, unknown>, options: unknown) => {
        h.upserts.push({ row, options });
        return { error: h.writeError };
      },
    }),
  },
}));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const value = { selected: { workspaceId: 'w', name: 'Studio' } };
  return { useSelectedWorkspace: () => value };
});

import { OWN_ONLY_NOT_SET_UP_MESSAGE } from '@/services/supabase/crmHub/visibility';
import { OwnOnlySetting } from '@/components/crmHub/OwnOnlySetting';

beforeEach(() => {
  h.row = null;
  h.readError = null;
  h.writeError = null;
  h.upserts.length = 0;
  h.toast.success.mockClear();
  h.org.isAdmin = true;
});
afterEach(cleanup);

const toggle = () => screen.getByRole('switch', { name: 'Each person sees only their own leads and deals' }) as HTMLButtonElement;

describe('the switch', () => {
  it('is off until somebody switches it on, and saves the change for this workspace', async () => {
    render(<OwnOnlySetting />);
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Each person now sees only their own leads and deals'));
    expect(h.upserts[0].row).toMatchObject({ workspace_id: 'w', organization_id: 'o', own_only: true });
    expect(h.upserts[0].options).toEqual({ onConflict: 'workspace_id' });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('shows what is saved, and can be switched off again', async () => {
    h.row = { own_only: true };
    render(<OwnOnlySetting />);
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Everybody in the workspace sees every lead and deal again'));
    expect(h.upserts[0].row).toMatchObject({ own_only: false });
  });

  it('cannot be changed by a member', async () => {
    h.org.isAdmin = false;
    render(<OwnOnlySetting />);
    expect(await screen.findByText('Only the owner and admins can change this.')).toBeTruthy();
    expect(toggle().disabled).toBe(true);
  });

  it('says which file to run while it is not set up, and stays off', async () => {
    h.readError = { code: 'PGRST205', message: "Could not find the table 'public.crm_visibility'" };
    render(<OwnOnlySetting />);
    expect((await screen.findByRole('alert')).textContent).toBe(OWN_ONLY_NOT_SET_UP_MESSAGE);
    expect(OWN_ONLY_NOT_SET_UP_MESSAGE).toContain('198_crm_own_records_only.sql');
    expect(toggle().disabled).toBe(true);
  });

  it('stays as it was and says why when the change is refused', async () => {
    h.writeError = { code: '42501', message: 'new row violates row-level security policy' };
    render(<OwnOnlySetting />);
    await waitFor(() => expect(toggle().disabled).toBe(false));
    fireEvent.click(toggle());
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toBe('You do not have permission to do this.');
    expect(alert).not.toContain('row-level security');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });
});

describe('migration 198', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/198_crm_own_records_only.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain('create table if not exists public.crm_visibility');
    expect((flat.match(/drop policy if exists/g) ?? []).length).toBe((flat.match(/create policy/g) ?? []).length);
    expect(flat).not.toMatch(/drop table|drop column|alter policy/i);
  });

  it('only ever hides rows: every rule on the CRM tables is restrictive and for reading', () => {
    for (const table of ['crm_contacts', 'crm_deals', 'crm_tasks', 'crm_activities']) {
      expect(flat, table).toContain(`on public.${table} as restrictive for select to authenticated using (`);
    }
    // It does not touch the rules that were there, and adds no rule that could show more.
    expect(flat).not.toMatch(/on public\.crm_(contacts|deals|tasks|activities) for /);
    expect((flat.match(/as restrictive/g) ?? []).length).toBe(4);
  });

  it('hides nothing while the switch is off, and nothing from the owner and admins', () => {
    expect(flat).toContain('select not coalesce((select v.own_only from public.crm_visibility v where v.workspace_id = p_workspace), false) or public.is_org_admin_or_owner(p_org);');
    expect(flat).toContain('own_only boolean not null default false');
    for (const table of ['crm_contacts', 'crm_deals', 'crm_tasks', 'crm_activities']) {
      const rule = flat.slice(flat.indexOf(`on public.${table} as restrictive`));
      expect(rule.slice(0, 200), table).toContain('public.crm_sees_all(organization_id, workspace_id)');
    }
  });

  it('shows a member what is theirs', () => {
    expect(flat).toContain('using (public.crm_sees_all(organization_id, workspace_id) or owner_id = auth.uid());');
    expect(flat).toContain('or assigned_to = auth.uid() or owner_id = auth.uid());');
    expect(flat).toContain('or user_id = auth.uid() or exists (select 1 from public.crm_contacts c where c.id = crm_activities.contact_id and c.owner_id = auth.uid())');
  });

  it('lets everybody read the switch and only the owner and admins set it', () => {
    expect(flat).toContain('for select to authenticated using (public.is_org_member(organization_id))');
    expect(flat).toContain('for insert to authenticated with check (public.is_org_admin_or_owner(organization_id))');
    expect(flat).toContain('for update to authenticated using (public.is_org_admin_or_owner(organization_id)) with check (public.is_org_admin_or_owner(organization_id))');
    expect(flat).not.toContain('grant delete');
  });

  it('uses columns the tables really have', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase/migrations/144_crm_hub_schema.sql'), 'utf8');
    const table = (name: string) => schema.slice(schema.indexOf(`create table if not exists public.${name} (`)).split(');')[0];
    expect(table('crm_contacts')).toMatch(/\n\s+owner_id uuid/);
    expect(table('crm_deals')).toMatch(/\n\s+owner_id uuid/);
    expect(table('crm_tasks')).toMatch(/\n\s+assigned_to uuid/);
    expect(table('crm_activities')).toMatch(/\n\s+user_id uuid/);
    expect(table('crm_activities')).toMatch(/\n\s+deal_id uuid/);
  });
});
