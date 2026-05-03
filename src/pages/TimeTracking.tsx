import React, { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Clock, PlayCircle, StopCircle, Loader2, Edit, Trash2, Lock, ShieldAlert,
  Timer,
} from 'lucide-react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { TimeEntry, formatDurationSeconds, type UpdateTimeEntryInput } from '@/services/supabase/timeEntries';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';

/** Live counter for the currently-open entry. */
const LiveDuration: React.FC<{ start: Date }> = ({ start }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
  return <span>{formatDurationSeconds(seconds)}</span>;
};

const toDatetimeLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const TimeTracking: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const {
    loading, entries, ownEntries, openEntry,
    clockIn, clockOut, updateEntry, deleteEntry,
    canViewAll, isOwner,
  } = useTimeTracking();

  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'me' | 'team'>('me');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);

  const filteredOwnEntries = useMemo(
    () => ownEntries.filter((e) => inRange(e.clockedInAt, dateRange)),
    [ownEntries, dateRange],
  );
  const filteredEntries = useMemo(
    () => entries.filter((e) => inRange(e.clockedInAt, dateRange)),
    [entries, dateRange],
  );
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [editForm, setEditForm] = useState({
    clockedInAt: '',
    clockedOutAt: '',
    notes: '',
  });
  const [editBusy, setEditBusy] = useState(false);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleClockIn = async () => {
    setBusy(true);
    try {
      await clockIn({ notes: notes.trim() || null });
      toast.success('Clocked in');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clock in');
    } finally {
      setBusy(false);
    }
  };

  const handleClockOut = async () => {
    setBusy(true);
    try {
      await clockOut(notes.trim() || null);
      toast.success('Clocked out');
      setNotes('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clock out');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (entry: TimeEntry) => {
    setEditing(entry);
    setEditForm({
      clockedInAt: toDatetimeLocal(entry.clockedInAt),
      clockedOutAt: entry.clockedOutAt ? toDatetimeLocal(entry.clockedOutAt) : '',
      notes: entry.notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!isOwner) {
      toast.error('Only the organization owner can edit time entries');
      return;
    }
    setEditBusy(true);
    try {
      const payload: UpdateTimeEntryInput = {
        clockedOutAt: editForm.clockedOutAt
          ? new Date(editForm.clockedOutAt)
          : null,
        notes: editForm.notes,
      };
      if (editForm.clockedInAt.trim()) {
        payload.clockedInAt = new Date(editForm.clockedInAt);
      }
      await updateEntry(editing.entryId, payload);
      toast.success('Time entry updated');
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update entry');
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || !isOwner) return;
    setDeleteBusy(true);
    try {
      await deleteEntry(deleting.entryId);
      toast.success('Time entry deleted');
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeleteBusy(false);
    }
  };

  // Per-user totals for the team view (owner + admin only). Reflects the
  // active date range so totals match what's in the table below.
  const memberTotals = useMemo(() => {
    const map = new Map<
      string,
      { userId: string; userName: string; total: number; openCount: number }
    >();
    filteredEntries.forEach((e) => {
      const cur = map.get(e.userId) ?? {
        userId: e.userId,
        userName: e.userName ?? e.userId,
        total: 0,
        openCount: 0,
      };
      cur.total += e.durationSeconds ?? 0;
      if (!e.clockedOutAt) cur.openCount += 1;
      map.set(e.userId, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredEntries]);

  const memberPhoto = (uid: string) =>
    organization?.members?.find((m) => m.userId === uid)?.photoURL ?? '';

  const renderEntryRow = (e: TimeEntry) => {
    const userIsSelf = e.userId === user?.userId;
    const canEdit = isOwner;
    return (
      <tr key={e.entryId} className="border-b border-border last:border-0">
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="w-7 h-7 shrink-0">
              <AvatarImage src={memberPhoto(e.userId)} alt={e.userName ?? ''} />
              <AvatarFallback className="text-[10px]">
                {(e.userName ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {e.userName ?? 'Unknown'}{userIsSelf ? ' (you)' : ''}
              </p>
              {e.notes && (
                <p className="text-xs text-muted-foreground truncate">
                  {e.notes}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="py-2 pr-4 text-sm">
          {format(e.clockedInAt, 'MMM d, p')}
        </td>
        <td className="py-2 pr-4 text-sm">
          {e.clockedOutAt ? format(e.clockedOutAt, 'MMM d, p') : (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
              <Timer className="w-3 h-3 mr-1" /> on the clock
            </Badge>
          )}
        </td>
        <td className="py-2 pr-4 text-sm font-mono">
          {e.clockedOutAt
            ? formatDurationSeconds(e.durationSeconds)
            : <LiveDuration start={e.clockedInAt} />}
        </td>
        <td className="py-2 text-right">
          {canEdit ? (
            <div className="inline-flex gap-1">
              <Button
                size="icon" variant="ghost" className="h-8 w-8"
                onClick={() => openEdit(e)}
                aria-label="Edit time entry"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => setDeleting(e)}
                aria-label="Delete time entry"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <span title="Only the owner can edit time entries">
              <Lock className="w-3.5 h-3.5 text-muted-foreground inline" />
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex h-screen bg-background pt-12 md:pt-0 overflow-x-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Clock className="w-6 h-6 text-primary" /> Time Tracking
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Clock in / clock out, see your hours.
                {canViewAll && ' Owner + admin can view the whole team.'}
                {!isOwner && ' Only the owner can edit time entries.'}
              </p>
            </div>
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          </div>

          {/* Clock in/out card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Your status</span>
                {openEntry ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    <Timer className="w-3 h-3 mr-1" /> On the clock
                  </Badge>
                ) : (
                  <Badge variant="outline">Off the clock</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {openEntry && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                  Started {format(openEntry.clockedInAt, 'MMM d, p')} — running for{' '}
                  <span className="font-mono font-semibold">
                    <LiveDuration start={openEntry.clockedInAt} />
                  </span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="time-notes">Notes (optional)</Label>
                <Input
                  id="time-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What are you working on?"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {!openEntry ? (
                  <Button onClick={handleClockIn} disabled={busy}>
                    {busy ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <PlayCircle className="w-4 h-4 mr-2" />
                    )}
                    Clock in
                  </Button>
                ) : (
                  <Button
                    onClick={handleClockOut}
                    disabled={busy}
                    variant="destructive"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <StopCircle className="w-4 h-4 mr-2" />
                    )}
                    Clock out
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tabs: Me / Team */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'me' | 'team')}>
            <TabsList>
              <TabsTrigger value="me">My hours</TabsTrigger>
              {canViewAll && <TabsTrigger value="team">Everyone</TabsTrigger>}
            </TabsList>

            <TabsContent value="me" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Your time entries</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredOwnEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {ownEntries.length === 0
                        ? 'No time entries yet — clock in above to start tracking.'
                        : 'No time entries in this date range.'}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                          <tr>
                            <th className="py-2 pr-4">Member</th>
                            <th className="py-2 pr-4">Clock in</th>
                            <th className="py-2 pr-4">Clock out</th>
                            <th className="py-2 pr-4">Duration</th>
                            <th className="py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>{filteredOwnEntries.map(renderEntryRow)}</tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {canViewAll && (
              <TabsContent value="team" className="mt-4 space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Totals by member</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {memberTotals.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        Nobody has clocked time yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {memberTotals.map((m) => (
                          <li key={m.userId} className="flex items-center gap-3 py-2">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={memberPhoto(m.userId)} alt={m.userName} />
                              <AvatarFallback className="text-[11px]">
                                {m.userName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {m.userName}
                              </p>
                              {m.openCount > 0 && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                  Currently on the clock
                                </p>
                              )}
                            </div>
                            <span className="text-sm font-mono">
                              {formatDurationSeconds(m.total)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <CardTitle className="text-base">All time entries</CardTitle>
                    {!isOwner && (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        View-only — owner edits
                      </span>
                    )}
                  </CardHeader>
                  <CardContent>
                    {filteredEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        {entries.length === 0
                          ? 'No entries yet.'
                          : 'No entries in this date range.'}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                            <tr>
                              <th className="py-2 pr-4">Member</th>
                              <th className="py-2 pr-4">Clock in</th>
                              <th className="py-2 pr-4">Clock out</th>
                              <th className="py-2 pr-4">Duration</th>
                              <th className="py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>{filteredEntries.map(renderEntryRow)}</tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </main>

      {/* Owner-only edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit time entry</DialogTitle>
            <DialogDescription>
              Adjust clock-in / clock-out times. This is restricted to the
              organization owner.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-in">Clocked in</Label>
              <Input
                id="edit-in"
                type="datetime-local"
                value={editForm.clockedInAt}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, clockedInAt: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-out" className="flex items-center gap-2">
                Clocked out
                <span className="text-xs text-muted-foreground">
                  (leave blank if still on the clock)
                </span>
              </Label>
              <Input
                id="edit-out"
                type="datetime-local"
                value={editForm.clockedOutAt}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, clockedOutAt: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={editBusy}>
              {editBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete time entry?</DialogTitle>
            <DialogDescription>
              This permanently removes the entry for{' '}
              <strong>{deleting?.userName ?? 'this member'}</strong>. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy || !isOwner}
              aria-busy={deleteBusy}
            >
              {deleteBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TimeTracking;
