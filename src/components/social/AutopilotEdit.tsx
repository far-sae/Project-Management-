// Change a post the autopilot made, before it goes out: its words, its time,
// and its picture or video (made again with what should be different, or
// replaced by the person's own file).
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { publicMessage } from '@/lib/publicError';
import { UPLOAD_ACCEPT, fileProblem } from '@/lib/socialCompose';
import { uploadSocialMedia } from '@/services/supabase/social';
import { remakeAutopilotMedia, saveAutopilotText, setAutopilotMedia } from '@/services/social/autopilot';
import { CHANGE_MAX, SPOKEN_MAX } from '../../../api/_social/shared/autopilot';
import { PLATFORM_NAME, isPlatform, readTags } from '../../../api/_social/shared/platforms';
import type { SocialAccount, SocialContent } from '@/types/social';

interface Props {
  /** The posts of one idea (one for each account). Null keeps the window closed. */
  posts: SocialContent[] | null;
  workspaceId: string;
  accounts: SocialAccount[];
  /** False when the site cannot make pictures and videos: only the person's own file can replace one. */
  canRemake: boolean;
  onOpenChange: (open: boolean) => void;
  /** Something was saved: the page reads its lists again. */
  onChanged: () => void;
}

/** A moment as the browser's date-and-time box wants it, in the person's own time. */
export function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** YouTube and TikTok take videos only: a picture cannot go on an idea that is posted there. */
export function ownFileProblem(file: { type: string; size: number }, posts: SocialContent[], accounts: SocialAccount[]): string | null {
  const basic = fileProblem(file);
  if (basic) return basic;
  if (file.type.startsWith('video/')) return null;
  const needVideo = posts.map((p) => accounts.find((a) => a.id === p.accountId)?.provider).filter((p) => p === 'youtube' || p === 'tiktok');
  if (needVideo.length > 0) return `${[...new Set(needVideo)].map((p) => (isPlatform(p) ? PLATFORM_NAME[p] : p)).join(' and ')} ${needVideo.length > 1 ? 'need' : 'needs'} a video. Choose a video, or make the picture again.`;
  if (!/^image\/jpe?g$/i.test(file.type) && posts.some((p) => accounts.find((a) => a.id === p.accountId)?.provider === 'instagram')) return 'Instagram takes JPEG pictures only. Save the picture as a JPEG and choose it again.';
  return null;
}

export const AutopilotEdit: React.FC<Props> = ({ posts, workspaceId, accounts, canRemake, onOpenChange, onChanged }) => {
  const first = posts?.[0] ?? null;
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [time, setTime] = useState('');
  const [change, setChange] = useState('');
  const [spoken, setSpoken] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'remake' | 'upload'>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const id = first?.postGroupId ?? first?.id ?? null;
  // Filled in afresh each time another idea is opened.
  useEffect(() => {
    if (!first) return;
    setTitle(first.title);
    setCaption(first.body);
    setTags((first.idea?.tags ?? []).join(', '));
    setTime(toLocalInput(first.scheduledAt));
    setChange('');
    setSpoken(first.idea?.spoken ?? '');
    // Only when another idea is opened: a read of the list in the background must not wipe what is being typed.
  }, [id]);

  if (!posts || !first) return null;
  const video = first.idea?.format === 'video';
  const groupId = first.postGroupId;

  const done = (message: string) => { toast.success(message); onChanged(); onOpenChange(false); };

  const save = async () => {
    setBusy('save');
    try {
      const at = time ? new Date(time) : null;
      await saveAutopilotText(posts, accounts, { title, caption, tags: readTags(tags), scheduledAt: at && !Number.isNaN(at.getTime()) ? at : null });
      done('Saved.');
    } catch (error) {
      toast.error(publicMessage(error, 'The changes could not be saved. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const remake = async () => {
    if (!groupId) return;
    setBusy('remake');
    try {
      await remakeAutopilotMedia(workspaceId, groupId, change.trim(), video ? spoken.trim() : undefined);
      done(video ? 'The video is being made again. The post comes back when it is ready.' : 'The picture is being made again. The post comes back when it is ready.');
    } catch (error) {
      toast.error(publicMessage(error, 'It could not be made again just now. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const problem = ownFileProblem(file, posts, accounts);
    if (problem) { toast.error(problem); return; }
    setBusy('upload');
    try {
      await setAutopilotMedia(posts, await uploadSocialMedia(workspaceId, file));
      done('Your file is on the post.');
    } catch (error) {
      toast.error(publicMessage(error, 'The file could not be uploaded. It may be too large. Try again.'));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change this post</DialogTitle>
          <DialogDescription>It is changed for every account it goes to. Nothing is posted from here.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="ae-title">Title</Label>
            <Input id="ae-title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ae-text">Text</Label>
            <Textarea id="ae-text" rows={5} maxLength={2000} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="ae-tags">Tags</Label>
              <Input id="ae-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dental, teeth" />
              <p className="mt-1 text-xs text-muted-foreground">With commas between them, without the # sign.</p>
            </div>
            <div>
              <Label htmlFor="ae-time">Goes out at</Label>
              <Input id="ae-time" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <section aria-label={video ? 'The video' : 'The picture'} className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold">{video ? 'The video' : 'The picture'}</h3>
            <div className="mt-2 flex flex-wrap gap-3">
              {first.media
                ? first.media.kind === 'video'
                  ? <video src={first.media.url} controls className="h-48 w-28 shrink-0 rounded-md border border-border bg-black object-cover" aria-label={`The video of ${first.title}`} />
                  : <img src={first.media.url} alt={`The picture of ${first.title}`} className="h-48 w-36 shrink-0 rounded-md border border-border object-cover" />
                : <p className="grid h-24 w-36 shrink-0 place-items-center rounded-md border border-dashed border-border px-2 text-center text-xs text-muted-foreground">{first.lastError ? 'It could not be made.' : 'It is being made.'}</p>}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {groupId && canRemake && (
                  <>
                    <Label htmlFor="ae-change">What should be different?</Label>
                    <Textarea id="ae-change" rows={2} maxLength={CHANGE_MAX} value={change} onChange={(e) => setChange(e.target.value)} placeholder={video ? 'Show a child smiling at the dentist' : 'Brighter, with the whole team in it'} />
                    {video && (
                      <>
                        <Label htmlFor="ae-spoken">Words the voice says</Label>
                        <Input id="ae-spoken" maxLength={SPOKEN_MAX} value={spoken} onChange={(e) => setSpoken(e.target.value)} placeholder="Leave empty for no voice" />
                      </>
                    )}
                    <div>
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void remake()}>
                        {busy === 'remake' ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}Make it again
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Making it again costs the same as the first time and takes a few minutes.</p>
                  </>
                )}
                <div>
                  <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} className="hidden" aria-label="Choose your own picture or video" onChange={(e) => void upload(e.target.files?.[0])} />
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                    {busy === 'upload' ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{busy === 'upload' ? 'Uploading…' : 'Use my own file'}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy !== null || !caption.trim()} onClick={() => void save()}>{busy === 'save' && <Loader2 className="animate-spin" aria-hidden />}Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AutopilotEdit;
