// Video meetings with one lead: the meetings that are planned, and the window
// that plans one. Planning makes a room and a link (the call server), writes
// the meeting down, and emails the link to the lead. The host joins the same
// room from here; the lead opens the link in a browser, with no account.
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CalendarClock, Copy, Loader2, Mail, Plus, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCallContext } from '@/components/calling/CallProvider';
import { SetupHint } from '@/components/common/SetupHint';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MEETING_LENGTHS, defaultStart, meetingState, startOf, toLocalInput, whenLabel } from '@/lib/crmMeetings';
import { publicMessage } from '@/lib/publicError';
import { errorSentence } from '@/services/automation/client';
import { createMeetingInvite } from '@/services/livekit/guestApi';
import { cancelMeeting, createMeeting, emailMeetingInvite, listLeadMeetings, type CrmMeeting } from '@/services/supabase/crmHub/meetings';

interface Props {
  organizationId: string;
  workspaceId: string;
  lead: { id: string; name: string; email: string | null };
  /** The planner, opened from elsewhere on the page too (the Log window). */
  planning: boolean;
  onPlanning: (open: boolean) => void;
  /** Called after a meeting is planned or an invite is sent, so the timeline can be read again. */
  onChanged?: () => void;
  /** The time "now", for tests. */
  now?: () => Date;
}

const timeZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

