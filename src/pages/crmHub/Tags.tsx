import React, { useState } from 'react';
import { Plus, Trash2, Loader2, Tag as TagIcon, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmTags } from '@/hooks/useCrmHub';
import { createTag, updateTag, deleteTag } from '@/services/supabase/crmHub/tags';
import type { CrmTag } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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

export const CrmTagsPage: React.FC = () => {
  const { organization } = useOrganization();
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
    if (!organization) return;
    if (!name.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      await createTag(organization.organizationId, name.trim(), color);
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
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Tags</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Colour-coded labels you can apply to contacts.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" /> New tag
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tags.length} tag{tags.length === 1 ? '' : 's'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : tags.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No tags yet. Add one to start labelling contacts.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <div
                    key={t.id}
                    className="inline-flex items-center gap-2 rounded-full pl-2 pr-1 py-1 text-xs font-medium"
                    style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
                  >
                    <TagIcon className="w-3 h-3" style={{ color: t.color }} />
                    <span className="text-foreground">{t.name}</span>
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      className="h-5 w-5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center"
                      title="Edit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(t)}
                      className="h-5 w-5 rounded-full hover:bg-destructive/20 flex items-center justify-center text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="tname">Name</Label>
              <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${editColor === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={busy || !editName.trim()}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
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
              It will be removed from every contact currently tagged. This can't be undone.
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
