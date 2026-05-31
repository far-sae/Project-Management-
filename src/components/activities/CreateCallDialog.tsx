import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Phone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  createCall, updateCall, type Call, type CallStatus, type CallType,
} from '@/services/supabase/calls';
import { DayPickerPopover } from '@/components/kanban/DayPickerPopover';
import { RelatedToPicker, type RelatedTo } from './RelatedToPicker';

interface CreateCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRelatedTo?: RelatedTo | null;
  /** When set, dialog opens in EDIT mode — prefilled from the call,
   *  Save calls updateCall instead of createCall. */
  editCall?: Call | null;
  onCreated?: () => void;
}

/**
 * "Log Call" / "Schedule Call" modal. Supports both modes:
 *   - call_status='scheduled' → planning a call to make
 *   - call_status='completed' → logging one that already happened
 *
 * Switching the Status field reveals/hides duration + outcome fields
 * so the form matches the mental model the rep is in.
 */
export const CreateCallDialog: React.FC<CreateCallDialogProps> = ({
  open, onOpenChange, defaultRelatedTo = null, editCall = null, onCreated,
}) => {
  const isEditing = !!editCall;
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const members = organization?.members ?? [];

  const [subject, setSubject] = useState('');
  const [callType, setCallType] = useState<CallType>('outbound');
  const [callStatus, setCallStatus] = useState<CallStatus>('scheduled');
  const [callDate, setCallDate] = useState<Date | null>(null);
  const [callTime, setCallTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState<string>('5');
  const [callerId, setCallerId] = useState<string>(user?.userId ?? '');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [relatedTo, setRelatedTo] = useState<RelatedTo | null>(defaultRelatedTo);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editCall) {
      setSubject(editCall.subject);
      setCallType(editCall.callType);
      setCallStatus(editCall.callStatus);
      if (editCall.callStartAt) {
        setCallDate(editCall.callStartAt);
        setCallTime(`${String(editCall.callStartAt.getHours()).padStart(2, '0')}:${String(editCall.callStartAt.getMinutes()).padStart(2, '0')}`);
      } else {
        setCallDate(null);
        setCallTime('10:00');
      }
      setDurationMin(String(Math.round((editCall.callDurationSeconds ?? 0) / 60)));
      setCallerId(editCall.callerUserId ?? user?.userId ?? '');
      setContactName(editCall.contactName ?? '');
      setContactPhone(editCall.contactPhone ?? '');
      setDescription(editCall.description ?? '');
      setOutcome(editCall.outcome ?? '');
      setRelatedTo(null);
    } else {
      setSubject('');
      setCallType('outbound');
      setCallStatus('scheduled');
      const now = new Date();
      setCallDate(now);
      setCallTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setDurationMin('5');
      setCallerId(user?.userId ?? '');
      setContactName('');
      setContactPhone('');
      setDescription('');
      setOutcome('');
      setRelatedTo(defaultRelatedTo);
    }
  }, [open, user?.userId, defaultRelatedTo, editCall]);

  const composeStart = (): Date | null => {
    if (!callDate) return null;
    const [h, m] = callTime.split(':').map((n) => Number(n) || 0);
    const out = new Date(callDate);
    out.setHours(h, m, 0, 0);
    return out;
  };

  const handleSave = async () => {
    if (!orgId) return;
    if (!subject.trim()) { toast.error('Subject is required'); return; }

    setSaving(true);
    try {
      const caller = members.find((m) => m.userId === callerId);
      const start = composeStart();
      const durSeconds = callStatus === 'completed' ? Math.max(0, Number(durationMin) || 0) * 60 : null;
      if (editCall) {
        await updateCall(editCall.callId, {
          subject: subject.trim(),
          callType,
          callStatus,
          callStartAt: start,
          callDurationSeconds: durSeconds,
          callerUserId: callerId || null,
          callerName: caller?.displayName ?? null,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          description: description.trim() || null,
          outcome: outcome.trim() || null,
        });
        toast.success('Call updated');
      } else {
        await createCall({
          organizationId: orgId,
          subject: subject.trim(),
          callType,
          callStatus,
          callStartAt: start,
          callDurationSeconds: durSeconds,
          callerUserId: callerId || null,
          callerName: caller?.displayName ?? null,
          relatedToType: relatedTo?.type ?? null,
          relatedToId: relatedTo?.id ?? null,
          clientId: relatedTo?.clientId ?? null,
          dealId: relatedTo?.dealId ?? null,
          leadId: relatedTo?.leadId ?? null,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          description: description.trim() || null,
          outcome: outcome.trim() || null,
          createdBy: user?.userId ?? null,
          createdByName: user?.displayName ?? user?.email ?? null,
        });
        toast.success(
          callStatus === 'completed' ? 'Call logged' : 'Call scheduled',
        );
      }
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save call');
    } finally {
      setSaving(false);
    }
  };

  const completed = callStatus === 'completed';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-emerald-600" /> {isEditing ? 'Edit Call' : completed ? 'Log a Call' : 'Schedule a Call'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? 'Edit a logged or scheduled call.' : 'Schedule or log a call with subject, direction, status, caller, and outcome.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[140px,1fr] gap-3 items-center">
          <Label>Subject <span className="text-destructive">*</span></Label>
          <Input
            value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Discovery call with Jack"
          />

          <Label>Status</Label>
          <Select value={callStatus} onValueChange={(v) => setCallStatus(v as CallStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="missed">Missed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Label>Direction</Label>
          <Select value={callType} onValueChange={(v) => setCallType(v as CallType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="outbound">Outbound</SelectItem>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="missed">Missed</SelectItem>
              <SelectItem value="scheduled">Scheduled (no direction yet)</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Label>{completed ? 'Happened at' : 'Scheduled for'}</Label>
          <div className="flex gap-2">
            <DayPickerPopover value={callDate} onChange={setCallDate} />
            <Input
              type="time" value={callTime}
              onChange={(e) => setCallTime(e.target.value)}
              className="h-9 w-28"
            />
          </div>

          {completed && (
            <>
              <Label>Duration (min)</Label>
              <Input
                type="number" min="0" step="1"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                className="w-28 h-9"
              />
            </>
          )}

          <Label>Caller</Label>
          <Select value={callerId} onValueChange={setCallerId}>
            <SelectTrigger><SelectValue placeholder="Who made the call?" /></SelectTrigger>
            <SelectContent>
              {members.filter((m) => m.status === 'active').map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.displayName} {m.userId === user?.userId && '(me)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label>Related To</Label>
          <RelatedToPicker
            organizationId={orgId} value={relatedTo} onChange={setRelatedTo}
          />

          <Label>Contact name</Label>
          <Input
            value={contactName} onChange={(e) => setContactName(e.target.value)}
            placeholder="Person on the other end"
          />

          <Label>Phone</Label>
          <Input
            value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+1 555 …"
          />

          <Label className="self-start mt-1">Description</Label>
          <Textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Context or talking points"
            rows={3}
          />

          {completed && (
            <>
              <Label className="self-start mt-1">Outcome</Label>
              <Textarea
                value={outcome} onChange={(e) => setOutcome(e.target.value)}
                placeholder="What was discussed, next steps…"
                rows={3}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isEditing ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