export const LeadMeetings: React.FC<Props> = ({ organizationId, workspaceId, lead, planning, onPlanning, onChanged, now = () => new Date() }) => {
  const { actions, state } = useCallContext();
  const [meetings, setMeetings] = useState<CrmMeeting[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<CrmMeeting | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await listLeadMeetings(workspaceId, lead.id);
      setMeetings(got.meetings);
      setReady(got.ready);
    } catch {
      toast.error('The meetings could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, lead.id]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  const at = now();
  // What can still be joined first, the soonest on top; what is over after it, the newest on top.
  const shown = useMemo(() => {
    const open = meetings.filter((m) => meetingState(m, at) !== 'over');
    const over = meetings.filter((m) => meetingState(m, at) === 'over').reverse();
    return [...open, ...over];
  }, [meetings]);

  const join = (meeting: CrmMeeting) => {
    void actions.startMeeting({ type: 'meeting', targetId: meeting.id, label: meeting.title, roomName: meeting.roomName }, 'video');
  };

  const copy = async (meeting: CrmMeeting) => {
    try {
      await navigator.clipboard.writeText(meeting.joinUrl);
      toast.success('Link copied. Anybody with it can ask to join.');
    } catch {
      // The clipboard is blocked here: hand the link over so it can be copied by hand.
      toast.message('The link of this meeting', { description: meeting.joinUrl, duration: 60_000 });
    }
  };

  const email = async (meeting: CrmMeeting) => {
    setBusyId(meeting.id);
    try {
      const sent = await emailMeetingInvite(workspaceId, meeting.id, { timeZone: timeZone() });
      toast.success(`The invite was emailed to ${sent.sentTo}.`);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(errorSentence(error));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    try {
      await cancelMeeting(cancelling.id);
      toast.success('Meeting cancelled');
      setCancelling(null);
      await load();
    } catch (error) {
      toast.error(publicMessage(error, 'The meeting could not be cancelled. Please try again.'));
    }
  };

  const inCall = state.status !== 'idle';

  return (
    <section aria-label="Meetings" className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Meetings</h2>
          <p className="text-xs text-muted-foreground">A video meeting with a link {lead.name} opens in a browser. No account is needed.</p>
        </div>
        <Button variant="outline" onClick={() => onPlanning(true)} disabled={!ready}><Plus aria-hidden />Plan a meeting</Button>
      </div>

      {!ready ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          <SetupHint other="Meetings with leads are not switched on yet.">
            Meetings need the meetings table: run supabase/crm_setup.sql in the Supabase SQL editor, then reload.
          </SetupHint>
        </p>
      ) : loading ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading meetings" /></div>
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No meeting is planned. Plan one, and the link is emailed to {lead.name}.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((meeting) => {
            const kind = meetingState(meeting, at);
            const over = kind === 'over';
            return (
              <li key={meeting.id} aria-label={meeting.title} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className={`min-w-0 ${over ? 'text-muted-foreground' : ''}`}>
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{meeting.title}</span>
                    {kind === 'now' && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Now</span>}
                    {over && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">Over</span>}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    <time dateTime={meeting.startsAt.toISOString()}>{whenLabel(meeting.startsAt)}</time> · {meeting.durationMinutes} minutes
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {meeting.invitedEmail && meeting.invitedAt
                      ? `Invite emailed to ${meeting.invitedEmail} on ${whenLabel(meeting.invitedAt)}`
                      : 'The invite was not emailed yet.'}
                  </p>
                </div>
                {!over && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" onClick={() => join(meeting)} disabled={inCall} aria-label={`Join ${meeting.title}`} title={inCall ? 'You are in a call already' : 'Join as the host'}>
                      <Video aria-hidden />Join
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void copy(meeting)} aria-label={`Copy the link of ${meeting.title}`}>
                      <Copy aria-hidden />Copy link
                    </Button>
                    <Button
                      size="sm" variant="outline" disabled={busyId !== null || !lead.email}
                      title={lead.email ? undefined : 'This lead has no email address'}
                      onClick={() => void email(meeting)} aria-label={`${meeting.invitedAt ? 'Email the invite again for' : 'Email the invite for'} ${meeting.title}`}
                    >
                      {busyId === meeting.id ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}{meeting.invitedAt ? 'Email again' : 'Email the invite'}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setCancelling(meeting)} aria-label={`Cancel ${meeting.title}`} title="Cancel this meeting">
                      <X aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PlanMeetingDialog
        open={planning} onOpenChange={onPlanning} organizationId={organizationId} workspaceId={workspaceId} lead={lead} now={now}
        onPlanned={async () => { await load(); onChanged?.(); }}
      />

      <AlertDialog open={cancelling !== null} onOpenChange={(open) => { if (!open) setCancelling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && `“${cancelling.title}” on ${whenLabel(cancelling.startsAt)} is taken off the list. ${cancelling.invitedEmail ? `${lead.name} is not told by itself: let them know.` : ''}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void cancel(); }}>Cancel the meeting</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

/** The planner: what it is about, when, how long, and whether the link is emailed. */
const PlanMeetingDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workspaceId: string;
  lead: Props['lead'];
  now: () => Date;
  onPlanned: () => void | Promise<void>;
}> = ({ open, onOpenChange, organizationId, workspaceId, lead, now, onPlanned }) => {
  const id = useId();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [sendEmail, setSendEmail] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Each time it opens: a fresh meeting, tomorrow at ten.
  useEffect(() => {
    if (!open) return;
    setTitle(`Meeting with ${lead.name}`);
    setWhen(defaultStart(now()));
    setMinutes(30);
    setSendEmail(Boolean(lead.email));
    setMessage('');
  }, [open]);

  const start = startOf(when);
  // A meeting that starts right now is fine; one that is long past is a slip of the hand.
  const past = start !== null && start.getTime() < now().getTime() - 5 * 60_000;
  const ready = Boolean(title.trim() && start && !past);

  const save = async () => {
    if (!ready || !start) return;
    setBusy(true);
    try {
      // 1. The room and the link, from the call server.
      let invite: Awaited<ReturnType<typeof createMeetingInvite>>;
      try {
        invite = await createMeetingInvite({ workspaceId, startsAt: start.toISOString(), label: title.trim() });
      } catch (error) {
        toast.error(publicMessage(error, 'The meeting link could not be made. Please try again.'));
        return;
      }
      // 2. The meeting itself.
      let meeting: CrmMeeting;
      try {
        meeting = await createMeeting({
          organizationId, workspaceId, contactId: lead.id, title: title.trim(), startsAt: start, durationMinutes: minutes,
          roomName: invite.roomName, joinUrl: invite.url,
        });
      } catch (error) {
        toast.error(publicMessage(error, 'The meeting could not be saved. Please try again.'));
        return;
      }
      onOpenChange(false);
      // 3. The email. A meeting that is planned stays planned when the email does not go out.
      if (sendEmail && lead.email) {
        try {
          const sent = await emailMeetingInvite(workspaceId, meeting.id, { timeZone: timeZone(), message: message.trim() });
          toast.success(`Meeting planned. The link was emailed to ${sent.sentTo}.`);
        } catch (error) {
          toast.error(`The meeting is planned, but the invite was not emailed. ${errorSentence(error)}`);
        }
      } else {
        toast.success('Meeting planned. Copy its link to send it yourself.');
      }
      await onPlanned();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onOpenChange(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan a meeting</DialogTitle>
          <DialogDescription>
            A video meeting in TaskCalendar. {lead.name} gets a link that opens in a browser, and waits a moment until you let them in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-title`}>What it is about</Label>
            <Input id={`${id}-title`} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-when`}>Day and time</Label>
              <Input id={`${id}-when`} type="datetime-local" min={toLocalInput(now())} value={when} onChange={(e) => setWhen(e.target.value)} />
              {past && <p role="alert" className="text-xs text-destructive">This time has passed. Choose a later one.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-length`}>How long</Label>
              <select
                id={`${id}-length`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm md:h-9"
              >
                {MEETING_LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={sendEmail && Boolean(lead.email)}
              disabled={!lead.email} onChange={(e) => setSendEmail(e.target.checked)}
            />
            <span className="min-w-0">
              Email the link to {lead.email || lead.name}
              {!lead.email && <span className="block text-xs text-muted-foreground">This lead has no email address. You can copy the link after the meeting is planned.</span>}
            </span>
          </label>
          {sendEmail && lead.email && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-message`}>A note for the invite (optional)</Label>
              <Textarea id={`${id}-message`} maxLength={2000} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything they should bring or read first" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}{sendEmail && lead.email ? 'Plan and email the link' : 'Plan the meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LeadMeetings;
