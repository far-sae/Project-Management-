import React from 'react';
import { cn } from '@/lib/utils';
import type { PresencePeer, PresenceAvailability } from '@/hooks/usePresence';

interface PresenceAvatarsProps {
  peers: PresencePeer[];
  /** Limit number of avatars; the rest are summarized in a +N pill. */
  max?: number;
  /** Size of each avatar in px. */
  size?: number;
  className?: string;
  /** Show a hover tooltip with the displayName. */
  showLabels?: boolean;
}

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase()).join('');
};

const COLORS = [
  'bg-primary text-primary-foreground',
  'bg-info-soft text-info-soft-foreground',
  'bg-success-soft text-success-soft-foreground',
  'bg-warning-soft text-warning-soft-foreground',
  'bg-destructive-soft text-destructive-soft-foreground',
];

const colorFor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COLORS[h % COLORS.length];
};

const statusClasses = (a?: PresenceAvailability): string => {
  if (!a) return 'bg-success';
  switch (a) {
    case 'online':
      return 'bg-success';
    case 'offline':
      return 'bg-muted-foreground/70';
    case 'dnd':
      return 'bg-amber-500';
    case 'holiday':
      return 'bg-sky-500';
    default:
      return 'bg-success';
  }
};

const statusLabel = (a: PresenceAvailability | undefined): string => {
  if (!a) return 'Online';
  const labels: Record<PresenceAvailability, string> = {
    online: 'Online',
    offline: 'Offline',
    dnd: 'Do not disturb',
    holiday: 'Holiday',
  };
  return labels[a];
};

const buildTitle = (peer: PresencePeer, showLabels: boolean) => {
  if (!showLabels) return undefined;
  const s = statusLabel(peer.availability);
  return s ? `${peer.displayName} — ${s}` : peer.displayName;
};

export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({
  peers,
  max = 4,
  size = 28,
  className,
  showLabels = true,
}) => {
  if (!peers || peers.length === 0) return null;
  const visible = peers.slice(0, max);
  const overflow = peers.length - visible.length;

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-2">
        {visible.map((peer) => (
          <div
            key={peer.userId}
            title={buildTitle(peer, showLabels)}
            className="relative"
            style={{ width: size, height: size }}
          >
            {peer.photoURL ? (
              <img
                src={peer.photoURL}
                alt={peer.displayName}
                className={cn(
                  'rounded-full object-cover ring-2 ring-card',
                )}
                style={{ width: size, height: size }}
              />
            ) : (
              <div
                className={cn(
                  'rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ring-card',
                  colorFor(peer.userId),
                )}
                style={{ width: size, height: size }}
              >
                {initials(peer.displayName)}
              </div>
            )}
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 block w-2.5 h-2.5 rounded-full ring-2 ring-card',
                statusClasses(peer.availability),
              )}
              aria-hidden
            />
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <div
          className="ml-2 inline-flex items-center justify-center rounded-full bg-secondary text-secondary-foreground text-[11px] font-medium px-2 h-6"
          title={peers.slice(max).map((p) => p.displayName).join(', ')}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
};

export default PresenceAvatars;
