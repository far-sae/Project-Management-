import React, { useId, useState } from 'react';
import { ArrowRight, Calendar, CheckSquare, PenLine, Plus, Trash2, Type } from 'lucide-react';
import { toast } from 'sonner';
import {
  FIELD_LABELS, geometryAllows, placeField, signatureForEachSigner, signerNames,
} from '@/lib/signroom/agreementFields';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import PdfViewer from '@/components/signroom/PdfViewer';
import { FIELD_TYPES, type Agreement, type Field, type FieldKind } from '../../../../api/_signroom/shared/types';
import { Card, CheckRow } from './Card';
import { newId } from './EditorRecipientsStep';

const kindIcon = (kind: FieldKind) =>
  kind === 'signature' ? <PenLine aria-hidden />
    : kind === 'checkbox' ? <CheckSquare aria-hidden />
      : kind === 'date_signed' ? <Calendar aria-hidden />
        : <Type aria-hidden />;

const GEOMETRY: { key: 'x' | 'y' | 'width' | 'height'; label: string }[] = [
  { key: 'x', label: 'Left %' },
  { key: 'y', label: 'Top %' },
  { key: 'width', label: 'Width %' },
  { key: 'height', label: 'Height %' },
];

interface EditorFieldsStepProps {
  draft: Agreement;
  update: (patch: Partial<Agreement>) => void;
  /** Go back to the document step (no PDF yet) or to recipients (no signer yet). */
  onGoTo: (step: 'document' | 'recipients') => void;
}

/**
 * Step 3: where each signer signs. Pick a kind of field and a signer, then
 * click or tap the page; drag a field to move it and its corner to resize it.
 * Everything can also be done from the buttons, the list and the inspector.
 */
export const EditorFieldsStep: React.FC<EditorFieldsStepProps> = ({ draft, update, onGoTo }) => {
  const id = useId();
  const [kind, setKind] = useState<FieldKind>('signature');
  const [chosenRecipient, setChosenRecipient] = useState('');
  const [selected, setSelected] = useState('');

  const names = signerNames(draft.participants);
  const signerIds = Object.keys(names);
  const recipient = names[chosenRecipient] ? chosenRecipient : signerIds[0] ?? '';
  const active = draft.fields.find((f) => f.id === selected);

  const patchField = (fieldId: string, change: Partial<Field>) =>
    update({ fields: draft.fields.map((f) => (f.id === fieldId ? { ...f, ...change } : f)) });

  const place = (page: number, x?: number, y?: number) => {
    if (!recipient) {
      toast.error('Add a signer before placing fields.');
      onGoTo('recipients');
      return;
    }
    const field = placeField({ id: newId(), kind, participantId: recipient, page, x, y });
    update({ fields: [...draft.fields, field] });
    setSelected(field.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="A place for every signature"
        note="Choose a field and recipient, then click the PDF. Use Add field and the inspector for keyboard placement."
        action={(
          <Button
            type="button"
            variant="outline"
            disabled={!draft.documentHash || signerIds.length === 0}
            onClick={() => update({
              fields: [...draft.fields, ...signatureForEachSigner(draft.participants, draft.pages.length, newId)],
            })}
          >
            Add signature for each signer
          </Button>
        )}
      >
        {!draft.documentHash ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">Prepare a PDF before placing fields.</p>
            <Button type="button" onClick={() => onGoTo('document')}>Back to document</Button>
          </div>
        ) : (
          <div className="grid items-start gap-4 p-4 lg:grid-cols-[13rem_minmax(0,1fr)] 2xl:grid-cols-[13rem_minmax(0,1fr)_16rem]">
            <aside className="flex flex-col gap-3" aria-label="Field choices">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-recipient`}>Assign fields to</Label>
                <Select value={recipient} onValueChange={setChosenRecipient} disabled={signerIds.length === 0}>
                  <SelectTrigger id={`${id}-recipient`} aria-label="Field recipient"><SelectValue placeholder="No signers yet" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(names).map(([pid, name]) => <SelectItem key={pid} value={pid}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span id={`${id}-kinds`} className="text-sm font-medium">Fields</span>
                <div role="radiogroup" aria-labelledby={`${id}-kinds`} className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
                  {FIELD_TYPES.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={cn(
                        'flex min-h-[40px] items-center gap-2 rounded-md border px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                        kind === k ? 'border-foreground bg-secondary font-medium' : 'border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                      )}
                    >
                      {kindIcon(k)} {FIELD_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="button" onClick={() => place(1)}><Plus aria-hidden /> Add field</Button>
            </aside>

            <PdfViewer
              agreement={{ id: draft.id, kind: 'source', version: draft.documentHash }}
              fields={draft.fields}
              recipientNames={names}
              selected={selected}
              onSelect={setSelected}
              onFieldChange={(fieldId, change) => patchField(fieldId, change as Partial<Field>)}
              onPlace={place}
            />

            <aside className="flex flex-col gap-3 rounded-lg border border-border p-3 lg:col-span-2 2xl:col-span-1" aria-label="Field inspector">
              <h3 className="text-sm font-semibold">Field inspector</h3>
              {active ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-label`}>Label</Label>
                    <Input id={`${id}-label`} value={active.label} maxLength={100} onChange={(e) => patchField(active.id, { label: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-signer`}>Assigned signer</Label>
                    <Select value={active.participantId} onValueChange={(participantId) => patchField(active.id, { participantId })}>
                      <SelectTrigger id={`${id}-signer`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(names).map(([pid, name]) => <SelectItem key={pid} value={pid}>{name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-page`}>Page</Label>
                    <Select value={String(active.page)} onValueChange={(page) => patchField(active.id, { page: Number(page) })}>
                      <SelectTrigger id={`${id}-page`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {draft.pages.map((_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {GEOMETRY.map(({ key, label }) => (
                      <div key={key} className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-${key}`}>{label}</Label>
                        <Input
                          id={`${id}-${key}`}
                          type="number"
                          inputMode="numeric"
                          className="tabular-nums"
                          min={key === 'width' || key === 'height' ? 2 : 0}
                          max={100}
                          step={1}
                          value={Math.round(active[key] * 100)}
                          onChange={(e) => {
                            const value = Number(e.target.value) / 100;
                            if (geometryAllows(active, key, value)) patchField(active.id, { [key]: value });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <CheckRow checked={active.required} onChange={(required) => patchField(active.id, { required })}>Required</CheckRow>
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start text-destructive hover:text-destructive"
                    onClick={() => {
                      update({ fields: draft.fields.filter((f) => f.id !== active.id) });
                      setSelected('');
                    }}
                  >
                    <Trash2 aria-hidden /> Delete field
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a field to move it, resize it, assign a signer or change its label.
                </p>
              )}
            </aside>
          </div>
        )}
      </Card>

      <Card title="All fields" note="Pick a field here to select it without using the page.">
        {draft.fields.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No fields placed yet. Every signer needs a required signature field.
          </p>
        ) : (
          <ul>
            {draft.fields.map((f, i) => (
              <li key={f.id} className="border-b border-border/60 last:border-0">
                <button
                  type="button"
                  aria-pressed={selected === f.id}
                  onClick={() => setSelected(f.id)}
                  className={cn(
                    'flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selected === f.id && 'bg-secondary',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium"><span className="tabular-nums">{i + 1}.</span> {f.label}</span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">
                      {names[f.participantId] ?? 'No signer'} · Page {f.page} · {f.required ? 'Required' : 'Optional'}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default EditorFieldsStep;
