import React, { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, Mail, ExternalLink } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Client, CreateNoteInput } from '@/services/supabase/clients';
import { createNote } from '@/services/supabase/clients';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { expandTemplate, MergeContext } from '@/services/supabase/emailTemplates';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface SendEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  organizationId: string;
  onLogged?: () => void;
}

const NONE = '__none__';

export const SendEmailDialog: React.FC<SendEmailDialogProps> = ({
  open, onOpenChange, client, organizationId, onLogged,
}) => {
  const { user } = useAuth();
  const { templates, loading } = useEmailTemplates();
  const [templateId, setTemplateId] = useState<string>(NONE);
  const [to, setTo] = useState(client.email ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [logging, setLogging] = useState(false);

  const ctx: MergeContext = useMemo(() => ({
    client: {
      name: client.name,
      legalName: client.legalName,
      email: client.email,
      industry: client.industry,
      country: client.country,
      accountOwnerName: client.accountOwnerName,
    },
    user: {
      name: user?.displayName,
      email: user?.email,
    },
  }), [client, user]);

  useEffect(() => {
    if (!open) return;
    setTo(client.email ?? '');
    setTemplateId(NONE);
    setSubject('');
    setBody('');
  }, [open, client.email]);

  const handlePickTemplate = (id: string) => {
    setTemplateId(id);
    if (id === NONE) {
      setSubject('');
      setBody('');
      return;
    }
    const tpl = templates.find((t) => t.templateId === id);
    if (!tpl) return;
    setSubject(expandTemplate(tpl.subject, ctx));
    setBody(expandTemplate(tpl.body, ctx));
  };

  const buildMailto = () => {
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    const qs = params.toString();
    return `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`;
  };

  const handleOpenInMail = () => {
    if (!to.trim()) {
      toast.error('Add a recipient email first');
      return;
    }
    window.location.href = buildMailto();
  };

  const handleLogAndSend = async () => {
    if (!to.trim()) {
      toast.error('Add a recipient email first');
      return;
    }
    setLogging(true);
    try {
      const note: CreateNoteInput = {
        kind: 'email',
        subject: subject || `Email to ${to}`,
        body: body
          ? `To: ${to}\n\n${body}`
          : `To: ${to}`,
        occurredAt: new Date(),
      };
      await createNote(
        organizationId,
        client.clientId,
        user?.userId ?? '',
        user?.displayName ?? '',
        note,
      );
      toast.success('Email logged on the client timeline');
      onLogged?.();
      window.location.href = buildMailto();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log email');
    } finally {
      setLogging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" /> Email {client.name}
          </DialogTitle>
          <DialogDescription>
            Compose from a saved template — merge tokens are filled in
            automatically. Sending opens your default mail app and logs the
            send on this client's timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={handlePickTemplate} disabled={logging}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? 'Loading…' : 'Start blank'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Start blank</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.templateId} value={t.templateId}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">To</Label>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="contact@example.com"
              disabled={logging}
              maxLength={320}
            />
          </div>

          <div>
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              disabled={logging}
            />
          </div>

          <div>
            <Label className="text-xs">Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={8000}
              disabled={logging}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={logging}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleOpenInMail} disabled={logging}>
            <ExternalLink className="w-4 h-4 mr-2" /> Open in mail app
          </Button>
          <Button onClick={handleLogAndSend} disabled={logging}>
            {logging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Log & send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
