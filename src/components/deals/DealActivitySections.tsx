import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  MessageSquare, Phone, Mail, Calendar, ListTodo, Plus, Loader2,
  Trash2, Send, Video, VideoOff, ExternalLink,
} from 'lucide-react';
import { cancelMeetForCrm, createMeetForCrm } from '@/services/integrations/googleMeet';
import { DayPickerPopover } from '@/components/kanban/DayPickerPopover';
import { EntityActivitiesSection } from '@/components/activities/EntityActivitiesSection';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  ClientNote, ClientNoteKind, createNote, deleteNote, getDealNotes,
} from '@/services/supabase/clients';
import { cn } from '@/lib/utils';

interface DealActivitySectionsProps {
  dealId: string;
  /** clientId of the deal's account — required for createNote (notes are
   *  scoped to a client as well as a deal so they show up on the account
   *  timeline too). When the deal has no account, the composer is hidden
   *  with a hint. */
  clientId: string | null;
  organizationId: string | null;
  canManage: boolean;
  /** When set, only that one sub-section renders. Used by the detail view's
   *  tab navigation so picking "Notes" doesn't also dump Open / Closed /
   *  Emails on the rep. Omit to show all four. */
  visible?: 'notes' | 'open-activities' | 'closed-activities' | 'emails';
}


const KIND_META: Record<ClientNoteKind, { label: string; icon: typeof MessageSquare; tone: string }> = {
  note:    { label: 'Note',    icon: MessageSquare, tone: 'text-sky-600' },
  call:    { label: 'Call',    icon: Phone,         tone: 'text-emerald-600' },
  meeting: { label: 'Meeting', icon: Calendar,      tone: 'text-violet-600' },
  email:   { label: 'Email',   icon: Mail,          tone: 'text-amber-600' },
  task:    { label: 'Task',    icon: ListTodo,      tone: 'text-rose-600' },
};

/**
 * Bundle of "Related List" sections that live below the Stage Path on the
 * deal detail view: Open Activities (future tasks/meetings/calls), Closed
 * Activities (past ones), Notes, Emails. All persisted as client_notes rows
 * scoped to this deal via dealId.
 *
 * Reps' workflow:
 *   • "+ Task / + Meeting / + Call" buttons in Open Activities prompt for
 *     subject + due date.
 *   • Adding a note from the Notes section just needs a body.
 *   • Sending an email logs the outreach (no SMTP integration here — just
 *     records that it happened so the timeline stays honest).
 */
