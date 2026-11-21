// The recycle bin and the change log: what the screens say, and what the database file does.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { daysLeft, describeChange, fieldLabel, recordPath, showValue, whoDid, type HistoryNames } from '@/lib/crmHistory';

type Answer = { data: unknown; error: null | { code?: string; message?: string } };

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { code?: string; message?: string }>,
  asked: [] as Array<{ table: string; filters: string[] }>,
  rpc: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  org: {
    isAdmin: true,
    organization: {
      organizationId: 'o',
      members: [{ userId: 'u1', displayName: 'Sam', email: 'sam@example.com' }, { userId: 'u2', displayName: 'Dana', email: 'dana@example.com' }],
    },
  },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => h.rpc(name, args),
    from: (table: string) => {
      const call = { table, filters: [] as string[] };
      h.asked.push(call);
      const answer = (): Answer => (h.errors[table] ? { data: null, error: h.errors[table] } : { data: h.tables[table] ?? [], error: null });
      const link: Record<string, unknown> = {
        select: () => link,
        eq: (c: string, v: unknown) => { call.filters.push(`${c}=${String(v)}`); return link; },
        order: () => link,
        limit: () => link,
        then: (ok: (v: Answer) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad),
      };
      return link;
    },
  },
}));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const value = { selected: { workspaceId: 'w', name: 'Studio' } };
  return { useSelectedWorkspace: () => value };
});
vi.mock('@/hooks/useCrmHub', () => {
  const stages = { items: [{ id: 's1', name: 'New Lead' }, { id: 's2', name: 'Qualified' }] };
  const companies = { items: [{ id: 'c1', name: 'Northwind Studio' }] };
  const contacts = { items: [{ id: 'l1', firstName: 'Elena', lastName: 'Rossi' }] };
  return { useCrmDealStages: () => stages, useCrmCompanies: () => companies, useCrmContacts: () => contacts };
});

import { HISTORY_NOT_SET_UP_MESSAGE, listTrash, restoreFromTrash } from '@/services/supabase/crmHub/history';
import { ChangeLog, RecycleBin } from '@/components/crmHub/CrmHistory';

const NAMES: HistoryNames = {
  people: new Map([['u1', 'Sam'], ['u2', 'Dana']]),
  stages: new Map([['s1', 'New Lead'], ['s2', 'Qualified']]),
  companies: new Map([['c1', 'Northwind Studio']]),
  leads: new Map([['l1', 'Elena Rossi']]),
};

beforeEach(() => {
  h.tables = {};
  h.errors = {};
  h.asked.length = 0;
  h.rpc.mockReset().mockResolvedValue({ data: 'l9', error: null });
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.org.isAdmin = true;
});
afterEach(cleanup);

describe('saying a change in plain words', () => {
  it('names the field and shows names, not ids', () => {
    expect(describeChange({
      owner_id: { from: 'u1', to: 'u2' },
      stage_id: { from: 's1', to: 's2' },
      value: { from: 4000, to: 5500 },
      company_id: { from: null, to: 'c1' },
    }, NAMES)).toEqual(['Company: nothing → Northwind Studio', 'Owner: Sam → Dana', 'Stage: New Lead → Qualified', 'Value: 4000 → 5500']);
  });

  it('copes with what it does not know: a person who left, a deleted stage, a field added later', () => {
    expect(showValue('owner_id', 'gone', NAMES)).toBe('someone who has left');
    expect(showValue('stage_id', 'gone', NAMES)).toBe('a stage that was deleted');
    expect(fieldLabel('preferred_contact_time')).toBe('Preferred contact time');
    expect(fieldLabel('group_id')).toBe('Group');
    expect(showValue('lifecycle_stage', 'sales_qualified_lead', NAMES)).toBe('sales qualified lead');
  });

  it('keeps long texts short and shows custom fields as words', () => {
    const long = 'x'.repeat(200);
    expect(showValue('notes', long, NAMES)).toHaveLength(80);
    expect(showValue('custom_fields', { budget: '10k', seats: 12 }, NAMES)).toBe('budget: 10k, seats: 12');
    expect(showValue('custom_fields', {}, NAMES)).toBe('nothing');
    expect(showValue('email', '', NAMES)).toBe('nothing');
  });

  it('leaves out a line that would read the same on both sides', () => {
    expect(describeChange({ notes: { from: null, to: '' }, email: { from: 'a@x.example', to: 'b@x.example' } }, NAMES)).toEqual(['Email: a@x.example → b@x.example']);
  });

  it('says who did it, and "The system" for the server', () => {
    expect(whoDid('u2', NAMES)).toBe('Dana');
    expect(whoDid(null, NAMES)).toBe('The system');
    expect(whoDid('gone', NAMES)).toBe('Someone who has left');
  });
});

