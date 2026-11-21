// The Replies tab: who answered, what they answered, and where to find them.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildReplies, realReplies, type RepliedCampaign, type RepliedMessage, type ReplyEvent } from '@/lib/email/replies';

type Answer = { data: unknown[] | null; error: null | { message: string } };

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
  asked: [] as Array<{ table: string; filters: string[] }>,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, filters: [] as string[] };
      h.asked.push(call);
      const answer = (): Answer => (h.errors[table] ? { data: null, error: h.errors[table] } : { data: h.tables[table] ?? [], error: null });
      const link: Record<string, unknown> = {
        select: () => link,
        eq: (c: string, v: unknown) => { call.filters.push(`${c}=${String(v)}`); return link; },
        in: (c: string, v: unknown[]) => { call.filters.push(`${c} in ${v.join(',')}`); return link; },
        order: () => link,
        limit: () => link,
        then: (ok: (v: Answer) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad),
      };
      return link;
    },
  },
}));

import { listReplies } from '@/services/supabase/emailReplies';
import { RepliesTab } from '@/components/email/RepliesTab';

const event = (id: string, kind: ReplyEvent['kind'], address: string, messageId: string | null, at: string, accountId: string | null = 'box1'): ReplyEvent =>
  ({ id, kind, address, messageId, accountId, createdAt: new Date(at) });
const MESSAGES: RepliedMessage[] = [
  { id: 'm1', campaignId: 'c1', contactId: 'l1', toName: 'Priya Nair' },
  { id: 'm2', campaignId: 'c2', contactId: null, toName: null },
  { id: 'm3', campaignId: 'c3', contactId: 'l3', toName: 'Tom Okafor' },
];
const CAMPAIGNS: RepliedCampaign[] = [
  { id: 'c1', name: 'Autumn offer', subject: 'A thought for Harbour Dental', kind: 'bulk', workspaceId: 'w' },
  { id: 'c2', name: 'Step 2', subject: 'Following up', kind: 'sequence', workspaceId: 'w' },
  { id: 'c3', name: 'Other team', subject: 'Hello', kind: 'bulk', workspaceId: 'other' },
];
const BOXES = [{ id: 'box1', label: 'Sales', fromEmail: 'sales@northwind.example' }];

beforeEach(() => { h.tables = {}; h.errors = {}; h.asked.length = 0; });
afterEach(cleanup);

describe('the list of replies', () => {
  const events = [
    event('e1', 'reply', 'priya@harbour.example', 'm1', '2026-11-20T10:00:00Z'),
    event('e2', 'auto_reply', 'someone@fieldway.example', 'm2', '2026-11-21T09:00:00Z', null),
    event('e3', 'bounce', 'gone@nowhere.example', 'm1', '2026-11-21T11:00:00Z'),
    event('e4', 'reply', 'tom@other.example', 'm3', '2026-11-21T12:00:00Z'),
    event('e5', 'reply', 'stranger@x.example', null, '2026-11-21T13:00:00Z'),
  ];

  it('shows who answered what, newest first, for this workspace only', () => {
    const rows = buildReplies(events, MESSAGES, CAMPAIGNS, BOXES, 'w');
    expect(rows.map((r) => r.id)).toEqual(['e2', 'e1']);
    expect(rows[1]).toMatchObject({
      who: 'Priya Nair', address: 'priya@harbour.example', automatic: false, answered: 'Autumn offer',
      subject: 'A thought for Harbour Dental', mailbox: 'Sales (sales@northwind.example)', contactId: 'l1',
    });
    // No name on the email: the address stands in. A sequence step has no name anybody chose.
    expect(rows[0]).toMatchObject({ who: 'someone@fieldway.example', automatic: true, answered: 'a sequence email', mailbox: null, contactId: null });
  });

  it('leaves out bounces, answers to nothing we sent, and other workspaces', () => {
    const ids = buildReplies(events, MESSAGES, CAMPAIGNS, BOXES, 'w').map((r) => r.id);
    expect(ids).not.toContain('e3');
    expect(ids).not.toContain('e4');
    expect(ids).not.toContain('e5');
    // With no workspace chosen, every workspace's replies are listed.
    expect(buildReplies(events, MESSAGES, CAMPAIGNS, BOXES, null).map((r) => r.id)).toEqual(['e4', 'e2', 'e1']);
  });

  it('does not count an automatic answer as a reply', () => {
    expect(realReplies(buildReplies(events, MESSAGES, CAMPAIGNS, BOXES, 'w'))).toBe(1);
  });
});

