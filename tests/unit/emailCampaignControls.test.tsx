// A campaign that is going out can be paused, resumed and deleted.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { EmailCampaign } from '@/lib/email/types';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; patch?: unknown; filters: Array<[string, string, unknown]> }>,
  /** Rows the database says it changed. */
  changed: [{ id: 'c1' }] as Array<{ id: string }>,
  error: null as null | { code: string; message: string },
  listCampaigns: vi.fn(),
  listMessages: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
// The chart of recent campaigns needs a real browser to measure itself; it is not what is tested here.
vi.mock('@/components/dashboards/StackedBar', () => ({ StackedBar: () => null }));
vi.mock('@/lib/logger',() => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/services/supabase/config', () => {
  const chain = (op: string, patch?: unknown) => {
    const call = { op, patch, filters: [] as Array<[string, string, unknown]> };
    h.calls.push(call);
    const result = () => (h.error ? { data: null, error: h.error } : { data: h.changed, error: null });
    const link: Record<string, unknown> = {
      eq: (column: string, value: unknown) => { call.filters.push(['eq', column, value]); return link; },
      in: (column: string, value: unknown) => { call.filters.push(['in', column, value]); return link; },
      select: () => Promise.resolve(result()),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    return link;
  };
  return { supabase: { from: () => ({ update: (patch: unknown) => chain('update', patch), delete: () => chain('delete') }) } };
});

beforeEach(() => {
  h.calls.length = 0;
  h.changed = [{ id: 'c1' }];
  h.error = null;
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the three changes', () => {
  it('pauses only a campaign that is still going out', async () => {
    const { pauseCampaign } = await import('@/services/supabase/email');
    expect(await pauseCampaign('c1')).toBe(true);
    expect(h.calls[0]).toEqual({ op: 'update', patch: { status: 'paused' }, filters: [['eq', 'id', 'c1'], ['in', 'status', ['sending', 'scheduled']]] });
    // It finished in the meantime: nothing was changed, and the caller is told.
    h.changed = [];
    expect(await pauseCampaign('c1')).toBe(false);
  });

  it('resumes only a paused campaign, back to waiting when its start time is still ahead', async () => {
    const { resumeCampaign } = await import('@/services/supabase/email');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    expect(await resumeCampaign({ id: 'c1', scheduledAt: null })).toBe(true);
    expect(h.calls[0]).toEqual({ op: 'update', patch: { status: 'sending' }, filters: [['eq', 'id', 'c1'], ['eq', 'status', 'paused']] });
    await resumeCampaign({ id: 'c1', scheduledAt: new Date('2026-11-25T09:00:00Z') });
    expect(h.calls[1].patch).toEqual({ status: 'scheduled' });
    await resumeCampaign({ id: 'c1', scheduledAt: new Date('2026-11-20T09:00:00Z') });
    expect(h.calls[2].patch).toEqual({ status: 'sending' });
  });

  it('deletes one campaign by its id, and passes on a refusal', async () => {
    const { deleteCampaign } = await import('@/services/supabase/email');
    await deleteCampaign('c1');
    expect(h.calls[0]).toEqual({ op: 'delete', patch: undefined, filters: [['eq', 'id', 'c1']] });
    h.error = { code: '42501', message: 'not allowed' };
    await expect(deleteCampaign('c1')).rejects.toMatchObject({ message: 'not allowed' });
  });
});

describe('why a pause is real', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/160_claim_respects_pinned_mailbox.sql'), 'utf8');

  it('the sender only takes emails of campaigns that are sending or scheduled', () => {
    expect(sql).toContain("and c.status in ('sending','scheduled')");
    expect(sql).not.toMatch(/c\.status in \([^)]*'paused'/);
  });

  it('deleting a campaign removes its emails and keeps the unsubscribes', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase/migrations/152_email_marketing_schema.sql'), 'utf8');
    expect(schema).toContain('campaign_id uuid not null references public.email_campaigns(id) on delete cascade');
    expect(schema).toContain('campaign_id uuid references public.email_campaigns(id) on delete set null');
  });
});

