// The composer: one file, one text, one press, every account, with each
// platform asking for what it needs.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SocialAccount, SocialContent } from '@/types/social';
import type { PostMedia } from '../../../api/_social/shared/platforms';

const h = vi.hoisted(() => ({
  uploadSocialMedia: vi.fn(),
  removeSocialMedia: vi.fn(async () => {}),
  createSocialPosts: vi.fn(async () => 'group-1'),
  runSocialPublish: vi.fn(async () => {}),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/social', () => ({
  uploadSocialMedia: h.uploadSocialMedia,
  removeSocialMedia: h.removeSocialMedia,
  createSocialPosts: h.createSocialPosts,
  runSocialPublish: h.runSocialPublish,
}));

import { SocialComposer } from '@/components/social/SocialComposer';
import { fileProblem, groupPosts, groupSummary, isOnItsWay, postTitle } from '@/lib/socialCompose';

const account = (id: string, provider: SocialAccount['provider'], displayName: string, status: SocialAccount['status'] = 'connected'): SocialAccount => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', provider, displayName, externalAccountId: 'ext', status, lastError: null, createdAt: new Date('2026-11-01'),
});
const ALL = [
  account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio'),
  account('fb', 'facebook', 'Northwind Studio'), account('x', 'x', '@northwind'),
];
const VIDEO: PostMedia = { url: 'https://abc.supabase.co/storage/v1/object/public/social-media/ws-1/clip.mp4', kind: 'video', mime: 'video/mp4', bytes: 12_500_000, name: 'clip.mp4' };
const PHOTO: PostMedia = { url: 'https://abc.supabase.co/storage/v1/object/public/social-media/ws-1/photo.jpg', kind: 'image', mime: 'image/jpeg', bytes: 400_000, name: 'photo.jpg' };

