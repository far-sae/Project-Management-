import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

// ── Guest admission prompt ──────────────────────────────────

export type GuestDecision = 'admit' | 'deny';

interface GuestAdmitBannersProps {
  guests: CallPeerSnapshot[];
  /** Identities whose admit/deny request is in flight. */
  busy: Record<string, boolean>;
  onDecide: (identity: string, decision: GuestDecision) => void;
  compact?: boolean;
  className?: string;
}

/** One "<Name> (guest) wants to join" row per waiting guest. */
export const GuestAdmitBanners: React.FC<GuestAdmitBannersProps> = ({
  guests,
  busy,
  onDecide,
  compact = false,
  className,
}) => {
  if (guests.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {guests.map((g) => {
        const pending = !!busy[g.userId];
        return (
          <div
            key={g.userId}
            role="status"
            className={cn(
              'flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/95 text-white shadow-lg',
              compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {`${g.displayName || 'Someone'} (guest) wants to join`}
            </span>
            <Button
              size="sm"
              className={cn('shrink-0', compact && 'h-7 px-2 text-xs')}
              disabled={pending}
              onClick={() => onDecide(g.userId, 'admit')}
            >
              Admit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'shrink-0 text-white/80 hover:bg-white/10 hover:text-white',
                compact && 'h-7 px-2 text-xs',
              )}
              disabled={pending}
              onClick={() => onDecide(g.userId, 'deny')}
            >
              Deny
            </Button>
          </div>
        );
      })}
    </div>
  );
};
