import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Video, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  createMeeting, updateMeeting, type Meeting, type MeetingParticipant,
} from '@/services/supabase/meetings';
import { DayPickerPopover } from '@/components/kanban/DayPickerPopover';
import { RelatedToPicker, type RelatedTo } from './RelatedToPicker';
import { AddParticipantsDialog } from './AddParticipantsDialog';
import { SendInvitesDialog } from './SendInvitesDialog';

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRelatedTo?: RelatedTo | null;
  /** When set, dialog opens in EDIT mode — prefilled from the meeting,
   *  Save calls updateMeeting instead of createMeeting. */
  editMeeting?: Meeting | null;
  onCreated?: () => void;
}

/**
 * Full Zoho-style "Create Meeting" flow:
 *   1. Form (title, location, all-day, from/to date+time, host,
 *      participants, related-to, description).
 *   2. On Save → if there are any participants, prompt "Send Invitations?"
 *      (Send / Do Not Send / Cancel). The choice is persisted on
 *      meetings.send_invites so a Calendar-sync worker can pick it up.
 *
 * Backed by the dedicated `meetings` table (migration 115). Doesn't
 * call Google Calendar from here — the existing /cancel-meet +
 * /crm-create-meet edge functions handle Google-side syncing, and this
 * dialog stays Google-free so it works for orgs without the Google
 * integration connected.
 */
