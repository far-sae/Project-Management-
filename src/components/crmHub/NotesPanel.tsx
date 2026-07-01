import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, StickyNote, Trash2, Save, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  listNotes, createNote, updateNote, deleteNote,
} from '@/services/supabase/crmHub/notes';
import type { CrmNote } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type ScopedTo =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

interface Props {
  scopedTo: ScopedTo;
  /** Optional heading override — defaults to "Notes". */
  title?: string;
}

const formatWhen = (d: Date) => {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const NotesPanel: React.FC<Props> = ({ scopedTo, title = 'Notes' }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const scopeOpts = 'contactId' in scopedTo
    ? { contactId: scopedTo.contactId }
    : 'companyId' in scopedTo
    ? { companyId: scopedTo.companyId }
    : { dealId: scopedTo.dealId };

  const scopeKey = JSON.stringify(scopeOpts);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setNotes(await listNotes(orgId, scopeOpts));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load notes');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, scopeKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`crm-notes-${orgId}-${scopeKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_notes', filter: `organization_id=eq.${orgId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, scopeKey, refresh]);

  const handleAdd = async () => {
    if (!orgId) return;
    if (!body.trim()) return;
    setBusy(true);
    try {
      await createNote(
        { organizationId: orgId, body: body.trim(), ...scopeOpts },
        user?.userId ?? null,
      );
      setBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingBody.trim()) return;
    setBusy(true);
    try {
      await updateNote(id, editingBody.trim());
      setEditingId(null);
      setEditingBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update note');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteNote(id);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">({notes.length})</span>
      </div>

      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          disabled={busy}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleAdd} disabled={busy || !body.trim()}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save note
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
        </div>
      ) : notes.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">No notes yet.</div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-card p-3">
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    disabled={busy}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingId(null); setEditingBody(''); }}
                      disabled={busy}
                    >
                      <X className="w-4 h-4 mr-1" /> Cancel
                    </Button>
                    <Button size="sm" onClick={() => void handleSaveEdit(n.id)} disabled={busy || !editingBody.trim()}>
                      <Save className="w-4 h-4 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{n.body}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">{formatWhen(n.createdAt)}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => { setEditingId(n.id); setEditingBody(n.body); }}
                        disabled={busy}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDelete(n.id)}
                        disabled={busy}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotesPanel;
