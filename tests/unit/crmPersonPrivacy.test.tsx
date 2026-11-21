// Privacy tools on a lead: a copy of everything about one person, and erasing them.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { exportFileName, personExport } from '@/lib/crmPersonData';
import type { CrmContact } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  personCalls: vi.fn(),
  deletePersonCalls: vi.fn(),
  listDeals: vi.fn(),
  listTasks: vi.fn(),
  listActivities: vi.fn(),
  messages: [] as Array<Record<string, unknown>>,
  campaigns: [] as Array<Record<string, unknown>>,
  order: [] as string[],
  toast: { success: vi.fn(), error: vi.fn() },
  saved: [] as Array<{ name: string; text: string }>,
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => { h.order.push(`rpc:${name}`); return h.rpc(name, args); },
    from: (table: string) => {
      const rows = table === 'email_messages' ? h.messages : h.campaigns;
      const link: Record<string, unknown> = {
        select: () => link, eq: () => link, in: () => link, order: () => link, limit: () => link,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return link;
    },
  },
}));
vi.mock('@/services/voice/client', () => ({
  personCalls: h.personCalls,
  deletePersonCalls: (id: string) => { h.order.push('calls'); return h.deletePersonCalls(id); },
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({ listDeals: h.listDeals }));
vi.mock('@/services/supabase/crmHub/tasks', () => ({ listTasks: h.listTasks }));
vi.mock('@/services/supabase/crmHub/activities', () => ({ listActivities: h.listActivities }));

import { ERASE_NOT_SET_UP_MESSAGE, collectPersonData, erasePerson } from '@/services/supabase/crmHub/privacy';
import { PersonPrivacy } from '@/components/crmHub/PersonPrivacy';

const LEAD = {
  id: 'l1', organizationId: 'o', workspaceId: 'w', firstName: 'Elena', lastName: 'Rossi', email: 'elena@northwind.example',
  phone: '020 7946 0958', companyId: 'c1', ownerId: 'u1', createdAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-02T10:00:00Z'),
} as unknown as CrmContact;

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ error: null });
  h.personCalls.mockReset().mockResolvedValue({ calls: [{ id: 'k1', at: '2026-11-10T10:00:00Z', to: '+442079460958', status: 'completed', outcome: 'connected', seconds: 61, note: '', recorded: true }] });
  h.deletePersonCalls.mockReset().mockResolvedValue(1);
  h.listDeals.mockReset().mockResolvedValue([{ id: 'd1', name: 'Northwind website', value: 9500, createdAt: new Date('2026-11-05T10:00:00Z') }]);
  h.listTasks.mockReset().mockResolvedValue([{ id: 't1', title: 'Ring Elena' }]);
  h.listActivities.mockReset().mockResolvedValue([{ id: 'a1', type: 'note', description: 'Met at the fair' }]);
  h.messages = [{ id: 'm1', campaign_id: 'c9', to_email: 'elena@northwind.example', status: 'sent', sent_at: '2026-11-08T09:00:00Z', created_at: '2026-11-08T08:00:00Z' }];
  h.campaigns = [{ id: 'c9', name: 'Autumn offer', subject: 'A thought for Northwind' }];
  h.order.length = 0;
  h.saved.length = 0;
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('a copy of one person’s data', () => {
  it('puts everything into one plain structure, with dates as text', () => {
    const out = personExport('Elena Rossi', {
      lead: { id: 'l1', createdAt: new Date('2026-11-01T10:00:00Z'), customFields: { since: new Date('2026-01-01T00:00:00Z') } },
      company: { name: 'Northwind Studio' }, deals: [{ id: 'd1' }], followUps: [], timeline: [{ id: 'a1' }], emails: [], calls: [{ id: 'k1' }],
    }, new Date('2026-11-21T12:00:00Z'));
    expect(out.about).toBe('Everything the CRM holds about Elena Rossi.');
    expect(out.exportedAt).toBe('2026-11-21T12:00:00.000Z');
    expect(out.lead).toEqual({ id: 'l1', createdAt: '2026-11-01T10:00:00.000Z', customFields: { since: '2026-01-01T00:00:00.000Z' } });
    expect(out.calls).toEqual([{ id: 'k1' }]);
    expect(out.notIncluded.join(' ')).toContain('Call recordings');
    expect(out.notIncluded.join(' ')).not.toContain('could not be read');
  });

  it('says so when the calls could not be read, instead of showing none', () => {
    const out = personExport('Elena Rossi', { lead: {}, company: null, deals: [], followUps: [], timeline: [], emails: [], calls: null }, new Date());
    expect(out.calls).toEqual([]);
    expect(out.notIncluded[0]).toBe('Calls: they could not be read. Only the owner and admins can see calls.');
  });

  it('names the file after the person and the day', () => {
    expect(exportFileName('Élena Rossi-O’Neil', new Date('2026-11-21T23:30:00Z'))).toBe('elena-rossi-o-neil-data-2026-11-21.json');
    expect(exportFileName('  ', new Date('2026-11-21T10:00:00Z'))).toBe('lead-data-2026-11-21.json');
  });

  it('reads the lead’s deals, follow-ups, timeline, emails and calls', async () => {
    const out = await collectPersonData(LEAD, 'Northwind Studio');
    expect(h.listDeals).toHaveBeenCalledWith('o', { contactId: 'l1' });
    expect(h.listTasks).toHaveBeenCalledWith('o', { contactId: 'l1' });
    expect(h.listActivities).toHaveBeenCalledWith('o', { contactId: 'l1', limit: 2000 });
    expect(out.company).toEqual({ name: 'Northwind Studio' });
    expect(out.deals).toHaveLength(1);
    expect(out.emails).toEqual([{ to: 'elena@northwind.example', subject: 'A thought for Northwind', campaign: 'Autumn offer', status: 'sent', sentAt: '2026-11-08T09:00:00Z' }]);
    expect(out.calls).toHaveLength(1);
    expect(JSON.stringify(out)).toContain('Met at the fair');
  });

  it('still makes the copy for somebody who may not see calls', async () => {
    h.personCalls.mockRejectedValue(new Error('Only the owner and admins can see calls.'));
    const out = await collectPersonData(LEAD, null);
    expect(out.calls).toEqual([]);
    expect(out.notIncluded[0]).toContain('Calls: they could not be read.');
  });
});

