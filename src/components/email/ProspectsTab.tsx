import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2, RefreshCw, Plus, Save, Search, Users, Check, Pencil, Trash2, FolderInput,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  listProspects, listGroups, saveProspect, assignGroup, deleteProspect,
} from '@/services/supabase/emailAudience';
import type { EmailGroup, EmailProspect, SuppressionReason } from '@/lib/email/types';

interface ProspectsTabProps {
  orgId: string;
  workspaceId: string | null;
}

/**
 * Sentinels for the group selects. Radix's Select reserves `''` for "nothing
 * chosen" and refuses it as an item value, and both "every group" and "no
 * group at all" are real, choosable filters rather than an empty field.
 */
const ALL_GROUPS = '__all_groups__';
const NO_GROUP = '__no_group__';

/** Shared by the header and every row so the columns line up. */
const ROW_GRID =
  'grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,6.5rem)_auto] gap-3 items-center px-3 py-2';

/**
 * Why this address will not be mailed, in the words a person would use.
 *
 * READ-ONLY, and deliberately so: the fact lives in `email_suppressions`,
 * which claim_email_batch() enforces on every send, the unsubscribe endpoint
 * writes and a hard bounce adds to. Nothing on this screen writes a status
 * onto the contact — a second flag would be a second answer to the one
 * question the law cares about, and the two would disagree within a week.
 * Removing an address is done on the Suppression tab.
 */
const suppressionBadge = (reason: SuppressionReason) => {
  switch (reason) {
    case 'bounced':
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30">Bounced</Badge>;
    case 'complaint':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">Marked as spam</Badge>;
    case 'unsubscribed':
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">Unsubscribed</Badge>;
    default:
      return <Badge variant="secondary">Suppressed by hand</Badge>;
  }
};

interface ProspectFormState {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  painPoint: string;
  groupId: string;
}

const EMPTY_PROSPECT_FORM: ProspectFormState = {
  firstName: '',
  lastName: '',
  email: '',
  jobTitle: '',
  painPoint: '',
  groupId: NO_GROUP,
};

const fullName = (p: EmailProspect) => [p.firstName, p.lastName].filter(Boolean).join(' ').trim();

/** The same square the recipient picker uses, so a checked row looks the same in both places. */
const RowCheckbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <div className={cn(
    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
    checked ? 'bg-primary border-primary' : 'border-input',
  )}>
    {checked && <Check className="h-3 w-3 text-primary-foreground" />}
  </div>
);

