import React, { useCallback, useEffect, useId, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { StatusPill } from '@/components/common/StatusPill';
import { OwnerField } from '@/components/crmHub/OwnerField';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  createLeadForm, deleteLeadForm, listLeadForms, NEW_LEAD_FORM, updateLeadForm, type LeadForm, type LeadFormInput,
} from '@/services/supabase/crmHub/leadForms';
import { embedCode, formPath } from '../../../api/_leadForm/shared/types';

/**
 * The web forms of a workspace: make one, choose what it asks, and copy its
 * link or the code that shows it on your own website. Whoever fills it in
 * becomes a lead here, with the source and owner chosen for the form.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workspaceId: string;
}

const inputOf = (form: LeadForm): LeadFormInput => ({
  name: form.name, enabled: form.enabled, askPhone: form.askPhone, askCompany: form.askCompany, askMessage: form.askMessage,
  heading: form.heading, intro: form.intro, buttonLabel: form.buttonLabel, thankYou: form.thankYou, source: form.source, ownerId: form.ownerId, shareWith: form.shareWith,
});

const copy = async (text: string, done: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error('Could not copy. Select the text and copy it yourself.');
  }
};

export const LeadFormsDialog: React.FC<Props> = ({ open, onOpenChange, organizationId, workspaceId }) => {
  const fieldId = useId();
  const { user } = useAuth();
  const { organization } = useOrganization();
  /** People a lead can be given to: active members who are not viewers. */
  const team = (organization?.members ?? []).filter((m) => (!m.status || m.status === 'active') && m.role !== 'viewer');
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The form being edited: an existing one, 'new', or null for the list. */
  const [editing, setEditing] = useState<LeadForm | 'new' | null>(null);
  const [draft, setDraft] = useState<LeadFormInput>(NEW_LEAD_FORM);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      setForms(await listLeadForms(workspaceId));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The forms could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    void load();
  }, [open, load]);

  const edit = (form: LeadForm | 'new') => {
    setDraft(form === 'new' ? NEW_LEAD_FORM : inputOf(form));
    setConfirmDelete(false);
    setProblem(null);
    setEditing(form);
  };

  const set = <K extends keyof LeadFormInput>(key: K, value: LeadFormInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setProblem(null);
    try {
      const saved = editing === 'new'
        ? await createLeadForm(organizationId, workspaceId, draft, user?.userId ?? null)
        : await updateLeadForm(editing.id, draft, editing.shareWith.length > 0);
      toast.success(editing === 'new' ? 'Form created. Copy its link below.' : 'Form saved.');
      await load();
      // Stay on the form, so the link and the code are right there after creating it.
      edit(saved);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The form could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing || editing === 'new') return;
    setBusy(true);
    try {
      await deleteLeadForm(editing.id);
      toast.success('Form deleted. Its link no longer works.');
      setEditing(null);
      await load();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The form could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const saved = editing && editing !== 'new' ? editing : null;
  const link = saved ? `${origin}${formPath(saved.id)}` : '';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing === null ? 'Web forms' : editing === 'new' ? 'New web form' : draft.name || 'Web form'}</DialogTitle>
          <DialogDescription>
            {editing === null
              ? 'A form you link to or put on your website. Whoever fills it in becomes a lead here, by itself.'
              : 'Name and email are always asked. Choose what else, and what the visitor reads.'}
          </DialogDescription>
        </DialogHeader>

        {editing === null ? (
          <div className="flex flex-col gap-3">
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading forms…
              </p>
            ) : forms.length === 0 && !problem ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No form yet. Make one, then share its link or put it on your website.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border">
                {forms.map((form) => (
                  <li key={form.id} className="border-b border-border/60 last:border-0">
                    <button
                      type="button"
                      onClick={() => edit(form)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                    >
                      <span className="min-w-0 truncate font-medium text-foreground">{form.name}</span>
                      <StatusPill tone={form.enabled ? 'success' : 'muted'}>{form.enabled ? 'On' : 'Off'}</StatusPill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={() => edit('new')} disabled={loading || Boolean(problem)}><Plus aria-hidden />New form</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {saved && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${fieldId}-link`}>Link to the form</Label>
                  <div className="flex items-center gap-2">
                    <Input id={`${fieldId}-link`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="sm" onClick={() => void copy(link, 'Link copied.')} aria-label="Copy the link"><Copy aria-hidden />Copy</Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={link} target="_blank" rel="noreferrer" aria-label="Open the form in a new tab"><ExternalLink aria-hidden /></a>
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${fieldId}-embed`}>Code for your website</Label>
                  <Textarea id={`${fieldId}-embed`} readOnly rows={3} className="font-mono text-xs" value={embedCode(origin, saved.id)} onFocus={(e) => e.currentTarget.select()} />
                  <div>
                    <Button variant="outline" size="sm" onClick={() => void copy(embedCode(origin, saved.id), 'Code copied.')}><Copy aria-hidden />Copy the code</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Paste it into the page where the form should appear.</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-name`}>Name of the form</Label>
                <Input id={`${fieldId}-name`} maxLength={120} value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={busy} />
              </div>
              <label className="mt-5 flex shrink-0 items-center gap-2 text-sm">
                <Switch checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={busy} aria-label="Form is switched on" />
                {draft.enabled ? 'On' : 'Off'}
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Also ask for</legend>
              {([['askPhone', 'Phone'], ['askCompany', 'Company'], ['askMessage', 'A message']] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={draft[key]} onChange={(e) => set(key, e.target.checked)} disabled={busy} />
                  {label}
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-heading`}>Heading</Label>
              <Input id={`${fieldId}-heading`} maxLength={160} value={draft.heading} onChange={(e) => set('heading', e.target.value)} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-intro`}>Introduction</Label>
              <Textarea id={`${fieldId}-intro`} rows={2} maxLength={600} placeholder="Optional. One or two lines under the heading." value={draft.intro} onChange={(e) => set('intro', e.target.value)} disabled={busy} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-button`}>Button</Label>
                <Input id={`${fieldId}-button`} maxLength={40} value={draft.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-source`}>Source written on the lead</Label>
                <Input id={`${fieldId}-source`} maxLength={80} value={draft.source} onChange={(e) => set('source', e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-thanks`}>What the visitor reads after sending</Label>
              <Input id={`${fieldId}-thanks`} maxLength={400} value={draft.thankYou} onChange={(e) => set('thankYou', e.target.value)} disabled={busy} />
            </div>
            <div>
              <OwnerField id={`${fieldId}-owner`} value={draft.ownerId ?? ''} onChange={(v) => set('ownerId', v || null)} disabled={busy || draft.shareWith.length > 0} />
              <p className="mt-1 text-xs text-muted-foreground">
                {draft.shareWith.length > 0
                  ? 'Not used while the leads are shared between the people ticked below.'
                  : 'Who gets the leads from this form. With nobody chosen, the owner and admins are told about each one.'}
              </p>
            </div>
            {team.length > 1 && (
              <fieldset className="flex flex-col gap-1.5" disabled={busy}>
                <legend className="text-sm font-medium text-foreground">Or share the leads between</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {team.map((member) => (
                    <label key={member.userId} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={draft.shareWith.includes(member.userId)}
                        onChange={(e) => set('shareWith', e.target.checked ? [...draft.shareWith, member.userId] : draft.shareWith.filter((id) => id !== member.userId))}
                      />
                      {member.displayName || member.email}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {draft.shareWith.length > 1
                    ? 'Each new lead goes to the next of these people, in turn.'
                    : draft.shareWith.length === 1
                      ? 'Tick one more person to share the leads in turn.'
                      : 'Tick two or more people and each new lead goes to the next of them, in turn.'}
                </p>
              </fieldset>
            )}

            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}

            <DialogFooter className="sm:justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}><ArrowLeft aria-hidden />All forms</Button>
                {saved && (confirmDelete ? (
                  <Button variant="destructive" onClick={() => void remove()} disabled={busy}>Yes, delete it</Button>
                ) : (
                  <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy} aria-label="Delete this form">
                    <Trash2 aria-hidden />
                  </Button>
                ))}
              </div>
              <Button onClick={() => void save()} disabled={busy || !draft.name.trim()}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}{editing === 'new' ? 'Create form' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
