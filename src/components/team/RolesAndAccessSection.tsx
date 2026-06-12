import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2, Loader2, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { updateOrganization } from '@/services/supabase/organizations';
import type { OrganizationMember } from '@/types/organization';
import {
  listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole,
  type CustomRole,
} from '@/services/supabase/customRoles';
import { PAGE_CATALOG, type PageKey, type PageAccessLevel } from '@/lib/pageCatalog';
import type { RolePermissionMap } from '@/lib/pagePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const LEVELS: { value: PageAccessLevel; label: string }[] = [
  { value: 'none', label: 'No access' },
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
];

const emptyPerms = (): Record<PageKey, PageAccessLevel> =>
  Object.fromEntries(PAGE_CATALOG.map((p) => [p.key, 'none'])) as Record<PageKey, PageAccessLevel>;

/** Group the catalog for the editor, preserving catalog order. */
const GROUPS: { group: string; keys: PageKey[] }[] = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, PageKey[]>();
  for (const p of PAGE_CATALOG) {
    if (!byGroup.has(p.group)) { byGroup.set(p.group, []); order.push(p.group); }
    byGroup.get(p.group)!.push(p.key);
  }
  return order.map((group) => ({ group, keys: byGroup.get(group)! }));
})();

const labelFor = (key: PageKey) => PAGE_CATALOG.find((p) => p.key === key)?.label ?? key;
const isAlwaysAvailable = (key: PageKey) => !!PAGE_CATALOG.find((p) => p.key === key)?.alwaysAvailable;

/**
 * Owner/admin section on the Team page: create custom roles (a per-page
 * No access / View / Edit map) and assign them to members. Self-contained —
 * pulls the org + current user from context and persists via the role service
 * + updateOrganization. Owner is always full and is never listed for
 * reassignment.
 */
