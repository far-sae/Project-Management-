import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  subscribeToDirectMessageReactions,
  toggleDirectMessageReaction,
  directMessageThreadKey,
  type ChatAttachment,
  type DirectMessage,
  type DirectMessageReaction,
} from '@/services/supabase/database';
import { ATTACHMENTS_BUCKET, deleteFile, uploadChatAttachment } from '@/services/supabase/storage';
import { ChatAttachmentList } from './ChatAttachmentList';
import { ChatBubble, ProjectChatMessage as ChatMessageRow } from '@/components/project/ProjectChatMessage';
import { ReactionButton, ReactionChips, groupReactions } from './ChatReactions';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { useDmTyping } from '@/hooks/useDmTyping';
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
 *
 * It works like the project chat: the same message rows, emoji and reactions,
 * plus what only a pair needs: "is typing" and "Seen".
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
  const [reactionRows, setReactionRows] = useState<DirectMessageReaction[]>([]);
  /** True once we learn this deployment has no reactions table (migration 181 not run). */
  const [reactionsUnavailable, setReactionsUnavailable] = useState(false);
  const [reactionMenuForId, setReactionMenuForId] = useState<string | null>(null);
  const reloadReactionsRef = useRef<() => void>(() => {});
  const { otherTyping, notifyTyping } = useDmTyping(user?.userId, recipientId);

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

  useEffect(() => {
    if (!user?.userId) return;
    setReactionRows([]);
    const { stop, reload } = subscribeToDirectMessageReactions(
      user.userId,
      recipientId,
      setReactionRows,
      () => setReactionsUnavailable(true),
    );
    reloadReactionsRef.current = reload;
    return () => {
      reloadReactionsRef.current = () => {};
      stop();
    };
  }, [recipientId, user?.userId]);

  const reactionsByMessageId = useMemo(() => groupReactions(reactionRows), [reactionRows]);

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.userId) return;
      try {
        await toggleDirectMessageReaction({ messageId, userId: user.userId, emoji });
        reloadReactionsRef.current();
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : 'Could not update the reaction');
      }
    },
    [user?.userId],
  );

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
  }, [messages, reactionRows, otherTyping, loading, minimized]);

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

  const avatar = (size: string, text: string) => (
    <span className="relative shrink-0">
      <Avatar className={size}>
        <AvatarImage src={recipient.photoURL} alt="" />
        <AvatarFallback className={cn('bg-primary-soft font-semibold text-primary-soft-foreground', text)}>
          {(recipient.displayName || '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span
        aria-hidden
        className={cn(
          'absolute -bottom-px -right-px h-2 w-2 rounded-full ring-2 ring-card',
          recipientStatus.dot,
        )}
      />
    </span>
  );

  if (minimized) {
    return (
      <div
        className={cn(
          'pointer-events-auto flex h-12 w-48 shrink-0 items-center overflow-hidden rounded-t-xl border border-b-0 border-border bg-card sm:w-60',
          'shadow-[0_-4px_16px_rgba(0,0,0,0.08)]',
          'animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
        )}
      >
        <button
          type="button"
          onClick={onRestore}
          aria-label={`Open chat with ${recipient.displayName}${unread ? ` (${unread} unread)` : ''}`}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 pr-1 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {avatar('h-6 w-6', 'text-xs')}
          <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
            {recipient.displayName}
          </span>
          {unread > 0 && (
            <span className="min-w-[18px] shrink-0 rounded-full bg-destructive px-[5px] text-center text-xs font-semibold leading-[18px] text-destructive-foreground tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
          aria-label={`Close chat with ${recipient.displayName}`}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
        'pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card',
        'shadow-[0_-8px_32px_rgba(0,0,0,0.12)]',
        'w-[calc(100vw-1rem)] sm:w-[22.5rem]',
        'h-[min(32rem,calc(100svh-4rem))]',
        'animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none',
      )}
    >
      <div className="flex min-h-[52px] shrink-0 items-center gap-1 border-b border-border pl-3 pr-1.5">
        {/* Clicking the name minimises, like Teams / LinkedIn. */}
        <button
          type="button"
          onClick={onMinimize}
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left"
        >
          {avatar('h-8 w-8', 'text-sm')}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-[18px] text-foreground">
              {recipient.displayName}
            </span>
            <span
              className={cn(
                'block truncate text-xs leading-4',
                otherTyping || recipientStatus.online ? 'text-success-soft-foreground' : 'text-muted-foreground',
              )}
              title={recipientStatus.title}
            >
              {otherTyping ? 'typing…' : recipientStatus.label}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center">
          {isMediaSupported() && callState.status === 'idle' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={`Voice call ${recipient.displayName}`}
                title={`Voice call ${firstName} only`}
                onClick={() => startCall('audio')}
              >
                <Phone />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={`Video call ${recipient.displayName}`}
                title={`Video call ${firstName} only`}
                onClick={() => startCall('video')}
              >
                <Video />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={onMinimize}
            aria-label={`Minimise chat with ${recipient.displayName}`}
            title="Minimise"
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={onClose}
            aria-label={`Close chat with ${recipient.displayName}`}
            title="Close"
          >
            <X />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1"
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <MessageSquare className="mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Start the conversation</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Send {firstName} a private message.
            </p>
          </div>
        ) : (
          <div>
            {rows.map(({ msg, showDay }, i) => {
              const mine = msg.senderId === user?.userId;
              const prev = messages[i - 1];
              // Group consecutive messages from the same person (Teams style).
              const grouped =
                !showDay &&
                prev?.senderId === msg.senderId &&
                msg.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000;
              const isLast = i === messages.length - 1;
              return (
                <div key={msg.messageId}>
                  {showDay && (
                    <div className="flex items-center gap-3 pb-1 pt-3" role="separator">
                      <span aria-hidden className="h-px flex-1 bg-border" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {messageDayLabel(msg.createdAt)}
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <ChatMessageRow
                    mine={mine}
                    grouped={grouped}
                    authorLabel={mine ? 'You' : firstName}
                    photoURL={recipient.photoURL}
                    createdAt={msg.createdAt}
                    actions={
                      reactionsUnavailable ? undefined : (
                        <ReactionButton
                          mine={mine}
                          open={reactionMenuForId === msg.messageId}
                          onOpenChange={(next) => setReactionMenuForId(next ? msg.messageId : null)}
                          onPick={(emoji) => void handleToggleReaction(msg.messageId, emoji)}
                          disabled={!user}
                        />
                      )
                    }
                    content={msg.body ? <ChatBubble text={msg.body} mine={mine} grouped={grouped} /> : null}
                    footer={
                      <>
                        <ChatAttachmentList attachments={msg.attachments} mine={mine} />
                        <ReactionChips
                          reactions={reactionsByMessageId[msg.messageId]}
                          selfId={user?.userId}
                          mine={mine}
                          onToggle={(emoji) => void handleToggleReaction(msg.messageId, emoji)}
                        />
                        {mine && isLast && (
                          <div className="mt-0.5 text-right text-[0.6875rem] leading-4 text-muted-foreground">
                            {msg.readAt ? 'Seen' : 'Sent'}
                          </div>
                        )}
                      </>
                    }
                  />
                </div>
              );
            })}
            {otherTyping && (
              <div className="mt-3 flex items-center gap-2" role="status">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarImage src={recipient.photoURL} alt="" />
                  <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
                    {(recipient.displayName || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span aria-hidden className="inline-flex h-7 items-center gap-1 rounded-2xl rounded-tl bg-secondary px-3">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                      style={{ animationDelay: `${dot * 200}ms` }}
                    />
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">{firstName} is typing…</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-2.5 pb-2.5 pt-1">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, idx) => (
              <span
                key={`${f.name}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
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
        <div className="flex items-end gap-0.5 rounded-[20px] border border-input p-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
          <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
          <EmojiPickerButton
            value={input}
            onChange={setInput}
            disabled={!user || sending}
            className="rounded-full"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={!user || sending}
            aria-label="Attach file"
            title="Attach file"
          >
            <Paperclip />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim()) notifyTyping();
            }}
            placeholder={`Message ${firstName}…`}
            rows={1}
            className="max-h-32 min-h-8 flex-1 self-center resize-none rounded-md border-0 bg-transparent px-1.5 py-1.5 leading-5 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0"
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
            className="shrink-0 rounded-full"
            disabled={!user || sending || (!input.trim() && pendingFiles.length === 0)}
            onClick={() => void handleSend()}
            aria-label="Send message"
            title="Send (Enter) · Shift+Enter for a new line"
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default DirectMessageWindow;
