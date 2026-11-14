import { useEffect } from 'react';
import { supabase } from '@/services/supabase/config';
import { playChatChime } from '@/lib/notificationSound';
import { appIsInFront } from '@/services/calling/incomingAlert';

/**
 * Desktop notification for a new chat message when TaskCalendar isn't in
 * front (another tab/app). Needs notification permission — the same
 * "Get alerted…" prompt as calls. Same `tag` replaces rather than stacks.
 */
export function showMessageNotification(p: { title: string; body: string; tag: string }): void {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N || N.permission !== 'granted' || appIsInFront()) return;
  try {
    const n = new N(p.title, { body: p.body, tag: p.tag, icon: '/logo.png' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications unavailable */
  }
}

const nameCache = new Map<string, string>();

async function senderName(userId: string): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached) return cached;
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('display_name, email')
      .eq('id', userId)
      .maybeSingle();
    const row = data as { display_name?: string | null; email?: string | null } | null;
    const name = row?.display_name?.trim() || row?.email?.split('@')[0] || 'a teammate';
    nameCache.set(userId, name);
    return name;
  } catch {
    return 'a teammate';
  }
}

function preview(body: unknown): string {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return 'Sent an attachment';
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/**
 * App-wide: chime (and pop up a desktop notification when the app isn't in
 * front) for every direct message sent to the signed-in user — not only
 * when that chat window happens to be open.
 */
export function useIncomingMessageAlerts(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`dm-alerts-${userId}-${Math.random().toString(36).slice(2, 9)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${userId}`,
        },
        (change: { new: Record<string, unknown> }) => {
          const row = change.new ?? {};
          const sender = typeof row.sender_id === 'string' ? row.sender_id : '';
          if (!sender || sender === userId) return;
          playChatChime();
          if (appIsInFront()) return;
          void senderName(sender).then((name) =>
            showMessageNotification({
              title: `New message from ${name}`,
              body: preview(row.body),
              tag: `taskcalendar-dm-${sender}`,
            }),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
