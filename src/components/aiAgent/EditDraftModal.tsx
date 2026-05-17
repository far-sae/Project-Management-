import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentDraft } from "@/services/supabase/agentSuggestions";

interface Props {
  open: boolean;
  initial: AgentDraft;
  onCancel: () => void;
  onSend: (draft: { subject: string; bodyText: string; bodyHtml: string }) => void | Promise<void>;
}

export const EditDraftModal: React.FC<Props> = ({ open, initial, onCancel, onSend }) => {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.bodyText || initial.bodyHtml.replace(/<[^>]+>/g, ""));
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const html = body
        .split(/\n\n+/)
        .filter((p) => p.trim().length > 0)
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("");
      await onSend({ subject, bodyText: body, bodyHtml: html });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit draft</DialogTitle>
          <DialogDescription>
            Review and adjust the AI-generated outreach before sending it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !subject || !body}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
