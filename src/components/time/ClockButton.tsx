import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, PlayCircle, StopCircle, Timer } from 'lucide-react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { formatDurationSeconds } from '@/services/supabase/timeEntries';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  /** Optional project context — recorded with the time entry so admins can see
   *  what the person was working on. */
  projectId?: string | null;
  projectName?: string | null;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Compact clock-in / clock-out toggle. Shows the live elapsed timer when on
 * the clock so users get visible feedback. Drop into project headers or any
 * page that wants the affordance.
 */
export const ClockButton: React.FC<Props> = ({
  projectId,
  projectName,
  className,
  size = 'md',
}) => {
  const { openEntry, clockIn, clockOut, loading } = useTimeTracking();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  // Tick once a second while on the clock to refresh the displayed timer.
  useEffect(() => {
    if (!openEntry) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [openEntry]);

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (openEntry) {
        await clockOut();
        toast.success('Clocked out');
      } else {
        await clockIn({
          projectId: projectId ?? null,
          projectName: projectName ?? null,
        });
        toast.success('Clocked in');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update clock');
    } finally {
      setBusy(false);
    }
  };

  const onClock = !!openEntry;
  const elapsed = openEntry
    ? Math.floor((Date.now() - openEntry.clockedInAt.getTime()) / 1000)
    : 0;

  return (
    <Button
      type="button"
      onClick={handleToggle}
      disabled={busy || loading}
      variant={onClock ? 'destructive' : 'default'}
      size={size === 'sm' ? 'sm' : 'default'}
      className={cn(
        'gap-1.5',
        onClock && 'bg-emerald-600 hover:bg-emerald-700 text-white',
        className,
      )}
      aria-label={onClock ? 'Clock out' : 'Clock in'}
      title={onClock ? 'You are on the clock — click to clock out' : 'Clock in'}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : onClock ? (
        <>
          <Timer className="w-4 h-4" />
          <span className="font-mono tabular-nums text-xs">
            {formatDurationSeconds(elapsed)}
          </span>
          <StopCircle className="w-4 h-4" />
        </>
      ) : (
        <>
          <PlayCircle className="w-4 h-4" />
          Clock in
        </>
      )}
    </Button>
  );
};

export default ClockButton;