export const RolesAndAccessSection: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin, refreshOrganization } = useOrganization();

  const orgId = organization?.organizationId ?? null;
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(false);

  // Editor dialog state.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Record<PageKey, PageAccessLevel>>(emptyPerms());
  const [saving, setSaving] = useState(false);

  // Delete confirm + per-member assignment busy.
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);

  const reload = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setRoles(await listCustomRoles(orgId));
    } catch {
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [orgId]);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.roleId, r])), [roles]);

  // Members eligible for assignment — everyone except the owner.
  const assignableMembers = useMemo<OrganizationMember[]>(() => {
    const members = organization?.members ?? [];
    const ownerId = organization?.ownerId;
    return members.filter((m) => m.userId !== ownerId && m.role !== 'owner' && m.status !== 'removed');
  }, [organization?.members, organization?.ownerId]);

  if (!isAdmin) return null;

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setPerms(emptyPerms());
    setEditorOpen(true);
  };

  const openEdit = (role: CustomRole) => {
    setEditing(role);
    setName(role.name);
    setDescription(role.description ?? '');
    const next = emptyPerms();
    for (const [k, v] of Object.entries(role.permissions)) {
      if (v) next[k as PageKey] = v;
    }
    setPerms(next);
    setEditorOpen(true);
  };

  const setAll = (level: PageAccessLevel) => {
    const next = emptyPerms();
    for (const p of PAGE_CATALOG) next[p.key] = level;
    setPerms(next);
  };

  const save = async () => {
    if (!orgId) return;
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Role name is required'); return; }
    // Persist only granted pages; absent key = no access.
    const permissions: RolePermissionMap = {};
    for (const p of PAGE_CATALOG) {
      const lvl = perms[p.key];
      if (lvl === 'view' || lvl === 'edit') permissions[p.key] = lvl;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateCustomRole(orgId, editing.roleId, { name: trimmed, description, permissions });
        toast.success('Role updated');
      } else {
        await createCustomRole(orgId, user?.userId ?? null, { name: trimmed, description, permissions });
        toast.success(`Role "${trimmed}" created`);
      }
      setEditorOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save role');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!orgId || !deleting) return;
    try {
      await deleteCustomRole(orgId, deleting.roleId);
      // Clear the assignment from any member that pointed at this role so the
      // selector doesn't show a dangling id (they fall back to their built-in).
      const members = organization?.members ?? [];
      if (members.some((m) => m.customRoleId === deleting.roleId)) {
        const next = members.map((m) =>
          m.customRoleId === deleting.roleId ? { ...m, customRoleId: null } : m);
        await updateOrganization(orgId, { members: next });
        await refreshOrganization();
      }
      toast.success(`Deleted "${deleting.name}"`);
      setDeleting(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete role');
    }
  };

  // Selector value encodes built-in ("builtin:member") vs custom ("custom:<id>").
  const memberValue = (m: OrganizationMember) =>
    m.customRoleId && roleById.has(m.customRoleId) ? `custom:${m.customRoleId}` : `builtin:${m.role}`;

  const assignRole = async (m: OrganizationMember, value: string) => {
    if (!orgId) return;
    const members = organization?.members ?? [];
    const next = members.map((cur) => {
      if (cur.userId !== m.userId) return cur;
      if (value.startsWith('custom:')) {
        // Keep a safe built-in baseline ('member') so deleting the custom role
        // later degrades gracefully rather than leaving stale admin access.
        return { ...cur, role: 'member' as const, customRoleId: value.slice('custom:'.length) };
      }
      const builtin = value.slice('builtin:'.length) as OrganizationMember['role'];
      return { ...cur, role: builtin, customRoleId: null };
    });
    setAssignBusy(m.userId);
    try {
      await updateOrganization(orgId, { members: next });
      await refreshOrganization();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update access');
    } finally {
      setAssignBusy(null);
    }
  };

  const memberCountFor = (roleId: string) =>
    (organization?.members ?? []).filter((m) => m.customRoleId === roleId).length;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-orange-500" /> Roles &amp; access
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Create roles and choose, per page, whether a member gets No access, View, or Edit.
            You (the owner) always have full access.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New role
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Roles list */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Roles</h3>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom roles yet. Create one (e.g. “Sales”, “Developer”) and assign it below.
            </p>
          ) : (
            <ul className="space-y-2">
              {roles.map((r) => {
                const granted = Object.values(r.permissions).filter(Boolean).length;
                return (
                  <li key={r.roleId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{r.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{granted} pages</Badge>
                        <Badge variant="outline" className="text-[10px]">{memberCountFor(r.roleId)} members</Badge>
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{r.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(r)}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(r)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Member assignment */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Member access
          </h3>
          {assignableMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other members yet. Invite teammates above.</p>
          ) : (
            <ul className="space-y-2">
              {assignableMembers.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={m.photoURL} />
                      <AvatarFallback>{(m.displayName || m.email || '?').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{m.displayName || m.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {assignBusy === m.userId && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    <Select value={memberValue(m)} onValueChange={(v) => void assignRole(m, v)}>
                      <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="builtin:admin">Admin (full access)</SelectItem>
                        <SelectItem value="builtin:member">Member (default)</SelectItem>
                        <SelectItem value="builtin:viewer">Viewer (read-only)</SelectItem>
                        {roles.length > 0 && (
                          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Custom roles</div>
                        )}
                        {roles.map((r) => (
                          <SelectItem key={r.roleId} value={`custom:${r.roleId}`}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {/* Role editor */}
      <Dialog open={editorOpen} onOpenChange={(o) => { if (!saving) setEditorOpen(o); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit role' : 'New role'}</DialogTitle>
            <DialogDescription>
              Set what this role can do on each page. Missing = no access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name *</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales" maxLength={60} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea id="role-desc" value={description} rows={2} maxLength={300}
                onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <h4 className="text-sm font-semibold">Page access</h4>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">Set all:</span>
                {LEVELS.map((l) => (
                  <Button key={l.value} size="sm" variant="outline" className="h-7 px-2 text-xs"
                    onClick={() => setAll(l.value)}>{l.label}</Button>
                ))}
              </div>
            </div>

            {GROUPS.map(({ group, keys }) => (
              <div key={group} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
                {keys.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-sm inline-flex items-center gap-1">
                      {labelFor(key)}
                      {isAlwaysAvailable(key) && (
                        <span title="Always at least View — members never lose their own basics">
                          <Info className="w-3 h-3 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                    <div className="inline-flex rounded-md border overflow-hidden">
                      {LEVELS.map((l) => (
                        <button
                          key={l.value}
                          type="button"
                          onClick={() => setPerms((prev) => ({ ...prev, [key]: l.value }))}
                          className={cn(
                            'px-2.5 py-1 text-xs transition-colors',
                            perms[key] === l.value
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background hover:bg-muted text-muted-foreground',
                          )}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              My Tasks, Calendar, and Settings always stay at least View so nobody is locked out of their own account.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : editing ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this role?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleting?.name}</strong> will be removed and any member using it falls back to
              the Member default. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default RolesAndAccessSection;
