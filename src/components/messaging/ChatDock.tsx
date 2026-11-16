import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DM_RECEIVED_EVENT, type DmReceivedDetail } from '@/hooks/useIncomingMessageAlerts';
import { DirectMessageWindow } from './DirectMessageWindow';
import {
  chatDockReducer,
  deserializeDock,
  serializeDock,
  type ChatDockAction,
  type ChatDockState,
  type DockRecipient,
} from './chatDockState';

/**
 * Teams-style chat dock. One-to-one chats sit along the bottom-right of every
 * page; minimising shrinks a chat to a bar (it never just vanishes), and the
 * open chats are remembered per user across pages and reloads.
 */

interface ChatDockApi {
  openChat: (recipient: DockRecipient) => void;
  /** Keep the dock clear of a panel on the right (in rem); null = default. */
  setRightInset: (rem: number | null) => void;
}

const noop: ChatDockApi = { openChat: () => undefined, setRightInset: () => undefined };
const ChatDockContext = createContext<ChatDockApi>(noop);

export const useChatDock = (): ChatDockApi => useContext(ChatDockContext);

/** Reserve space on the right for a panel while it's mounted (e.g. project chat). */
export function useChatDockInset(rem: number | null): void {
  const { setRightInset } = useChatDock();
  useEffect(() => {
    setRightInset(rem);
    return () => setRightInset(null);
  }, [rem, setRightInset]);
}

const storageKey = (userId: string) => `taskcalendar:chat-dock:${userId}`;

function loadDock(userId: string | undefined): ChatDockState {
  if (!userId) return { chats: [] };
  try {
    return deserializeDock(localStorage.getItem(storageKey(userId)));
  } catch {
    return { chats: [] };
  }
}

/** How many chats can be open side by side at the current window width. */
function maxExpandedForViewport(): number {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  if (w < 640) return 1;
  if (w < 1100) return 2;
  return 3;
}

const DEFAULT_INSET_REM = 1;

export const ChatDockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.userId;
  const [store, setStore] = useState<{ owner: string | undefined; dock: ChatDockState }>(() => ({
    owner: userId,
    dock: loadDock(userId),
  }));
  // Signed-in user changed: load their dock (derived state, no flash).
  if (store.owner !== userId) setStore({ owner: userId, dock: loadDock(userId) });
  const dock = store.owner === userId ? store.dock : loadDock(userId);

  const dispatch = useCallback((action: ChatDockAction) => {
    setStore((s) => ({ ...s, dock: chatDockReducer(s.dock, action) }));
  }, []);

  useEffect(() => {
    if (!userId || store.owner !== userId) return;
    try {
      localStorage.setItem(storageKey(userId), serializeDock(store.dock));
    } catch {
      /* storage unavailable — dock still works for this session */
    }
  }, [store, userId]);

  // A new message from someone: add their chat as a bar (unread count shows).
  useEffect(() => {
    if (!userId) return;
    const onDm = (e: Event) => {
      const d = (e as CustomEvent<DmReceivedDetail>).detail;
      if (!d?.senderId || d.senderId === userId) return;
      dispatch({
        type: 'incoming',
        recipient: { userId: d.senderId, displayName: d.displayName, organizationId: d.organizationId },
      });
    };
    window.addEventListener(DM_RECEIVED_EVENT, onDm);
    return () => window.removeEventListener(DM_RECEIVED_EVENT, onDm);
  }, [userId, dispatch]);

  const [insetRem, setInsetRem] = useState<number | null>(null);

  const api = useMemo<ChatDockApi>(
    () => ({
      openChat: (recipient) => {
        if (!recipient.userId || recipient.userId === userId) return;
        dispatch({ type: 'open', recipient, maxExpanded: maxExpandedForViewport() });
      },
      setRightInset: setInsetRem,
    }),
    [dispatch, userId],
  );

  return (
    <ChatDockContext.Provider value={api}>
      {children}
      {userId && dock.chats.length > 0 && (
        <div
          // z-45: above the project chat (z-40), below dialogs (z-50).
          className="pointer-events-none fixed bottom-0 left-2 right-2 z-[45] flex flex-row-reverse items-end gap-2 overflow-x-auto sm:left-auto sm:right-[var(--chat-dock-right)] sm:max-w-[calc(100vw-var(--chat-dock-right)-1rem)]"
          style={{ ['--chat-dock-right' as string]: `${insetRem ?? DEFAULT_INSET_REM}rem` }}
          aria-label="Chats"
        >
          {dock.chats.map((c) => (
            <DirectMessageWindow
              key={c.recipient.userId}
              recipient={c.recipient}
              organizationId={c.recipient.organizationId ?? user?.organizationId ?? null}
              minimized={c.minimized}
              onMinimize={() => dispatch({ type: 'minimize', userId: c.recipient.userId })}
              onRestore={() =>
                dispatch({ type: 'open', recipient: c.recipient, maxExpanded: maxExpandedForViewport() })
              }
              onClose={() => dispatch({ type: 'close', userId: c.recipient.userId })}
            />
          ))}
        </div>
      )}
    </ChatDockContext.Provider>
  );
};
