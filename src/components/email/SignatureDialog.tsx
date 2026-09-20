import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildSignatureHtml, EMPTY_SIGNATURE_FIELDS, SIGNATURE_PLACEHOLDER,
  type SignatureFields,
} from '@/lib/email/signature';
import { updateAccountSignature } from '@/services/supabase/email';
import type { EmailAccount } from '@/lib/email/types';
import { RichTextEditor } from './RichTextEditor';

interface SignatureDialogProps {
  account: EmailAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * The signature for one mailbox.
 *
 * Per mailbox, not per user and not per campaign, because a campaign sends
 * from a pool and which mailbox takes a message is decided at send time. The
 * dialog names the address for that reason — this is the signature on mail
 * from THIS address, and a pool of three mailboxes has three of them.
 */
export const SignatureDialog: React.FC<SignatureDialogProps> = ({
  account, open, onOpenChange, onSaved,
}) => {
  const [html, setHtml] = useState('');
  const [fields, setFields] = useState<SignatureFields>(EMPTY_SIGNATURE_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloaded whenever a different mailbox is opened, so the dialog never shows
  // one mailbox's signature under another's address.
  useEffect(() => {
    if (!open || !account) return;
    setHtml(account.signatureHtml);
    setError(null);
    // The quick-fill starts from what the mailbox already knows about itself.
    setFields({ ...EMPTY_SIGNATURE_FIELDS, name: account.fromName });
  }, [open, account]);

  const quickFill = () => {
    const built = buildSignatureHtml(fields);
    if (built === '') {
      toast.error('Fill in at least one field first');
      return;
    }
    // Generated ONCE, as a starting point. Nothing binds the fields to the
    // signature afterwards: what is stored is the HTML, and editing it below
    // is editing the real thing. Two live representations would mean a rule
    // about which wins, and the answer would be wrong for anybody who then
    // adjusted the markup.
    setHtml(built);
    toast.success('Built — edit it below, it is yours now');
  };

  const save = async () => {
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      await updateAccountSignature(account.id, html);
      toast.success('Signature saved');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the signature');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof SignatureFields, label: string, placeholder: string) => (
    <div className="space-y-2">
      <Label htmlFor={`sig-${key}`}>{label}</Label>
      <Input
        id={`sig-${key}`}
        value={fields[key]}
        placeholder={placeholder}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signature</DialogTitle>
          <DialogDescription>
            {/* The address, not the label: this is what recipients see at the
                bottom of mail from this mailbox, and with a pool every mailbox
                signs with its own. */}
            Added to every message sent from{' '}
            <span className="font-medium text-foreground">{account?.fromEmail}</span>.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Start from these, then edit it however you like. Nothing stays linked — once
              built, the signature below is the real one.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {field('name', 'Name', 'Ada Lovelace')}
              {field('role', 'Role', 'Head of Partnerships')}
              {field('company', 'Company', 'Acme')}
              {field('phone', 'Phone', '+44 20 7946 0000')}
              {field('website', 'Website', 'acme.com')}
              {field('logoUrl', 'Logo URL', 'https://acme.com/logo.png')}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={quickFill}>
              <Wand2 className="mr-2 h-4 w-4" />
              Build it for me
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Signature</Label>
            <RichTextEditor
              value={html}
              onChange={setHtml}
              placeholder="Nothing yet — build one above, or write it here"
              mergeFields={['first_name', 'last_name', 'full_name', 'company']}
            />
            <p className="text-xs text-muted-foreground">
              Appended to the end of every message from this mailbox. To place it somewhere
              else, put <code className="font-mono">{SIGNATURE_PLACEHOLDER}</code> in the
              message body and it goes there instead.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
