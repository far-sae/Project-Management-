// The composer: upload a file once, write the post once, and send it to every
// connected account with one press. Each platform shows the boxes it needs
// (a YouTube title, who can see a TikTok, ...), filled from what was written
// at the top and changeable for that platform alone.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Film, ImageIcon, Loader2, Send, Upload, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS, PLATFORM_NAME, TIKTOK_PRIVACY_LABEL, YOUTUBE_CATEGORIES, mediaNote, readTags,
  type FacebookOptions, type InstagramOptions, type LinkedInOptions, type PostMedia, type SharedText,
  type TikTokOptions, type TikTokPrivacy, type XOptions, type YouTubeOptions, type YouTubePrivacy,
} from '../../../api/_social/shared/platforms';
import {
  UPLOAD_ACCEPT, accountProblems, fileProblem, optionsFor, postTitle, postableAccounts,
  type Overrides, type PostableAccount,
} from '@/lib/socialCompose';
import { publicMessage } from '@/lib/publicError';
import { cn } from '@/lib/utils';
import { createSocialPosts, removeSocialMedia, runSocialPublish, uploadSocialMedia } from '@/services/supabase/social';
import type { SocialAccount } from '@/types/social';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workspaceId: string;
  userId?: string;
  accounts: SocialAccount[];
  /** Called after the posts are queued, so the page can show them. */
  onPosted: () => void;
  /** Open the page's Accounts tab (when there is nothing to post to yet). */
  onAddAccount: () => void;
}

const FIELD = 'flex flex-col gap-1.5';
const STEP = 'text-sm font-semibold text-foreground';
const HINT = 'text-xs text-muted-foreground';
const NOT_CHOSEN = '__choose__';

/** "12 / 100", in red once over. */
const Count: React.FC<{ value: number; max: number }> = ({ value, max }) => (
  <span className={cn('shrink-0 text-xs tabular-nums', value > max ? 'font-medium text-destructive' : 'text-muted-foreground')}>
    {value.toLocaleString('en-GB')} / {max.toLocaleString('en-GB')}
  </span>
);

const Tick: React.FC<{ checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode; disabled?: boolean }> = ({ checked, onChange, children, disabled }) => (
  <label className="flex items-start gap-2 text-sm text-foreground">
    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="min-w-0">{children}</span>
  </label>
);

