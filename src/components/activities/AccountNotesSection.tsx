import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Loader2, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  getClientNotes, createNote, deleteNote, type ClientNote,
} from '@/services/supabase/clients';

interface AccountNotesSectionProps {
  organizationId: string | null;
  clientId: string | null;
  canCompose: boolean;
  /** Optional label hint used in the empty-state message — e.g.
   *  "this contact" on the Contact drawer, "this account" on the
   *  Account drawer. */
  entityLabel?: string;
}

/**
 * Notes section used by the Contact and Account drawers. Persists to
 * client_notes (the same table the deal-side Notes UI writes to) so
 * notes added from a Contact show up on its parent Account drawer
 * AND on any deal scoped to that account — Zoho-style.
 *
 * Renders nothing if there's no clientId (e.g. a contact that's been
 * orphaned from its parent account), with a one-line hint so the user
 * understands why.
 */
export const AccountNotesSection: React.FC<AccountNotesSectionProps> = ({
  organizationId, clientId, canCompose, entityLabel = 'this record',
}) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!organizationId || !clientId) { setNotes([]); return; }
    setLoading(true);
    try {
      setNotes(await getClientNotes(organizationId, clientId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId, clientId]);

  const handleSave = async () => {
    if (!organizationId || !clientId) return;
    if (!body.trim() && !subject.trim()) {
      toast.error('Note needs a subject or body');
      return;
    }
    setBusy(true);
    try {
      await createNote(organizationId, clientId, user?.userId ?? '', user?.displayName ?? user?.email ?? '', {
        kind: 'note',
        subject: subject.trim() || null,
        body: body.trim() || null,
        occurredAt: new Date(),
      });
      setSubject('');
      setBody('');
      setComposing(false);
      await reload();
      toast.success('Note saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!organizationId) return;
    if (!window.confirm('Delete this note?')) return;
    try {
      await deleteNote(organizationId, noteId);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center justify-between border-b pb-1.5 mb-2">
        <span className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> Notes
          <span className="text-[11px] text-muted-foreground font-normal">
            ({notes.length})
          </span>
        </span>
        {canCompose && clientId && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" /> Note
          </button>
        )}
      </h3>

      {!clientId ? (
        <p className="text-xs text-muted-foreground">
          Notes save on the parent account — link {entityLabel} to an account to add notes.
        </p>
      ) : composing ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2 mb-2">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="h-8 text-sm"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note…"
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm" variant="ghost" disabled={busy}
              onClick={() => { setComposing(false); setSubject(''); setBody(''); }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Save note
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {canCompose && clientId ? 'No notes yet. Use + Note to add one.' : 'No notes yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.noteId} className="rounded-md border p-2 group">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {n.subject && <p className="text-sm font-medium truncate">{n.subject}</p>}
                  {n.body && <p className="text-sm whitespace-pre-wrap break-words text-foreground/90">{n.body}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {n.authorName ?? '—'} · {format(n.createdAt, 'MMM d, yyyy · HH:mm')}
                  </p>
                </div>
                {canCompose && (
                  <button
                    type="button"
                    onClick={() => handleDelete(n.noteId)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