describe('reading them', () => {
  const seed = () => {
    h.tables = {
      email_inbox_events: [
        { id: 'e1', kind: 'reply', address: 'priya@harbour.example', account_id: 'box1', message_id: 'm1', created_at: '2026-11-20T10:00:00Z' },
      ],
      email_messages: [{ id: 'm1', campaign_id: 'c1', contact_id: 'l1', to_name: 'Priya Nair' }],
      email_campaigns: [{ id: 'c1', name: 'Autumn offer', subject: 'A thought', kind: 'bulk', workspace_id: 'w' }],
      email_accounts: [{ id: 'box1', label: 'Sales', from_email: 'sales@northwind.example' }],
    };
  };

  it('asks only for replies, then for the emails and campaigns they answer', async () => {
    seed();
    const rows = await listReplies('o', 'w');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ who: 'Priya Nair', answered: 'Autumn offer', mailbox: 'Sales (sales@northwind.example)' });
    expect(h.asked.find((c) => c.table === 'email_inbox_events')?.filters).toEqual(['organization_id=o', 'kind in reply,auto_reply']);
    expect(h.asked.find((c) => c.table === 'email_messages')?.filters).toEqual(['id in m1']);
    expect(h.asked.find((c) => c.table === 'email_campaigns')?.filters).toEqual(['id in c1']);
  });

  it('asks for nothing more when there are no replies', async () => {
    expect(await listReplies('o', 'w')).toEqual([]);
    expect(h.asked.map((c) => c.table)).toEqual(['email_inbox_events']);
  });

  it('still lists the replies when the mailbox names cannot be read', async () => {
    seed();
    h.errors = { email_accounts: { message: 'not allowed' } };
    expect((await listReplies('o', 'w'))[0]).toMatchObject({ who: 'Priya Nair', mailbox: null });
  });

  it('passes on a refusal to read the replies', async () => {
    h.errors = { email_inbox_events: { message: 'not allowed' } };
    await expect(listReplies('o', 'w')).rejects.toMatchObject({ message: 'not allowed' });
  });
});

describe('Replies tab', () => {
  const show = () => render(<MemoryRouter><RepliesTab orgId="o" workspaceId="w" /></MemoryRouter>);

  it('lists each reply with the mailbox to read it in and a way to the lead', async () => {
    h.tables = {
      email_inbox_events: [
        { id: 'e1', kind: 'reply', address: 'priya@harbour.example', account_id: 'box1', message_id: 'm1', created_at: '2026-11-20T10:00:00Z' },
        { id: 'e2', kind: 'auto_reply', address: 'office@fieldway.example', account_id: 'box1', message_id: 'm2', created_at: '2026-11-21T10:00:00Z' },
      ],
      email_messages: [{ id: 'm1', campaign_id: 'c1', contact_id: 'l1', to_name: 'Priya Nair' }, { id: 'm2', campaign_id: 'c1', contact_id: null, to_name: null }],
      email_campaigns: [{ id: 'c1', name: 'Autumn offer', subject: 'A thought', kind: 'bulk', workspace_id: 'w' }],
      email_accounts: [{ id: 'box1', label: 'Sales', from_email: 'sales@northwind.example' }],
    };
    show();
    const row = (await screen.findByText('Priya Nair')).closest('li') as HTMLElement;
    expect(row.textContent).toContain('answered Autumn offer: “A thought”');
    expect(row.textContent).toContain('Read it in Sales (sales@northwind.example).');
    expect(within(row).getByRole('link', { name: 'Open lead' }).getAttribute('href')).toBe('/crm/contacts/l1');
    const auto = screen.getByText('office@fieldway.example').closest('li') as HTMLElement;
    expect(within(auto).getByText('Automatic answer')).toBeTruthy();
    expect(within(auto).getByText('Not a lead in the CRM')).toBeTruthy();
    expect(screen.getByText('1 reply, and 1 automatic answer')).toBeTruthy();
  });

  it('says how replies get here when there are none', async () => {
    show();
    expect(await screen.findByText('No replies yet.')).toBeTruthy();
  });

  it('says so when the replies cannot be read', async () => {
    h.errors = { email_inbox_events: { message: 'permission denied for table email_inbox_events' } };
    show();
    // Never the database's own words: a plain sentence about what the person can do.
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toBe('You do not have permission to do this.');
    expect(alert).not.toContain('email_inbox_events');
  });
});