export const SocialComposer: React.FC<Props> = ({ open, onOpenChange, organizationId, workspaceId, userId, accounts, onPosted, onAddAccount }) => {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const usable = useMemo(() => postableAccounts(accounts), [accounts]);

  const [media, setMedia] = useState<PostMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [changed, setChanged] = useState<Overrides>({});
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);

  // Each time it opens: an empty post, going to every connected account.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMedia(null); setTitle(''); setText(''); setTags(''); setChanged({}); setWhen('now'); setAt('');
      setChosen(usable.filter((a) => a.status === 'connected').map((a) => a.id));
    }
    wasOpen.current = open;
  }, [open, usable]);

  const shared: SharedText = useMemo(() => ({ title, text, tags: readTags(tags) }), [title, text, tags]);
  const going = usable.filter((a) => chosen.includes(a.id));
  const problems = useMemo(
    () => new Map(going.map((a) => [a.id, accountProblems(a, shared, changed[a.id], media)])),
    [going, shared, changed, media],
  );
  const blocked = going.filter((a) => (problems.get(a.id) ?? []).length > 0);
  const laterReady = when === 'now' || (at !== '' && new Date(at).getTime() > Date.now());
  const ready = going.length > 0 && blocked.length === 0 && !uploading && !busy && laterReady;

  const change = (accountId: string, patch: Record<string, unknown>) =>
    setChanged((old) => ({ ...old, [accountId]: { ...(old[accountId] ?? {}), ...patch } }));

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) { toast.error(problem); return; }
    setUploading(true);
    try {
      const uploaded = await uploadSocialMedia(workspaceId, file);
      if (media) void removeSocialMedia(media);
      setMedia(uploaded);
    } catch (err) {
      toast.error(publicMessage(err, 'The file could not be uploaded. It may be too large. Try again.'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const post = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await createSocialPosts({
        organizationId, workspaceId, userId,
        title: postTitle(shared, media), body: text.trim(), media,
        scheduledAt: when === 'later' ? new Date(at) : undefined,
        posts: going.map((a) => ({ accountId: a.id, options: optionsFor(a.provider, shared, changed[a.id]) as unknown as Record<string, unknown> })),
      });
      const places = going.length === 1 ? '1 account' : `${going.length} accounts`;
      if (when === 'later') {
        toast.success(`Scheduled for ${places}.`);
      } else {
        toast.success(`Posting to ${places} now. A video can take a few minutes.`);
        // Not waited for: a video upload takes minutes, and the page shows each account's result as it comes.
        void runSocialPublish().then(onPosted);
      }
      onOpenChange(false);
      onPosted();
    } catch (err) {
      toast.error(publicMessage(err, 'The post could not be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const section = (account: PostableAccount) => {
    const o = optionsFor(account.provider, shared, changed[account.id]);
    const set = (patch: Record<string, unknown>) => change(account.id, patch);
    const fid = `${id}-${account.id}`;
    if (account.provider === 'youtube') {
      const y = o as YouTubeOptions;
      return (
        <>
          <div className={FIELD}>
            <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-title`}>YouTube title</Label><Count value={y.title.length} max={LIMITS.youtubeTitle} /></div>
            <Input id={`${fid}-title`} value={y.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className={FIELD}>
            <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-description`}>YouTube description</Label><Count value={y.description.length} max={LIMITS.youtubeDescription} /></div>
            <Textarea id={`${fid}-description`} rows={3} value={y.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${fid}-tags`}>YouTube tags</Label>
            <Input id={`${fid}-tags`} value={y.tags.join(', ')} onChange={(e) => set({ tags: readTags(e.target.value) })} placeholder="A comma between tags" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={FIELD}>
              <Label htmlFor={`${fid}-category`}>Category</Label>
              <Select value={y.categoryId} onValueChange={(v) => set({ categoryId: v })}>
                <SelectTrigger id={`${fid}-category`}><SelectValue /></SelectTrigger>
                <SelectContent>{YOUTUBE_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fid}-privacy`}>Who can watch</Label>
              <Select value={y.privacy} onValueChange={(v) => set({ privacy: v as YouTubePrivacy })}>
                <SelectTrigger id={`${fid}-privacy`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public: everyone</SelectItem>
                  <SelectItem value="unlisted">Unlisted: people with the link</SelectItem>
                  <SelectItem value="private">Private: only you</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-foreground">Is this video made for kids?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${fid}-kids`} className="h-4 w-4 accent-primary" checked={y.madeForKids === false} onChange={() => set({ madeForKids: false })} />
              No, it is not made for kids
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${fid}-kids`} className="h-4 w-4 accent-primary" checked={y.madeForKids === true} onChange={() => set({ madeForKids: true })} />
              Yes, it is made for kids
            </label>
          </fieldset>
          <Tick checked={y.notifySubscribers} onChange={(v) => set({ notifySubscribers: v })}>Tell subscribers about this video</Tick>
        </>
      );
    }
    if (account.provider === 'tiktok') {
      const t = o as TikTokOptions;
      return (
        <>
          <div className={FIELD}>
            <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-caption`}>TikTok caption</Label><Count value={t.caption.length} max={LIMITS.tiktokCaption} /></div>
            <Textarea id={`${fid}-caption`} rows={3} value={t.caption} onChange={(e) => set({ caption: e.target.value })} />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${fid}-privacy`}>Who can see this video</Label>
            {/* TikTok's rule: nothing is chosen for the person. */}
            <Select value={t.privacy || NOT_CHOSEN} onValueChange={(v) => set({ privacy: v === NOT_CHOSEN ? '' : (v as TikTokPrivacy) })}>
              <SelectTrigger id={`${fid}-privacy`} className="sm:w-60"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_CHOSEN}>Choose…</SelectItem>
                {(Object.keys(TIKTOK_PRIVACY_LABEL) as TikTokPrivacy[]).map((p) => <SelectItem key={p} value={p}>{TIKTOK_PRIVACY_LABEL[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-foreground">Allow people to</legend>
            <Tick checked={t.allowComment} onChange={(v) => set({ allowComment: v })}>Comment</Tick>
            <Tick checked={t.allowDuet} onChange={(v) => set({ allowDuet: v })}>Duet</Tick>
            <Tick checked={t.allowStitch} onChange={(v) => set({ allowStitch: v })}>Stitch</Tick>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-foreground">Does this video promote something?</legend>
            <Tick checked={t.brandOrganic} onChange={(v) => set({ brandOrganic: v })}>Your own business or brand</Tick>
            <Tick checked={t.brandContent} onChange={(v) => set({ brandContent: v })}>Another business: a paid partnership</Tick>
          </fieldset>
        </>
      );
    }
    if (account.provider === 'instagram') {
      const i = o as InstagramOptions;
      return (
        <>
          <div className={FIELD}>
            <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-caption`}>Instagram caption</Label><Count value={i.caption.length} max={LIMITS.instagramCaption} /></div>
            <Textarea id={`${fid}-caption`} rows={3} value={i.caption} onChange={(e) => set({ caption: e.target.value })} />
          </div>
          {media?.kind === 'video' && <Tick checked={i.shareToFeed} onChange={(v) => set({ shareToFeed: v })}>Also show the Reel in the feed</Tick>}
        </>
      );
    }
    if (account.provider === 'facebook') {
      const f = o as FacebookOptions;
      return (
        <>
          {media?.kind === 'video' && (
            <div className={FIELD}>
              <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-title`}>Facebook video title</Label><Count value={f.title.length} max={LIMITS.facebookTitle} /></div>
              <Input id={`${fid}-title`} value={f.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
          )}
          <div className={FIELD}>
            <Label htmlFor={`${fid}-message`}>Facebook text</Label>
            <Textarea id={`${fid}-message`} rows={3} value={f.message} onChange={(e) => set({ message: e.target.value })} />
          </div>
        </>
      );
    }
    const single = o as XOptions | LinkedInOptions;
    const max = account.provider === 'x' ? LIMITS.xText : LIMITS.linkedinText;
    return (
      <div className={FIELD}>
        <div className="flex items-center justify-between gap-2"><Label htmlFor={`${fid}-text`}>{PLATFORM_NAME[account.provider]} text</Label><Count value={single.text.length} max={max} /></div>
        <Textarea id={`${fid}-text`} rows={3} value={single.text} onChange={(e) => set({ text: e.target.value })} />
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
          <DialogDescription>
            Upload once, write once, and post to every account with one press. Each platform shows what it needs below.
          </DialogDescription>
        </DialogHeader>

        {usable.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="max-w-md text-sm text-muted-foreground">
              No account to post to yet. Add your YouTube, TikTok, Instagram, Facebook or X account first.
            </p>
            <Button onClick={() => { onOpenChange(false); onAddAccount(); }}>Add an account</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2" aria-label="Your file">
              <h3 className={STEP}>1. Your picture or video</h3>
              <input
                ref={fileInput} type="file" accept={UPLOAD_ACCEPT} className="sr-only" aria-label="Choose a picture or video"
                onChange={(e) => void pickFile(e.target.files?.[0])}
              />
              {media ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                  {media.kind === 'video'
                    ? <video src={media.url} className="h-24 w-40 rounded-md bg-black object-contain" controls preload="metadata" />
                    : <img src={media.url} alt="" className="h-24 w-24 rounded-md object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {media.kind === 'video' ? <Film className="h-4 w-4 shrink-0" aria-hidden /> : <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />}
                      <span className="truncate">{media.name}</span>
                    </p>
                    <p className={HINT}>{media.kind === 'video' ? 'Video' : 'Picture'} · {(media.bytes / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={uploading || busy} onClick={() => fileInput.current?.click()}>Change</Button>
                  <Button
                    variant="ghost" size="icon" aria-label="Remove the file" disabled={uploading || busy}
                    onClick={() => { void removeSocialMedia(media); setMedia(null); }}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <button
                  type="button" disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void pickFile(e.dataTransfer.files?.[0]); }}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-foreground/25 px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Upload className="h-5 w-5" aria-hidden />}
                  <span className="font-medium">{uploading ? 'Uploading…' : 'Choose a picture or a video'}</span>
                  <span className={HINT}>Or drop it here. YouTube and TikTok need a video. A post with text only is fine for Facebook, X and LinkedIn.</span>
                </button>
              )}
            </section>

            <section className="flex flex-col gap-3" aria-label="What it says">
              <h3 className={STEP}>2. What it says</h3>
              <div className={FIELD}>
                <Label htmlFor={`${id}-title`}>Title</Label>
                <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Used as the YouTube title and the first line elsewhere" />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-text`}>Text</Label>
                <Textarea id={`${id}-text`} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="The description or caption" />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-tags`}>Tags</Label>
                <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dental care, tips, smile" />
                <p className={HINT}>A comma between tags. They become YouTube tags, and hashtags on the other platforms.</p>
              </div>
            </section>

            <section className="flex flex-col gap-3" aria-label="Where it goes">
              <h3 className={STEP}>3. Where it goes, and what each one needs</h3>
              <ul className="flex flex-col gap-3">
                {usable.map((account) => {
                  const on = chosen.includes(account.id);
                  const connected = account.status === 'connected';
                  const missing = on ? problems.get(account.id) ?? [] : [];
                  const note = mediaNote(account.provider, media);
                  return (
                    <li key={account.id} className="list-none rounded-lg border border-border" aria-label={`${PLATFORM_NAME[account.provider]}: ${account.displayName}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                          <input
                            type="checkbox" className="h-4 w-4 shrink-0 accent-primary"
                            aria-label={`Post to ${PLATFORM_NAME[account.provider]} (${account.displayName})`}
                            checked={on} disabled={!connected}
                            onChange={(e) => setChosen((old) => (e.target.checked ? [...old, account.id] : old.filter((v) => v !== account.id)))}
                          />
                          <span className="font-medium text-foreground">{PLATFORM_NAME[account.provider]}</span>
                          <span className="truncate text-muted-foreground">{account.displayName}</span>
                        </label>
                        {!connected ? (
                          <span className={HINT}>Not connected yet</span>
                        ) : on && missing.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Ready{note ? ` · ${note}` : ''}</span>
                        ) : on ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><CircleAlert className="h-3.5 w-3.5" aria-hidden />{missing.length === 1 ? '1 thing missing' : `${missing.length} things missing`}</span>
                        ) : (
                          <span className={HINT}>Not posting here</span>
                        )}
                      </div>
                      {on && connected && (
                        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                          {missing.length > 0 && (
                            <ul role="alert" className="flex flex-col gap-0.5 text-xs text-destructive">
                              {missing.map((m) => <li key={m}>{m}</li>)}
                            </ul>
                          )}
                          {section(account)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="flex flex-col gap-2" aria-label="When">
              <h3 className={STEP}>4. When</h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${id}-when`} className="h-4 w-4 accent-primary" checked={when === 'now'} onChange={() => setWhen('now')} />
                Now
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input type="radio" name={`${id}-when`} className="h-4 w-4 accent-primary" checked={when === 'later'} onChange={() => setWhen('later')} />
                Later
                {when === 'later' && (
                  <Input type="datetime-local" aria-label="Post at" className="w-56 tabular-nums" value={at} onChange={(e) => setAt(e.target.value)} />
                )}
              </label>
              {when === 'later' && at !== '' && !laterReady && <p className="text-xs text-destructive">Choose a time that is still to come.</p>}
            </section>
          </div>
        )}

        {usable.length > 0 && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground" role="status">
              {going.length === 0
                ? 'Tick at least one account.'
                : blocked.length > 0
                  ? `Still missing for ${blocked.map((a) => PLATFORM_NAME[a.provider]).join(', ')}.`
                  : uploading ? 'Waiting for the upload to finish.' : 'Everything each platform needs is filled in.'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!ready} onClick={() => void post()}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {when === 'later' ? 'Schedule' : 'Post'} to {going.length === 1 ? '1 account' : `${going.length} accounts`}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SocialComposer;
