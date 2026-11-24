// The Autopilot tab of the Social page: the switch, the posts that wait for a
// yes, what the autopilot has learned, how its posts did, and its settings.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AutopilotData } from '@/services/social/autopilot';
import type { SocialAccount, SocialContent } from '@/types/social';
import { DEFAULT_SETTINGS, type AutopilotSettings, type FeedPost } from '../../../api/_social/shared/autopilot';
import { setInternalsVisible } from '@/lib/publicError';

const h = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), ready: vi.fn(), run: vi.fn(), approve: vi.fn(),
  remake: vi.fn(), improve: vi.fn(), learn: vi.fn(), saveText: vi.fn(), setMedia: vi.fn(), upload: vi.fn(),
  internals: { visible: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useInternalsVisible', () => ({ useInternalsVisible: () => h.internals.visible }));
vi.mock('@/services/social/autopilot', async (original) => ({
  ...(await original<typeof import('@/services/social/autopilot')>()),
  loadAutopilot: h.load, saveAutopilot: h.save, autopilotReady: h.ready, runAutopilot: h.run, approveAutopilotPosts: h.approve,
  remakeAutopilotMedia: h.remake, improveAutopilotPost: h.improve, learnFromWebsite: h.learn, saveAutopilotText: h.saveText, setAutopilotMedia: h.setMedia,
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
  jobs: { waiting: 0, running: 0, done: 0, failed: 0 }, spentCents: 0, ...over,
});

const onChanged = vi.fn();
const onDelete = vi.fn();

async function open(d: AutopilotData, props: { content?: SocialContent[]; canEdit?: boolean; accounts?: SocialAccount[] } = {}) {
  h.load.mockResolvedValue(d);
  render(<Autopilot organizationId={ORG} workspaceId={WS} accounts={props.accounts ?? ACCOUNTS} content={props.content ?? []} canEdit={props.canEdit ?? true} userId="u1" onChanged={onChanged} onDelete={onDelete} />);
  await screen.findByRole('region', { name: 'Autopilot' });
}

beforeEach(() => {
  for (const f of [h.load, h.save, h.ready, h.run, h.approve, h.remake, h.improve, h.learn, h.saveText, h.setMedia, h.upload, h.toast.success, h.toast.error, onChanged, onDelete]) f.mockReset();
  for (const f of [h.remake, h.improve, h.saveText, h.setMedia]) f.mockResolvedValue(undefined);
  h.ready.mockResolvedValue({ writing: true, media: true, posting: true });
  h.save.mockResolvedValue(undefined);
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
    expect(screen.getByText(/2 pictures and videos are being made/)).toBeTruthy();
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
    expect(within(screen.getByRole('region', { name: 'What it has learned' })).getByText('Check-ups from £45. Open Monday to Saturday.')).toBeTruthy();
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

describe('what it has learned and how its posts did', () => {
  const note = (kind: 'study' | 'trends' | 'plan' | 'problem', title: string, body: string, d: Record<string, unknown> = {}) => ({ id: `${kind}-${title}`, kind, title, body, data: d, createdAt: '2026-11-24T10:00:00Z' });

  it('shows the study, the trends and its rules', async () => {
    await open(data({
      playbook: 'Open with a question.',
      notes: [
        note('study', 'Study of your pages', 'Videos with a tip do best.', { working: ['Tip videos'], notWorking: ['Long captions'], changes: ['Shorter captions'], bestTimes: ['Instagram: Tuesday 18:00'] }),
        note('trends', 'What is working right now', 'Short tip reels are doing well.'),
      ],
    }));
    const learned = screen.getByRole('region', { name: 'What it has learned' });
    for (const words of ['Videos with a tip do best.', 'Tip videos', 'Long captions', 'Shorter captions', 'Instagram: Tuesday 18:00', 'Short tip reels are doing well.', 'Open with a question.']) {
      expect(within(learned).getByText(words)).toBeTruthy();
    }
  });

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
