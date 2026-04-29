import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Minus, Send } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
  insertDirectMessage,
  markDirectMessagesRead,
  subscribeToDirectMessages,
  type DirectMessage,
} from '@/services/supabase/database';
import { format, isSameDay } from 'date-fns';
import { toast } from 'sonner';

export interface DirectMessageRecipient {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

interface DirectMessageDockProps {
  recipient: DirectMessageRecipient | null;
  organizationId?: string | null;
  onClose: () => void;
}

const messageDayLabel = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return format(date, 'MMM d, yyyy');
};

/** Floating 1-on-1 chat docked to the bottom-left corner. Mirrors the right-rail project
 *  chat visually but talks to the `direct_messages` table (RLS scoped to the two
 *  participants) so the conversation is private to the pair. */
export const DirectMessageDock: React.FC<DirectMessageDockProps> = ({
  recipient,
  organizationId,
  onClose,
}) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!recipient || !user?.userId) return;
    setLoading(true);
    setMessages([]);
    const unsub = subscribeToDirectMessages(user.userId, recipient.userId, (list) => {
      setMessages(list);
      setLoading(false);
    });
    return () => unsub();
  }, [recipient, user?.userId]);

  // Mark messages as read when the dock opens or new messages arrive while it's open.
  useEffect(() => {
    if (!recipient || !user?.userId) return;
    void markDirectMessagesRead(user.userId, recipient.userId);
  }, [recipient, user?.userId, messages.length]);

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
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    if (!recipient || !user?.userId) return;
    const body = input.trim();
    if (!body) return;
    setSending(true);
    stickToBottomRef.current = true;
    try {
      await insertDirectMessage({
        senderId: user.userId,
        recipientId: recipient.userId,
        organizationId: organizationId ?? null,
        body,
      });
      setInput('');
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const lower = raw.toLowerCase();
      if (
        lower.includes('does not exist') ||
        lower.includes('relation') ||
        lower.includes('pgrst205')
      ) {
        toast.error(
          'Direct messages aren’t enabled on this workspace yet. Apply migration 033_direct_messages.sql in Supabase.',
        );
      } else {
        toast.error(raw || 'Could not send message');
      }
    } finally {
      setSending(false);
    }
  }, [recipient, user?.userId, input, organizationId]);

  if (!recipient) return null;

  const railWidth = 'w-[calc(100vw-1.5rem)] sm:w-[min(22rem,calc(100vw-2.5rem))]';

  const rows = messages.map((msg, index) => {
    const createdAt = msg.createdAt;
    const previous = messages[index - 1];
    const showDay = !previous || !isSameDay(previous.createdAt, createdAt);
    return { msg, createdAt, showDay };
  });

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-[100] flex flex-col items-start pointer-events-none sm:inset-x-auto sm:left-5"
      role="complementary"
      aria-label={`Direct message with ${recipient.displayName}`}
    >
      <aside
        className={cn(
          'pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border/70',
          'bg-card/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl',
          railWidth,
          'h-[min(30rem,calc(100svh-2rem))] max-h-[calc(100vh-2rem)]',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={recipient.photoURL} alt={recipient.displayName} />
              <AvatarFallback className="bg-primary-soft text-primary-soft-foreground text-xs">
                {(recipient.displayName || '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate leading-tight">
                {recipient.displayName}
              </p>
              {recipient.email ? (
                <p className="text-[11px] text-muted-foreground truncate">{recipient.email}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Direct message</p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close direct message"
          >
            <Minus className="h-5 w-5" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 scroll-smooth"
        >
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12 px-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-foreground">Start the conversation</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Send {recipient.displayName.split(' ')[0] || recipient.displayName} a private message.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map(({ msg, createdAt, showDay }) => {
                const mine = msg.senderId === user?.userId;
                return (
                  <div key={msg.messageId}>
                    {showDay && (
                      <div className="flex justify-center py-2">
                        <span className="rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                          {messageDayLabel(createdAt)}
                        </span>
                      </div>
                    )}
                    <div className={cn('flex gap-2', mine && 'justify-end')}>
                      <div className={cn('max-w-[78%] min-w-0', mine && 'flex flex-col items-end')}>
                        <div className={cn('mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground', mine && 'justify-end')}>
                          <span className="font-medium text-foreground">{mine ? 'You' : recipient.displayName}</span>
                          <span>{format(createdAt, 'p')}</span>
                        </div>
                        <div
                          className={cn(
                            'rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
                            mine
                              ? 'rounded-br-sm bg-primary text-primary-foreground shadow-sm'
                              : 'rounded-bl-sm bg-muted text-foreground border border-border/60',
                          )}
                        >
                          {msg.body}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/70 bg-card/80 p-2.5">
          <div className="rounded-lg border border-border/60 bg-background/90 p-1.5 transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${recipient.displayName.split(' ')[0] || recipient.displayName}…`}
              rows={2}
              className="min-h-[3rem] resize-none rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
              disabled={!user || sending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5 pt-1">
              <p className="text-[10.5px] text-muted-foreground truncate">
                Enter to send · Shift+Enter for newline
              </p>
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-md px-3 text-xs"
                disabled={!user || !input.trim() || sending}
                onClick={() => void handleSend()}
              >
                {sending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3 h-3 mr-1" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default DirectMessageDock;
