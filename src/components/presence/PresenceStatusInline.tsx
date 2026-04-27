import React from 'react';
import { cn } from '@/lib/utils';
import type { PresencePeer } from '@/hooks/usePresence';

const dotAndLabel = (peer: PresencePeer | undefined): { label: string; dot: string } => {
  if (!peer) {
    return { label: 'Offline', dot: 'bg-muted-foreground/60' };
  }
  const a = peer.availability;
  if (a === 'offline') {
    return { label: 'Offline', dot: 'bg-muted-foreground/70' };
  }
  if (a === 'dnd') {
    return { label: 'Do not disturb', dot: 'bg-amber-500' };
  }
  if (a === 'holiday') {
    return { label: 'Holiday', dot: 'bg-sky-500' };
  }
  return { label: 'Online', dot: 'bg-success' };
};

/** Compact status dot + label for toolbars, chat, and team lists. */
export const PresenceStatusInline: React.FC<{
  peer: PresencePeer | undefined;
  className?: string;
}> = ({ peer, className }) => {
  const { label, dot } = dotAndLabel(peer);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={label}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} aria-hidden />
      <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
    </span>
  );
};
