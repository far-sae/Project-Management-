/**
 * State for the Teams-style chat dock: one-to-one chats docked along the
 * bottom of the screen. A chat is either open (expanded window) or
 * minimised (a small bar). Closing removes it; minimising never does.
 * chats[0] is the newest and sits nearest the right edge.
 */

export interface DockRecipient {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  organizationId?: string | null;
}

export interface DockChat {
  recipient: DockRecipient;
  minimized: boolean;
}

export interface ChatDockState {
  chats: DockChat[];
}

export type ChatDockAction =
  | { type: 'open'; recipient: DockRecipient; maxExpanded: number }
  | { type: 'minimize'; userId: string }
  | { type: 'close'; userId: string }
  | { type: 'incoming'; recipient: DockRecipient };

export const MAX_DOCK_CHATS = 8;

function limitExpanded(chats: DockChat[], maxExpanded: number): DockChat[] {
  let open = 0;
  return chats.map((c) => {
    if (c.minimized) return c;
    open += 1;
    return open > Math.max(1, maxExpanded) ? { ...c, minimized: true } : c;
  });
}

export function chatDockReducer(state: ChatDockState, action: ChatDockAction): ChatDockState {
  switch (action.type) {
    case 'open': {
      const existing = state.chats.find((c) => c.recipient.userId === action.recipient.userId);
      const rest = state.chats.filter((c) => c.recipient.userId !== action.recipient.userId);
      const recipient = { ...existing?.recipient, ...action.recipient };
      const chats = limitExpanded([{ recipient, minimized: false }, ...rest], action.maxExpanded);
      return { chats: chats.slice(0, MAX_DOCK_CHATS) };
    }
    case 'minimize':
      return {
        chats: state.chats.map((c) =>
          c.recipient.userId === action.userId ? { ...c, minimized: true } : c,
        ),
      };
    case 'close':
      return { chats: state.chats.filter((c) => c.recipient.userId !== action.userId) };
    case 'incoming': {
      if (state.chats.some((c) => c.recipient.userId === action.recipient.userId)) return state;
      return {
        chats: [{ recipient: action.recipient, minimized: true }, ...state.chats].slice(0, MAX_DOCK_CHATS),
      };
    }
    default:
      return state;
  }
}

export function serializeDock(state: ChatDockState): string {
  return JSON.stringify(state);
}

/** Parse a saved dock, dropping anything malformed. */
export function deserializeDock(raw: string | null): ChatDockState {
  if (!raw) return { chats: [] };
  try {
    const parsed = JSON.parse(raw) as { chats?: unknown };
    if (!Array.isArray(parsed?.chats)) return { chats: [] };
    const chats: DockChat[] = [];
    for (const c of parsed.chats as Array<Record<string, unknown>>) {
      const r = c?.recipient as Record<string, unknown> | undefined;
      if (!r || typeof r.userId !== 'string' || !r.userId || typeof r.displayName !== 'string') continue;
      const recipient: DockRecipient = { userId: r.userId, displayName: r.displayName };
      if (typeof r.email === 'string') recipient.email = r.email;
      if (typeof r.photoURL === 'string') recipient.photoURL = r.photoURL;
      if (typeof r.organizationId === 'string' || r.organizationId === null) {
        recipient.organizationId = r.organizationId as string | null;
      }
      chats.push({ recipient, minimized: Boolean(c.minimized) });
    }
    return { chats: chats.slice(0, MAX_DOCK_CHATS) };
  } catch {
    return { chats: [] };
  }
}