export const DealActivitySections: React.FC<DealActivitySectionsProps> = ({
  dealId, clientId, organizationId, canManage, visible,
}) => {
  const show = (key: NonNullable<DealActivitySectionsProps['visible']>) =>
    !visible || visible === key;
  const { user } = useAuth();
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState<{
    kind: ClientNoteKind;
    subject: string;
    body: string;
    occurredAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [meetingBusyId, setMeetingBusyId] = useState<string | null>(null);
  // Per-note picked meeting date+time. When set, this overrides the
  // note's occurred_at as the Meet's start time and is persisted back
  // to occurred_at by the edge function. When null/empty, Add Meet
  // falls back to the note's existing occurred_at. Keyed by noteId so
  // multiple meeting notes can have independent pickers open.
  const [meetingDateById, setMeetingDateById] = useState<Record<string, Date | null>>({});
  const [meetingTimeById, setMeetingTimeById] = useState<Record<string, string>>({});
  const [pickerOpenId, setPickerOpenId] = useState<string | null>(null);
  const [emailFilter, setEmailFilter] = useState<'sent' | 'all'>('sent');

  // Spin up a Google Meet link for an existing meeting note. If the
  // user picked a date+time in the inline picker, that wins and is
  // persisted back to occurred_at by the edge function. Otherwise we
  // fall back to the note's existing occurred_at (which is what the
  // backend does when no startTime is sent).
  const handleAddMeet = async (noteId: string) => {
    setMeetingBusyId(noteId);
    try {
      const pickedDate = meetingDateById[noteId] ?? null;
      const pickedTime = meetingTimeById[noteId] ?? '';
      let startTime: Date | undefined;
      if (pickedDate) {
        const [hh, mm] = (pickedTime || '10:00').split(':').map((n) => Number(n) || 0);
        const composed = new Date(pickedDate);
        composed.setHours(hh, mm, 0, 0);
        startTime = composed;
      }
      const result = await createMeetForCrm('client_notes', noteId, {
        durationMinutes: 30,
        ...(startTime ? { startTime } : {}),
      });
      toast.success(
        startTime
          ? `Meet scheduled for ${startTime.toLocaleString()}.`
          : 'Meet link created — refreshing.',
      );
      // Clear the inline picker once successfully used.
      setPickerOpenId(null);
      setMeetingDateById((m) => ({ ...m, [noteId]: null }));
      // Refresh so the new link shows up in the row.
      await reload();
      // Open the link immediately for convenience.
      window.open(result.meetLink, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create Meet link');
    } finally {
      setMeetingBusyId(null);
    }
  };

  // Tear down the Google Calendar event and clear google_meet_link /
  // google_event_id on the note. Confirm first — once Calendar deletes
  // the event, attendees lose access and the Meet room is gone.
  const handleCancelMeet = async (noteId: string) => {
    if (!window.confirm('Cancel this Google Meet? The Calendar event will be deleted and attendees will lose access.')) return;
    setMeetingBusyId(noteId);
    try {
      const result = await cancelMeetForCrm('client_notes', noteId);
      toast.success(
        result.calendarDeleted === true
          ? 'Meet cancelled — Calendar event deleted.'
          : 'Meet link removed from this note.',
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel Meet');
    } finally {
      setMeetingBusyId(null);
    }
  };

  const reload = async () => {
    if (!organizationId || !dealId) return;
    setLoading(true);
    try {
      const next = await getDealNotes(organizationId, dealId);
      setNotes(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organizationId || !dealId) {
      setNotes([]);
      return;
    }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, dealId]);

  // Split activity rows the way Zoho does: future tasks/meetings/calls are
  // "Open", past ones are "Closed". Notes and Emails get their own sections.
  // The Open/Closed Activities sections now read from the new
  // client_tasks/meetings/calls tables via EntityActivitiesSection, so
  // we only need to split client_notes into Notes (kind='note') and
  // Emails (kind='email') for the legacy two sections below. The
  // task/meeting/call kinds on client_notes are leftover from the
  // pre-Activities-hub composer; they stay hidden so reps don't see
  // duplicate cards.
  const { justNotes, emails } = useMemo(() => {
    const ns: ClientNote[] = [];
    const es: ClientNote[] = [];
    for (const n of notes) {
      if (n.kind === 'note') ns.push(n);
      else if (n.kind === 'email') es.push(n);
    }
    return { justNotes: ns, emails: es };
  }, [notes]);

  const openComposer = (kind: ClientNoteKind) => {
    setComposer({
      kind,
      subject: '',
      body: '',
      occurredAt: new Date().toISOString().slice(0, 16),
    });
  };

  const handleSave = async () => {
    if (!composer || !organizationId || !user) return;
    if (!clientId) {
      toast.error('This deal has no account linked yet — set one before logging activity.');
      return;
    }
    const subject = composer.subject.trim();
    const body = composer.body.trim();
    if (!subject && !body) {
      toast.error('Add a subject or body so the timeline is useful');
      return;
    }
    setBusy(true);
    try {
      await createNote(organizationId, clientId, user.userId, user.displayName, {
        kind: composer.kind,
        subject: subject || null,
        body: body || null,
        occurredAt: composer.occurredAt ? new Date(composer.occurredAt) : new Date(),
        dealId,
      });
      toast.success(`${KIND_META[composer.kind].label} logged`);
      setComposer(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!organizationId) return;
    setRemovingId(noteId);
    try {
      await deleteNote(organizationId, noteId);
      setNotes((prev) => prev.filter((n) => n.noteId !== noteId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setRemovingId(null);
    }
  };

  const renderRow = (n: ClientNote) => {
    const meta = KIND_META[n.kind];
    const Icon = meta.icon;
    const isMeeting = n.kind === 'meeting';
    return (
      <li key={n.noteId} className="flex items-start gap-2 py-2 border-b last:border-b-0">
        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', meta.tone)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {n.subject && <span className="font-medium text-sm">{n.subject}</span>}
            <span className="text-[11px] text-muted-foreground">
              {format(n.occurredAt instanceof Date ? n.occurredAt : new Date(n.occurredAt), 'MMM d, yyyy · HH:mm')}
            </span>
            {n.authorName && <span className="text-[11px] text-muted-foreground">· {n.authorName}</span>}
          </div>
          {n.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words mt-0.5">{n.body}</p>}
          {isMeeting && n.googleMeetLink && (
            <a
              href={n.googleMeetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[12px] text-emerald-600 hover:text-emerald-700 font-medium"
            >
              <Video className="w-3.5 h-3.5" /> Join Google Meet
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>
          )}
          {isMeeting && !n.googleMeetLink && canManage && pickerOpenId === n.noteId && (
            // Inline scheduler — picks the Meet's date/time independently
            // of the note's occurred_at. The picked time is persisted back
            // to occurred_at by the edge function so the note row stays in
            // sync with the actual meeting time.
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 p-2">
              <span className="text-[11px] text-muted-foreground">Schedule for</span>
              <DayPickerPopover
                value={meetingDateById[n.noteId] ?? null}
                onChange={(d) => setMeetingDateById((m) => ({ ...m, [n.noteId]: d }))}
              />
              <span className="text-[11px] text-muted-foreground">at</span>
              <Input
                type="time"
                value={meetingTimeById[n.noteId] ?? '10:00'}
                onChange={(e) => setMeetingTimeById((m) => ({ ...m, [n.noteId]: e.target.value }))}
                className="h-7 w-24 text-xs"
              />
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={meetingBusyId === n.noteId || !meetingDateById[n.noteId]}
                onClick={() => handleAddMeet(n.noteId)}
              >
                {meetingBusyId === n.noteId
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <><Video className="w-3 h-3 mr-1" />Schedule Meet</>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setPickerOpenId(null)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isMeeting && !n.googleMeetLink && canManage && pickerOpenId !== n.noteId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                // Open the inline picker so the rep can choose a different
                // date/time than the note's occurred_at before scheduling.
                setPickerOpenId(n.noteId);
                if (!meetingDateById[n.noteId]) {
                  setMeetingDateById((m) => ({
                    ...m,
                    [n.noteId]: n.occurredAt instanceof Date ? n.occurredAt : new Date(n.occurredAt),
                  }));
                }
                if (!meetingTimeById[n.noteId]) {
                  const seed = n.occurredAt instanceof Date ? n.occurredAt : new Date(n.occurredAt);
                  const hh = String(seed.getHours()).padStart(2, '0');
                  const mm = String(seed.getMinutes()).padStart(2, '0');
                  setMeetingTimeById((m) => ({ ...m, [n.noteId]: `${hh}:${mm}` }));
                }
              }}
              title="Schedule a Google Meet (pick any date/time, not tied to the note's date)"
            >
              <Video className="w-3 h-3 mr-1" />Add Meet
            </Button>
          )}
          {isMeeting && n.googleMeetLink && canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] text-destructive hover:text-destructive border-destructive/40"
              disabled={meetingBusyId === n.noteId}
              onClick={() => handleCancelMeet(n.noteId)}
              title="Cancel this Meet and delete the Calendar event"
            >
              {meetingBusyId === n.noteId
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <><VideoOff className="w-3 h-3 mr-1" />Cancel Meet</>}
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={removingId === n.noteId}
              onClick={() => handleDelete(n.noteId)}
            >
              {removingId === n.noteId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const Composer = () => {
    if (!composer) return null;
    const meta = KIND_META[composer.kind];
    return (
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <meta.icon className={cn('w-4 h-4', meta.tone)} />
          <span className="font-medium text-sm">New {meta.label}</span>
        </div>
        <Input
          value={composer.subject}
          onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
          placeholder="Subject"
          maxLength={200}
        />
        <Textarea
          value={composer.body}
          onChange={(e) => setComposer({ ...composer, body: e.target.value })}
          placeholder="Details (optional)"
          rows={2}
          maxLength={2000}
        />
        {(composer.kind === 'task' || composer.kind === 'meeting' || composer.kind === 'call') && (
          <Input
            type="datetime-local"
            value={composer.occurredAt}
            onChange={(e) => setComposer({ ...composer, occurredAt: e.target.value })}
          />
        )}
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={() => setComposer(null)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            {busy ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving…</> : 'Save'}
          </Button>
        </div>
      </div>
    );
  };

  const emptyHint = (label: string) => (
    <p className="text-xs text-muted-foreground italic">{label}</p>
  );

  return (
    <>
      {/* ─── Notes ──────────────────────────────────────────────────────── */}
      {show('notes') && <Card id="notes">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Notes</h3>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => openComposer('note')}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add note
              </Button>
            )}
          </div>
          {composer?.kind === 'note' && <Composer />}
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : justNotes.length === 0 ? (
            emptyHint('No notes yet — drop a quick note so the team knows what changed.')
          ) : (
            <ul className="space-y-0">{justNotes.map(renderRow)}</ul>
          )}
        </CardContent>
      </Card>}

      {/* ─── Open Activities ──────────────────────────────────────────────
          Previously this section read from client_notes rows with
          kind='task'/'meeting'/'call' and split open/closed by
          occurredAt vs now. That meant: (a) it only saw activities
          created via the legacy in-deal composer below, NOT the ones
          created from the Activities hub or any other drawer, and
          (b) "closed" was defined by clock time, not by row status.
          Replaced with EntityActivitiesSection so the deal sees the
          same client_tasks / meetings / calls the rest of the CRM
          uses, with the same drag-droppable status semantics. */}
      {show('open-activities') && <Card id="open-activities">
        <CardContent className="pt-5">
          <EntityActivitiesSection
            entityKind="deal"
            entityName="this deal"
            entityId={dealId}
            clientId={clientId}
            dealId={dealId}
            mode="open"
            readOnly={!canManage}
          />
        </CardContent>
      </Card>}

      {/* ─── Closed Activities ──────────────────────────────────────────── */}
      {show('closed-activities') && <Card id="closed-activities">
        <CardContent className="pt-5">
          <EntityActivitiesSection
            entityKind="deal"
            entityName="this deal"
            entityId={dealId}
            clientId={clientId}
            dealId={dealId}
            mode="closed"
            readOnly
          />
        </CardContent>
      </Card>}

      {/* ─── Emails ─────────────────────────────────────────────────────── */}
      {show('emails') && <Card id="emails">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-base font-semibold">Emails</h3>
            <div className="flex items-center gap-2">
              <Select value={emailFilter} onValueChange={(v) => setEmailFilter(v as typeof emailFilter)}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sent">Emails Sent from CRM</SelectItem>
                  <SelectItem value="all">All emails</SelectItem>
                </SelectContent>
              </Select>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => openComposer('email')}>
                  <Send className="w-3.5 h-3.5 mr-1" /> Send Email
                </Button>
              )}
            </div>
          </div>
          {composer?.kind === 'email' && <Composer />}
          {emails.length === 0 ? (
            emptyHint('No records found')
          ) : (
            <ul className="space-y-0">{emails.map(renderRow)}</ul>
          )}
        </CardContent>
      </Card>}
    </>
  );
};