const onPosted = vi.fn();
const onOpenChange = vi.fn();
const onAddAccount = vi.fn();
const show = (accounts: SocialAccount[] = ALL) => render(
  <SocialComposer open onOpenChange={onOpenChange} organizationId="org-1" workspaceId="ws-1" userId="u1" accounts={accounts} onPosted={onPosted} onAddAccount={onAddAccount} />,
);
const upload = async (media: PostMedia) => {
  h.uploadSocialMedia.mockResolvedValue(media);
  const file = new File(['x'], media.name, { type: media.mime });
  fireEvent.change(screen.getByLabelText('Choose a picture or video'), { target: { files: [file] } });
  await screen.findByText(media.name);
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const part = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name}:`) });
const postButton = () => screen.getByRole('button', { name: /^(Post|Schedule) to / }) as HTMLButtonElement;
const choose = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};
/** Fill in what every platform needs for a video. */
const makeReady = async () => {
  await upload(VIDEO);
  type('Title', 'Five tips for a brighter smile');
  type('Text', 'Our dentist explains what works.');
  type('Tags', 'dental care, tips');
  fireEvent.click(within(part('YouTube')).getByRole('radio', { name: 'No, it is not made for kids' }));
  await choose('Who can see this video', 'Everyone');
};

beforeEach(() => {
  for (const fn of [h.uploadSocialMedia, h.removeSocialMedia, h.createSocialPosts, h.runSocialPublish, h.toast.success, h.toast.error, onPosted, onOpenChange, onAddAccount]) fn.mockClear();
  h.createSocialPosts.mockResolvedValue('group-1');
  h.runSocialPublish.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('one press, every account', () => {
  it('starts with every connected account ticked', () => {
    show();
    for (const name of ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X']) {
      expect((within(part(name)).getByRole('checkbox', { name: new RegExp(`^Post to ${name} `) }) as HTMLInputElement).checked).toBe(true);
    }
    expect(postButton().textContent).toContain('Post to 5 accounts');
  });

  it('says what each platform still needs, and does not post until it has it', async () => {
    show();
    await upload(VIDEO);
    type('Title', 'Five tips for a brighter smile');
    expect(within(part('YouTube')).getByText('Say whether the video is made for kids. YouTube asks this of every video.')).toBeTruthy();
    expect(within(part('TikTok')).getByText('Choose who can see the video on TikTok.')).toBeTruthy();
    expect(within(part('Instagram')).getByText(/Ready · Posted as a Reel/)).toBeTruthy();
    expect(postButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Still missing for YouTube, TikTok.');
    expect(h.createSocialPosts).not.toHaveBeenCalled();
  });

  it('posts to all of them at once, each with its own fields made from what was written once', async () => {
    show();
    await makeReady();
    expect(screen.getByRole('status').textContent).toBe('Everything each platform needs is filled in.');
    fireEvent.click(postButton());
    await waitFor(() => expect(h.createSocialPosts).toHaveBeenCalledTimes(1));
    const sent = h.createSocialPosts.mock.calls[0]![0] as unknown as { title: string; body: string; media: PostMedia; scheduledAt?: Date; posts: Array<{ accountId: string; options: Record<string, unknown> }> };
    expect(sent).toMatchObject({ organizationId: 'org-1', workspaceId: 'ws-1', userId: 'u1', title: 'Five tips for a brighter smile', body: 'Our dentist explains what works.', media: VIDEO });
    expect(sent.scheduledAt).toBeUndefined();
    const of = (id: string) => sent.posts.find((p) => p.accountId === id)!.options;
    expect(sent.posts.map((p) => p.accountId)).toEqual(['yt', 'tt', 'ig', 'fb', 'x']);
    expect(of('yt')).toMatchObject({ title: 'Five tips for a brighter smile', description: 'Our dentist explains what works.', tags: ['dental care', 'tips'], madeForKids: false, privacy: 'public' });
    expect(of('tt')).toMatchObject({ privacy: 'PUBLIC_TO_EVERYONE', caption: 'Five tips for a brighter smile\n\nOur dentist explains what works.\n\n#dentalcare #tips' });
    expect(of('ig')).toMatchObject({ shareToFeed: true });
    expect(of('x')).toEqual({ text: 'Five tips for a brighter smile\n\n#dentalcare #tips' });
    // It is sent now, not at the next five-minute run, and the window closes.
    expect(h.runSocialPublish).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith('Posting to 5 accounts now. A video can take a few minutes.');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPosted).toHaveBeenCalled();
  });

  it('leaves out an account that is unticked', async () => {
    show();
    await makeReady();
    fireEvent.click(within(part('X')).getByRole('checkbox', { name: /^Post to X / }));
    fireEvent.click(postButton());
    await waitFor(() => expect(h.createSocialPosts).toHaveBeenCalled());
    const sent = h.createSocialPosts.mock.calls[0]![0] as unknown as { posts: Array<{ accountId: string }> };
    expect(sent.posts.map((p) => p.accountId)).toEqual(['yt', 'tt', 'ig', 'fb']);
  });
});

describe('each platform’s own part', () => {
  it('can be changed for that platform alone; the rest still follow what is written at the top', async () => {
    show();
    await makeReady();
    fireEvent.change(within(part('X')).getByLabelText('X text'), { target: { value: 'New video is up!' } });
    type('Title', 'Six tips for a brighter smile');
    expect((within(part('X')).getByLabelText('X text') as HTMLTextAreaElement).value).toBe('New video is up!');
    expect((within(part('YouTube')).getByLabelText('YouTube title') as HTMLInputElement).value).toBe('Six tips for a brighter smile');
  });

  it('counts the characters, and stops a post that is too long for a platform', async () => {
    show([account('x', 'x', '@northwind')]);
    fireEvent.change(screen.getByLabelText('X text'), { target: { value: 'y'.repeat(281) } });
    expect(within(part('X')).getByText('281 / 280')).toBeTruthy();
    expect(within(part('X')).getByText('The X post is 1 character too long (the limit is 280).')).toBeTruthy();
    expect(postButton().disabled).toBe(true);
  });

  it('tells YouTube and TikTok apart from the rest when the file is a picture', async () => {
    show();
    await upload(PHOTO);
    type('Text', 'Our new front desk.');
    expect(within(part('YouTube')).getByText('YouTube needs a video.')).toBeTruthy();
    expect(within(part('TikTok')).getByText('TikTok needs a video.')).toBeTruthy();
    expect(within(part('Instagram')).getByText(/Ready · Posted as a picture/)).toBeTruthy();
    // Untick the two that need a video: the picture goes to the other three.
    fireEvent.click(within(part('YouTube')).getByRole('checkbox', { name: /^Post to YouTube / }));
    fireEvent.click(within(part('TikTok')).getByRole('checkbox', { name: /^Post to TikTok / }));
    expect(postButton().disabled).toBe(false);
    expect(postButton().textContent).toContain('Post to 3 accounts');
  });

  it('asks nothing of the file for a text post to Facebook and X', () => {
    show([account('fb', 'facebook', 'Northwind Studio'), account('x', 'x', '@northwind')]);
    expect(postButton().disabled).toBe(true);
    type('Text', 'We are open on Saturday.');
    expect(postButton().disabled).toBe(false);
    expect(within(part('Facebook')).getByText(/Ready · Text post/)).toBeTruthy();
  });
});

describe('when', () => {
  it('can be later: the posts are scheduled and nothing is sent now', async () => {
    show([account('fb', 'facebook', 'Northwind Studio')]);
    type('Text', 'We are open on Saturday.');
    fireEvent.click(screen.getByRole('radio', { name: 'Later' }));
    expect(postButton().disabled).toBe(true);
    const later = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const local = new Date(later.getTime() - later.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText('Post at'), { target: { value: local } });
    expect(postButton().textContent).toContain('Schedule to 1 account');
    fireEvent.click(postButton());
    await waitFor(() => expect(h.createSocialPosts).toHaveBeenCalled());
    const sent = h.createSocialPosts.mock.calls[0]![0] as unknown as { scheduledAt: Date };
    expect(Math.abs(sent.scheduledAt.getTime() - later.getTime())).toBeLessThan(61_000);
    expect(h.runSocialPublish).not.toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith('Scheduled for 1 account.');
  });

  it('does not take a time that has passed', () => {
    show([account('fb', 'facebook', 'Northwind Studio')]);
    type('Text', 'Hello');
    fireEvent.click(screen.getByRole('radio', { name: 'Later' }));
    fireEvent.change(screen.getByLabelText('Post at'), { target: { value: '2020-01-01T10:00' } });
    expect(screen.getByText('Choose a time that is still to come.')).toBeTruthy();
    expect(postButton().disabled).toBe(true);
  });
});

describe('accounts and files that cannot be used', () => {
  it('does not post to an account that is not connected, and says so', () => {
    show([account('yt', 'youtube', 'Northwind channel', 'disconnected'), account('fb', 'facebook', 'Northwind Studio')]);
    const box = within(part('YouTube')).getByRole('checkbox', { name: /^Post to YouTube / }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(within(part('YouTube')).getByText('Not connected yet')).toBeTruthy();
    expect(postButton().textContent).toContain('1 account');
  });

  it('sends a person with no accounts to add one', () => {
    show([]);
    expect(screen.getByText(/No account to post to yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add an account' }));
    expect(onAddAccount).toHaveBeenCalled();
  });

  it('refuses a file that is not a picture or a video, and says so plainly when an upload fails', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Choose a picture or video'), { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    expect(h.toast.error).toHaveBeenCalledWith('Choose a picture or a video.');
    expect(h.uploadSocialMedia).not.toHaveBeenCalled();
    h.uploadSocialMedia.mockRejectedValue({ message: 'new row violates row-level security policy for table "objects"' });
    fireEvent.change(screen.getByLabelText('Choose a picture or video'), { target: { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
    expect(String(h.toast.error.mock.calls[1]![0])).not.toMatch(/row-level|objects/);
  });

  it('says so plainly when the post cannot be saved, and keeps the window open', async () => {
    h.createSocialPosts.mockRejectedValue({ message: 'column "post_group_id" of relation "social_content" does not exist' });
    show([account('fb', 'facebook', 'Northwind Studio')]);
    type('Text', 'Hello');
    fireEvent.click(postButton());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0]![0])).not.toMatch(/post_group_id|relation/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('the posts of one press, afterwards', () => {
  const row = (id: string, status: SocialContent['status'], over: Partial<SocialContent> = {}): SocialContent => ({
    id, organizationId: 'org-1', workspaceId: 'ws-1', campaignId: null, accountId: `acc-${id}`, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
    title: 'Five tips', body: '', status, scheduledAt: new Date('2026-11-23T10:00:00Z'), publishedAt: null, lastError: null, createdAt: new Date('2026-11-23T10:00:00Z'),
    postGroupId: 'g1', media: VIDEO, options: {}, ...over,
  });

  it('are shown together, and an older post stands alone', () => {
    const groups = groupPosts([row('a', 'published'), row('b', 'failed'), row('old', 'draft', { postGroupId: null, createdAt: new Date('2026-11-01') })]);
    expect(groups.map((g) => [g.id, g.posts.length])).toEqual([['g1', 2], ['old', 1]]);
  });

  it('are summed up in a few words', () => {
    const say = (...statuses: SocialContent['status'][]) => groupSummary(groupPosts(statuses.map((s, n) => row(String(n), s)))[0]);
    expect(say('published', 'published')).toBe('Posted everywhere');
    expect(say('published')).toBe('Posted');
    expect(say('published', 'failed', 'failed')).toBe('Posted to 1 of 3');
    expect(say('failed', 'failed')).toBe('Not posted');
    expect(say('published', 'publishing')).toBe('Posted to 1 of 2 so far');
    expect(say('publishing', 'scheduled')).toBe('Posting now');
    expect(say('scheduled')).toBe('Waiting to go out');
  });

  it('count as on their way while queued for now or being sent, not while scheduled for next week', () => {
    const now = new Date('2026-11-23T10:00:30Z').getTime();
    expect(isOnItsWay(row('a', 'publishing'), now)).toBe(true);
    expect(isOnItsWay(row('a', 'scheduled'), now)).toBe(true);
    expect(isOnItsWay(row('a', 'scheduled', { scheduledAt: new Date('2026-11-30T10:00:00Z') }), now)).toBe(false);
    expect(isOnItsWay(row('a', 'published'), now)).toBe(false);
  });

  it('are named by the title, else the first line, else the file', () => {
    expect(postTitle({ title: ' Five tips ', text: 'x', tags: [] }, null)).toBe('Five tips');
    expect(postTitle({ title: '', text: 'Opening day\nCome by.', tags: [] }, null)).toBe('Opening day');
    expect(postTitle({ title: '', text: '', tags: [] }, VIDEO)).toBe('clip.mp4');
    expect(fileProblem({ type: 'video/mp4', size: 0 })).toBe('This file is empty.');
    expect(fileProblem({ type: 'image/jpeg', size: 10 })).toBeNull();
  });
});
