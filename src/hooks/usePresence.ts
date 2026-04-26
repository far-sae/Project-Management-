import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/context/AuthContext';

export interface PresencePeer {
  userId: string;
  displayName: string;
  photoURL?: string;
  /** Optional task the peer is currently focused on. */
  currentTaskId?: string | null;
  /** When the user last broadcast a `typing` event for the current task. */
  typingTaskId?: string | null;
  typingAt?: number;
  joinedAt: number;
}

interface UsePresenceOptions {
  /** Stable channel key, e.g. project id. */
  channelKey: string | null;
  /** When set, the user broadcasts they are looking at this task. */
  currentTaskId?: string | null;
}

interface UsePresenceResult {
  peers: PresencePeer[];
  selfKey: string | null;
  /** Broadcast that the current user is typing in `taskId`'s comment box. */
  broadcastTyping: (taskId: string) => void;
  /** Peers currently typing in `taskId`. Returns peers that emitted a typing
   *  event in the last 3000ms. */
  typingPeers: (taskId: string) => PresencePeer[];
}

const TYPING_TTL_MS = 3000;

/**
 * Realtime presence + typing indicators per channel (project).
 * - Each user "tracks" themselves with `{ userId, displayName, photoURL,
 *   currentTaskId }` so peers know who is online and which task they have
 *   open.
 * - Typing events are sent over a `broadcast` event, which avoids storing
 *   transient state in presence and keeps things lightweight.
 */
export const usePresence = ({
  channelKey,
  currentTaskId,
}: UsePresenceOptions): UsePresenceResult => {
  const { user } = useAuth();
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [selfKey, setSelfKey] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Mutable typing map keyed by `${userId}:${taskId}` -> last typing timestamp
  const typingMap = useRef(new Map<string, { peer: PresencePeer; at: number; taskId: string }>());
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!channelKey || !user?.userId) return;

    const channel = supabase.channel(`presence-${channelKey}`, {
      config: { presence: { key: user.userId } },
    });
    channelRef.current = channel;

    const meta: PresencePeer = {
      userId: user.userId,
      displayName: user.displayName || user.email || 'Someone',
      photoURL: user.photoURL || undefined,
      currentTaskId: currentTaskId ?? null,
      joinedAt: Date.now(),
    };

    const collect = () => {
      const state = channel.presenceState() as Record<
        string,
        Array<PresencePeer & { presence_ref?: string }>
      >;
      const list: PresencePeer[] = [];
      for (const [, metas] of Object.entries(state)) {
        if (!metas?.length) continue;
        // Use the latest meta entry for that user
        const last = metas[metas.length - 1];
        list.push({
          userId: last.userId,
          displayName: last.displayName,
          photoURL: last.photoURL,
          currentTaskId: last.currentTaskId ?? null,
          joinedAt: last.joinedAt ?? Date.now(),
        });
      }
      setPeers(list);
    };

    channel
      .on('presence', { event: 'sync' }, collect)
      .on('presence', { event: 'join' }, collect)
      .on('presence', { event: 'leave' }, collect)
      .on('broadcast', { event: 'typing' }, (msg) => {
        const payload = msg.payload as
          | {
              userId: string;
              displayName: string;
              photoURL?: string;
              taskId: string;
            }
          | undefined;
        if (!payload?.userId || !payload.taskId) return;
        if (payload.userId === user.userId) return;
        typingMap.current.set(`${payload.userId}:${payload.taskId}`, {
          peer: {
            userId: payload.userId,
            displayName: payload.displayName,
            photoURL: payload.photoURL,
            joinedAt: Date.now(),
          },
          at: Date.now(),
          taskId: payload.taskId,
        });
        forceTick((n) => n + 1);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setSelfKey(user.userId);
          await channel.track(meta);
        }
      });

    return () => {
      try {
        channel.untrack().catch(() => {});
        supabase.removeChannel(channel);
      } catch {
        /* noop */
      }
      channelRef.current = null;
      setPeers([]);
      setSelfKey(null);
      typingMap.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, user?.userId]);

  // Re-track when currentTaskId changes without recreating the channel
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !user?.userId) return;
    const meta: PresencePeer = {
      userId: user.userId,
      displayName: user.displayName || user.email || 'Someone',
      photoURL: user.photoURL || undefined,
      currentTaskId: currentTaskId ?? null,
      joinedAt: Date.now(),
    };
    channel.track(meta).catch(() => {});
  }, [currentTaskId, user?.userId, user?.displayName, user?.email, user?.photoURL]);

  // Periodically prune expired typing entries
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      let mutated = false;
      for (const [key, entry] of typingMap.current.entries()) {
        if (now - entry.at > TYPING_TTL_MS) {
          typingMap.current.delete(key);
          mutated = true;
        }
      }
      if (mutated) forceTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const broadcastTyping = useCallback(
    (taskId: string) => {
      const channel = channelRef.current;
      if (!channel || !user?.userId) return;
      channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: user.userId,
          displayName: user.displayName || user.email || 'Someone',
          photoURL: user.photoURL || undefined,
          taskId,
        },
      });
    },
    [user?.userId, user?.displayName, user?.email, user?.photoURL],
  );

  const typingPeers = useCallback(
    (taskId: string): PresencePeer[] => {
      const now = Date.now();
      const list: PresencePeer[] = [];
      for (const entry of typingMap.current.values()) {
        if (entry.taskId !== taskId) continue;
        if (now - entry.at > TYPING_TTL_MS) continue;
        list.push(entry.peer);
      }
      return list;
    },
    [],
  );

  const stablePeers = useMemo(() => {
    return peers.slice().sort((a, b) => a.joinedAt - b.joinedAt);
  }, [peers]);

  return { peers: stablePeers, selfKey, broadcastTyping, typingPeers };
};

export default usePresence;