export const ProspectsTab: React.FC<ProspectsTabProps> = ({ orgId, workspaceId }) => {
  const [prospects, setProspects] = useState<EmailProspect[]>([]);
  const [groups, setGroups] = useState<EmailGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState<string>(NO_GROUP);
  const [assigning, setAssigning] = useState(false);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProspectFormState>(EMPTY_PROSPECT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!orgId) { setProspects([]); setGroups([]); setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [people, segments] = await Promise.all([
        listProspects(orgId, workspaceId),
        listGroups(orgId, workspaceId),
      ]);
      setProspects(people);
      setGroups(segments);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load prospects');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const groupName = useCallback(
    (id: string | null) => (id ? groups.find((g) => g.id === id)?.name ?? null : null),
    [groups],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (groupFilter === NO_GROUP && p.groupId !== null) return false;
      if (groupFilter !== ALL_GROUPS && groupFilter !== NO_GROUP && p.groupId !== groupFilter) return false;
      if (!term) return true;
      return fullName(p).toLowerCase().includes(term) || (p.email ?? '').toLowerCase().includes(term);
    });
  }, [prospects, search, groupFilter]);

  // Selecting somebody and then filtering them out of sight would assign a
  // person the user can no longer see, so the visible set is the only set.
  const visibleSelected = useMemo(
    () => filtered.filter((p) => selectedIds.has(p.id)),
    [filtered, selectedIds],
  );
  const allVisibleSelected = filtered.length > 0 && visibleSelected.length === filtered.length;

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.id)));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_PROSPECT_FORM);
    setSaveError(null);
    setShowDialog(true);
  };

  const openEdit = (p: EmailProspect) => {
    setEditingId(p.id);
    setForm({
      firstName: p.firstName,
      lastName: p.lastName ?? '',
      email: p.email ?? '',
      jobTitle: p.jobTitle ?? '',
      painPoint: p.painPoint ?? '',
      groupId: p.groupId ?? NO_GROUP,
    });
    setSaveError(null);
    setShowDialog(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !form.firstName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveProspect({
        ...(editingId ? { id: editingId } : {}),
        organizationId: orgId,
        workspaceId,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        jobTitle: form.jobTitle,
        painPoint: form.painPoint,
        groupId: form.groupId === NO_GROUP ? null : form.groupId,
      });
      setShowDialog(false);
      await load(true);
      toast.success(editingId ? 'Prospect saved' : 'Prospect added');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save prospect');
    } finally {
      setSaving(false);
    }
  };

  /**
   * The reason this screen exists. A hundred imported contacts go into a
   * segment in one statement, not one dialog at a time.
   */
  const handleAssign = async () => {
    const ids = visibleSelected.map((p) => p.id);
    if (ids.length === 0) return;
    const target = assignTarget === NO_GROUP ? null : assignTarget;
    setAssigning(true);
    try {
      await assignGroup(ids, target);
      setSelectedIds(new Set());
      await load(true);
      toast.success(
        target
          ? `${ids.length} prospect${ids.length === 1 ? '' : 's'} moved to ${groupName(target) ?? 'the group'}`
          : `${ids.length} prospect${ids.length === 1 ? '' : 's'} removed from their group`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign prospects');
    } finally {
      setAssigning(false);
    }
  };

  const handleDelete = async (p: EmailProspect) => {
    const name = fullName(p) || p.email || 'this prospect';
    // Said plainly because it is the part people get wrong: deleting the
    // contact does NOT lift a suppression. The suppression is about the
    // ADDRESS, so re-importing them later will not resume mailing them.
    const warning = p.suppressedReason
      ? `\n\n${p.email} stays on the suppression list. Re-importing them will not resume mailing them — lift it on the Suppression tab if that is what you want.`
      : '';
    if (!window.confirm(`Delete ${name}? Their contact record is removed from the organization.${warning}`)) return;
    setDeletingId(p.id);
    try {
      await deleteProspect(p.id);
      setProspects((prev) => prev.filter((x) => x.id !== p.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      toast.success('Prospect deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete prospect');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Prospects</CardTitle>
            <p className="text-sm text-muted-foreground">
              The people you write to. Anyone on the suppression list is shown here too — they
              simply will not be mailed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />Add prospect
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email"
                className="pl-9"
              />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="sm:max-w-[220px]">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_GROUPS}>All groups</SelectItem>
                <SelectItem value={NO_GROUP}>No group</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {visibleSelected.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3">
              <span className="text-sm font-medium">
                {visibleSelected.length} selected
              </span>
              <Select value={assignTarget} onValueChange={setAssignTarget}>
                <SelectTrigger className="sm:max-w-[240px]">
                  <SelectValue placeholder="Choose a group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>No group</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleAssign} disabled={assigning}>
                {assigning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FolderInput className="w-4 h-4 mr-2" />}
                Assign to group
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={assigning}>
                Clear
              </Button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading prospects...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">
                {prospects.length === 0 ? 'No prospects yet' : 'No matches'}
              </p>
              <p className="text-sm">
                {prospects.length === 0
                  ? 'Add someone to start building an audience.'
                  : 'Try a different search or group.'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <div
                className={cn(ROW_GRID, 'border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground')}
              >
                <div
                  role="checkbox"
                  aria-checked={allVisibleSelected}
                  aria-label="Select every prospect shown"
                  tabIndex={0}
                  onClick={toggleAllVisible}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAllVisible(); } }}
                  className="cursor-pointer"
                >
                  <RowCheckbox checked={allVisibleSelected} />
                </div>
                <span>Name</span>
                <span>Email</span>
                <span>Group</span>
                <span>Pain point</span>
                <span>Last contacted</span>
                <span className="sr-only">Actions</span>
              </div>
              <div className="divide-y divide-border">
                {filtered.map((p) => {
                  const checked = selectedIds.has(p.id);
                  const group = groupName(p.groupId);
                  return (
                    <div key={p.id} className={cn(ROW_GRID, 'hover:bg-accent/50')}>
                      <div
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={`Select ${fullName(p) || p.email || 'prospect'}`}
                        tabIndex={0}
                        onClick={() => toggleRow(p.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(p.id); } }}
                        className="cursor-pointer"
                      >
                        <RowCheckbox checked={checked} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {fullName(p) || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{p.jobTitle ?? '—'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm truncate">{p.email ?? '—'}</p>
                        {/* Derived from email_suppressions, never from the
                            contact, and there is no control here to change
                            it — see suppressionBadge. */}
                        {p.suppressedReason && (
                          <div className="mt-0.5">{suppressionBadge(p.suppressedReason)}</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        {group
                          ? <Badge variant="outline" className="max-w-full truncate">{group}</Badge>
                          : <span className="text-xs text-muted-foreground">No group</span>}
                      </div>
                      {/* On the row rather than behind the edit dialog: it is
                          the merge field that makes a cold email land, and a
                          row without it does not say whether this person is
                          ready to be written to. */}
                      <p className="text-sm text-muted-foreground truncate" title={p.painPoint ?? undefined}>
                        {p.painPoint ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.lastContactedAt ? format(p.lastContactedAt, 'MMM d, yyyy') : 'Never'}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${fullName(p) || p.email || 'prospect'}`}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${fullName(p) || p.email || 'prospect'}`}
                          disabled={deletingId === p.id}
                          onClick={() => handleDelete(p)}
                        >
                          {deletingId === p.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4 text-red-600" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit prospect' : 'Add prospect'}</DialogTitle>
            <DialogDescription>
              Somebody to write to. Whether they can be mailed is decided by the suppression list,
              not here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {saveError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prospect-first-name">First name *</Label>
                <Input
                  id="prospect-first-name"
                  value={form.firstName}
                  placeholder="Jane"
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prospect-last-name">Last name</Label>
                <Input
                  id="prospect-last-name"
                  value={form.lastName}
                  placeholder="Doe"
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prospect-email">Email</Label>
                <Input
                  id="prospect-email"
                  type="email"
                  value={form.email}
                  placeholder="jane@acme.com"
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prospect-job-title">Job title</Label>
                <Input
                  id="prospect-job-title"
                  value={form.jobTitle}
                  placeholder="Head of Growth"
                  onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prospect-pain-point">Pain point</Label>
              <Textarea
                id="prospect-pain-point"
                value={form.painPoint}
                placeholder="Spends two days a month reconciling timesheets by hand"
                className="min-h-[80px]"
                onChange={(e) => setForm((f) => ({ ...f, painPoint: e.target.value }))}
              />
              {/* Described rather than advertised as a placeholder: the
                  recipient merge data built for a campaign carries the name
                  and address fields only, so promising `{{pain_point}}` here
                  would promise a substitution that does not happen yet. */}
              <p className="text-xs text-muted-foreground">
                The one thing about them worth writing about — the line a cold email is built
                around. Shown on every row.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prospect-group">Group</Label>
              <Select
                value={form.groupId}
                onValueChange={(v) => setForm((f) => ({ ...f, groupId: v }))}
              >
                <SelectTrigger id="prospect-group">
                  <SelectValue placeholder="No group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>No group</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.firstName.trim()}>
                {saving
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : editingId ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                {editingId ? 'Save' : 'Add prospect'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProspectsTab;
