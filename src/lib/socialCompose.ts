// The composer's own rules: what a chosen file is, what each account's part of
// the post holds, and how the posts of one press are shown together afterwards.
import {
  PLATFORM_NAME, isPlatform, postProblems, startingOptions,
  type Platform, type PlatformOptions, type PostMedia, type SharedText,
} from '../../api/_social/shared/platforms';
import type { SocialAccount, SocialContent } from '@/types/social';

/** The largest file the composer takes (the storage bucket's own limit). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm';

/** What kind of file was chosen, or why it cannot be used. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!/^(image|video)\//.test(file.type)) return 'Choose a picture or a video.';
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'This file is larger than 1 GB. Choose a smaller one.';
  return null;
}

export const mediaKind = (mime: string): 'image' | 'video' => (mime.startsWith('video/') ? 'video' : 'image');

/** An account the composer can post to: one of the platforms it knows. */
export type PostableAccount = SocialAccount & { provider: Platform };

export const postableAccounts = (accounts: SocialAccount[]): PostableAccount[] =>
  accounts.filter((a): a is PostableAccount => isPlatform(a.provider));

/** Fields the person changed by hand for one account. A field not in here still follows what was typed at the top. */
export type Overrides = Record<string, Record<string, unknown>>;

/** One account's part of the post: what was typed once, with what the person changed for this account on top. */
export function optionsFor<P extends Platform>(platform: P, shared: SharedText, changed: Record<string, unknown> | undefined): PlatformOptions[P] {
  return { ...startingOptions(platform, shared), ...(changed ?? {}) } as PlatformOptions[P];
}

/** The answers a platform asked for that are not text: they stay when the text of a post is changed. */
const KEPT: Record<Platform, string[]> = {
  youtube: ['categoryId', 'privacy', 'madeForKids', 'notifySubscribers'],
  tiktok: ['privacy', 'allowComment', 'allowDuet', 'allowStitch', 'brandOrganic', 'brandContent'],
  instagram: ['shareToFeed'],
  facebook: [], x: [], linkedin: [],
};

/** One account's part of a post, written again from changed text. Who can see it, the category and the like stay as they were. */
export function retextOptions(platform: Platform, old: Record<string, unknown>, shared: SharedText): Record<string, unknown> {
  const fresh = { ...startingOptions(platform, shared) } as Record<string, unknown>;
  for (const key of KEPT[platform]) if (key in old) fresh[key] = old[key];
  return fresh;
}

/** What is still missing for one account, as sentences. */
export const accountProblems = (account: PostableAccount, shared: SharedText, changed: Record<string, unknown> | undefined, media: PostMedia | null): string[] => {
  if (account.status !== 'connected') return [`${PLATFORM_NAME[account.provider]} is not connected yet. Connect it on the Accounts tab.`];
  return postProblems(account.provider, optionsFor(account.provider, shared, changed), media);
};

/** What a post is called in the library: its title, else its first line, else the file's name. */
export function postTitle(shared: SharedText, media: PostMedia | null): string {
  const title = shared.title.trim() || shared.text.trim().split('\n')[0] || media?.name || 'Post';
  return title.slice(0, 200);
}

/** The posts of one press, together. A post made before the composer is a group of one. */
export interface PostGroup {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  scheduledAt: Date | null;
  media: PostMedia | null;
  posts: SocialContent[];
}

export function groupPosts(content: SocialContent[]): PostGroup[] {
  const groups = new Map<string, PostGroup>();
  for (const post of content) {
    const id = post.postGroupId ?? post.id;
    const group = groups.get(id);
    if (group) group.posts.push(post);
    else groups.set(id, { id, title: post.title, body: post.body, createdAt: post.createdAt, scheduledAt: post.scheduledAt, media: post.media, posts: [post] });
  }
  return [...groups.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** True while a post is on its way out: queued for now, or being sent. */
export const isOnItsWay = (post: SocialContent, now: number): boolean =>
  post.status === 'publishing' || (post.status === 'scheduled' && (post.scheduledAt?.getTime() ?? 0) <= now + 60_000);

/** "Posted to 3 of 5", "Posted everywhere", "Waiting to go out": the state of one press in a few words. */
export function groupSummary(group: PostGroup): string {
  const total = group.posts.length;
  const posted = group.posts.filter((p) => p.status === 'published').length;
  const failed = group.posts.filter((p) => p.status === 'failed').length;
  if (posted === total) return total === 1 ? 'Posted' : 'Posted everywhere';
  if (failed === total) return 'Not posted';
  if (posted + failed === total) return `Posted to ${posted} of ${total}`;
  if (posted > 0) return `Posted to ${posted} of ${total} so far`;
  return group.posts.some((p) => p.status === 'publishing') ? 'Posting now' : 'Waiting to go out';
}
