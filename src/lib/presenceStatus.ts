import type { PresencePeer } from '@/hooks/usePresence';
import { formatLastSeen, isUserOnline } from '@/services/supabase/lastSeen';

export interface PresenceStatus {
  /** "Online", "Last seen 5 min ago", "Do not disturb", "Offline"… */
  label: string;
  /** Green dot. */
  online: boolean;
  /** Tailwind class for the status dot. */
  dot: string;
  /** Exact last-seen time for a tooltip. */
  title: string;
}

function exact(lastSeenAt: Date | null | undefined): string {
  if (!lastSeenAt) return '';
  const date = lastSeenAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = lastSeenAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Last seen ${date}, ${time}`;
}

/**
 * One rule for "is this person online?" everywhere (team list, chat header):
 * live presence first, then a recent heartbeat, then "Last seen X ago".
 */
export function presenceStatus(
  peer: PresencePeer | undefined,
  lastSeenAt: Date | null | undefined,
  now: Date = new Date(),
): PresenceStatus {
  const t = now.getTime();
  const away = (dot: string): PresenceStatus => {
    const label = formatLastSeen(lastSeenAt, false, t);
    return { label, online: false, dot, title: exact(lastSeenAt) || label };
  };

  if (peer) {
    if (peer.availability === 'offline') return away('bg-muted-foreground/70');
    if (peer.availability === 'dnd') return { label: 'Do not disturb', online: true, dot: 'bg-amber-500', title: 'Do not disturb' };
    if (peer.availability === 'holiday') return { label: 'Holiday', online: false, dot: 'bg-sky-500', title: 'On holiday' };
    return { label: 'Online', online: true, dot: 'bg-success', title: 'Online now' };
  }
  if (isUserOnline(lastSeenAt, t)) return { label: 'Online', online: true, dot: 'bg-success', title: 'Online now' };
  return away('bg-muted-foreground/60');
}