describe('erasing one person', () => {
  it('removes the call recordings first, then everything in the database in one step', async () => {
    await erasePerson('l1');
    expect(h.order).toEqual(['calls', 'rpc:crm_erase_person']);
    expect(h.deletePersonCalls).toHaveBeenCalledWith('l1');
    expect(h.rpc).toHaveBeenCalledWith('crm_erase_person', { p_contact: 'l1' });
  });

  it('touches nothing in the database when a recording could not be removed', async () => {
    h.deletePersonCalls.mockRejectedValue(new Error('The recording could not be deleted.'));
    await expect(erasePerson('l1')).rejects.toThrow('The recording could not be deleted.');
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('says which file to run while the function is missing, and passes on a refusal', async () => {
    h.rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find the function public.crm_erase_person' } });
    await expect(erasePerson('l1')).rejects.toThrow(ERASE_NOT_SET_UP_MESSAGE);
    expect(ERASE_NOT_SET_UP_MESSAGE).toContain('195_crm_erase_person.sql');
    h.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'Only the owner can erase a person.' } });
    await expect(erasePerson('l1')).rejects.toThrow('Only the owner can erase a person.');
  });
});

describe('Privacy menu on the lead page', () => {
  const open = async (isOwner: boolean, onErased = vi.fn()) => {
    render(<PersonPrivacy contact={LEAD} companyName="Northwind Studio" isOwner={isOwner} onErased={onErased} />);
    const trigger = screen.getByRole('button', { name: 'Privacy' });
    // The arrow key opens the menu, as it does for somebody using the keyboard.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await screen.findByRole('menu');
    return onErased;
  };

  it('saves a copy as a file named after the person', async () => {
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { made.push(blob); return 'blob:copy'; }) as never;
    URL.revokeObjectURL = vi.fn() as never;
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicked.push(this.download); });
    await open(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download this person’s data' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('A copy of Elena Rossi’s data was saved to your downloads'));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^elena-rossi-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(made[0].type).toBe('application/json');
  });

  it('lets only the owner erase, and only after it is confirmed', async () => {
    await open(false);
    expect(screen.getByRole('menuitem', { name: 'Erase this person (owner only)' }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    const onErased = await open(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Erase this person…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Deals, agreements and invoices stay');
    expect(dialog.textContent).toContain('do-not-email list');
    expect(h.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Erase for good' }));
    await waitFor(() => expect(onErased).toHaveBeenCalled());
    expect(h.toast.success).toHaveBeenCalledWith('Elena Rossi was erased');
  });

  it('keeps the window open and says why when the person could not be erased', async () => {
    h.rpc.mockResolvedValue({ error: { code: '23503', message: 'This person still has call recordings. Delete the recordings first, then erase the person.' } });
    const onErased = await open(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Erase this person…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Erase for good' }));
    expect((await screen.findByRole('alert')).textContent).toContain('still has call recordings');
    expect(onErased).not.toHaveBeenCalled();
  });
});

describe('migration 195', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/195_crm_erase_person.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('can be run twice and adds only the one function, for signed-in people', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect((flat.match(/create or replace function/g) ?? []).length).toBe(1);
    expect(flat).not.toMatch(/create table|alter table|drop /i);
    expect(flat).toContain('revoke all on function public.crm_erase_person(uuid) from public, anon');
    expect(flat).toContain('grant execute on function public.crm_erase_person(uuid) to authenticated, service_role');
  });

  it('checks that the asker is the owner before it removes anything', () => {
    const check = flat.indexOf('o.owner_id = auth.uid()');
    expect(check).toBeGreaterThan(-1);
    expect(flat).toContain("raise exception 'Only the owner can erase a person.'");
    for (const removal of ['delete from public.crm_calls', 'delete from public.crm_tasks', 'delete from public.email_messages', 'delete from public.crm_contacts']) {
      expect(flat.indexOf(removal), removal).toBeGreaterThan(check);
    }
    // Asking with no lead changes nothing: the set-up check relies on that.
    expect(flat.indexOf("if p_contact is null then raise exception")).toBeLessThan(check);
  });

  it('stops while a call recording is still on record, and removes the lead last', () => {
    expect(flat).toContain("where contact_id = $1 and recording_sid is not null' into n using p_contact; if n > 0 then raise exception");
    const lead = flat.lastIndexOf('delete from public.crm_contacts where id = p_contact');
    for (const earlier of ['delete from public.crm_tasks', 'delete from public.email_messages', 'insert into public.email_suppressions']) {
      expect(flat.indexOf(earlier), earlier).toBeLessThan(lead);
    }
  });

  it('keeps the address on the do-not-email list, and leaves deals alone', () => {
    expect(flat).toContain("values ($1, $2, ''manual'') on conflict (organization_id, email) do nothing");
    expect(flat).not.toContain('crm_deals');
    // Tables from other migrations are used only where they exist.
    for (const table of ['crm_calls', 'email_sequence_enrollments', 'email_messages', 'email_inbox_events', 'email_suppressions']) {
      expect(flat, table).toContain(`to_regclass('public.${table}') is not null`);
    }
  });

  it('uses columns those tables really have', () => {
    const sql = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8');
    expect(sql('188_crm_calls.sql')).toMatch(/\n\s+recording_sid text/);
    expect(sql('158_email_sequences.sql')).toMatch(/\n\s+to_email text not null/);
    expect(sql('152_email_marketing_schema.sql')).toContain('unique (organization_id, email)');
    expect(sql('157_inbox_sync.sql')).toMatch(/\n\s+address text not null/);
  });
});
