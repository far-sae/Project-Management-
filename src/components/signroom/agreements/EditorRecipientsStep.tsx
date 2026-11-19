import React, { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { meFirst } from '@/lib/signroom/agreementFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Agreement, Participant } from '../../../../api/_signroom/shared/types';
import { Card, CheckRow } from './Card';

export const MAX_RECIPIENTS = 12;
export const newId = (): string => crypto.randomUUID();

interface EditorRecipientsStepProps {
  draft: Agreement;
  /** The signed-in sender, for "Add myself" and "I sign first". */
  me: { name: string; email: string };
  update: (patch: Partial<Agreement>) => void;
}

/** Step 2: who signs, who only gets a copy, the order, and the words of the invitation. */
export const EditorRecipientsStep: React.FC<EditorRecipientsStepProps> = ({ draft, me, update }) => {
  const id = useId();
  const people = draft.participants;

  const patch = (participantId: string, change: Partial<Participant>) =>
    update({ participants: people.map((p) => (p.id === participantId ? { ...p, ...change } : p)) });

  /** Fields belong to signers: a recipient who leaves, or turns into a copy, loses theirs. */
  const withoutFieldsOf = (participantId: string) => draft.fields.filter((f) => f.participantId !== participantId);

  const add = (myself = false) => {
    if (people.length >= MAX_RECIPIENTS) {
      toast.error('Use at most 12 recipients.');
      return;
    }
    update({
      participants: [...people, {
        id: newId(),
        name: myself ? me.name : '',
        email: myself ? me.email : '',
        role: 'signer',
        order: people.length + 1,
        progress: 'waiting',
        version: 0,
      }],
    });
  };

  return (
    <Card title="Who needs to sign?" note="Add company and internal signers. Copy recipients receive completion access only.">
      <div className="flex flex-col gap-4 p-4">
        {people.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No recipients yet. Add the person who needs to sign.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {people.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1.5">
                  <Label htmlFor={`${id}-${p.id}-name`}>Full name</Label>
                  <Input id={`${id}-${p.id}-name`} value={p.name} maxLength={150} autoComplete="off" onChange={(e) => patch(p.id, { name: e.target.value })} />
                </div>
                <div className="flex min-w-0 flex-1 basis-52 flex-col gap-1.5">
                  <Label htmlFor={`${id}-${p.id}-email`}>Email address</Label>
                  <Input id={`${id}-${p.id}-email`} type="email" value={p.email} maxLength={254} autoComplete="off" onChange={(e) => patch(p.id, { email: e.target.value })} />
                </div>
                <div className="flex w-44 flex-col gap-1.5">
                  <Label htmlFor={`${id}-${p.id}-role`}>Role</Label>
                  <Select
                    value={p.role}
                    onValueChange={(role) => update({
                      participants: people.map((x) => (x.id === p.id ? { ...x, role: role as Participant['role'] } : x)),
                      fields: withoutFieldsOf(p.id),
                    })}
                  >
                    <SelectTrigger id={`${id}-${p.id}-role`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signer">Signer</SelectItem>
                      <SelectItem value="copy">Completion copy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${p.name || 'recipient'}`}
                  onClick={() => update({ participants: people.filter((x) => x.id !== p.id), fields: withoutFieldsOf(p.id) })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => add()}><Plus aria-hidden /> Add recipient</Button>
          <Button type="button" variant="ghost" onClick={() => add(true)}>Add myself as a signer</Button>
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
          <CheckRow
            checked={Boolean(draft.senderFirst)}
            onChange={(checked) => update(checked
              ? { senderFirst: true, sequential: true, participants: meFirst(people, me, newId) }
              : { senderFirst: false })}
          >
            I sign first, then choose when to send to the other company
            <span className="block text-xs text-muted-foreground">
              Place a signature field for yourself and each other signer. Signing first does not automatically send the document.
            </span>
          </CheckRow>
          <CheckRow checked={draft.sequential} disabled={Boolean(draft.senderFirst)} onChange={(checked) => update({ sequential: checked })}>
            Sign in order
            <span className="block text-xs text-muted-foreground">
              The list above sets the order. Copy recipients are invited only after completion.
            </span>
          </CheckRow>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-subject`}>Invitation subject</Label>
            <Input
              id={`${id}-subject`} value={draft.subject} maxLength={150} placeholder={`Please sign: ${draft.title}`}
              onChange={(e) => update({ subject: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-message`}>Message to recipients</Label>
            <Textarea
              id={`${id}-message`} rows={3} maxLength={2000} value={draft.message} placeholder="A short note to introduce the agreement."
              onChange={(e) => update({ message: e.target.value })}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default EditorRecipientsStep;
