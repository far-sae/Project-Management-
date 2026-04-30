import { supabase } from '@/services/supabase/config';
import type { SignalMessage } from './types';

type MessageHandler = (msg: SignalMessage) => void;

/**
 * Thin wrapper over a Supabase Realtime broadcast channel used for
 * exchanging WebRTC signaling messages (SDP offers/answers + ICE candidates).
 *
 * Messages are broadcast (ephemeral) — they are NOT persisted to any table.
 */
export class SignalingChannel {
  private channel: ReturnType<typeof supabase.channel>;
  private handlers: MessageHandler[] = [];
  private subscribed = false;
  private subscribePromise: Promise<void> | null = null;

  constructor(
    /** Unique channel id — typically `call:<callId>` */
    channelId: string,
    /** Local user id — reserved for future filtering of own broadcasts. */
    _localUserId: string,
  ) {
    this.channel = supabase.channel(channelId, {
      config: { broadcast: { self: false } },
    });
    // Register once; subscribe() only attaches the Realtime subscription so retries
    // do not stack duplicate broadcast handlers.
    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const msg = payload as SignalMessage;
      for (const h of this.handlers) h(msg);
    });
  }

  /**
   * Start listening for signaling messages. Safe to call multiple times.
   * Resolves when the Realtime channel reaches SUBSCRIBED (so send() is safe).
   */
  subscribe(): Promise<void> {
    if (this.subscribed) return Promise.resolve();
    if (this.subscribePromise) return this.subscribePromise;

    this.subscribePromise = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      this.channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          settle(() => {
            this.subscribed = true;
            resolve();
          });
          return;
        }
        settle(() => {
          this.subscribed = false;
          this.subscribePromise = null;
          reject(
            err instanceof Error
              ? err
              : new Error(
                  `Signaling subscribe failed: ${String(status)}${err != null ? ` ${String(err)}` : ''}`,
                ),
          );
        });
      });
    });

    return this.subscribePromise;
  }

  /** Register a handler invoked for every incoming signal message. */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** Broadcast a signal message to all other subscribers on this channel. */
  send(msg: SignalMessage): void {
    void this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: msg,
    });
  }

  /** Tear down the channel. Call this when the call ends. */
  destroy(): void {
    this.handlers = [];
    this.subscribed = false;
    this.subscribePromise = null;
    void supabase.removeChannel(this.channel);
  }
}
