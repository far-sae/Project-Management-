// The Autopilot tab of the Social page: the switch, the posts that wait for a
// yes, what the autopilot has learned, how its posts did, and its settings.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AutopilotData } from '@/services/social/autopilot';
import type { SocialAccount, SocialContent } from '@/types/social';
import { DEFAULT_CUSTOM, DEFAULT_SETTINGS, type AutopilotSettings, type FeedPost } from '../../../api/_social/shared/autopilot';
import { blocksOf } from '@/components/social/RichNote';
import { setInternalsVisible } from '@/lib/publicError';

const h = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), ready: vi.fn(), run: vi.fn(), approve: vi.fn(),
  remake: vi.fn(), improve: vi.fn(), learn: vi.fn(), saveText: vi.fn(), setMedia: vi.fn(), upload: vi.fn(), trends: vi.fn(),
  internals: { visible: false },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useInternalsVisible', () => ({ useInternalsVisible: () => h.internals.visible }));
vi.mock('@/services/social/autopilot', async (original) => ({
  ...(await original<typeof import('@/services/social/autopilot')>()),
  loadAutopilot: h.load, saveAutopilot: h.save, autopilotReady: h.ready, runAutopilot: h.run, approveAutopilotPosts: h.approve,
  remakeAutopilotMedia: h.remake, improveAutopilotPost: h.improve, learnFromWebsite: h.learn, saveAutopilotText: h.saveText, setAutopilotMedia: h.setMedia, refreshAutopilotTrends: h.trends,
}));
vi.mock('@/services/supabase/social', () => ({ uploadSocialMedia: h.upload }));

import { Autopilot, monthlyMediaCeiling } from '@/components/social/Autopilot';
import { ownFileProblem, toLocalInput } from '@/components/social/AutopilotEdit';
import { retextOptions } from '@/lib/socialCompose';

const WS = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

const account = (id: string, provider: SocialAccount['provider'], displayName: string, status: SocialAccount['status'] = 'connected'): SocialAccount =>
  ({ id, organizationId: ORG, workspaceId: WS, provider, displayName, externalAccountId: null, status, lastError: null, createdAt: new Date('2026-11-01') });
const ACCOUNTS = [account('a1', 'instagram', 'Harbour Dental'), account('a2', 'tiktok', 'harbourdental'), account('a3', 'facebook', 'Old page', 'error')];

const post = (id: string, over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: ORG, workspaceId: WS, campaignId: 'c1', accountId: 'a1', crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: 'Three brushing mistakes', body: 'Most people brush too hard.', status: 'in_review', scheduledAt: new Date('2026-11-25T18:00:00Z'), publishedAt: null,
  lastError: null, createdAt: new Date('2026-11-24T10:00:00Z'), postGroupId: 'g1',
  media: { url: 'https://files.example/a.jpg', kind: 'image', mime: 'image/jpeg', bytes: 4, name: 'a.jpg' }, options: {}, externalPostId: null,
  origin: 'autopilot', idea: { format: 'image', hook: 'You are brushing wrong.', why: 'Tips did well.', experiment: 'A question as the opening line', tags: ['dental'], visual: 'A toothbrush', spoken: '' },
  ...over,
});

