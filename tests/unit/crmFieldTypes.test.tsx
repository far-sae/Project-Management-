// Custom fields with a type: the checks, the boxes the lead form shows, and the settings.
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { defFor, defProblem, readOptions, rowsProblem, valueProblem, type FieldDef } from '@/lib/crmFieldTypes';
import type { CustomFieldRow } from '@/lib/customFields';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  readError: null as null | { code?: string; message?: string },
  writeError: null as null | { code?: string; message?: string },
  inserted: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => (h.readError ? { data: null, error: h.readError } : { data: h.rows, error: null }) }) }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (h.writeError) return { data: null, error: h.writeError };
            h.inserted.push(row);
            return { data: { id: `def-${h.inserted.length}`, ...row }, error: null };
          },
        }),
      }),
      delete: () => ({ eq: async (_c: string, id: string) => { h.deleted.push(id); return { error: null }; } }),
    }),
  },
}));
vi.mock('@/context/OrganizationContext', () => {
  const value = { organization: { organizationId: 'o' } };
  return { useOrganization: () => value };
});
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const value = { selected: { workspaceId: 'w', name: 'Studio' } };
  return { useSelectedWorkspace: () => value };
});

import { FIELD_TYPES_NOT_SET_UP_MESSAGE, listFieldDefs } from '@/services/supabase/crmHub/fieldDefs';
import { CustomFieldsEditor } from '@/components/crmHub/CustomFieldsEditor';
import { FieldDefsSettings } from '@/components/crmHub/FieldDefsSettings';

const DEFS: FieldDef[] = [
  { id: '1', name: 'Budget', kind: 'number', options: [] },
  { id: '2', name: 'Renewal date', kind: 'date', options: [] },
  { id: '3', name: 'Plan', kind: 'choice', options: ['Basic', 'Pro', 'Enterprise'] },
];
const row = (name: string, value: string, id = name): CustomFieldRow => ({ id, name, value });

beforeEach(() => {
  h.rows = [];
  h.readError = null;
  h.writeError = null;
  h.inserted.length = 0;
  h.deleted.length = 0;
  h.toast.success.mockClear();
});
afterEach(cleanup);

describe('a typed field', () => {
  it('is found by its name, whatever the capitals or underscores', () => {
    expect(defFor(DEFS, ' budget ')?.id).toBe('1');
    expect(defFor(DEFS, 'RENEWAL_DATE')?.id).toBe('2');
    expect(defFor(DEFS, 'Industry')).toBeNull();
    expect(defFor(DEFS, '')).toBeNull();
  });

  it('accepts its own kind of value, and an empty one', () => {
    expect(valueProblem(DEFS[0], '12,500.50')).toBeNull();
    expect(valueProblem(DEFS[0], '-3')).toBeNull();
    expect(valueProblem(DEFS[0], '')).toBeNull();
    expect(valueProblem(DEFS[1], '2026-12-01')).toBeNull();
    expect(valueProblem(DEFS[2], 'pro')).toBeNull();
  });

  it('says in plain words what is wrong', () => {
    expect(valueProblem(DEFS[0], 'about ten')).toBe('Budget must be a number.');
    expect(valueProblem(DEFS[1], '1 December')).toBe('Renewal date must be a date.');
    expect(valueProblem(DEFS[1], '2026-13-45')).toBe('Renewal date must be a date.');
    expect(valueProblem(DEFS[2], 'Gold')).toBe('Plan must be one of: Basic, Pro, Enterprise.');
  });

  it('checks every row of a lead and leaves untyped fields alone', () => {
    expect(rowsProblem(DEFS, [row('Industry', 'anything at all'), row('Budget', '4000')])).toBeNull();
    expect(rowsProblem(DEFS, [row('Industry', 'x'), row('budget', 'lots')])).toBe('Budget must be a number.');
    expect(rowsProblem([], [row('Budget', 'lots')])).toBeNull();
  });

  it('reads a list of choices as typed', () => {
    expect(readOptions(' Basic, Pro ,, pro\nEnterprise ')).toEqual(['Basic', 'Pro', 'Enterprise']);
  });

  it('cannot be added without a name, twice, or as a list with one choice', () => {
    expect(defProblem(DEFS, ' ', 'text', [])).toBe('Give the field a name.');
    expect(defProblem(DEFS, 'budget', 'text', [])).toBe('There is a field called Budget already.');
    expect(defProblem(DEFS, 'Size', 'choice', ['Small'])).toBe('Give at least two choices, with a comma between them.');
    expect(defProblem(DEFS, 'Size', 'choice', ['Small', 'Large'])).toBeNull();
  });
});

describe('reading the typed fields', () => {
  it('gives none, not an error, while the table is not there', async () => {
    h.readError = { code: 'PGRST205', message: "Could not find the table 'public.crm_field_defs'" };
    expect(await listFieldDefs('w')).toEqual([]);
  });

  it('treats a kind it does not know as text', async () => {
    h.rows = [{ id: '1', name: 'Budget', kind: 'money', options: 'x' }];
    expect(await listFieldDefs('w')).toEqual([{ id: '1', name: 'Budget', kind: 'text', options: [] }]);
  });
});