export const CreateMeetingDialog: React.FC<CreateMeetingDialogProps> = ({
  open, onOpenChange, defaultRelatedTo = null, editMeeting = null, onCreated,
}) => {
  const isEditing = !!editMeeting;
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const members = organization?.members ?? [];

  // Form state
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [fromTime, setFromTime] = useState('09:00');
  const [toDate, setToDate] = useState<Date | null>(null);
  const [toTime, setToTime] = useState('10:00');
  const [hostId, setHostId] = useState<string>(user?.userId ?? '');
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [relatedTo, setRelatedTo] = useState<RelatedTo | null>(defaultRelatedTo);
  const [description, setDescription] = useState('');
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Sub-dialogs
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [invitePromptOpen, setInvitePromptOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editMeeting) {
      setTitle(editMeeting.title);
      setLocation(editMeeting.location ?? '');
      setAllDay(editMeeting.allDay);
      setFromDate(editMeeting.startAt);
      setFromTime(`${String(editMeeting.startAt.getHours()).padStart(2, '0')}:${String(editMeeting.startAt.getMinutes()).padStart(2, '0')}`);
      setToDate(editMeeting.endAt);
      setToTime(`${String(editMeeting.endAt.getHours()).padStart(2, '0')}:${String(editMeeting.endAt.getMinutes()).padStart(2, '0')}`);
      setHostId(editMeeting.hostUserId ?? user?.userId ?? '');
      setParticipants(editMeeting.participants);
      setRelatedTo(null);
      setDescription(editMeeting.description ?? '');
      setShowMoreDetails(!!editMeeting.description);
    } else {
      setTitle('');
      setLocation('');
      setAllDay(false);
      // Default to "today + tomorrow same time" so the form is one-click usable.
      const now = new Date();
      setFromDate(now);
      setFromTime(`${String(now.getHours()).padStart(2, '0')}:00`);
      setToDate(now);
      setToTime(`${String((now.getHours() + 1) % 24).padStart(2, '0')}:00`);
      setHostId(user?.userId ?? '');
      setParticipants([]);
      setRelatedTo(defaultRelatedTo);
      setDescription('');
      setShowMoreDetails(false);
    }
  }, [open, user?.userId, defaultRelatedTo, editMeeting]);

  const composeDateTime = (date: Date | null, hhmm: string): Date | null => {
    if (!date) return null;
    const [h, m] = hhmm.split(':').map((n) => Number(n) || 0);
    const out = new Date(date);
    if (allDay) out.setHours(0, 0, 0, 0);
    else out.setHours(h, m, 0, 0);
    return out;
  };

  const performSave = async (sendInvites: boolean) => {
    if (!orgId) return;
    const startAt = composeDateTime(fromDate, fromTime);
    const endAt = allDay
      ? (toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)) : null)
      : composeDateTime(toDate, toTime);
    if (!startAt || !endAt) { toast.error('Pick a from and to date/time'); return; }
    if (endAt.getTime() < startAt.getTime()) { toast.error('End must be after start'); return; }

    setSaving(true);
    try {
      const host = members.find((m) => m.userId === hostId);
      if (editMeeting) {
        await updateMeeting(editMeeting.meetingId, {
          title: title.trim(),
          location: location.trim() || null,
          allDay,
          startAt, endAt,
          hostUserId: hostId || null,
          hostName: host?.displayName ?? null,
          participants,
          description: description.trim() || null,
          sendInvites,
        });
        toast.success('Meeting updated');
      } else {
        await createMeeting({
          organizationId: orgId,
          title: title.trim(),
          location: location.trim() || null,
          allDay,
          startAt, endAt,
          hostUserId: hostId || null,
          hostName: host?.displayName ?? null,
          relatedToType: relatedTo?.type ?? null,
          relatedToId: relatedTo?.id ?? null,
          clientId: relatedTo?.clientId ?? null,
          dealId: relatedTo?.dealId ?? null,
          leadId: relatedTo?.leadId ?? null,
          participants,
          description: description.trim() || null,
          sendInvites,
          createdBy: user?.userId ?? null,
          createdByName: user?.displayName ?? user?.email ?? null,
        });
        toast.success(
          sendInvites && participants.length > 0
            ? `Meeting created — invites queued for ${participants.length} guest${participants.length === 1 ? '' : 's'}`
            : 'Meeting created',
        );
      }
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create meeting');
    } finally {
      setSaving(false);
      setInvitePromptOpen(false);
    }
  };

  const handleSaveClick = () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (participants.length > 0) {
      setInvitePromptOpen(true);
    } else {
      void performSave(false);
    }
  };

  const removeParticipant = (idx: number) =>
    setParticipants(participants.filter((_, i) => i !== idx));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-5 h-5 text-violet-600" /> {isEditing ? 'Edit Meeting' : 'Meeting Information'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {isEditing
                ? 'Edit the meeting title, time, location, host, participants, and description.'
                : 'Schedule a meeting with title, from/to time, host, participants, and an optional location and description.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (e.g. New Meeting with Jack)"
              className="text-base"
            />
            <Input
              value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (room, address, or video link)"
            />

            <div className="flex items-center gap-3">
              <Label className="text-sm">All day</Label>
              <Switch checked={allDay} onCheckedChange={setAllDay} />
            </div>

            <div className="grid grid-cols-[80px,1fr,140px] gap-2 items-center">
              <Label>From</Label>
              <DayPickerPopover value={fromDate} onChange={setFromDate} />
              {!allDay && (
                <Input
                  type="time" value={fromTime}
                  onChange={(e) => setFromTime(e.target.value)}
                  className="h-9"
                />
              )}
              {allDay && <div />}

              <Label>To</Label>
              <DayPickerPopover value={toDate} onChange={setToDate} />
              {!allDay && (
                <Input
                  type="time" value={toTime}
                  onChange={(e) => setToTime(e.target.value)}
                  className="h-9"
                />
              )}
              {allDay && <div />}
            </div>

            <div className="grid grid-cols-[80px,1fr] gap-2 items-center">
              <Label>Host</Label>
              <Select value={hostId} onValueChange={setHostId}>
                <SelectTrigger><SelectValue placeholder="Pick a host" /></SelectTrigger>
                <SelectContent>
                  {members.filter((m) => m.status === 'active').map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label className="self-start mt-1">Participants</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {participants.map((p, i) => (
                  <Badge key={`${p.kind}:${p.id ?? p.email}:${i}`} variant="secondary" className="gap-1 pl-2 pr-1">
                    {p.name}
                    <button
                      type="button" onClick={() => removeParticipant(i)}
                      className="opacity-60 hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                <Button
                  variant="ghost" size="sm" type="button"
                  onClick={() => setParticipantsOpen(true)}
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="w-3 h-3" />
                  {participants.length > 0 ? 'Add more' : 'Add'}
                </Button>
              </div>

              <Label>Related To</Label>
              <RelatedToPicker
                organizationId={orgId} value={relatedTo} onChange={setRelatedTo}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowMoreDetails((s) => !s)}
              className="text-xs text-primary hover:underline"
            >
              {showMoreDetails ? '− Less details' : '+ Add more details'}
            </button>

            {showMoreDetails && (
              <Textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Agenda, notes, dial-in details…"
                rows={4}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {isEditing ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddParticipantsDialog
        open={participantsOpen}
        onOpenChange={setParticipantsOpen}
        organizationId={orgId}
        value={participants}
        onChange={setParticipants}
      />

      <SendInvitesDialog
        open={invitePromptOpen}
        onOpenChange={setInvitePromptOpen}
        participantCount={participants.length}
        onChoose={(send) => void performSave(send)}
      />
    </>
  );
};
