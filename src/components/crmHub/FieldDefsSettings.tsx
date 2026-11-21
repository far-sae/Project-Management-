import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/common/StatusPill';
import {
  FIELD_KINDS, FIELD_KIND_LABEL, FIELD_NAME_MAX, defProblem, readOptions, type FieldDef, type FieldKind,
} from '@/lib/crmFieldTypes';
import { createFieldDef, deleteFieldDef, listFieldDefs } from '@/services/supabase/crmHub/fieldDefs';

/**
 * The typed custom fields of the workspace on screen: what each one is called
 * and what kind of thing it holds. A lead form shows a number box, a date box
 * or a list for these, and checks what is typed.
 */
export const FieldDefsSettings: React.FC = () => {
  const { organization } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const organizationId = organization?.organizationId ?? '';
  const workspaceId = selected?.workspaceId ?? '';
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  const [optionsText, setOptionsText] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      setDefs(await listFieldDefs(workspaceId));
    } catch (err) {
      setProblem(publicMessage(err, 'The custom fields could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const options = readOptions(optionsText);
    const wrong = defProblem(defs, name, kind, options);
    setProblem(wrong ?? '');
    if (wrong || !organizationId || !workspaceId) return;
    setBusy(true);
    try {
      const made = await createFieldDef(organizationId, workspaceId, { name, kind, options });
      setDefs((list) => [...list, made]);
      setName('');
      setOptionsText('');
      setKind('text');
      toast.success(`Field “${made.name}” added`);
    } catch (err) {
      setProblem(publicMessage(err, 'The field could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (def: FieldDef) => {
    setBusy(true);
    setProblem('');
    try {
      await deleteFieldDef(def.id);
      setDefs((list) => list.filter((d) => d.id !== def.id));
      toast.success(`“${def.name}” is plain text again. What is written on leads stays.`);
    } catch (err) {
      setProblem(publicMessage(err, 'The field could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-h-11 flex-col justify-center border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Custom fields</h2>
        <p className="mt-1 text-pretty text-xs text-muted-foreground">
          Say what kind of thing a custom field on a lead holds. The lead form then shows a number box, a date box or a
          list for it. A field you do not list here stays plain text.
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : defs.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No typed fields yet. Every custom field is plain text.</p>
      ) : (
        <ul className="divide-y divide-border">
          {defs.map((def) => (
            <li key={def.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate">{def.name}</span>
                  <StatusPill tone="neutral">{FIELD_KIND_LABEL[def.kind]}</StatusPill>
                </p>
                {def.kind === 'choice' && <p className="truncate text-xs text-muted-foreground">{def.options.join(', ')}</p>}
              </div>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void remove(def)} disabled={busy} aria-label={`Remove the field ${def.name}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-col gap-3 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="space-y-1.5">
            <Label htmlFor="field-def-name">Field name</Label>
            <Input id="field-def-name" value={name} maxLength={FIELD_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="For example: Budget" disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="field-def-kind">What it holds</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as FieldKind)} disabled={busy}>
              <SelectTrigger id="field-def-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_KINDS.map((k) => <SelectItem key={k} value={k}>{FIELD_KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {kind === 'choice' && (
          <div className="space-y-1.5">
            <Label htmlFor="field-def-options">The choices</Label>
            <Input id="field-def-options" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Basic, Pro, Enterprise" disabled={busy} />
            <p className="text-xs text-muted-foreground">With a comma between them.</p>
          </div>
        )}
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        <div>
          <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Add field
          </Button>
        </div>
      </form>
    </section>
  );
};
