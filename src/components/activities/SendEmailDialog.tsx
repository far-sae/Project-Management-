import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Mail, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listEmailTemplates, expandTemplate,
  type EmailTemplate, type MergeContext,
} from '@/services/supabase/emailTemplates';

export interface SendEmailRecipient {
  /** The CRM entity we're emailing from — used to pre-fill merge
   *  tokens AND to log the email_event back to the right record. */
  entityType: 'lead' | 'contact' | 'client' | 'deal';
  entityId: string;
  /** Display name for the merge tokens. */
  name: string | null;
  email: string | null;
  /** Optional extras to populate {{client.*}} tokens. */
  legalName?: string | null;
  industry?: string | null;
  country?: string | null;
  accountOwnerName?: string | null;
}

interface SendEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipient: SendEmailRecipient | null;
  onSent?: () => void;
}

/**
 * In-app email composer that:
 *   1. Loads the org's saved Email Templates from
 *      Settings → CRM → Email templates.
 *   2. Lets the rep pick one; the subject + body are
 *      auto-expanded with merge tokens like
 *      {{client.name}} / {{user.name}} from the open recipient.
 *   3. Posts to the notify-send-gmail edge function with the entity
 *      context, so the resulting email is logged to email_events and
 *      shows up on the contact/lead drawer's Emails section
 *      automatically.
 *
 * Falls back to a plain mailto link when:
 *   - The edge function returns 412 (rep hasn't connected Gmail), or
 *   - The send genuinely fails — we open the rep's external mail
 *     client with the same subject/body so they can still send.
 */
export const SendEmailDialog: React.FC<SendEmailDialogProps> = ({
  open, onOpenChange, recipient, onSent,
}) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Build the merge context once per (recipient, user) pair.
  const mergeContext: MergeContext = useMemo(() => ({
    client: recipient ? {
      name: recipient.name,
      legalName: recipient.legalName ?? null,
      email: recipient.email,
      industry: recipient.industry ?? null,
      country: recipient.country ?? null,
      accountOwnerName: recipient.accountOwnerName ?? null,
    } : null,
    user: {
      name: user?.displayName ?? user?.email ?? null,
      email: user?.email ?? null,
    },
  }), [recipient, user]);

  // Load templates when the dialog opens.
  useEffect(() => {
    if (!open || !orgId) return;
    void listEmailTemplates(orgId).then(setTemplates);
  }, [open, orgId]);

  // Reset state on open + close.
  useEffect(() => {
    if (!open) return;
    setTemplateId('');
    setSubject('');
    setBody('');
  }, [open]);

  // When a template is picked, expand its tokens and prefill the
  // editor. The rep can still edit before sending.
  useEffect(() => {
    if (!templateId) return;
    const t = templates.find((x) => x.templateId === templateId);
    if (!t) return;
    setSubject(expandTemplate(t.subject ?? '', mergeContext));
    setBody(expandTemplate(t.body ?? '', mergeContext));
  }, [templateId, templates, mergeContext]);

  if (!recipient) return null;

  const handleSend = async () => {
    if (!recipient.email) { toast.error('No email address on file'); return; }
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!body.trim())    { toast.error('Body is required'); return; }
    if (!orgId)          { toast.error('No active organization'); return; }

    setSending(true);
    try {
      // Try the in-app Gmail send. The edge function logs to
      // email_events on success/failure, so the Emails section on the
      // drawer auto-refreshes.
      const { supabase } = await import('@/services/supabase/config');
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const baseEnv = (import.meta as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL;
      if (!token || !baseEnv) throw new Error('Not authenticated');

      const res = await fetch(`${baseEnv}/functions/v1/notify-send-gmail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          toEmail: recipient.email,
          toName: recipient.name,
          subject: subject.trim(),
          body: body.trim(),
          // Entity context → notify-send-gmail writes to email_events,
          // and that shows on the contact/lead drawer immediately.
          organizationId: orgId,
          entityType: recipient.entityType,
          entityId: recipient.entityId,
        }),
      });

      if (res.ok) {
        toast.success(`Email sent to ${recipient.email}`);
        onSent?.();
        onOpenChange(false);
        return;
      }

      // 412 = rep hasn't connected Gmail. Open mailto as a fallback
      // so the email STILL gets a chance to send from their external
      // client. Anything else (5xx etc.) — surface the real reason.
      const errBody = await res.json().catch(() => ({}));
      if (res.status === 412) {
        toast.info('Gmail isn’t connected — opening your email client instead');
        const params = new URLSearchParams({
          subject: subject.trim(),
          body: body.trim(),
        });
        window.location.href = `mailto:${recipient.email}?${params.toString()}`;
        onSent?.();
        onOpenChange(false);
        return;
      }
      throw new Error((errBody as { message?: string }).message ?? `send failed: ${res.status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-amber-600" />
            Send Email
          </DialogTitle>
          <DialogDescription className="sr-only">
            Compose an email to the recipient, optionally from a saved template. Sent via the connected Gmail account; falls back to a mailto link when Gmail isn't connected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[80px,1fr] gap-2 items-center text-sm">
            <Label className="text-muted-foreground">To</Label>
            <div className="font-medium">
              {recipient.name ?? recipient.email}
              {recipient.email && recipient.name && (
                <span className="text-muted-foreground font-normal ml-1">&lt;{recipient.email}&gt;</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[80px,1fr] gap-2 items-center text-sm">
            <Label htmlFor="template">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="template" className="h-9">
                <span className="inline-flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <SelectValue placeholder={templates.length === 0 ? 'No templates — create one in Settings → Email templates' : 'Choose a template (optional)'} />
                </span>
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.templateId} value={t.templateId}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-9"
          />
          <Textarea
            placeholder="Write your message… Tokens like {{client.name}}, {{user.name}} get auto-expanded from the picked template."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
          />

          <p className="text-[11px] text-muted-foreground">
            Sends through your connected Gmail (Settings → Integrations).
            Without it, this opens your default email client instead.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !recipient.email}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