describe('the bin', () => {
  it('counts the days a deleted record still has', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(daysLeft(new Date('2026-11-21T11:00:00Z'), now)).toBe(30);
    expect(daysLeft(new Date('2026-11-01T12:00:00Z'), now)).toBe(10);
    expect(daysLeft(new Date('2026-09-01T12:00:00Z'), now)).toBe(0);
  });

  it('knows where each kind of record is opened', () => {
    expect(recordPath('lead', 'x')).toBe('/crm/contacts/x');
    expect(recordPath('company', 'x')).toBe('/crm/companies/x');
    expect(recordPath('deal', 'x')).toBe('/crm/deals/x');
  });

  it('reads the bin of the workspace and counts what comes back with each record', async () => {
    h.tables.crm_trash = [{ id: 't1', kind: 'lead', record_id: 'l9', name: 'Priya Nair', deleted_by: 'u1', deleted_at: '2026-11-20T10:00:00Z', children: { notes: [{}, {}], activities: [{}] } }];
    const items = await listTrash('o', 'w');
    expect(items).toEqual([{ id: 't1', kind: 'lead', recordId: 'l9', name: 'Priya Nair', deletedBy: 'u1', deletedAt: new Date('2026-11-20T10:00:00Z'), notes: 2, timeline: 1 }]);
    expect(h.asked[0].filters).toEqual(['organization_id=o', 'workspace_id=w']);
  });

  it('says which file to run while the bin is not set up', async () => {
    h.errors.crm_trash = { code: 'PGRST205', message: "Could not find the table 'public.crm_trash'" };
    await expect(listTrash('o', 'w')).rejects.toThrow(HISTORY_NOT_SET_UP_MESSAGE);
    expect(HISTORY_NOT_SET_UP_MESSAGE).toContain('197_crm_recycle_bin_and_changes.sql');
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no function' } });
    await expect(restoreFromTrash('t1')).rejects.toThrow(HISTORY_NOT_SET_UP_MESSAGE);
  });
});

describe('Recycle bin', () => {
  const show = () => render(<MemoryRouter><RecycleBin /></MemoryRouter>);
  const seed = () => {
    h.tables.crm_trash = [
      { id: 't1', kind: 'lead', record_id: 'l9', name: 'Priya Nair', deleted_by: 'u2', deleted_at: new Date(Date.now() - 3 * 86400000).toISOString(), children: { notes: [{}], activities: [{}, {}] } },
      { id: 't2', kind: 'deal', record_id: 'd9', name: 'Harbour booking site', deleted_by: null, deleted_at: new Date(Date.now() - 86400000).toISOString(), children: {} },
    ];
  };

  it('lists what was deleted, by whom, and for how long it stays', async () => {
    seed();
    show();
    const row = (await screen.findByText('Priya Nair')).closest('li') as HTMLElement;
    expect(within(row).getByText('Lead')).toBeTruthy();
    expect(row.textContent).toContain('Deleted by Dana');
    expect(row.textContent).toContain('with 3 notes and timeline entries');
    expect(row.textContent).toContain('Stays 27 more days.');
    expect((screen.getByText('Harbour booking site').closest('li') as HTMLElement).textContent).toContain('Deleted by The system');
  });

  it('puts a record back and takes it off the list', async () => {
    seed();
    show();
    await screen.findByText('Priya Nair');
    h.tables.crm_trash = (h.tables.crm_trash as Array<{ id: string }>).filter((r) => r.id !== 't1');
    fireEvent.click(screen.getByRole('button', { name: 'Restore Priya Nair' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Priya Nair is back'));
    expect(h.rpc).toHaveBeenCalledWith('crm_restore', { p_trash: 't1' });
    await waitFor(() => expect(screen.queryByText('Priya Nair')).toBeNull());
  });

  it('says why when a record cannot be put back, and keeps it on the list', async () => {
    seed();
    h.rpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'The workspace this belonged to was deleted, so it cannot be restored.' } });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Priya Nair' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The workspace this belonged to was deleted, so it cannot be restored.'));
    expect(screen.getByText('Priya Nair')).toBeTruthy();
  });

  it('is for the owner and admins: a member is told so and nothing is read', async () => {
    h.org.isAdmin = false;
    seed();
    show();
    expect(await screen.findByText('Only the owner and admins can open the recycle bin.')).toBeTruthy();
    expect(h.asked).toHaveLength(0);
  });
});

describe('Change log', () => {
  const show = () => render(<MemoryRouter><ChangeLog /></MemoryRouter>);

  it('shows who changed what, with a link to the record', async () => {
    h.tables.crm_changes = [
      { id: 'c1', kind: 'deal', record_id: 'd1', name: 'Northwind website', changes: { stage_id: { from: 's1', to: 's2' }, value: { from: 4000, to: 5500 } }, changed_by: 'u1', changed_at: '2026-11-20T10:00:00Z' },
      // Only a field nobody reads changed its spelling of "nothing": no line to show, so no row.
      { id: 'c2', kind: 'lead', record_id: 'l1', name: 'Elena Rossi', changes: { notes: { from: null, to: '' } }, changed_by: null, changed_at: '2026-11-20T09:00:00Z' },
    ];
    show();
    const row = (await screen.findByRole('link', { name: 'Northwind website' })).closest('li') as HTMLElement;
    expect((within(row).getByRole('link', { name: 'Northwind website' }) as HTMLAnchorElement).getAttribute('href')).toBe('/crm/deals/d1');
    expect(row.textContent).toContain('Sam');
    expect(within(row).getByText('Stage: New Lead → Qualified')).toBeTruthy();
    expect(within(row).getByText('Value: 4000 → 5500')).toBeTruthy();
    expect(screen.queryByText('Elena Rossi')).toBeNull();
  });

  it('says what to run while it is not set up', async () => {
    h.errors.crm_changes = { code: '42P01', message: 'relation "public.crm_changes" does not exist' };
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('197_crm_recycle_bin_and_changes.sql');
  });
});

