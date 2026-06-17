import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ClientNote, getClientNotes, createNote, deleteNote,
} from '@/services/supabase/clients';
import { toast } from 'sonner';

interface Props {
  clientId: string;
  organizationId: string | null;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
}

/**
 * Self-contained notes section for a business account — loads, adds, and
 * deletes the company's notes (client_notes, kind='note'). Used on the
 * business-account record page so reps can keep context on the company.
 */
export const AccountNotesSection: React.FC<Props> = ({
  clientId, organizationId, userId, userName, canManage,
}) => {
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    if (!organizationId) return;
    try { setNotes(await getClientNotes(organizationId, clientId)); } catch { /* non-blocking */ }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, organizationId]);

  const submit = async () => {
    if (!userId || !userName || !organizationId) return;
    if (!subject.trim() && !body.trim()) { toast.error('Write something to add'); return; }
    setSubmitting(true);
    try {
      await createNote(organizationId, clientId, userId, userName, {
        kind: 'note', subject: subject.trim() || null, body: body.trim() || null, occurredAt: new Date(),
      });
      setSubject(''); setBody('');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (n: ClientNote) => {
    if (!organizationId) return;
    if (!confirm('Delete this note?')) return;
    try { await deleteNote(organizationId, n.noteId); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete'); }
  };

  const canDelete = (n: ClientNote) => canManage || n.authorId === userId;
  const visible = useMemo(() => notes.filter((n) => n.kind === 'note'), [notes]);

  return (
    <div className="space-y-3">
      {userId && canManage && (
        <div className="border rounded-md p-3 space-y-2 bg-secondary/30">
          <Input
            placeholder="Add a title (optional)" maxLength={200}
            value={subject} onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="Add a note…" rows={3} maxLength={5000}
            value={body} onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Add note
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notes yet. Capture context, decisions, or reminders about this business.
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((n) => (
          <li key={n.noteId} className="rounded-md border p-3">
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {n.subject && <p className="font-medium text-sm">{n.subject}</p>}
                {n.body && <p className="text-sm whitespace-pre-wrap mt-0.5">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {n.authorName ?? 'Someone'} · {formatDistanceToNow(n.occurredAt, { addSuffix: true })}
                </p>
              </div>
              {canDelete(n) && (
                <Button
                  size="icon" variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete note"
                  onClick={() => remove(n)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
