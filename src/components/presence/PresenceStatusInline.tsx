import React from 'react';
import { cn } from '@/lib/utils';
import type { PresencePeer } from '@/hooks/usePresence';
import { presenceStatus } from '@/lib/presenceStatus';

/** Compact status dot + label for toolbars, chat, and team lists. */
export const PresenceStatusInline: React.FC<{
  peer: PresencePeer | undefined;
  /** Persisted last_seen_at from user_profiles. Drives the "Last seen X ago" copy. */
  lastSeenAt?: Date | null;
  className?: string;
}> = ({ peer, lastSeenAt, className }) => {
  const { label, dot, title } = presenceStatus(peer, lastSeenAt);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={title}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="text-[11px] leading-none text-muted-foreground">{label}</span>
    </span>
  );
};