describe('migration 197', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/197_crm_recycle_bin_and_changes.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).not.toMatch(/create table (?!if not exists)/i);
    expect(flat).not.toMatch(/create (?!or replace )function/i);
    expect((flat.match(/create trigger/g) ?? []).length).toBe(6);
    expect((flat.match(/drop trigger if exists/g) ?? []).length).toBe(6);
    expect(flat).not.toMatch(/drop table|drop column/i);
  });

  it('lets only the owner and admins read the bin and the log, and nobody write them from the app', () => {
    for (const table of ['crm_trash', 'crm_changes']) {
      expect(flat).toContain(`alter table public.${table} enable row level security`);
      expect(flat).toContain(`revoke all on public.${table} from anon, authenticated`);
      expect(flat).toContain(`grant select on public.${table} to authenticated`);
      expect(flat).not.toContain(`grant insert on public.${table}`);
    }
    expect((flat.match(/for select to authenticated using \(public\.is_org_admin_or_owner\(organization_id\)\)/g) ?? []).length).toBe(2);
    expect(flat).toContain("if not public.is_org_admin_or_owner(t.organization_id) then raise exception 'Only the owner and admins can restore.'");
  });

  it('never lets the copy or the log line stop a delete or a change', () => {
    // Both trigger functions swallow their own failures and hand the row back.
    expect((flat.match(/exception when others then null; end; return old;/g) ?? []).length).toBe(1);
    expect((flat.match(/exception when others then null; end; return new;/g) ?? []).length).toBe(1);
    expect(flat).toContain('before delete on public.crm_contacts for each row execute function public.crm_keep_deleted()');
    expect(flat).toContain('after update on public.crm_deals for each row execute function public.crm_log_change()');
  });

  it('keeps nothing of an erased person, and nothing when the whole organisation goes', () => {
    expect(flat).toContain("if current_setting('crm.skip_trash', true) = 'on' then return old; end if;");
    expect(flat).toContain("if not exists (select 1 from public.organizations o where o.organization_id = (j->>'organization_id')::uuid) then return old; end if;");
    // The bin has no foreign key to the organisation, or deleting an organisation would be stopped by it.
    expect(flat).not.toMatch(/crm_trash \([^;]*references public\.organizations/);
    const erase = readFileSync(resolve(process.cwd(), 'supabase/migrations/195_crm_erase_person.sql'), 'utf8').replace(/\s+/g, ' ');
    expect(erase.indexOf("perform set_config('crm.skip_trash', 'on', true)")).toBeGreaterThan(-1);
    expect(erase.indexOf("perform set_config('crm.skip_trash', 'on', true)")).toBeLessThan(erase.indexOf('delete from public.crm_contacts where id = p_contact'));
    expect(erase).toContain("delete from public.crm_changes where record_id = $1");
    expect(erase).toContain("delete from public.crm_trash where record_id = $1");
  });

  it('clears the bin after 30 days and the log after 180', () => {
    expect(flat).toContain("delete from public.crm_trash where deleted_at < now() - interval '30 days'");
    expect(flat).toContain("delete from public.crm_changes where changed_at < now() - interval '180 days'");
  });

  it('restores the record first, then what went with it, and tells the automation it is not news', () => {
    const record = flat.indexOf('insert into public.crm_contacts select * from jsonb_populate_record(null::public.crm_contacts, r)');
    const timeline = flat.indexOf('insert into public.crm_activities select * from jsonb_populate_record(null::public.crm_activities, child)');
    const quiet = flat.indexOf('update public.auto_events set own = true, processed_at = now()');
    const gone = flat.indexOf('delete from public.crm_trash where id = p_trash');
    expect(record).toBeGreaterThan(-1);
    expect(timeline).toBeGreaterThan(record);
    expect(quiet).toBeGreaterThan(timeline);
    expect(gone).toBeGreaterThan(quiet);
    expect(flat).toContain("when unique_violation then raise exception 'This is already back in the CRM.'");
  });

  it('does not log the fields that change by themselves', () => {
    expect(flat).toContain("and n.key not in ('updated_at', 'last_contacted_at', 'sort_order')");
    expect(flat).toContain('if v_changes is null then return new; end if;');
  });
});