describe('the lead form', () => {
  const Form: React.FC<{ start: CustomFieldRow[] }> = ({ start }) => {
    const [rows, setRows] = useState(start);
    return <CustomFieldsEditor rows={rows} onChange={setRows} defs={DEFS} suggestions={['industry', 'budget']} />;
  };

  it('shows a number box, a date box and a list for typed fields, and a text box for the rest', () => {
    render(<Form start={[row('Budget', '4000'), row('Renewal date', '2026-12-01'), row('Plan', 'Pro'), row('Industry', 'Dental')]} />);
    expect(screen.getByLabelText('Custom field 1 value').getAttribute('inputmode')).toBe('decimal');
    expect(screen.getByLabelText('Custom field 2 value').getAttribute('type')).toBe('date');
    const plan = screen.getByLabelText('Custom field 3 value') as HTMLSelectElement;
    expect(plan.tagName).toBe('SELECT');
    expect(within(plan).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Basic', 'Pro', 'Enterprise']);
    expect(plan.value).toBe('Pro');
    expect(screen.getByLabelText('Custom field 4 value').getAttribute('type')).toBe('text');
  });

  it('keeps what is written when it is no longer one of the choices', () => {
    render(<Form start={[row('Plan', 'Gold')]} />);
    const plan = screen.getByLabelText('Custom field 1 value') as HTMLSelectElement;
    expect(plan.value).toBe('Gold');
    fireEvent.change(plan, { target: { value: 'Enterprise' } });
    expect((screen.getByLabelText('Custom field 1 value') as HTMLSelectElement).value).toBe('Enterprise');
  });

  it('offers the workspace’s typed fields first, each once', () => {
    render(<Form start={[row('Budget', '')]} />);
    const offered = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((l) => l?.startsWith('Add field '));
    // Budget is on the form already; "budget" from other leads is the same field.
    expect(offered).toEqual(['Add field Renewal date', 'Add field Plan', 'Add field Industry']);
  });

  it('turns a text box into a list the moment the name becomes a typed field', () => {
    render(<Form start={[row('', '')]} />);
    expect(screen.getByLabelText('Custom field 1 value').tagName).toBe('INPUT');
    fireEvent.change(screen.getByLabelText('Custom field 1 name'), { target: { value: 'plan' } });
    expect(screen.getByLabelText('Custom field 1 value').tagName).toBe('SELECT');
  });
});

describe('Custom fields in CRM settings', () => {
  it('adds a field that is one of a list', async () => {
    render(<FieldDefsSettings />);
    expect(await screen.findByText('No typed fields yet. Every custom field is plain text.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Plan' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'What it holds' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'One of a list' }), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('The choices'), { target: { value: 'Basic, Pro, Enterprise' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Field “Plan” added'));
    expect(h.inserted[0]).toEqual({ organization_id: 'o', workspace_id: 'w', name: 'Plan', kind: 'choice', options: ['Basic', 'Pro', 'Enterprise'] });
    expect(screen.getByText('Basic, Pro, Enterprise')).toBeTruthy();
  });

  it('does not add a field that is already there, and says so', async () => {
    h.rows = [{ id: '1', name: 'Budget', kind: 'number', options: [] }];
    render(<FieldDefsSettings />);
    await screen.findByText('Budget');
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect((await screen.findByRole('alert')).textContent).toBe('There is a field called Budget already.');
    expect(h.inserted).toHaveLength(0);
  });

  it('removes a field and says that what is written stays', async () => {
    h.rows = [{ id: '1', name: 'Budget', kind: 'number', options: [] }];
    render(<FieldDefsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the field Budget' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('“Budget” is plain text again. What is written on leads stays.'));
    expect(h.deleted).toEqual(['1']);
    expect(screen.queryByText('Budget')).toBeNull();
  });

  it('says which file to run when the table is not there yet', async () => {
    h.readError = { code: 'PGRST205', message: 'no table' };
    h.writeError = { code: 'PGRST205', message: 'no table' };
    render(<FieldDefsSettings />);
    await screen.findByText('No typed fields yet. Every custom field is plain text.');
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect((await screen.findByRole('alert')).textContent).toBe(FIELD_TYPES_NOT_SET_UP_MESSAGE);
    expect(FIELD_TYPES_NOT_SET_UP_MESSAGE).toContain('200_crm_custom_field_types.sql');
  });
});

describe('migration 200', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/200_crm_custom_field_types.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('adds one table with the CRM’s own access rule, and can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain('create table if not exists public.crm_field_defs');
    expect(flat).toContain("check (kind in ('text', 'number', 'date', 'choice'))");
    expect(flat).toContain('create unique index if not exists crm_field_defs_name on public.crm_field_defs (workspace_id, lower(btrim(name)))');
    expect(flat).toContain('for select to authenticated using (public.can_access_crm_scope(organization_id, workspace_id))');
    expect(flat).toContain('and not public.is_org_viewer(organization_id)');
    expect((flat.match(/drop policy if exists/g) ?? []).length).toBe((flat.match(/create policy/g) ?? []).length);
    // The values on the leads are not touched.
    expect(flat).not.toContain('crm_contacts');
  });
});
