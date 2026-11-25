// The browser's writes for the autopilot: what is sent to the database when a
// post it made is changed, approved, or given the person's own file, and when
// the settings are saved.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialAccount, SocialContent } from '@/types/social';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; values: Record<string, unknown>; filters: Array<[string, string, unknown]>; options?: unknown }>,
  error: null as null | { code?: string; message?: string },
  /** The answers of the next calls, in order; after them every call gets `error`. */
  errors: [] as Array<null | { code?: string; message?: string }>,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => {
      const start = (op: string, values: Record<string, unknown>, options?: unknown) => {
        const call = { table, op, values, filters: [] as Array<[string, string, unknown]>, options };
        h.calls.push(call);
        const link = {
          eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return link; },
          in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return link; },
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: h.errors.length ? (h.errors.shift() ?? null) : h.error }).then(ok),
        };
        return link;
      };
      return { update: (values: Record<string, unknown>) => start('update', values), upsert: (values: Record<string, unknown>, options: unknown) => start('upsert', values, options) };
    },
  },
}));

import { approveAutopilotPosts, saveAutopilot, saveAutopilotText, setAutopilotMedia, settingsOfRow } from '@/services/social/autopilot';
import { DEFAULT_CUSTOM, DEFAULT_SETTINGS } from '../../../api/_social/shared/autopilot';

const WS = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const account = (id: string, provider: SocialAccount['provider']): SocialAccount =>
  ({ id, organizationId: ORG, workspaceId: WS, provider, displayName: provider, externalAccountId: null, status: 'connected', lastError: null, createdAt: new Date() });
const post = (id: string, accountId: string, over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: ORG, workspaceId: WS, campaignId: null, accountId, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: 'Old title', body: 'Old words', status: 'in_review', scheduledAt: new Date('2026-11-25T18:00:00Z'), publishedAt: null, lastError: null, createdAt: new Date(),
  postGroupId: 'g1', media: null, options: {}, externalPostId: null, origin: 'autopilot',
  idea: { format: 'video', hook: '', why: '', experiment: 'A question', tags: ['old'], visual: '', spoken: '' }, ...over,
});

beforeEach(() => { h.calls.length = 0; h.error = null; h.errors.length = 0; });

describe('changing the words of a post it made', () => {
  it('writes each account’s own part again, and keeps the answers that are not text', async () => {
    const posts = [
      post('p1', 'yt', { options: { title: 'Old', madeForKids: false, privacy: 'unlisted' } }),
      post('p2', 'tt', { options: { caption: 'Old', privacy: 'PUBLIC_TO_EVERYONE', brandOrganic: true } }),
    ];
    await saveAutopilotText(posts, [account('yt', 'youtube'), account('tt', 'tiktok')], { title: 'New title', caption: 'New words', tags: ['dental'], scheduledAt: new Date('2026-11-26T09:00:00Z') });
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]).toMatchObject({ table: 'social_content', op: 'update', filters: [['eq', 'id', 'p1'], ['in', 'status', ['draft', 'in_review', 'scheduled']]] });
    expect(h.calls[0].values).toMatchObject({ title: 'New title', body: 'New words', scheduled_at: '2026-11-26T09:00:00.000Z', options: { title: 'New title', description: 'New words', tags: ['dental'], madeForKids: false, privacy: 'unlisted' } });
    expect(h.calls[0].values.idea).toMatchObject({ experiment: 'A question', tags: ['dental'] });
    expect(h.calls[1].values.options).toMatchObject({ caption: 'New title\n\nNew words\n\n#dental', privacy: 'PUBLIC_TO_EVERYONE', brandOrganic: true });
  });

  it('never touches a post that is already out, and leaves the time alone when none is given', async () => {
    await saveAutopilotText([post('p1', 'yt')], [account('yt', 'youtube')], { title: 'T', caption: 'C', tags: [], scheduledAt: null });
    expect(h.calls[0].filters).toContainEqual(['in', 'status', ['draft', 'in_review', 'scheduled']]);
    expect('scheduled_at' in h.calls[0].values).toBe(false);
  });

  it('says so in plain words when it cannot be saved', async () => {
    h.error = { code: '42501', message: 'new row violates row-level security policy' };
    await expect(saveAutopilotText([post('p1', 'yt')], [account('yt', 'youtube')], { title: 'T', caption: 'C', tags: [], scheduledAt: null })).rejects.toThrow('The changes could not be saved. Please try again.');
  });
});

describe('the person’s own file on a post it made', () => {
  const media = { url: 'https://files.example/own.mp4', kind: 'video' as const, mime: 'video/mp4', bytes: 9, name: 'own.mp4' };

  it('goes on every post of the idea; one that waited for the autopilot’s file now waits for a yes', async () => {
    await setAutopilotMedia([post('p1', 'yt', { status: 'draft', lastError: 'It could not be made.' }), post('p2', 'tt', { status: 'scheduled' })], media);
    expect(h.calls[0].values).toEqual({ media: [media], media_urls: [media.url], last_error: null, status: 'in_review' });
    // A post that was already approved stays approved.
    expect(h.calls[1].values).toEqual({ media: [media], media_urls: [media.url], last_error: null });
  });
});

