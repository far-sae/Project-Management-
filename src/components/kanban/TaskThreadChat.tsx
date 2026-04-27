import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import {
  MessageSquare,
  Paperclip,
  X,
  Clock,
  ChevronDown,
  Bell,
  Loader2,
} from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import AttachmentPreview from '@/components/ui/AttachmentPreview';
import { cn, truncateFileName } from '@/lib/utils';
import { playTaskChatMessageSound, resumeNotificationAudioContext } from '@/lib/chatSounds';
import type { TaskComment } from '@/types';
import type { PresencePeer } from '@/hooks/usePresence';
import { toast } from 'sonner';

const SCROLL_THRESH_PX = 88;

const formatTimeLogged = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

export interface TaskThreadChatProps {
  taskId: string;
  currentUserId: string | undefined;
  readOnly: boolean;
  taskComments: TaskComment[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onTyping: () => void;
  /** Typing on this task */
  typingPeers: PresencePeer[] | null;
  commentLoading: boolean;
  onSendComment: () => void;
  commentAttachmentFiles: File[];
  setCommentAttachmentFiles: React.Dispatch<React.SetStateAction<File[]>>;
  showTimeSpent: boolean;
  setShowTimeSpent: (v: boolean) => void;
  commentTimeSpentMinutes: number | '';
  setCommentTimeSpentMinutes: React.Dispatch<React.SetStateAction<number | ''>>;
  commentFileInputRef: React.RefObject<HTMLInputElement>;
  maxFileSize: number;
}

type IncomingPreview = { commentId: string; displayName: string; text: string };

export const TaskThreadChat: React.FC<TaskThreadChatProps> = ({
  taskId,
  currentUserId,
  readOnly,
  taskComments,
  newComment,
  onNewCommentChange,
  onTyping,
  typingPeers,
  commentLoading,
  onSendComment,
  commentAttachmentFiles,
  setCommentAttachmentFiles,
  showTimeSpent,
  setShowTimeSpent,
  commentTimeSpentMinutes,
  setCommentTimeSpentMinutes,
  commentFileInputRef,
  maxFileSize,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  /** Mute pings while the modal hydrates the first comment batch for this task. */
  const soundMuteUntilRef = useRef(0);
  const [incomingStack, setIncomingStack] = useState<IncomingPreview[]>([]);
  const [atBottom, setAtBottom] = useState(true);

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESH_PX;
  }, []);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    setIncomingStack([]);
    setAtBottom(true);
  }, []);

  useEffect(() => {
    seenIdsRef.current = new Set();
    setIncomingStack([]);
    soundMuteUntilRef.current = Date.now() + 1200;
  }, [taskId]);

  useEffect(() => {
    const newOnes = taskComments.filter((c) => !seenIdsRef.current.has(c.commentId));
    for (const c of newOnes) seenIdsRef.current.add(c.commentId);
    if (newOnes.length === 0) return;

    // Initial fetch often delivers many messages at once — never play a chime for that batch.
    if (newOnes.length > 1) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        else endRef.current?.scrollIntoView({ block: 'end' });
      });
      return;
    }

    const justOpened = Date.now() < soundMuteUntilRef.current;
    if (justOpened) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        } else {
          endRef.current?.scrollIntoView({ block: 'end' });
        }
      });
      return;
    }

    const notNear = !isNearBottom();
    let hasExternalWhileNotNearBottom = false;
    for (const c of newOnes) {
      const fromOther = Boolean(currentUserId && c.userId !== currentUserId);
      if (fromOther && notNear) {
        hasExternalWhileNotNearBottom = true;
        setIncomingStack((prev) => {
          const next: IncomingPreview[] = [
            {
              commentId: c.commentId,
              displayName: c.displayName || 'Someone',
              text: (c.text || '').replace(/\s+/g, ' ').trim() || (c.attachments?.length ? 'Sent an attachment' : 'New message'),
            },
            ...prev.filter((p) => p.commentId !== c.commentId),
          ];
          return next.slice(0, 4);
        });
      }
    }
    if (hasExternalWhileNotNearBottom) {
      playTaskChatMessageSound();
    }
  }, [taskComments, currentUserId, isNearBottom]);

  const onScroll = useCallback(() => {
    const near = isNearBottom();
    setAtBottom(near);
    if (near) setIncomingStack([]);
  }, [isNearBottom]);

  const sorted = useMemo(
    () => [...taskComments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [taskComments],
  );

  const messageRows = useMemo(() => {
    const out: { kind: 'day' | 'msg'; key: string; dayLabel?: string; comment?: TaskComment }[] = [];
    let lastDay: Date | null = null;
    for (const c of sorted) {
      const d = new Date(c.createdAt);
      if (!lastDay || !isSameDay(d, lastDay)) {
        const label =
          isSameDay(d, new Date()) ? 'Today' : isSameDay(d, new Date(Date.now() - 864e5)) ? 'Yesterday' : format(d, 'EEE, MMM d');
        out.push({ kind: 'day', key: `day-${c.commentId}`, dayLabel: label });
        lastDay = d;
      }
      out.push({ kind: 'msg', key: c.commentId, comment: c });
    }
    return out;
  }, [sorted]);

  return (
    <div className="flex flex-col rounded-2xl border border-border/80 bg-gradient-to-b from-card to-muted/20 shadow-sm min-h-[min(52vh,440px)] max-h-[min(52vh,440px)] overflow-hidden">
      {/* Top: incoming (when user has scrolled up) — like Slack / Teams */}
      <div className="shrink-0 border-b border-border/60 bg-background/80 backdrop-blur-sm px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground leading-tight">Discussion</h3>
              <p className="text-[11px] text-muted-foreground">
                {taskComments.length} {taskComments.length === 1 ? 'message' : 'messages'}
                {typingPeers && typingPeers.length > 0 ? ' · someone is typing…' : ''}
              </p>
            </div>
          </div>
          {!atBottom && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => {
                resumeNotificationAudioContext();
                scrollToEnd('smooth');
              }}
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Latest
            </Button>
          )}
        </div>
        {incomingStack.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-0.5">
            {incomingStack.map((m) => (
              <button
                key={m.commentId}
                type="button"
                onClick={() => {
                  document.getElementById(`thread-msg-${m.commentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setIncomingStack((p) => p.filter((x) => x.commentId !== m.commentId));
                }}
                className="flex items-start gap-2 text-left w-full rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs hover:bg-primary/10 transition-colors"
              >
                <Bell className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{m.displayName}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground line-clamp-1">{m.text}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable thread */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-1 scroll-smooth"
      >
        {messageRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Start the thread</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
              Share updates, @mention teammates, and attach files. You’ll get a short sound when someone else posts.
            </p>
          </div>
        )}
        {messageRows.map((row) => {
          if (row.kind === 'day' && row.dayLabel) {
            return (
              <div key={row.key} className="flex justify-center py-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/90 bg-background/80 border border-border/50 px-2.5 py-0.5 rounded-full">
                  {row.dayLabel}
                </span>
              </div>
            );
          }
          const c = row.comment;
          if (!c) return null;
          const mine = currentUserId && c.userId === currentUserId;
          return (
            <div
              id={`thread-msg-${c.commentId}`}
              key={c.commentId}
              className={cn('flex gap-2 px-1', mine ? 'flex-row-reverse' : 'flex-row')}
            >
              <Avatar className="w-8 h-8 shrink-0 ring-2 ring-background">
                <AvatarImage src={c.photoURL} />
                <AvatarFallback
                  className={cn(
                    'text-xs',
                    mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {c.displayName?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  'min-w-0 max-w-[min(100%,20rem)] rounded-2xl px-3 py-2 shadow-sm',
                  mine
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-background border border-border/90 rounded-bl-md',
                )}
              >
                {!mine && (
                  <p className="text-[11px] font-semibold text-foreground/90 mb-0.5 pr-1">{c.displayName}</p>
                )}
                {c.timeSpentMinutes != null && c.timeSpentMinutes > 0 && (
                  <span
                    className={cn(
                      'inline-block mb-1 px-2 py-0.5 text-[10px] rounded-full',
                      mine
                        ? 'bg-primary-foreground/15 text-primary-foreground'
                        : 'bg-success-soft text-success-soft-foreground',
                    )}
                  >
                    {formatTimeLogged(c.timeSpentMinutes)} logged
                  </span>
                )}
                {c.text?.trim() && (
                  <p
                    className={cn(
                      'text-sm whitespace-pre-wrap break-words leading-relaxed',
                      mine ? 'text-primary-foreground' : 'text-foreground',
                    )}
                  >
                    {c.text}
                  </p>
                )}
                {c.attachments && c.attachments.length > 0 && (
                  <div className={cn('mt-2', mine && 'opacity-95')}>
                    <AttachmentPreview attachments={c.attachments} />
                  </div>
                )}
                <p
                  className={cn(
                    'text-[10px] mt-1.5 tabular-nums',
                    mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {format(new Date(c.createdAt), 'p')}
                  {' · '}
                  {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} className="h-1" />
      </div>

      {/* Composer — bottom dock */}
      <div className="shrink-0 border-t border-border/80 bg-muted/30 p-2.5">
        {typingPeers && typingPeers.length > 0 && (
          <div className="px-1.5 pb-1.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-muted-foreground animate-pulse" />
              <span
                className="w-1 h-1 rounded-full bg-muted-foreground animate-pulse"
                style={{ animationDelay: '120ms' }}
              />
            </span>
            {(() => {
              const names = typingPeers.map((p) => p.displayName);
              if (names.length === 1) return `${names[0]} is typing…`;
              if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
              return `${names[0]} and ${names.length - 1} others are typing…`;
            })()}
          </div>
        )}
        <div className="rounded-2xl border border-border/70 bg-card shadow-[0_-4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.25)] overflow-hidden">
          <Textarea
            value={newComment}
            onChange={(e) => {
              onNewCommentChange(e.target.value);
              onTyping();
            }}
            placeholder="Message the team…"
            rows={2}
            disabled={readOnly}
            className="border-0 resize-none focus-visible:ring-0 bg-transparent min-h-[4.25rem] text-sm leading-relaxed px-3.5 py-2.5 placeholder:text-muted-foreground/70"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!readOnly) onSendComment();
              }
            }}
            onMouseDown={() => resumeNotificationAudioContext()}
          />
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-border/50 bg-background/50">
            <div className="flex items-center gap-0.5 min-w-0">
              <EmojiPickerButton
                value={newComment}
                onChange={onNewCommentChange}
                disabled={readOnly}
              />
              <button
                type="button"
                onClick={() => commentFileInputRef.current?.click()}
                disabled={readOnly}
                className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs disabled:opacity-50"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Attach</span>
              </button>
              <input
                ref={commentFileInputRef}
                type="file"
                multiple
                accept="*/*"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files?.length) return;
                  const validFiles: File[] = [];
                  for (const file of Array.from(files)) {
                    if (file.size > maxFileSize) {
                      toast.error(`${file.name} exceeds 2MB limit`);
                      continue;
                    }
                    validFiles.push(file);
                  }
                  if (validFiles.length > 0) {
                    setCommentAttachmentFiles((prev) => [...prev, ...validFiles]);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => setShowTimeSpent(!showTimeSpent)}
                disabled={readOnly}
                className={cn(
                  'p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs',
                  showTimeSpent && 'bg-secondary text-foreground',
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Time</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground hidden sm:inline">⌘/Ctrl+Enter to send</span>
              <Button
                type="button"
                size="sm"
                className="h-8 px-4 rounded-full gap-1.5 font-medium"
                onClick={onSendComment}
                disabled={readOnly || (!newComment.trim() && commentAttachmentFiles.length === 0) || commentLoading}
              >
                {commentLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Send'
                )}
              </Button>
            </div>
          </div>
        </div>

        {showTimeSpent && (
          <div className="mt-2 flex items-center gap-2 px-1">
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={commentTimeSpentMinutes === '' ? '' : commentTimeSpentMinutes}
              onChange={(e) => {
                const v = e.target.value;
                setCommentTimeSpentMinutes(v === '' ? '' : Math.max(0, parseInt(v, 10) || 0));
              }}
              className="w-20 h-8 text-center text-sm"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
            <button
              type="button"
              onClick={() => {
                setShowTimeSpent(false);
                setCommentTimeSpentMinutes('');
              }}
              className="ml-auto p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {commentAttachmentFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {commentAttachmentFiles.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-secondary/80 rounded-lg text-xs border border-border/50"
                title={f.name}
              >
                <span className="truncate max-w-[150px]">{truncateFileName(f.name, 20)}</span>
                <button
                  type="button"
                  onClick={() => setCommentAttachmentFiles((p) => p.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
