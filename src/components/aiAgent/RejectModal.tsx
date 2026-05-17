import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REASONS = [
  { id: "generic", label: "Too generic" },
  { id: "wrong_tone", label: "Wrong tone" },
  { id: "bad_enrichment", label: "Bad enrichment" },
  { id: "not_a_lead", label: "Not a real lead" },
  { id: "bad_timing", label: "Wrong timing" },
  { id: "other", label: "Other" },
] as const;

interface Props {
  open: boolean;
  onCancel: () => void;
  onReject: (reasons: string[], note: string) => void | Promise<void>;
}

export const RejectModal: React.FC<Props> = ({ open, onCancel, onReject }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try { await onReject(Array.from(selected), note); }
    finally { setSubmitting(false); }
  };

  const needsNote = selected.has("other");
  const canSubmit = selected.size > 0 && (!needsNote || note.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why reject this draft?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                {r.label}
              </label>
            ))}
          </div>
          {needsNote && (
            <div>
              <Label>Tell us more</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Saving…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