describe('saying yes to a post it made', () => {
  it('lets it go out at its planned time, or now when that time has passed', async () => {
    const now = new Date('2026-11-25T12:00:00Z');
    await approveAutopilotPosts([{ id: 'p1', scheduledAt: new Date('2026-11-25T18:00:00Z') }, { id: 'p2', scheduledAt: new Date('2026-11-24T18:00:00Z') }, { id: 'p3', scheduledAt: null }], 'u1', now);
    expect(h.calls.map((c) => c.values.scheduled_at)).toEqual(['2026-11-25T18:00:00.000Z', '2026-11-25T12:00:00.000Z', '2026-11-25T12:00:00.000Z']);
    expect(h.calls[0].values).toMatchObject({ status: 'scheduled', approved_by: 'u1' });
    // Only a post that still waits for a yes.
    expect(h.calls[0].filters).toEqual([['eq', 'id', 'p1'], ['eq', 'status', 'in_review']]);
  });
});

describe('saving the settings', () => {
  const s = { ...DEFAULT_SETTINGS, mode: 'ask' as const, brief: '  Harbour Dental is a family dentist in Leeds.  ', website: ' harbourdental.co.uk ', postDays: [5, 1, 1], postTimes: ['18:00', 'x'], retryWeak: false, budgetCents: 999999, postsPerWeek: 40 };

  it('keeps every value inside its limits', async () => {
    await saveAutopilot(ORG, WS, s, 'u1');
    expect(h.calls[0]).toMatchObject({ table: 'social_autopilot', op: 'upsert', options: { onConflict: 'workspace_id' } });
    expect(h.calls[0].values).toMatchObject({
      workspace_id: WS, organization_id: ORG, mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.', website: 'harbourdental.co.uk',
      post_days: [1, 5], post_times: ['18:00'], retry_weak: false, budget_cents: 100000, posts_per_week: 14, updated_by: 'u1',
    });
    // What the website said is only written when it was just read.
    expect('site_notes' in h.calls[0].values).toBe(false);
  });

  it('keeps what the website said when it was just read for the form', async () => {
    await saveAutopilot(ORG, WS, s, 'u1', { siteNotes: 'Check-ups from £45.' });
    expect(h.calls[0].values).toMatchObject({ site_notes: 'Check-ups from £45.' });
    expect(typeof h.calls[0].values.site_at).toBe('string');
  });

  it('says who may change it, and that the SQL is not run yet, in words for the reader', async () => {
    h.error = { code: '42501', message: 'new row violates row-level security policy for table "social_autopilot"' };
    await expect(saveAutopilot(ORG, WS, s)).rejects.toThrow('Only the owner or an admin can change the autopilot.');
    h.error = { code: 'PGRST204', message: "Could not find the 'post_days' column of 'social_autopilot' in the schema cache" };
    await expect(saveAutopilot(ORG, WS, s)).rejects.toThrow(/Run supabase\/crm_setup\.sql/);
  });

  it('reads a row made before the newer settings existed', () => {
    expect(settingsOfRow({ mode: 'ask', brief: 'x' })).toMatchObject({ retryWeak: true, website: '', postDays: [], postTimes: [], custom: DEFAULT_CUSTOM });
  });

  it('saves the owner’s own wishes as one value, cleaned, with the link as it will be written', async () => {
    const wishes = { ...DEFAULT_CUSTOM, goal: 'leads' as const, link: 'harbourdental.co.uk/book', fixedTags: ['#Leeds', 'Leeds', 'smile'], rules: `  ${'x'.repeat(900)}` };
    expect(await saveAutopilot(ORG, WS, { ...s, custom: wishes }, 'u1')).toEqual({ customKept: true });
    expect(h.calls).toHaveLength(1);
    const kept = h.calls[0].values.custom as typeof DEFAULT_CUSTOM;
    expect(kept).toMatchObject({ goal: 'leads', link: 'https://harbourdental.co.uk/book', fixedTags: ['Leeds', 'smile'], emoji: 'auto', trendsEveryDays: 7 });
    expect(kept.rules).toHaveLength(800);
    expect(settingsOfRow({ custom: kept }).custom).toEqual(kept);
  });

  it('still saves everything else when the database cannot keep the wishes yet, and says so', async () => {
    h.errors.push({ code: 'PGRST204', message: "Could not find the 'custom' column of 'social_autopilot' in the schema cache" }, null);
    expect(await saveAutopilot(ORG, WS, { ...s, custom: { ...DEFAULT_CUSTOM, goal: 'sales' } }, 'u1')).toEqual({ customKept: false });
    expect(h.calls).toHaveLength(2);
    expect('custom' in h.calls[0].values).toBe(true);
    expect('custom' in h.calls[1].values).toBe(false);
    expect(h.calls[1].values).toMatchObject({ mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.', updated_by: 'u1' });
  });

  it('does not try a second time for any other failure', async () => {
    h.error = { code: '42501', message: 'new row violates row-level security policy for table "social_autopilot"' };
    await expect(saveAutopilot(ORG, WS, { ...s, custom: { ...DEFAULT_CUSTOM, goal: 'sales' } })).rejects.toThrow('Only the owner or an admin can change the autopilot.');
    expect(h.calls).toHaveLength(1);
  });
});
