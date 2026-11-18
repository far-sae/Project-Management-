import React from 'react';
import { cn } from '@/lib/utils';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { CALL_BORDER, CALL_SURFACE } from './callTheme';

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
  // 32px buttons on the call screen, 28px in the small floating call.
  const button = cn(
    'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
    'disabled:pointer-events-none disabled:opacity-50',
    compact ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
  );
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {guests.map((g) => {
        const pending = !!busy[g.userId];
        return (
          <div
            key={g.userId}
            role="status"
            className={cn(
              'flex items-center gap-2 border text-white shadow-[0_12px_32px_rgba(0,0,0,0.24)]',
              CALL_BORDER,
              CALL_SURFACE,
              compact ? 'rounded-lg py-1.5 pl-2.5 pr-1.5 text-xs' : 'rounded-xl py-2 pl-3 pr-2 text-sm',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {`${g.displayName || 'Someone'} (guest) wants to join`}
            </span>
            <button
              type="button"
              className={cn(button, 'bg-primary text-primary-foreground hover:bg-primary/90')}
              disabled={pending}
              onClick={() => onDecide(g.userId, 'admit')}
            >
              Admit
            </button>
            <button
              type="button"
              className={cn(button, 'text-white hover:bg-[#3a3a3a]')}
              disabled={pending}
              onClick={() => onDecide(g.userId, 'deny')}
            >
              Deny
            </button>
          </div>
        );
      })}
    </div>
  );
};
