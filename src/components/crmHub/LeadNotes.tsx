// The notes of a lead: a box to write a new one at the top, then every note,
// newest first. A note can be changed or deleted, and a changed note keeps its
// earlier versions ("History").
import React, { useMemo, useState } from 'react';
import { History, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { publicMessage } from '@/lib/publicError';
import { createNote, deleteNote, listNoteHistory, updateNote, type CrmNoteVersion } from '@/services/supabase/crmHub/notes';
import type { CrmActivity, CrmNote } from '@/types/crmHub';

interface Props {
  organizationId: string;
  workspaceId: string | null;
  contactId: string;
  userId: string | null;
  notes: CrmNote[];
  /** The lead's timeline: a note that was only logged there (not written here) is shown too, read-only. */
  activities: CrmActivity[];
  /** Called after a note was added, changed or deleted. */
  onChanged: () => Promise<void> | void;
}

const dateTime = (date: Date): string => date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Saving a note also writes a short line on the timeline. That line is the same note, not another one. */
export const MIRROR_SECONDS = 30;

/** The notes that exist only on the timeline (logged with "Log note"), without the lines that mirror a written note. */
export function loggedOnly(activities: CrmActivity[], notes: CrmNote[]): CrmActivity[] {
  return activities.filter((a) => a.type === 'note' && (a.description ?? '').trim() !== ''
    && a.metadata?.automation !== 'true'
    && !notes.some((n) => Math.abs(n.createdAt.getTime() - a.createdAt.getTime()) <= MIRROR_SECONDS * 1000));
}

/** A note counts as changed when it was saved again after it was written. */
export const wasEdited = (note: CrmNote): boolean => note.updatedAt.getTime() - note.createdAt.getTime() > 2000;

type Row = { key: string; at: Date; note: CrmNote | null; text: string };

export const LeadNotes: React.FC<Props> = ({ organizationId, workspaceId, contactId, userId, notes, activities, onChanged }) => {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CrmNote | null>(null);
  const [history, setHistory] = useState<{ note: CrmNote; versions: CrmNoteVersion[] | null } | null>(null);

  const rows = useMemo<Row[]>(() => [
    ...notes.map((n) => ({ key: `n-${n.id}`, at: n.createdAt, note: n, text: n.body })),
    ...loggedOnly(activities, notes).map((a) => ({ key: `a-${a.id}`, at: a.createdAt, note: null, text: a.description ?? '' })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()), [notes, activities]);

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      await createNote({ organizationId, workspaceId, body, contactId }, userId);
      toast.success('Note added');
      setDraft('');
      await onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'The note could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (note: CrmNote) => {
    const body = editBody.trim();
    if (!body || body === note.body) { setEditing(null); return; }
    setBusyId(note.id);
    try {
      await updateNote(note.id, body);
      toast.success('Note changed');
      setEditing(null);
      await onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'The note could not be changed. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await deleteNote(deleting.id);
      toast.success('Note deleted');
      setDeleting(null);
      await onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'The note could not be deleted. Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (note: CrmNote) => {
    setHistory({ note, versions: null });
    try {
      const versions = await listNoteHistory(note.id);
      setHistory((old) => (old && old.note.id === note.id ? { note, versions } : old));
    } catch (error) {
      toast.error(publicMessage(error, 'The history could not be read. Please try again.'));
      setHistory(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Textarea
          id="contact-note-composer" rows={3} placeholder="Add a note about this lead…" aria-label="Add note"
          value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving}
        />
        <div className="flex justify-end">
          <Button onClick={() => void add()} disabled={saving || !draft.trim()}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}Save note
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No notes yet. Write the first one above.</p>
      ) : (
        <ul aria-label="Notes" className="divide-y divide-border">
          {rows.map(({ key, at, note, text }) => (
            <li key={key} className="px-4 py-3">
              {note && editing === note.id ? (
                <div className="flex flex-col gap-2">
                  <Textarea rows={4} aria-label="Change the note" value={editBody} onChange={(e) => setEditBody(e.target.value)} disabled={busyId === note.id} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={busyId === note.id} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" disabled={busyId === note.id || !editBody.trim()} onClick={() => void saveEdit(note)}>
                      {busyId === note.id && <Loader2 className="animate-spin" aria-hidden />}Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{dateTime(at)}</span>
                    {note && wasEdited(note) && <span>Changed {dateTime(note.updatedAt)}</span>}
                    {!note && <span>Logged on the timeline</span>}
                    {note && (
                      <span className="ml-auto flex items-center gap-1">
                        {wasEdited(note) && (
                          <Button variant="ghost" size="sm" onClick={() => void openHistory(note)} aria-label="History of this note">
                            <History aria-hidden />History
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(note.id); setEditBody(note.body); }} aria-label="Change this note">
                          <Pencil aria-hidden />Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(note)} aria-label="Delete this note">
                          <Trash2 aria-hidden />Delete
                        </Button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && busyId === null) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>The note and its earlier versions are removed for good.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busyId !== null} onClick={(e) => { e.preventDefault(); void remove(); }}>
              {busyId !== null && <Loader2 className="animate-spin" aria-hidden />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={history !== null} onOpenChange={(open) => { if (!open) setHistory(null); }}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>History of this note</DialogTitle>
            <DialogDescription>What the note says now, and what it said before each change.</DialogDescription>
          </DialogHeader>
          {history && (
            <ol className="flex flex-col gap-3">
              <li className="rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Now · since {dateTime(history.note.updatedAt)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{history.note.body}</p>
              </li>
              {history.versions === null ? (
                <li className="py-4 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden />Reading the history…</li>
              ) : history.versions.length === 0 ? (
                <li className="text-sm text-muted-foreground">No earlier version was kept. Versions are kept from the moment the history was switched on.</li>
              ) : history.versions.map((v) => (
                <li key={v.id} className="rounded-md border border-border bg-surface-2 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Before the change of {dateTime(v.changedAt)}{v.writtenAt ? ` · written ${dateTime(v.writtenAt)}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{v.body}</p>
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadNotes;
