// What a post looks like: its picture or video, its text, where it went and
// how that went. A small picture in the posts table opens the full preview.
import React from 'react';
import { ExternalLink, FileText, Play } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { publicText } from '@/lib/publicError';
import { STATE_LABEL, type PostRow } from '@/lib/socialPosts';
import { cn } from '@/lib/utils';
import type { SocialContentStatus } from '@/types/social';
import type { PostMedia } from '../../../api/_social/shared/platforms';

const TONE: Record<SocialContentStatus, StatusTone> = {
  draft: 'neutral', in_review: 'warning', approved: 'info', scheduled: 'info', publishing: 'info', published: 'success', failed: 'danger',
};

/** Only a web address is ever put in a picture or a video. */
export const mediaAddress = (media: PostMedia | null): string | null =>
  media && /^https?:\/\/[^\s]+$/.test(media.url) ? media.url : null;

/** The small picture of a post in a list. Pressing it opens the preview. */
export const MediaThumb: React.FC<{ media: PostMedia | null; title: string; onOpen: () => void; className?: string }> = ({ media, title, onOpen, className }) => {
  const address = mediaAddress(media);
  return (
    <button
      type="button" onClick={onOpen} aria-label={`Preview ${title}`}
      className={cn('relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {address && media?.kind === 'video' ? (
        <>
          {/* "#t=0.1" makes the browser show the first picture of the video instead of a black box. */}
          <video src={`${address}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/25 text-white" aria-hidden><Play className="h-4 w-4 fill-current" /></span>
        </>
      ) : address ? (
        <img src={address} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-muted-foreground" aria-hidden><FileText className="h-4 w-4" /></span>
      )}
    </button>
  );
};

const whenText = (d: Date): string => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The full preview of one post. `row` null keeps it closed. */
export const PostPreview: React.FC<{ row: PostRow | null; onOpenChange: (open: boolean) => void }> = ({ row, onOpenChange }) => {
  const post = row?.post ?? null;
  const address = mediaAddress(post?.media ?? null);
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {row && post && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{post.title}</DialogTitle>
              <DialogDescription>
                {row.platformName}{row.accountName ? ` · ${row.accountName}` : ''} · {row.whenLabel} {whenText(row.when)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="grid min-h-[12rem] place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                {address && post.media?.kind === 'video' ? (
                  <video src={address} controls playsInline preload="metadata" aria-label={`Video of ${post.title}`} className="max-h-[60vh] w-full bg-black" />
                ) : address ? (
                  <img src={address} alt={`Picture of ${post.title}`} className="max-h-[60vh] w-full object-contain" />
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">This post is text only: it has no picture or video.</p>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <div><StatusPill tone={TONE[post.status]}>{STATE_LABEL[post.status]}</StatusPill></div>
                {post.status === 'failed' && post.lastError && (
                  <p role="alert" className="text-sm text-destructive">{publicText(post.lastError, 'The post was not accepted. Try again.')}</p>
                )}
                {post.body
                  ? <p className="whitespace-pre-wrap break-words text-sm text-foreground">{post.body}</p>
                  : <p className="text-sm text-muted-foreground">No text.</p>}
                {row.campaignName && <p className="text-sm text-muted-foreground">Campaign: <span className="text-foreground">{row.campaignName}</span></p>}
                {row.link && (
                  <Button asChild variant="outline" size="sm" className="self-start">
                    <a href={row.link} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />View on {row.platformName}</a>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PostPreview;