describe('Campaigns list', () => {
  const campaign = (id: string, name: string, status: EmailCampaign['status'], over: Partial<EmailCampaign> = {}) => ({
    id, organizationId: 'o', workspaceId: 'w', accountId: 'a1', kind: 'bulk', name, subject: 'Hello', bodyHtml: '<p>x</p>',
    status, scheduledAt: null, queuedCount: 40, sentCount: 12, failedCount: 0, suppressedCount: 1, openedCount: 3,
    openedPrefetchCount: 0, repliedCount: 1, bouncedCount: 0, createdAt: new Date('2026-11-20T10:00:00Z'), updatedAt: new Date('2026-11-20T10:00:00Z'), ...over,
  }) as unknown as EmailCampaign;

  const show = async (campaigns: EmailCampaign[]) => {
    vi.resetModules();
    vi.doMock('@/services/supabase/email', async (original) => ({
      ...(await original<typeof import('@/services/supabase/email')>()),
      listCampaigns: h.listCampaigns,
      listMessages: h.listMessages,
    }));
    h.listCampaigns.mockReset().mockResolvedValue(campaigns);
    h.listMessages.mockReset().mockResolvedValue([]);
    const { CampaignsTab } = await import('@/components/email/CampaignsTab');
    render(<CampaignsTab orgId="o" workspaceId="w" onNewCampaign={() => undefined} />);
    await screen.findByText(campaigns[0].name);
  };
  const card = (name: string) => screen.getByText(name).closest('[data-campaign]') as HTMLElement;

  it('offers Pause while a campaign is going out, and nothing that would lose it', async () => {
    await show([campaign('c1', 'Autumn offer', 'sending')]);
    expect(within(card('Autumn offer')).getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(within(card('Autumn offer')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(card('Autumn offer')).queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('pauses without opening the campaign, and shows the new state', async () => {
    await show([campaign('c1', 'Autumn offer', 'sending')]);
    h.listCampaigns.mockResolvedValue([campaign('c1', 'Autumn offer', 'paused')]);
    fireEvent.click(within(card('Autumn offer')).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Paused. Emails already on their way may still go out.'));
    expect(h.calls[0].patch).toEqual({ status: 'paused' });
    expect(await within(card('Autumn offer')).findByRole('button', { name: 'Resume' })).toBeTruthy();
    // The row was not opened by the press.
    expect(h.listMessages).not.toHaveBeenCalled();
  });

  it('says so when the campaign finished before it could be paused', async () => {
    await show([campaign('c1', 'Autumn offer', 'sending')]);
    h.changed = [];
    fireEvent.click(within(card('Autumn offer')).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('This campaign is no longer going out, so there is nothing to pause.'));
  });

  it('resumes a paused campaign', async () => {
    await show([campaign('c1', 'Autumn offer', 'paused')]);
    fireEvent.click(within(card('Autumn offer')).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Resumed. The emails not sent yet go out again.'));
    expect(h.calls[0].patch).toEqual({ status: 'sending' });
  });

  it('deletes a campaign that is not going out, only after it is confirmed', async () => {
    await show([campaign('c1', 'Autumn offer', 'paused'), campaign('c2', 'Spring news', 'sent')]);
    fireEvent.click(within(card('Spring news')).getByRole('button', { name: 'Delete' }));
    expect(h.calls).toHaveLength(0);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Spring news');
    expect(dialog.textContent).toContain('stay unsubscribed');
    h.listCampaigns.mockResolvedValue([campaign('c1', 'Autumn offer', 'paused')]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Campaign deleted'));
    expect(h.calls[0]).toMatchObject({ op: 'delete', filters: [['eq', 'id', 'c2']] });
    await waitFor(() => expect(screen.queryByText('Spring news')).toBeNull());
  });
});
