import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, RefreshCw, Plus, Save, Pencil, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { loadFailureMessage } from '@/lib/email/schemaErrors';
import { LoadFailure } from './LoadFailure';
import { format } from 'date-fns';
import { listGroups, saveGroup, deleteGroup, listProspects } from '@/services/supabase/emailAudience';
import type { EmailGroup } from '@/lib/email/types';

interface GroupsTabProps {
  orgId: string;
  workspaceId: string | null;
}

interface GroupFormState {
  name: string;
  angle: string;
}

const EMPTY_GROUP_FORM: GroupFormState = { name: '', angle: '' };

export const GroupsTab: React.FC<GroupsTabProps> = ({ orgId, workspaceId }) => {
  const [groups, setGroups] = useState<EmailGroup[]>([]);
  /**
   * How many prospects sit in each group. Counted from the prospect list
   * rather than asked for separately: the same read already backs the
   * Prospects tab, and a group with no members is the thing this screen most
   * needs to be able to show.
   */
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  /**
   * The load failure, kept in state rather than only shown as a toast.
   *
   * A toast disappears while the problem does not, and the list underneath it
   * is empty either way — so a failed load rendered the same "No groups yet"
   * message as a genuinely empty one, and the cause was invisible. The empty
   * state below is now only reachable when this is null.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!orgId) { setGroups([]); setMemberCounts({}); setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    // Cleared on the way IN, so a retry that succeeds takes the error box away
    // rather than leaving a stale failure above fresh data.
    setLoadError(null);
    try {
      const [segments, people] = await Promise.all([
        listGroups(orgId, workspaceId),
        listProspects(orgId, workspaceId),
      ]);
      setGroups(segments);
      const counts: Record<string, number> = {};
      for (const p of people) {
        if (p.groupId) counts[p.groupId] = (counts[p.groupId] ?? 0) + 1;
      }
      setMemberCounts(counts);
    } catch (err) {
      // Both: the toast says it just happened, the state says it is still
      // true. Where the cause is a migration that has not been run,
      // loadFailureMessage names the migration instead of relaying
      // PostgREST's "could not find the table in the schema cache".
      const message = loadFailureMessage(err, 'Failed to load groups');
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const withoutAngle = useMemo(
    () => groups.filter((g) => !g.angle.trim()).length,
    [groups],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_GROUP_FORM);
    setSaveError(null);
    setShowDialog(true);
  };

  const openEdit = (group: EmailGroup) => {
    setEditingId(group.id);
    setForm({ name: group.name, angle: group.angle });
    setSaveError(null);
    setShowDialog(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveGroup({
        ...(editingId ? { id: editingId } : {}),
        organizationId: orgId,
        workspaceId,
        name: form.name,
        angle: form.angle,
      });
      setShowDialog(false);
      await load(true);
      toast.success(editingId ? 'Group saved' : 'Group created');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: EmailGroup) => {
    const count = memberCounts[group.id] ?? 0;
    // The reassurance people need before clicking: `group_id` is
    // `on delete set null` (migration 162d), so the segment is a label and
    // removing the label never removes the people.
    const consequence = count === 0
      ? 'It has no prospects in it.'
      : `Its ${count} prospect${count === 1 ? '' : 's'} are kept — they are released from the group, not deleted.`;
    if (!window.confirm(`Delete the group "${group.name}"? ${consequence}`)) return;
    setDeletingId(group.id);
    try {
      await deleteGroup(group.id);
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
      toast.success('Group deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Groups</CardTitle>
            <p className="text-sm text-muted-foreground">
              A segment of your prospects and the angle you write to it with.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />New group
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Not an error — a group without an angle still segments perfectly
              well. But the angle is the half that gets used while writing, and
              a list of bare names is the failure mode this screen exists to
              avoid. */}
          {!loading && withoutAngle > 0 && (
            <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              {withoutAngle === 1 ? '1 group has' : `${withoutAngle} groups have`} no angle written
              down. A name on its own says nothing while you are writing — say how this segment is
              approached.
            </div>
          )}

          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading groups...</p>
            </div>
          ) : loadError ? (
            /* Before every empty state, never after one: an empty state is a
               statement that the request succeeded and found nothing, and it
               must not be reachable when the request failed. */
            <LoadFailure message={loadError} onRetry={() => load()} retrying={refreshing} />
          ) : groups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FolderOpen className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">No groups yet</p>
              <p className="text-sm">
                Create one to split your prospects by the angle you write to them with.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const count = memberCounts[group.id] ?? 0;
                return (
                  <div
                    key={group.id}
                    className="flex items-start justify-between gap-4 p-3 bg-secondary/40 border border-border rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{group.name}</p>
                        <Badge variant="outline">
                          {count} prospect{count === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      {group.angle.trim() ? (
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">
                          {group.angle}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1 italic">No angle yet</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {format(group.updatedAt, 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${group.name}`}
                        onClick={() => openEdit(group)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${group.name}`}
                        disabled={deletingId === group.id}
                        onClick={() => handleDelete(group)}
                      >
                        {deletingId === group.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4 text-red-600" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit group' : 'New group'}</DialogTitle>
            <DialogDescription>
              A segment of prospects, and the angle you write to it with. Deleting a group later
              releases its prospects rather than deleting them.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {saveError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="group-name">Name *</Label>
              <Input
                id="group-name"
                value={form.name}
                placeholder="Agencies"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>

            {/* A textarea, not an input: the angle is a sentence or two that
                somebody reads while writing, and a single line encourages a
                label where the useful half belongs. */}
            <div className="space-y-2">
              <Label htmlFor="group-angle">Angle</Label>
              <Textarea
                id="group-angle"
                value={form.angle}
                placeholder="Lead with the white-label workflow — they resell to their own clients and cannot show our branding."
                className="min-h-[100px]"
                onChange={(e) => setForm((f) => ({ ...f, angle: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                How this segment is approached — the point of the group. Available as{' '}
                <code>{'{{angle}}'}</code> in a template, so one template can serve several groups.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : editingId ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                {editingId ? 'Save' : 'Create group'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GroupsTab;
