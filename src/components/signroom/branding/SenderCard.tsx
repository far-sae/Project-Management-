// Who document emails come from: the sender name customers see, and where their replies go.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { senderBody } from '@/lib/signroom/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, FIELD } from '@/components/signroom/billing/shared';

export interface SettingsCardProps {
  workspace: Workspace;
  /** A member may look but not change. */
  readOnly: boolean;
  onSaved: (workspace: Workspace) => void;
  /** Shows a refusal on the page and in a toast; an empty call clears the one on the page. */
  onRefused: (error?: unknown, fallback?: string) => void;
}

export const SenderCard: React.FC<SettingsCardProps> = ({ workspace, readOnly, onSaved, onRefused }) => {
  const id = useId();
  const { client } = useSignroom();
  const [senderName, setSenderName] = useState(workspace.senderName || workspace.name);
  const [replyTo, setReplyTo] = useState(workspace.replyTo);
  const [busy, setBusy] = useState(false);
  const locked = readOnly || busy;

  const save = async () => {
    setBusy(true);
    onRefused();
    try {
      const saved = await client.call<{ senderName: string; senderEmail: string; replyTo: string }>(
        'workspaces/email-settings', senderBody({ senderName, replyTo }, workspace),
      );
      onSaved({ ...workspace, senderName: saved.senderName, senderEmail: saved.senderEmail, replyTo: saved.replyTo });
      toast.success('Sender details saved. They apply to emails sent from now on.');
    } catch (err) {
      onRefused(err, 'Could not save the sender details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Sender details">
      <form className="flex flex-col gap-3 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="text-sm text-muted-foreground">The name customers see on the emails that carry your documents, and where their replies go.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={FIELD}>
            <Label htmlFor={`${id}-sender-name`}>Sender name</Label>
            <Input id={`${id}-sender-name`} required maxLength={100} disabled={locked} placeholder="Your name or company" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${id}-reply-to`}>Reply-to email address</Label>
            <Input id={`${id}-reply-to`} type="email" required maxLength={254} disabled={locked} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
          </div>
        </div>
        <div>
          <Button type="submit" variant="outline" disabled={locked}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save sender details
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default SenderCard;
