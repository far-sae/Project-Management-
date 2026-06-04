import React, { useEffect, useState } from 'react';
import { Send, Loader2, MessageSquare, Sparkles } from 'lucide-react';
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
import { suggestReplies } from '@/services/supabase/aiSuggestions';
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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTo(client.phone ?? '');
    setBody('');
    setSuggestions([]);
  }, [open, client.phone]);

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestions([]);
    try {
      const drafts = await suggestReplies({
        channel: 'sms',
        client: {
          name: client.name,
          industry: client.industry,
          country: client.country,
          rating: client.rating,
          scoreBand: client.scoreBand,
        },
        draft: body,
        senderName: user?.displayName ?? null,
      });
      setSuggestions(drafts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      setSuggesting(false);
    }
  };

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
            Send a text message to this contact. Standard SMS charges apply.
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
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Message</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSuggest}
                disabled={suggesting || sending}
                className="h-7 text-xs"
              >
                {suggesting ? (
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1.5" />
                )}
                Suggest with AI
              </Button>
            </div>
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
            {suggestions.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setBody(s); setSuggestions([]); }}
                    className="w-full text-left p-2 rounded border bg-muted/30 hover:bg-muted/60 transition-colors text-xs whitespace-pre-wrap"
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground mr-1">
                      Draft {i + 1}
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            )}
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
