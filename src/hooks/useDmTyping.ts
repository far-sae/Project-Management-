import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/services/supabase/config';

/** How often my own typing is announced while I keep typing. */
const SEND_EVERY_MS = 2000;
/** How long "is typing" stays up after the last announcement from the other person. */
const SHOWN_FOR_MS = 4000;

/**
 * "Alice is typing…" for a one-to-one chat. Both people join one realtime
 * channel named after the pair; typing is announced on it and never stored.
 */
export function useDmTyping(
  selfUserId: string | null | undefined,
  otherUserId: string,
): { otherTyping: boolean; notifyTyping: () => void } {
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!selfUserId || !otherUserId) return;
    const pair = [selfUserId, otherUserId].sort().join('__');
    const channel = supabase
      .channel(`dm-typing-${pair}`)
      .on('broadcast', { event: 'typing' }, (message: { payload?: { userId?: string } }) => {
        if (message.payload?.userId !== otherUserId) return;
        setOtherTyping(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setOtherTyping(false), SHOWN_FOR_MS);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      lastSentRef.current = 0;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setOtherTyping(false);
      void supabase.removeChannel(channel);
    };
  }, [selfUserId, otherUserId]);

  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !selfUserId) return;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_EVERY_MS) return;
    lastSentRef.current = now;
    void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: selfUserId } });
  }, [selfUserId]);

  return { otherTyping, notifyTyping };
}
