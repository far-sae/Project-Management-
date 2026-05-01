import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { isAppOwner } from '@/lib/app-owner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, PlayCircle, LogOut, Clock } from 'lucide-react';
import { TaskCalendarLogo } from '@/components/brand/TaskCalendarLogo';
import { toast } from 'sonner';

/**
 * Workforce gate: every signed-in user (owner, admin, member) must clock in
 * before the app loads. The only escape hatch is the build/support team
 * configured via VITE_APP_OWNER_USER_IDS — they can always sign in to help.
 *
 * When the user is on the clock, children render and the regular UI shows.
 * When they aren't, we show a full-screen "Clock in to start your shift" card.
 */
export const ClockGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, signOut } = useAuth();
  const { openEntry, loading, clockIn } = useTimeTracking();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return <>{children}</>;
  // Build/support team only — never apply the gate to the workspace owner;
  // they need to clock in like everyone else.
  if (isAppOwner(user.userId)) return <>{children}</>;
  // The hook is fast (one query) but on a slow connection we must NOT
  // optimistically render children — that's the bug that let admins bypass.
  // Show a loading screen until we know the entry state.
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </div>
    );
  }
  if (openEntry) return <>{children}</>;

  const handleClockIn = async () => {
    setBusy(true);
    try {
      await clockIn({ notes: notes.trim() || null });
      toast.success(`Welcome, ${user.displayName?.split(' ')[0] ?? 'team'} — you're on the clock`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clock in');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center justify-center gap-2">
            <TaskCalendarLogo sizeClass="h-9 w-9" />
            <span className="text-lg font-semibold">TaskCalendar</span>
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={user.photoURL} alt={user.displayName} />
              <AvatarFallback>
                {user.displayName?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold truncate">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
            <div className="flex items-center gap-2 text-primary-soft-foreground">
              <Clock className="w-4 h-4" />
              <p className="text-sm font-semibold">Clock in to start your shift</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Your work hours will be recorded for the team timesheet. You can
              clock out anytime from the project view or the Time Tracking page.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="clock-gate-notes">What are you working on? (optional)</Label>
            <Input
              id="clock-gate-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Project, task, or anything you want to log"
              disabled={busy}
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={handleClockIn}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <PlayCircle className="w-4 h-4 mr-2" />
            )}
            Clock in
          </Button>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClockGate;
