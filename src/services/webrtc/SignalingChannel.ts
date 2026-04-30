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

  constructor(
    /** Unique channel id — typically `call:<callId>` */
    channelId: string,
    /** The local user id — reserved for future filtering of own broadcasts. */
    _localUserId: string,
  ) {
    this.channel = supabase.channel(channelId, {
      config: { broadcast: { self: false } },
    });
  }

  /** Start listening for signaling messages. Safe to call multiple times. */
  subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    this.channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const msg = payload as SignalMessage;
        for (const h of this.handlers) h(msg);
      })
      .subscribe();
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
    void supabase.removeChannel(this.channel);
  }
}
