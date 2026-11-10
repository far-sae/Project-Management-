import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

const MAX_RETRY_MS = 30_000;

/**
 * Keep the user's personal call inbox (`call-inbox:<userId>`) subscribed.
 *
 * Incoming calls arrive only as realtime broadcasts on this channel. If the
 * subscription errors, times out or closes — common after a laptop sleeps or
 * a background tab gets throttled — the old listener silently stopped
 * receiving, and the person never heard another call until they reloaded.
 * This re-subscribes with backoff, and immediately when the tab comes back
 * into view or the network returns. Returns stop().
 */
export function subscribeCallInbox(
  client: Pick<SupabaseClient, 'channel' | 'removeChannel'>,
  userId: string,
  onSignal: (payload: unknown) => void,
): () => void {
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const retire = (ch: RealtimeChannel | null) => {
    if (ch) void client.removeChannel(ch).catch(() => undefined);
  };

  const connect = () => {
    if (stopped) return;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const old = channel;
    const ch = client.channel(`call-inbox:${userId}`, {
      config: { broadcast: { self: false } },
    });
    channel = ch;
    retire(old);

    ch.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload)).subscribe(
      (status) => {
        if (stopped || channel !== ch) return; // a channel we already replaced
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (retryTimer) return;
          const delay = Math.min(1000 * 2 ** attempt, MAX_RETRY_MS);
          attempt += 1;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
          }, delay);
        }
      },
    );
  };

  const reconnectIfDropped = () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (channel && (channel as { state?: string }).state === 'joined') return;
    attempt = 0;
    connect();
  };

  connect();
  document.addEventListener('visibilitychange', reconnectIfDropped);
  window.addEventListener('online', reconnectIfDropped);
  window.addEventListener('focus', reconnectIfDropped);

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', reconnectIfDropped);
    window.removeEventListener('online', reconnectIfDropped);
    window.removeEventListener('focus', reconnectIfDropped);
    retire(channel);
    channel = null;
  };
}