const settings = (over: Partial<AutopilotSettings> = {}): AutopilotSettings => ({ ...DEFAULT_SETTINGS, ...over });
const data = (over: Partial<AutopilotData> = {}): AutopilotData => ({
  saved: true, settings: settings({ mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.' }), playbook: '', siteNotes: '', notes: [], feed: [],
  jobs: { waiting: 0, running: 0, done: 0, failed: 0 }, spentCents: 0, customReady: true, ...over,
});

const onChanged = vi.fn();
const onDelete = vi.fn();

async function open(d: AutopilotData, props: { content?: SocialContent[]; canEdit?: boolean; accounts?: SocialAccount[] } = {}) {
  h.load.mockResolvedValue(d);
  render(<Autopilot organizationId={ORG} workspaceId={WS} accounts={props.accounts ?? ACCOUNTS} content={props.content ?? []} canEdit={props.canEdit ?? true} userId="u1" onChanged={onChanged} onDelete={onDelete} />);
  await screen.findByRole('region', { name: 'Autopilot' });
}

beforeEach(() => {
  for (const f of [h.load, h.save, h.ready, h.run, h.approve, h.remake, h.improve, h.learn, h.saveText, h.setMedia, h.upload, h.trends, h.toast.success, h.toast.error, h.toast.warning, onChanged, onDelete]) f.mockReset();
  for (const f of [h.remake, h.improve, h.saveText, h.setMedia]) f.mockResolvedValue(undefined);
  h.ready.mockResolvedValue({ writing: true, media: true, posting: true });
  h.save.mockResolvedValue({ customKept: true });
  h.trends.mockResolvedValue(undefined);
  h.approve.mockResolvedValue(undefined);
  h.internals.visible = false;
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('the switch', () => {
  it('shows that it is off, and what switching it on would do', async () => {
    await open(data({ saved: false, settings: settings() }));
    const head = screen.getByRole('region', { name: 'Autopilot' });
    expect(within(head).getByText('Off')).toBeTruthy();
    expect(within(head).getByText('The autopilot does nothing.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.getByText('Nothing here. Switch the autopilot on below.')).toBeTruthy();
  });

  it('cannot be switched on before the business is described', async () => {
    await open(data({ saved: false, settings: settings() }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ask me first' }));
    expect(screen.getByRole('alert').textContent).toContain('Say in a sentence or two what your business does');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your business'), { target: { value: 'Harbour Dental is a family dentist in Leeds.' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0].slice(0, 2)).toEqual([ORG, WS]);
    expect(h.save.mock.calls[0][2]).toMatchObject({ mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.', postsPerWeek: 4, formats: ['image', 'video'] });
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved. The autopilot starts within five minutes.'));
  });

  it('asks once more before it posts with nobody checking', async () => {
    await open(data());
    fireEvent.click(screen.getByRole('radio', { name: 'Fully automatic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('with nobody checking');
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, post by itself' }));
    await waitFor(() => expect(h.save.mock.calls[0]?.[2]).toMatchObject({ mode: 'auto' }));
  });

  it('is not asked again by somebody who already runs it fully automatic', async () => {
    await open(data({ settings: settings({ mode: 'auto', brief: 'Harbour Dental is a family dentist in Leeds.' }) }));
    fireEvent.change(screen.getByLabelText('Posts each week'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save.mock.calls[0]?.[2]).toMatchObject({ mode: 'auto', postsPerWeek: 6 }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is the owner’s and the admins’ alone', async () => {
    await open(data(), { canEdit: false });
    expect(screen.getByText('Only the owner or an admin can change the autopilot.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
  });
});

describe('the settings', () => {
  it('offers only connected accounts, and asks the TikTok question only when there is a TikTok account', async () => {
    await open(data());
    const form = screen.getByRole('region', { name: 'Autopilot settings' });
    expect(within(form).getByLabelText('Instagram: Harbour Dental')).toBeTruthy();
    expect(within(form).queryByLabelText('Facebook: Old page')).toBeNull();
    expect(within(form).getByLabelText('Who can see its TikTok videos')).toBeTruthy();
    cleanup();
    await open(data(), { accounts: [ACCOUNTS[0]] });
    expect(screen.queryByLabelText('Who can see its TikTok videos')).toBeNull();
  });

  it('keeps "every account" as that, so an account connected later is used too', async () => {
    await open(data());
    fireEvent.click(screen.getByLabelText('TikTok: harbourdental'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save.mock.calls[0]?.[2]).toMatchObject({ accountIds: ['a1'] }));
    fireEvent.click(await screen.findByLabelText('TikTok: harbourdental'));
  });

  it('says what a month can cost at most', () => {
    expect(monthlyMediaCeiling(settings({ postsPerWeek: 4, formats: ['image', 'video'], voice: 'mixed' }))).toBe(2160);
    expect(monthlyMediaCeiling(settings({ postsPerWeek: 4, formats: ['video'], voice: 'without' }))).toBe(1440);
    expect(monthlyMediaCeiling(settings({ postsPerWeek: 7, formats: ['image'] }))).toBe(32);
  });
});

describe('posts that wait for a yes', () => {
  const two = [post('p1'), post('p2', { accountId: 'a2' }), post('p3', { postGroupId: 'g2', title: 'Meet the team', scheduledAt: new Date('2026-11-27T12:00:00Z') })];

  it('shows each idea once, with where it goes and what it tries', async () => {
    await open(data(), { content: two });
    const waiting = screen.getByRole('region', { name: 'Waiting for your yes' });
    const items = within(waiting).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Three brushing mistakes');
    expect(items[0].textContent).toContain('Instagram, TikTok');
    expect(items[0].textContent).toContain('It tries: A question as the opening line');
  });

  it('approves every post of the idea with one press', async () => {
    await open(data(), { content: two });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Three brushing mistakes' }));
    await waitFor(() => expect(h.approve).toHaveBeenCalledTimes(1));
    expect(h.approve.mock.calls[0][0].map((p: SocialContent) => p.id)).toEqual(['p1', 'p2']);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(h.toast.success).toHaveBeenCalledWith('Approved. It goes out at its time.');
  });

  it('deletes an idea that is not wanted', async () => {
    await open(data(), { content: two });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Meet the team' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete.mock.calls[0][0].map((p: SocialContent) => p.id)).toEqual(['p3']);
  });

  it('shows what is still being made, what is ready to go, and a post whose picture could not be made', async () => {
    await open(data({ jobs: { waiting: 1, running: 1, done: 0, failed: 0 } }), { content: [
      post('d1', { status: 'draft', media: null, postGroupId: 'g3', title: 'A tip video', idea: { ...(post('x').idea as NonNullable<SocialContent['idea']>), format: 'video' } }),
      post('d2', { status: 'draft', media: null, postGroupId: 'g4', title: 'No picture', lastError: 'The picture or video for this post could not be made. Add your own, or delete the post.' }),
      post('s1', { status: 'scheduled', postGroupId: 'g5', title: 'Ready to go' }),
    ] });
    const planned = screen.getByRole('region', { name: 'Planned posts' });
    expect(within(planned).getByText('Video being made')).toBeTruthy();
    expect(within(planned).getByText(/could not be made/)).toBeTruthy();
    expect(within(planned).getByText(/^Goes out/)).toBeTruthy();
    // The figure at the top counts what the maker is working on and what waits for its turn.
    const beingMade = [...document.querySelectorAll('dl > div')].find((cell) => cell.querySelector('dt')?.textContent === 'Being made');
    expect([...(beingMade?.querySelectorAll('dd') ?? [])].map((dd) => dd.textContent)).toEqual(['2', 'pictures and videos']);
    expect(screen.getByText('Nothing yet. The posts below are getting their picture or video first.')).toBeTruthy();
  });

  it('does not list posts a person made', async () => {
    await open(data(), { content: [post('m1', { origin: 'person', idea: null, title: 'My own post' })] });
    expect(screen.queryByText('My own post')).toBeNull();
  });
});

describe('changing a post before it goes out', () => {
  const video = { ...(post('x').idea as NonNullable<SocialContent['idea']>), format: 'video' as const, spoken: 'Brush softly.' };
  const waiting = [post('p1'), post('p2', { accountId: 'a2' })];
  const openEdit = async (content: SocialContent[] = waiting) => {
    await open(data(), { content });
    fireEvent.click(screen.getByRole('button', { name: 'Change Three brushing mistakes' }));
    return screen.findByRole('dialog');
  };

  it('opens with the words and the time of the post', async () => {
    const dialog = await openEdit();
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('Three brushing mistakes');
    expect((within(dialog).getByLabelText('Text') as HTMLTextAreaElement).value).toBe('Most people brush too hard.');
    expect((within(dialog).getByLabelText('Tags') as HTMLInputElement).value).toBe('dental');
    expect((within(dialog).getByLabelText('Goes out at') as HTMLInputElement).value).toBe(toLocalInput(new Date('2026-11-25T18:00:00Z')));
  });

  it('saves changed words for every account the idea goes to', async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'Are you brushing too hard?' } });
    fireEvent.change(within(dialog).getByLabelText('Tags'), { target: { value: '#dental, gentle care' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.saveText).toHaveBeenCalledTimes(1));
    expect(h.saveText.mock.calls[0][0].map((p: SocialContent) => p.id)).toEqual(['p1', 'p2']);
    expect(h.saveText.mock.calls[0][2]).toMatchObject({ title: 'Three brushing mistakes', caption: 'Are you brushing too hard?', tags: ['dental', 'gentle care'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChanged).toHaveBeenCalled();
  });

  it('has the picture made again with what should be different', async () => {
    const dialog = await openEdit();
    expect(within(dialog).queryByLabelText('Words the voice says')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('What should be different?'), { target: { value: 'Show the whole team' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make it again' }));
    await waitFor(() => expect(h.remake).toHaveBeenCalledWith(WS, 'g1', 'Show the whole team', undefined));
    expect(h.toast.success).toHaveBeenCalledWith('The picture is being made again. The post comes back when it is ready.');
  });

  it('lets the voice of a video be changed or taken away', async () => {
    const dialog = await openEdit([post('p1', { idea: video })]);
    const voice = within(dialog).getByLabelText('Words the voice says') as HTMLInputElement;
    expect(voice.value).toBe('Brush softly.');
    fireEvent.change(voice, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make it again' }));
    await waitFor(() => expect(h.remake).toHaveBeenCalledWith(WS, 'g1', '', ''));
  });

  it('takes the person’s own file instead', async () => {
    h.upload.mockResolvedValue({ url: 'https://files.example/own.jpg', kind: 'image', mime: 'image/jpeg', bytes: 9, name: 'own.jpg' });
    const dialog = await openEdit([post('p1')]);
    const file = new File(['x'], 'own.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(dialog).getByLabelText('Choose your own picture or video'), { target: { files: [file] } });
    await waitFor(() => expect(h.setMedia).toHaveBeenCalledTimes(1));
    expect(h.upload).toHaveBeenCalledWith(WS, file);
    expect(h.setMedia.mock.calls[0][1]).toMatchObject({ url: 'https://files.example/own.jpg' });
    expect(h.toast.success).toHaveBeenCalledWith('Your file is on the post.');
  });

  it('refuses a picture where a platform needs a video, before anything is uploaded', async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText('Choose your own picture or video'), { target: { files: [new File(['x'], 'own.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('TikTok needs a video. Choose a video, or make the picture again.'));
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('knows which files fit', () => {
    const jpg = { type: 'image/jpeg', size: 10 };
    expect(ownFileProblem(jpg, [post('p1')], ACCOUNTS)).toBeNull();
    expect(ownFileProblem({ type: 'image/png', size: 10 }, [post('p1')], ACCOUNTS)).toBe('Instagram takes JPEG pictures only. Save the picture as a JPEG and choose it again.');
    expect(ownFileProblem({ type: 'video/mp4', size: 10 }, waiting, ACCOUNTS)).toBeNull();
    expect(ownFileProblem({ type: 'application/pdf', size: 10 }, waiting, ACCOUNTS)).toBe('Choose a picture or a video.');
  });

  it('offers only the own file when pictures and videos cannot be made here', async () => {
    h.ready.mockResolvedValue({ writing: true, media: false, posting: true });
    const dialog = await openEdit([post('p1')]);
    expect(within(dialog).queryByRole('button', { name: 'Make it again' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Use my own file' })).toBeTruthy();
  });

  it('is not offered to somebody who cannot change the autopilot', async () => {
    await open(data(), { content: waiting, canEdit: false });
    expect(screen.queryByRole('button', { name: 'Change Three brushing mistakes' })).toBeNull();
  });

  it('keeps who can see a video and YouTube’s answers when the words change', () => {
    const shared = { title: 'New title', text: 'New words', tags: ['a'] };
    expect(retextOptions('tiktok', { caption: 'Old', privacy: 'SELF_ONLY', brandOrganic: true, allowComment: false }, shared))
      .toMatchObject({ caption: 'New title\n\nNew words\n\n#a', privacy: 'SELF_ONLY', brandOrganic: true, allowComment: false });
    expect(retextOptions('youtube', { title: 'Old', madeForKids: false, privacy: 'unlisted', categoryId: '27' }, shared))
      .toMatchObject({ title: 'New title', description: 'New words', tags: ['a'], madeForKids: false, privacy: 'unlisted', categoryId: '27' });
    expect(retextOptions('x', { text: 'Old' }, shared)).toEqual({ text: 'New title\n\n#a' });
  });
});

describe('the website, the days and the times', () => {
  it('fills the form from the website, and saves what the website said with it', async () => {
    h.learn.mockResolvedValue({ brief: 'Harbour Dental is a family dentist in Leeds. It offers check-ups and whitening.', audience: 'Families in Leeds', tone: 'Friendly', language: 'English', notes: 'Check-ups from £45.' });
    await open(data({ saved: false, settings: settings() }));
    const button = screen.getByRole('button', { name: 'Fill in from my website' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your website'), { target: { value: 'harbourdental.co.uk' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Filled in from your website. Check it, then press Save.'));
    expect(h.learn).toHaveBeenCalledWith(WS, 'harbourdental.co.uk');
    expect((screen.getByLabelText('Your business') as HTMLTextAreaElement).value).toContain('family dentist in Leeds');
    expect((screen.getByLabelText('Who you want to reach') as HTMLInputElement).value).toBe('Families in Leeds');
    // Nothing is saved until the owner has looked at it.
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Ask me first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][2]).toMatchObject({ website: 'harbourdental.co.uk', mode: 'ask' });
    expect(h.save.mock.calls[0][4]).toEqual({ siteNotes: 'Check-ups from £45.' });
  });

  it('says so in plain words when the website cannot be read, and keeps what was typed', async () => {
    h.learn.mockRejectedValue(new Error('That website could not be read. Check the address, or write about your business yourself.'));
    await open(data());
    fireEvent.change(screen.getByLabelText('Your website'), { target: { value: 'harbourdental.co.uk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill in from my website' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('That website could not be read. Check the address, or write about your business yourself.'));
    expect((screen.getByLabelText('Your business') as HTMLTextAreaElement).value).toBe('Harbour Dental is a family dentist in Leeds.');
  });

  it('will not save an address that is not a website', async () => {
    await open(data());
    fireEvent.change(screen.getByLabelText('Your website'), { target: { value: 'my shop' } });
    expect(screen.getByRole('alert').textContent).toContain('The website address does not look right');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the days and times the owner posts on', async () => {
    await open(data());
    fireEvent.click(screen.getByLabelText('Saturday'));
    fireEvent.click(screen.getByLabelText('Sunday'));
    fireEvent.change(screen.getByLabelText('Times it may post at'), { target: { value: '18:30, 9.00, later' } });
    expect(screen.getByText('It posts only at: 09:00, 18:30.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save.mock.calls[0]?.[2]).toMatchObject({ postDays: [1, 2, 3, 4, 5], postTimes: ['09:00', '18:30'] }));
  });

  it('can switch the second try off', async () => {
    await open(data());
    fireEvent.click(screen.getByLabelText(/When one of its posts does weakly/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save.mock.calls[0]?.[2]).toMatchObject({ retryWeak: false }));
  });

  it('shows what it read on the website', async () => {
    await open(data({ siteNotes: 'Check-ups from £45. Open Monday to Saturday.' }));
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    fireEvent.click(within(learned).getByRole('tab', { name: 'Your website' }));
    expect(within(learned).getByText('Check-ups from £45. Open Monday to Saturday.')).toBeTruthy();
  });
});

describe('a second try for a post that is out', () => {
  const feed = (id: string, views: number, contentId: string | null = null): FeedPost => ({
    id, accountId: 'a1', platform: 'instagram', url: '', caption: '', kind: 'image', postedAt: '2026-11-10T18:00:00Z', contentId, views, likes: 1, comments: 0, shares: 0, saves: 0, reach: 0,
  });
  const out = (over: Partial<SocialContent> = {}) => post('pub1', { status: 'published', title: 'A tip video', ...over });

  it('is made when the owner asks', async () => {
    await open(data({ feed: [feed('f1', 20, 'pub1'), feed('f2', 100), feed('f3', 120), feed('f4', 80)] }), { content: [out()] });
    fireEvent.click(screen.getByRole('button', { name: 'Second try for A tip video' }));
    await waitFor(() => expect(h.improve).toHaveBeenCalledWith(WS, 'pub1'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('A better version is being made. It appears above when it is ready.'));
  });

  it('is offered once: not for a post that had one, and not for a second try itself', async () => {
    const idea = post('x').idea as NonNullable<SocialContent['idea']>;
    await open(data({ feed: [feed('f1', 20, 'pub1'), feed('f2', 100, 'pub2')] }), { content: [out({ idea: { ...idea, retried: true } }), post('pub2', { status: 'published', title: 'The better one', postGroupId: 'g8', idea: { ...idea, improves: 'A tip video' } })] });
    expect(screen.getByText('Second try made')).toBeTruthy();
    expect(screen.getByText('This is a second try')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Second try for/ })).toBeNull();
  });

  it('says on a waiting post that it is the better version of a weak one', async () => {
    const idea = post('x').idea as NonNullable<SocialContent['idea']>;
    await open(data(), { content: [post('p9', { idea: { ...idea, improves: 'A tip video' } })] });
    expect(screen.getByText('A better version of “A tip video”, which did weakly.')).toBeTruthy();
  });
});

const TREND_WORDS = 'Short tip reels are doing well, so open your next reel with one tip from your own work.';

const note = (kind: 'study' | 'trends' | 'plan' | 'problem', title: string, body: string, d: Record<string, unknown> = {}) => ({ id: `${kind}-${title}`, kind, title, body, data: d, createdAt: '2026-11-24T10:00:00Z' });

describe('what it has learned', () => {

  it('shows the study, the trends and its rules', async () => {
    await open(data({
      playbook: 'Open with a question.',
      notes: [
        note('study', 'Study of your pages', 'Videos with a tip do best.', { working: ['Tip videos'], notWorking: ['Long captions'], changes: ['Shorter captions'], bestTimes: ['Instagram: Tuesday 18:00'] }),
        note('trends', 'What is working right now', TREND_WORDS),
      ],
    }));
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    // One thing at a time, each with the whole width: the study first.
    expect(within(learned).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your pages', 'Latest trends', 'Its rules']);
    expect(within(learned).getByRole('tab', { name: 'Your pages' }).getAttribute('aria-selected')).toBe('true');
    for (const words of ['Videos with a tip do best.', 'Tip videos', 'Long captions', 'Shorter captions', 'Instagram: Tuesday 18:00']) {
      expect(within(learned).getByText(words)).toBeTruthy();
    }
    for (const title of ['Working', 'Not working', 'What it changes', 'Best times']) expect(within(learned).getByRole('heading', { name: title })).toBeTruthy();
    fireEvent.click(within(learned).getByRole('tab', { name: 'Latest trends' }));
    expect(within(learned).getByText(TREND_WORDS)).toBeTruthy();
    expect(within(learned).queryByText('Videos with a tip do best.')).toBeNull();
    fireEvent.click(within(learned).getByRole('tab', { name: 'Its rules' }));
    expect(within(learned).getByText('Open with a question.')).toBeTruthy();
  });

  it('shows what was written as headings and points, never with the writing signs', async () => {
    await open(data({
      siteNotes: '**What it is and where**\nHarbour Dental is a family dentist in Leeds.\n\n**What it sells**\n- Check-ups from £45\n- **Whitening** for adults',
      notes: [note('trends', 'What is working right now', `YouTube\n- ${TREND_WORDS}\n- Titles with a number are opened more often.\n\nInstagram\n- Reels under 20 seconds are watched to the end.`)],
    }));
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    expect(within(learned).getByRole('heading', { name: 'YouTube' })).toBeTruthy();
    expect(within(learned).getByRole('heading', { name: 'Instagram' })).toBeTruthy();
    expect(within(learned).getAllByRole('listitem').map((li) => li.textContent)).toEqual([TREND_WORDS, 'Titles with a number are opened more often.', 'Reels under 20 seconds are watched to the end.']);
    fireEvent.click(within(learned).getByRole('tab', { name: 'Your website' }));
    expect(within(learned).getByRole('heading', { name: 'What it sells' })).toBeTruthy();
    expect(within(learned).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Check-ups from £45', 'Whitening for adults']);
    expect(learned.textContent).not.toContain('**');
  });

  it('reads the signs of a written note as what they mean', () => {
    expect(blocksOf('**What you can do now:**\n- Ask again later\n- Or check these places yourself:\n\nA last line.\nIt goes on here.')).toEqual([
      { kind: 'heading', text: 'What you can do now' },
      { kind: 'list', items: ['Ask again later', 'Or check these places yourself:'] },
      { kind: 'text', text: 'A last line. It goes on here.' },
    ]);
    expect(blocksOf('## Rules\n1. First\n2) Second')).toEqual([{ kind: 'heading', text: 'Rules' }, { kind: 'list', items: ['First', 'Second'] }]);
    // A playbook is short lines: each is a point of its own, also without a dash.
    expect(blocksOf('Open with a question.\nKeep captions short.\n- No feature demos.', 'rules')).toEqual([{ kind: 'list', items: ['Open with a question.', 'Keep captions short.', 'No feature demos.'] }]);
    // A sentence is not taken for a heading because it is short.
    expect(blocksOf('It works.\nAll of it.')).toEqual([{ kind: 'text', text: 'It works. All of it.' }]);
  });

  it('folds a long note away until it is asked for', async () => {
    await open(data({ siteNotes: `What it is and where\n- ${'A long line about the business. '.repeat(40)}` }));
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    fireEvent.click(within(learned).getByRole('tab', { name: 'Your website' }));
    const more = within(learned).getByRole('button', { name: 'Show all' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(learned).getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the latest trends', () => {
  const APOLOGY = "I couldn't find any current information for you this time. The web search tool hit its usage limit before it returned any results.\n\n**What you can do now:**\n- Ask me again later.";
  const openTrends = async (d: AutopilotData, props: Parameters<typeof open>[1] = {}) => {
    await open(d, props);
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    const tab = within(learned).queryByRole('tab', { name: 'Latest trends' });
    if (tab) fireEvent.click(tab);
    return learned;
  };

  it('never shows a search that found nothing as if it were trends', async () => {
    const learned = await openTrends(data({ notes: [note('trends', 'What is working right now', APOLOGY)] }));
    expect(learned.textContent).not.toContain('usage limit');
    expect(learned.textContent).not.toContain('What you can do now');
    expect(within(learned).getByText(/The last search on the web found nothing/)).toBeTruthy();
    expect(within(learned).getByRole('button', { name: 'Look up now' })).toBeTruthy();
  });

  it('looks them up when the owner asks, and shows them', async () => {
    const learned = await openTrends(data({ notes: [note('trends', 'What is working right now', APOLOGY)] }));
    h.load.mockResolvedValue(data({ notes: [note('trends', 'What is working right now', `YouTube\n- ${TREND_WORDS}`)] }));
    fireEvent.click(within(learned).getByRole('button', { name: 'Look up now' }));
    await waitFor(() => expect(h.trends).toHaveBeenCalledWith(WS));
    expect(await within(learned).findByText(TREND_WORDS)).toBeTruthy();
    expect(h.toast.success).toHaveBeenCalledWith('The latest trends are in.');
    expect(within(learned).getByRole('button', { name: 'Look up again' })).toBeTruthy();
  });

  it('says so in plain words when the search gives nothing again', async () => {
    const learned = await openTrends(data({ notes: [note('study', 'Study of your pages', 'Videos with a tip do best.')] }));
    expect(within(learned).getByText('No trends have been looked up yet.')).toBeTruthy();
    h.trends.mockRejectedValue(new Error('The search gave nothing this time. Please try again in a little while.'));
    fireEvent.click(within(learned).getByRole('button', { name: 'Look up now' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The search gave nothing this time. Please try again in a little while.'));
  });

  it('offers no look-up to somebody who cannot change the autopilot, or while it is off', async () => {
    const learned = await openTrends(data({ notes: [note('trends', 'What is working right now', `YouTube\n- ${TREND_WORDS}`)] }), { canEdit: false });
    expect(within(learned).queryByRole('button', { name: /Look up/ })).toBeNull();
    cleanup();
    const off = await openTrends(data({ settings: settings({ mode: 'off' }), notes: [note('trends', 'What is working right now', `YouTube\n- ${TREND_WORDS}`)] }));
    expect(within(off).queryByRole('button', { name: /Look up/ })).toBeNull();
    expect(within(off).getByText(TREND_WORDS)).toBeTruthy();
  });
});

describe('the owner’s own wishes', () => {
  it('start as "let it choose", and are saved with everything else', async () => {
    await open(data());
    expect((screen.getByLabelText('What the posts are for') as HTMLSelectElement).value).toBe('auto');
    fireEvent.change(screen.getByLabelText('What the posts are for'), { target: { value: 'leads' } });
    fireEvent.change(screen.getByLabelText('What people should do after a post'), { target: { value: 'Book a free check-up' } });
    fireEvent.change(screen.getByLabelText('Topics to post about'), { target: { value: 'Whitening, braces' } });
    fireEvent.change(screen.getByLabelText('Never post about, never say'), { target: { value: 'Other dentists' } });
    fireEvent.change(screen.getByLabelText('Link for the posts'), { target: { value: 'harbourdental.co.uk/book' } });
    fireEvent.change(screen.getByLabelText('Your own rules'), { target: { value: 'Always name Leeds.' } });
    fireEvent.change(screen.getByLabelText('Length of the text'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: 'none' } });
    fireEvent.change(screen.getByLabelText('Tags on every post'), { target: { value: '#HarbourDental, leeds' } });
    expect(screen.getByText('On every post: #HarbourDental #leeds. It adds its own tags after these.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Pictures or videos more often'), { target: { value: 'videos' } });
    fireEvent.change(screen.getByLabelText('How pictures and videos should look'), { target: { value: 'Bright and clean' } });
    fireEvent.change(screen.getByLabelText('Look up the latest trends'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][2].custom).toEqual({
      goal: 'leads', callToAction: 'Book a free check-up', topics: 'Whitening, braces', avoid: 'Other dentists', link: 'harbourdental.co.uk/book', rules: 'Always name Leeds.',
      captionLength: 'short', emoji: 'none', fixedTags: ['HarbourDental', 'leeds'], mix: 'videos', look: 'Bright and clean', trendsEveryDays: 1,
    });
  });

  it('shows what was saved before', async () => {
    await open(data({ settings: settings({ mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.', custom: { ...DEFAULT_CUSTOM, goal: 'sales', fixedTags: ['HarbourDental'], trendsEveryDays: 3 } }) }));
    expect((screen.getByLabelText('What the posts are for') as HTMLSelectElement).value).toBe('sales');
    expect((screen.getByLabelText('Tags on every post') as HTMLInputElement).value).toBe('#HarbourDental');
    expect((screen.getByLabelText('Look up the latest trends') as HTMLSelectElement).value).toBe('3');
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('will not save a link that is not one', async () => {
    await open(data());
    fireEvent.change(screen.getByLabelText('Link for the posts'), { target: { value: 'book now' } });
    expect(screen.getByRole('alert').textContent).toContain('The link for the posts does not look right.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cannot choose pictures or videos more often when only one kind is made', async () => {
    await open(data({ settings: settings({ mode: 'ask', brief: 'Harbour Dental is a family dentist in Leeds.', formats: ['image'] }) }));
    expect((screen.getByLabelText('Pictures or videos more often') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Voice in videos') as HTMLSelectElement).disabled).toBe(true);
  });

  it('says so when the database cannot keep them yet: one neutral sentence, or the step for the people who run the site', async () => {
    h.save.mockResolvedValue({ customKept: false });
    await open(data());
    expect(screen.queryByText(/cannot be kept yet/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith('Saved, but the newer options could not be kept yet. See the note in the settings.'));
    const hint = await screen.findByText(/cannot be kept yet/);
    expect(hint.textContent).toContain('Please ask the person who set up the site to finish the latest update.');
    expect(hint.textContent).not.toContain('supabase');
    cleanup();
    h.internals.visible = true;
    await open(data({ customReady: false }));
    expect(screen.getByText(/cannot be kept yet/).textContent).toContain('Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.');
  });
});

describe('the figures at the top', () => {
  it('counts what waits, what is planned and what is being made, and what was spent', async () => {
    await open(data({ spentCents: 450, jobs: { waiting: 0, running: 1, done: 3, failed: 0 } }), { content: [post('w1', { postGroupId: 'g1' }), post('s1', { postGroupId: 'g2', status: 'scheduled' })] });
    const figures = Object.fromEntries([...document.querySelectorAll('dl > div')].map((cell) => [cell.querySelector('dt')?.textContent, cell.querySelector('dd')?.textContent]));
    expect(figures).toEqual({ 'Waiting for your yes': '1', 'Planned to go out': '1', 'Being made': '1', 'Spent this month': '$4.50' });
  });

  it('are left out while the autopilot is off', async () => {
    await open(data({ settings: settings({ mode: 'off' }) }));
    expect(document.querySelector('dl')).toBeNull();
  });
});

describe('how its posts did', () => {
  it('puts what needs the owner at the top', async () => {
    await open(data({ notes: [note('problem', 'Connect Harbour Dental again', 'Open the Accounts tab and connect it again.')] }));
    const top = screen.getByRole('region', { name: 'Needs your attention' });
    expect(within(top).getByText('Connect Harbour Dental again')).toBeTruthy();
  });

  it('compares each of its posts with the usual post of the same page', async () => {
    const feed = (id: string, views: number, contentId: string | null = null): FeedPost => ({
      id, accountId: 'a1', platform: 'instagram', url: `https://www.instagram.com/p/${id}`, caption: '', kind: 'image', postedAt: '2026-11-10T18:00:00Z', contentId,
      views, likes: 12, comments: 2, shares: 1, saves: 0, reach: 0,
    });
    await open(data({ feed: [feed('f1', 400, 'pub1'), feed('f2', 100), feed('f3', 120), feed('f4', 80)] }), { content: [post('pub1', { status: 'published', title: 'A tip video' })] });
    const results = screen.getByRole('region', { name: 'How its posts did' });
    const row = within(results).getByText('A tip video').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('400');
    expect(row.textContent).toContain('15');
    expect(row.textContent).toContain('A question as the opening line');
    expect(within(row).getByText('Better than usual')).toBeTruthy();
  });

  it('says how many posts are on record when none of its own has gone out', async () => {
    const feed: FeedPost = { id: 'f1', accountId: 'a1', platform: 'instagram', url: '', caption: '', kind: '', postedAt: null, contentId: null, views: 1, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0 };
    await open(data({ feed: [feed] }));
    expect(screen.getByText(/The numbers of 1 post on your pages are on record/)).toBeTruthy();
  });
});

describe('what a person may read about the set-up', () => {
  it('says that a part is not switched on, without naming any setting', async () => {
    h.ready.mockResolvedValue({ writing: true, media: false, posting: true });
    await open(data());
    const box = await screen.findByRole('status');
    expect(box.textContent).toContain('Making pictures and videos.');
    expect(box.textContent).not.toMatch(/RUNWAY|API|Vercel|KEY/);
  });

  it('tells the people who run the site which setting is missing', async () => {
    h.internals.visible = true;
    h.ready.mockResolvedValue({ writing: false, media: false, posting: true });
    await open(data());
    const box = await screen.findByRole('status');
    expect(box.textContent).toContain('RUNWAYML_API_SECRET');
    expect(box.textContent).toContain('ANTHROPIC_API_KEY');
    expect(box.textContent).not.toContain('POST_FOR_ME_API_KEY');
  });

  it('gives one neutral sentence when the database is not ready', async () => {
    // Somebody who does not run the site.
    setInternalsVisible(false);
    h.load.mockRejectedValue(new Error('The autopilot is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.'));
    render(<Autopilot organizationId={ORG} workspaceId={WS} accounts={ACCOUNTS} content={[]} canEdit userId="u1" onChanged={onChanged} onDelete={onDelete} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This is not switched on yet. Please contact support.');
  });

  it('tells the people who run the site to run the SQL', async () => {
    setInternalsVisible(true);
    h.load.mockRejectedValue(new Error('The autopilot is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.'));
    render(<Autopilot organizationId={ORG} workspaceId={WS} accounts={ACCOUNTS} content={[]} canEdit userId="u1" onChanged={onChanged} onDelete={onDelete} />);
    expect((await screen.findByRole('alert')).textContent).toContain('supabase/crm_setup.sql');
  });
});

describe('Run now', () => {
  it('runs once and says what was done', async () => {
    h.run.mockResolvedValue({ did: ['read your pages', 'looked up the latest trends'], next: '' });
    await open(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Done: read your pages, looked up the latest trends.'));
    expect(h.run).toHaveBeenCalledWith(WS);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalled();
  });

  it('presses on by itself while more is due, and says everything it did at the end', async () => {
    h.run
      .mockResolvedValueOnce({ did: ['read your pages', 'looked up the latest trends'], next: '', more: true })
      .mockResolvedValueOnce({ did: ['looked at your pages: too few posts with numbers to learn from yet'], next: '', more: true })
      .mockResolvedValueOnce({ did: ['planned 4 posts'], next: '', more: false });
    await open(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    // While it works, the page says how far it has come.
    expect(await screen.findByText(/Done so far: read your pages, looked up the latest trends/)).toBeTruthy();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(
      'Done: read your pages, looked up the latest trends, looked at your pages: too few posts with numbers to learn from yet, planned 4 posts. The pictures and videos are being made now. The posts appear here when they are ready, in a few minutes.',
    ));
    expect(h.run).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Done so far/)).toBeNull();
  });

  it('says what stopped it, after what it did', async () => {
    h.run
      .mockResolvedValueOnce({ did: ['read your pages'], next: '', more: true })
      .mockResolvedValueOnce({ did: [], next: 'No account to post to. Connect at least one social account on the Accounts tab.', more: false });
    await open(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Done: read your pages. No account to post to. Connect at least one social account on the Accounts tab.'));
  });

  it('does not press on for ever', async () => {
    h.run.mockResolvedValue({ did: ['read your pages'], next: '', more: true });
    await open(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(h.run.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it('says so when nothing was due, and never shows a raw error', async () => {
    h.run.mockResolvedValue({ did: [], next: 'Nothing was due just now. The autopilot looks again every five minutes.' });
    await open(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Nothing was due just now. The autopilot looks again every five minutes.'));
    h.run.mockRejectedValue(new Error('relation "public.social_autopilot" does not exist'));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The autopilot could not run just now. Please try again.'));
  });
});
