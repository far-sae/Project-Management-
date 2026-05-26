import React, { useEffect, useState } from 'react';
import { Send, Loader2, MessageSquare } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Client } from '@/services/supabase/clients';
import { createNote } from '@/services/supabase/clients';
import { sendSms } from '@/services/supabase/sms';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface SendSmsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  organizationId: string;
  onLogged?: () => void;
}

const MAX_LEN = 1600;
const SEGMENT_LEN = 160;

export const SendSmsDialog: React.FC<SendSmsDialogProps> = ({
  open, onOpenChange, client, organizationId, onLogged,
}) => {
  const { user } = useAuth();
  const [to, setTo] = useState(client.phone ?? '');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(client.phone ?? '');
    setBody('');
  }, [open, client.phone]);

  const segments = Math.max(1, Math.ceil(body.length / SEGMENT_LEN));

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) {
      toast.error('Add a phone number and message body');
      return;
    }
    if (!/^\+\d{6,}$/.test(to.trim())) {
      toast.error('Phone must be E.164, e.g. +15551234567');
      return;
    }
    setSending(true);
    try {
      const result = await sendSms({
        organizationId,
        to: to.trim(),
        body: body.trim(),
        clientId: client.clientId,
      });
      toast.success(`SMS ${result.status} (Twilio)`);
      try {
        await createNote(
          organizationId,
          client.clientId,
          user?.userId ?? '',
          user?.displayName ?? '',
          {
            kind: 'note',
            subject: `SMS to ${to.trim()}`,
            body: body.trim(),
            occurredAt: new Date(),
          },
        );
      } catch {
        /* timeline note is best-effort */
      }
      onLogged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Send SMS to {client.name}
          </DialogTitle>
          <DialogDescription>
            Sent via Twilio. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
            TWILIO_FROM_NUMBER to be set on the sms-send edge function.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">To (E.164)</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+15551234567"
              disabled={sending}
              maxLength={20}
            />
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={MAX_LEN}
              disabled={sending}
              placeholder="Hi — just following up on…"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {body.length}/{MAX_LEN} chars · {segments} SMS segment
              {segments === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !to.trim() || !body.trim()}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send SMS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
