import React, { useState } from 'react';
import { Plus, Trash2, Loader2, Tag as TagIcon, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmTags } from '@/hooks/useCrmHub';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { createTag, updateTag, deleteTag } from '@/services/supabase/crmHub/tags';
import type { CrmTag } from '@/types/crmHub';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// Tag colours are data: they are saved on the tag and shown as they are.
const PRESETS = [
  '#f97316', // orange
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
];

/** The row of colour dots in the New tag and Edit tag dialogs. */
const ColourChoice: React.FC<{ value: string; onChange: (colour: string) => void }> = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-2">
    {PRESETS.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(c)}
        className={cn(
          'h-6 w-6 rounded-full',
          value === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
        )}
        style={{ backgroundColor: c }}
        aria-label={c}
        aria-pressed={value === c}
      />
    ))}
  </div>
);

export const CrmTagsPage: React.FC = () => {
  const { organization } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const { items: tags, loading, refresh } = useCrmTags();

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESETS[0]);

  const [editing, setEditing] = useState<CrmTag | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(PRESETS[0]);

  const [confirmDelete, setConfirmDelete] = useState<CrmTag | null>(null);

  const resetForm = () => { setName(''); setColor(PRESETS[0]); };

  const handleCreate = async () => {
    if (!organization || !selected) return;
    if (!name.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      await createTag(organization.organizationId, selected.workspaceId, name.trim(), color);
      toast.success('Tag created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create tag';
      // Unique constraint (organization_id, name)
      toast.error(msg.includes('duplicate') ? 'A tag with that name already exists' : msg);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (tag: CrmTag) => {
    setEditing(tag);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!editName.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      await updateTag(editing.id, { name: editName.trim(), color: editColor });
      toast.success('Tag updated');
      setEditing(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update tag');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tag: CrmTag) => {
    setBusy(true);
    try {
      await deleteTag(tag.id);
      toast.success('Tag deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete tag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Tags"
          description="Colour-coded labels you can put on leads."
          actions={
            <Button onClick={() => setShowCreate(true)}>
              <Plus aria-hidden />
              New tag
            </Button>
          }
        />

        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex min-h-11 items-center border-b border-border px-4">
            <h2 className="text-sm font-semibold text-foreground">
              <span className="tabular-nums">{tags.length}</span> tag{tags.length === 1 ? '' : 's'}
            </h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading tags…
            </div>
          ) : tags.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
              <TagIcon className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">No tags yet.</p>
              <p className="text-xs text-muted-foreground">Add one to start labelling leads.</p>
              <Button className="mt-3" onClick={() => setShowCreate(true)}>
                <Plus aria-hidden />
                New tag
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 p-4">
              {tags.map((t) => (
                <div
                  key={t.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-2 pr-1 text-xs font-medium"
                  style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
                >
                  <TagIcon className="h-3 w-3 shrink-0" style={{ color: t.color }} aria-hidden />
                  <span className="truncate text-foreground">{t.name}</span>
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    title="Edit"
                    aria-label={`Edit tag ${t.name}`}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(t)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                    title="Delete"
                    aria-label={`Delete tag ${t.name}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tname">Name</Label>
              <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <ColourChoice value={color} onChange={setColor} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tname-edit">Name</Label>
              <Input id="tname-edit" value={editName} onChange={(e) => setEditName(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <ColourChoice value={editColor} onChange={setEditColor} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              <X aria-hidden />
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={busy || !editName.trim()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from every lead that has it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && void handleDelete(confirmDelete)}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default CrmTagsPage;
