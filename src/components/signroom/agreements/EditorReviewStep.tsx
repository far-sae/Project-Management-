import React, { useId, useState } from 'react';
import { Eye, PenLine, ShieldCheck } from 'lucide-react';
import { hasRequiredSignature, signerNames } from '@/lib/signroom/agreementFields';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/common/StatusPill';
import PdfViewer from '@/components/signroom/PdfViewer';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { Card, CheckRow, Notice } from './Card';

const REMINDERS: { days: number; label: string }[] = [
  { days: 0, label: 'No automatic reminders' },
  { days: 1, label: 'Every day' },
  { days: 3, label: 'Every 3 days' },
  { days: 7, label: 'Every week' },
];

interface EditorReviewStepProps {
  draft: Agreement;
  update: (patch: Partial<Agreement>) => void;
  /** "I confirm this is an ordinary agreement…" */
  eligible: boolean;
  onEligible: (eligible: boolean) => void;
  /** "This document has special signing requirements." */
  special: boolean;
  onSpecial: (special: boolean) => void;
  /** What the server will still refuse the draft for, in its own sentences. */
  blockers: string[];
  /** The server's sentence when the last send was refused. */
  sendError: string;
}

/** Step 4: a last look at what freezes on sending, the deadline and reminders, and the confirmation the server requires. */
export const EditorReviewStep: React.FC<EditorReviewStepProps> = ({
  draft, update, eligible, onEligible, special, onSpecial, blockers, sendError,
}) => {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const reminders = REMINDERS.some((r) => r.days === draft.reminderDays)
    ? REMINDERS
    : [...REMINDERS, { days: draft.reminderDays, label: `Every ${draft.reminderDays} days` }];

  return (
    <Card
      title="One last look"
      note="The PDF, recipients, fields and consent version freeze when you send."
      action={draft.documentHash && (
        <Button type="button" variant="outline" onClick={() => setPreview(!preview)} aria-expanded={preview}>
          <Eye aria-hidden /> {preview ? 'Hide recipient preview' : 'Recipient preview'}
        </Button>
      )}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
              <PenLine className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{draft.title}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {draft.pages.length} pages · {draft.fields.length} fields · {draft.sequential ? 'Signing in order' : 'Any signing order'}
              </p>
            </div>
          </div>
          <StatusPill tone="neutral">Draft</StatusPill>
        </div>

        {draft.participants.length > 0 && (
          <ul className="rounded-lg border border-border">
            {draft.participants.map((p, i) => {
              const copy = p.role === 'copy';
              const placed = hasRequiredSignature(draft.fields, p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5 last:border-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('truncate text-sm font-medium', !p.name && 'text-destructive')}>{p.name || 'Missing name'}</p>
                      <p className={cn('truncate text-xs', p.email ? 'text-muted-foreground' : 'text-destructive')}>{p.email || 'Missing email'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {copy ? 'Completion copy' : `Signer${draft.sequential ? ` ${p.order}` : ''}`}
                    </span>
                    <span className={copy ? 'text-muted-foreground' : placed ? 'text-success' : 'text-destructive'}>
                      {copy ? 'No signing access' : placed ? 'Signature placed' : 'Signature missing'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-deadline`}>Signing deadline (23:59 UTC)</Label>
            <Input
              id={`${id}-deadline`}
              type="date"
              className="tabular-nums"
              value={draft.deadline}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => update({ deadline: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reminders`}>Automatic reminders</Label>
            <Select value={String(draft.reminderDays)} onValueChange={(days) => update({ reminderDays: Number(days) })}>
              <SelectTrigger id={`${id}-reminders`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {reminders.map((r) => <SelectItem key={r.days} value={String(r.days)}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="rounded-lg border border-border px-4 py-3">
          <legend className="px-1 text-sm font-semibold">Ordinary agreements only</legend>
          <p className="text-sm text-muted-foreground">
            Deeds, witnessing, notarisation and special execution requirements are outside this release.
          </p>
          <CheckRow
            checked={special}
            onChange={(checked) => {
              onSpecial(checked);
              onEligible(false);
            }}
          >
            This document has special signing requirements.
          </CheckRow>
          {special ? (
            <p role="alert" className="text-sm text-destructive">
              Sending is unavailable. Use a process suited to the document’s execution requirements.
            </p>
          ) : (
            <CheckRow checked={eligible} onChange={onEligible}>
              I confirm this is an ordinary agreement without special execution requirements.
            </CheckRow>
          )}
        </fieldset>

        {blockers.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-warning-soft-foreground" role="status">
            <p className="text-sm font-semibold">Before you can send</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}

        {sendError && <Notice tone="danger" role="alert">{sendError}</Notice>}

        <Notice icon={<ShieldCheck />}>
          {draft.senderFirst
            ? 'Nobody else is invited until you have signed and chosen to send. Invitations are then emailed to each signer in turn.'
            : 'Invitations are emailed to the signers when you send. Copy recipients are emailed once everyone has signed.'}
        </Notice>

        {preview && draft.documentHash && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Read-only recipient preview · no signing privileges</h3>
            <PdfViewer
              agreement={{ id: draft.id, kind: 'source', version: draft.documentHash }}
              fields={draft.fields}
              recipientNames={signerNames(draft.participants)}
            />
          </div>
        )}
      </div>
    </Card>
  );
};

export default EditorReviewStep;
