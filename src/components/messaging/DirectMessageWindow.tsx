import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Minus, Paperclip, Phone, Send, Video, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/hooks/useCall';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import {
  insertDirectMessage,
  markDirectMessagesRead,
  deleteOldDirectMessages,
  subscribeToDirectMessages,
  directMessageThreadKey,
  type ChatAttachment,
  type DirectMessage,
} from '@/services/supabase/database';
import { ATTACHMENTS_BUCKET, deleteFile, uploadChatAttachment } from '@/services/supabase/storage';
import { ChatAttachmentList } from './ChatAttachmentList';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { format, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { useLastSeen } from '@/hooks/useLastSeen';
import { presenceStatus } from '@/lib/presenceStatus';
import type { PresencePeer } from '@/hooks/usePresence';

export interface DirectMessageRecipient {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

interface DirectMessageWindowProps {
  recipient: DirectMessageRecipient;
  organizationId?: string | null;
  /** Minimised = a small bar at the bottom of the screen (name + unread count). */
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  /** Live presence for the recipient, when the caller has it. */
  recipientPeer?: PresencePeer;
}

const messageDayLabel = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return format(date, 'MMM d, yyyy');
};

/**
 * One-to-one chat window in the bottom chat dock (Teams / LinkedIn style).
 * Talks to the `direct_messages` table (RLS scoped to the two participants)
 * so the conversation is private to the pair. Minimising shrinks it to a bar
 * that keeps listening, so its unread count stays live.
 */
export const DirectMessageWindow: React.FC<DirectMessageWindowProps> = ({
  recipient,
  organizationId,
  minimized,
  onMinimize,
  onRestore,
  onClose,
  recipientPeer,
}) => {
  const { user } = useAuth();
  const { actions: callActions, state: callState } = useCall();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const recipientId = recipient.userId;

  useEffect(() => {
    if (!user?.userId) return;
    setLoading(true);
    setMessages([]);
    // Clean up messages older than 30 days
    void deleteOldDirectMessages(user.userId, recipientId);
    const unsub = subscribeToDirectMessages(user.userId, recipientId, (list) => {
      setMessages(list);
      setLoading(false);
    });
    return () => unsub();
  }, [recipientId, user?.userId]);

  // Mark messages as read while the window is open (not while minimised).
  useEffect(() => {
    if (minimized || !user?.userId) return;
    void markDirectMessagesRead(user.userId, recipientId);
  }, [minimized, recipientId, user?.userId, messages.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 80;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, minimized]);

  const handleSend = useCallback(async () => {
    if (!user?.userId) return;
    const body = input.trim();
    if (!body && pendingFiles.length === 0) return;
    setSending(true);
    stickToBottomRef.current = true;
    try {
      // Upload any pending files first; surface upload failures clearly.
      const attachments: ChatAttachment[] = [];
      const uploadedPaths: string[] = [];
      if (pendingFiles.length > 0) {
        const threadKey = directMessageThreadKey(user.userId, recipientId);
        const settled = await Promise.allSettled(
          pendingFiles.map((f) => uploadChatAttachment(f, { kind: 'dm', threadKey })),
        );
        const failedNames: string[] = [];
        settled.forEach((r, i) => {
          const name = pendingFiles[i]?.name ?? `file ${i + 1}`;
          if (r.status === 'fulfilled') {
            const u = r.value;
            uploadedPaths.push(u.storagePath);
            attachments.push({
              fileName: u.fileName,
              fileUrl: u.fileUrl,
              fileType: u.fileType,
              fileSize: u.fileSize,
            });
          } else {
            failedNames.push(name);
          }
        });
        if (failedNames.length > 0) {
          const sample = failedNames.slice(0, 3).join(', ');
          toast.warning(
            `${failedNames.length} attachment(s) failed to upload: ${sample}${failedNames.length > 3 ? '…' : ''}`,
          );
        }
        if (!body.trim() && attachments.length === 0) {
          toast.error(
            failedNames.length === pendingFiles.length
              ? 'All uploads failed. Message not sent.'
              : 'Nothing to send.',
          );
          return;
        }
      }
      try {
        await insertDirectMessage({
          senderId: user.userId,
          recipientId,
          organizationId: organizationId ?? null,
          body,
          attachments,
        });
      } catch (insertErr) {
        await Promise.allSettled(
          uploadedPaths.map((p) => deleteFile(ATTACHMENTS_BUCKET, p).catch(() => undefined)),
        );
        throw insertErr;
      }
      setInput('');
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const lower = raw.toLowerCase();
      if (lower.includes('does not exist') || lower.includes('relation') || lower.includes('pgrst205')) {
        toast.error(
          'Direct messages aren’t enabled on this workspace yet. Apply migration 033_direct_messages.sql in Supabase.',
        );
      } else {
        toast.error(raw || 'Could not send message');
      }
    } finally {
      setSending(false);
    }
  }, [recipientId, user?.userId, input, pendingFiles, organizationId]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    // Cap at 5 files / 500 MB each to avoid blowing storage costs from chat.
    const filtered = files.filter((f) => {
      if (f.size > 500 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 500 MB`);
        return false;
      }
      return true;
    });
    setPendingFiles((prev) => [...prev, ...filtered].slice(0, 5));
    if (e.target) e.target.value = '';
  };

  const removePending = (idx: number) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  // "Online" / "Last seen 5 min ago", refreshed every 30s.
  const lastSeenMap = useLastSeen([recipientId]);
  const [, forceLastSeenTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceLastSeenTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const recipientStatus = presenceStatus(recipientPeer, lastSeenMap.get(recipientId) ?? null);
  const unread = messages.filter((m) => m.senderId === recipientId && !m.readAt).length;
  const firstName = recipient.displayName.split(' ')[0] || recipient.displayName;
  const callTarget = {
    userId: recipientId,
    displayName: recipient.displayName,
    photoURL: recipient.photoURL,
  };
  const startCall = (media: 'audio' | 'video') =>
    void callActions.startCall(
      { type: 'dm', targetId: recipientId, label: recipient.displayName },
      media,
      callTarget,
    );

  const avatar = (size: string) => (
    <span className="relative shrink-0">
      <Avatar className={size}>
        <AvatarImage src={recipient.photoURL} alt="" />
        <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
          {(recipient.displayName || '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span
        aria-hidden
        className={cn(
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
          recipientStatus.dot,
        )}
      />
    </span>
  );

  if (minimized) {
    return (
      <div
        className={cn(
          'pointer-events-auto flex h-11 w-44 shrink-0 items-center overflow-hidden rounded-t-xl border border-b-0 border-border/70 sm:w-56',
          'bg-card shadow-[0_-6px_24px_rgba(0,0,0,0.18)]',
          'animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
        )}
      >
        <button
          type="button"
          onClick={onRestore}
          aria-label={`Open chat with ${recipient.displayName}${unread ? ` (${unread} unread)` : ''}`}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 pr-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {avatar('h-7 w-7')}
          <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
            {recipient.displayName}
          </span>
          {unread > 0 && (
            <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="mr-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label={`Close chat with ${recipient.displayName}`}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const rows = messages.map((msg, index) => {
    const previous = messages[index - 1];
    return { msg, showDay: !previous || !isSameDay(previous.createdAt, msg.createdAt) };
  });

  return (
    <section
      role="region"
      aria-label={`Chat with ${recipient.displayName}`}
      className={cn(
        'pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-t-xl border border-b-0 border-border/70',
        'bg-card shadow-[0_-10px_40px_rgba(0,0,0,0.22)]',
        'w-[calc(100vw-1rem)] sm:w-80',
        'h-[min(30rem,calc(100svh-4rem))]',
        'animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none',
      )}
    >
      <div className="flex items-center justify-between gap-1 border-b border-border/70 py-2 pl-2.5 pr-1.5">
        {/* Clicking the name minimises, like Teams / LinkedIn. */}
        <button
          type="button"
          onClick={onMinimize}
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 text-left"
        >
          {avatar('h-8 w-8')}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight text-foreground">
              {recipient.displayName}
            </span>
            <span
              className={cn(
                'block truncate text-[11px]',
                recipientStatus.online ? 'text-emerald-600' : 'text-muted-foreground',
              )}
              title={recipientStatus.title}
            >
              {recipientStatus.label}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {isMediaSupported() && callState.status === 'idle' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-emerald-600"
                aria-label={`Voice call ${recipient.displayName}`}
                title={`Voice call ${firstName} only`}
                onClick={() => startCall('audio')}
              >
                <Phone className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                aria-label={`Video call ${recipient.displayName}`}
                title={`Video call ${firstName} only`}
                onClick={() => startCall('video')}
              >
                <Video className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            onClick={onMinimize}
            aria-label={`Minimise chat with ${recipient.displayName}`}
            title="Minimise"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onClose}
            aria-label={`Close chat with ${recipient.displayName}`}
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">Start the conversation</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Send {firstName} a private message.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map(({ msg, showDay }, i) => {
              const mine = msg.senderId === user?.userId;
              const prev = messages[i - 1];
              // Group consecutive messages from the same person (Teams style).
              const grouped =
                !showDay &&
                prev?.senderId === msg.senderId &&
                msg.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000;
              return (
                <div key={msg.messageId} className={cn(!grouped && 'pt-1.5')}>
                  {showDay && (
                    <div className="flex justify-center py-2">
                      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {messageDayLabel(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className={cn('flex', mine && 'justify-end')}>
                    <div className={cn('min-w-0 max-w-[82%]', mine && 'flex flex-col items-end')}>
                      {!grouped && (
                        <div className="mb-0.5 px-1 text-[11px] text-muted-foreground tabular-nums">
                          {format(msg.createdAt, 'p')}
                        </div>
                      )}
                      {msg.body && (
                        <div
                          className={cn(
                            'whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed',
                            mine
                              ? 'rounded-br-md bg-primary text-primary-foreground'
                              : 'rounded-bl-md bg-muted text-foreground',
                          )}
                        >
                          <LinkifiedText
                            text={msg.body}
                            linkClassName={mine ? 'text-primary-foreground decoration-primary-foreground/50' : undefined}
                          />
                        </div>
                      )}
                      <ChatAttachmentList attachments={msg.attachments} mine={mine} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/70 p-2">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, idx) => (
              <span
                key={`${f.name}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
              >
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[10rem] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removePending(idx)}
                  aria-label={`Remove ${f.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 rounded-xl border border-border/60 bg-background p-1 transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
          <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={!user || sending}
            aria-label="Attach file"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${firstName}…`}
            rows={1}
            className="max-h-32 min-h-8 flex-1 resize-none rounded-md border-0 bg-transparent px-1.5 py-1.5 text-[13px] leading-snug shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70"
            disabled={!user || sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg active:scale-[0.97]"
            disabled={!user || sending || (!input.trim() && pendingFiles.length === 0)}
            onClick={() => void handleSend()}
            aria-label="Send message"
            title="Send (Enter) · Shift+Enter for a new line"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default DirectMessageWindow;
