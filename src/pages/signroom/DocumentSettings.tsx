// How invoices, receipts and agreements look, who the emails come from, and how long records are kept.
import React, { useEffect, useId, useState } from 'react';
import { Eye, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence } from '@/lib/signroom/billing';
import {
  DOCUMENT_FONTS, DOCUMENT_LAYOUTS, FONT_SIZES, brandingBody, brandingFormOf, logoProblem, retentionBody, senderBody,
  type BrandingForm, type DocumentFont, type DocumentLayout, type PreviewKind,
} from '@/lib/signroom/branding';
import { readAsDataUrl, trimLogo } from '@/lib/signroom/brandingLogo';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { brandingPreviewPdf } from '@/components/signroom/billing/brandingPreviewRequest';
import { PdfFrame } from '@/components/signroom/billing/PdfFrame';
import { Card, EmptyState, FIELD, PickWorkspace } from '@/components/signroom/billing/shared';
import { UnsavedGuard } from '@/components/signroom/billing/UnsavedGuard';

/** What the documents server says about the workspace in use and the person's role in it. */
interface SessionView { workspace: Workspace; role: 'Owner' | 'Member' }

const GROUP_TITLE = 'text-xs font-medium text-muted-foreground';
const PAIR = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

export const DocumentSettingsPage: React.FC = () => {
  const { client, workspaceId } = useSignroom();
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setSession(null);
    setError('');
    if (!workspaceId) return;
    client.call<SessionView>('session')
      .then((view) => { if (alive) setSession(view); })
      .catch((err) => { if (alive) setError(errorSentence(err)); });
    return () => { alive = false; };
  }, [client, workspaceId]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Document settings"
          description="How your invoices, receipts and agreements look, and who the emails that carry them come from."
        />
        {!workspaceId ? (
          <PickWorkspace what="its document settings" />
        ) : error ? (
          <EmptyState><span role="alert">{error}</span></EmptyState>
        ) : !session ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading document settings" />
          </div>
        ) : (
          <Settings
            key={session.workspace.id}
            workspaceId={workspaceId}
            workspace={session.workspace}
            readOnly={session.role !== 'Owner'}
            onSaved={(workspace) => setSession((old) => (old ? { ...old, workspace } : old))}
          />
        )}
      </div>
    </main>
  );
};

const Settings: React.FC<{
  workspaceId: string;
  workspace: Workspace;
  readOnly: boolean;
  onSaved: (workspace: Workspace) => void;
}> = ({ workspaceId, workspace, readOnly, onSaved }) => {
  const id = useId();
  const { client } = useSignroom();
  const [form, setForm] = useState<BrandingForm>(() => brandingFormOf(workspace));
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(brandingFormOf(workspace)));
  const [senderName, setSenderName] = useState(workspace.senderName || workspace.name);
  const [replyTo, setReplyTo] = useState(workspace.replyTo);
  const [days, setDays] = useState(String(workspace.retentionDays));
  const [busy, setBusy] = useState<null | 'look' | 'sender' | 'retention'>(null);
  const [previewKind, setPreviewKind] = useState<PreviewKind>('invoice');
  /** Counts previews asked for: zero means none is shown, and each new one is fetched afresh. */
  const [previewRun, setPreviewRun] = useState(0);
  /** The server's refusal, kept on the page as well as in a toast. */
  const [refused, setRefused] = useState('');

  const dirty = JSON.stringify(form) !== savedForm;
  const locked = readOnly || busy !== null;
  const set = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) => {
    setForm((old) => ({ ...old, [key]: value }));
  };
  const fail = (err: unknown, fallback: string) => {
    const sentence = errorSentence(err, fallback);
    setRefused(sentence);
    toast.error(sentence);
  };

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) { toast.error(problem); return; }
    try {
      // Without the empty margin around it, so it fills its place and lines up with the name.
      set('logo', await trimLogo(await readAsDataUrl(file)));
    } catch (err) {
      toast.error(errorSentence(err, 'The logo could not be read.'));
    }
  };

  const saveLook = async () => {
    setBusy('look');
    setRefused('');
    try {
      const saved = await client.call<Workspace>('workspaces/branding', brandingBody(form, workspace.branding));
      const next = brandingFormOf(saved);
      setForm(next);
      setSavedForm(JSON.stringify(next));
      onSaved(saved);
      toast.success('Document look saved. Documents already issued keep the look they had.');
    } catch (err) {
      fail(err, 'Could not save the document look');
    } finally {
      setBusy(null);
    }
  };

  const saveSender = async () => {
    setBusy('sender');
    setRefused('');
    try {
      const saved = await client.call<{ senderName: string; senderEmail: string; replyTo: string }>(
        'workspaces/email-settings', senderBody({ senderName, replyTo }, workspace),
      );
      onSaved({ ...workspace, senderName: saved.senderName, senderEmail: saved.senderEmail, replyTo: saved.replyTo });
      toast.success('Sender details saved. They apply to emails sent from now on.');
    } catch (err) {
      fail(err, 'Could not save the sender details');
    } finally {
      setBusy(null);
    }
  };

  const saveRetention = async () => {
    setBusy('retention');
    setRefused('');
    try {
      onSaved(await client.call<Workspace>('workspaces/settings', retentionBody(workspace, Number(days))));
      toast.success('Retention period saved.');
    } catch (err) {
      fail(err, 'Could not save the retention period');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <UnsavedGuard when={dirty} what="Your changes to how documents look" />
      <div className="flex min-w-0 flex-col gap-4">
        {readOnly && (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Only a workspace owner or admin can change these settings.
          </p>
        )}
        {refused && <p role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">{refused}</p>}

        <Card title="How documents look">
          <form className="flex flex-col gap-6 p-4" onSubmit={(event) => { event.preventDefault(); void saveLook(); }}>
            <section className="flex flex-col gap-3" aria-labelledby={`${id}-g-company`}>
              <h3 id={`${id}-g-company`} className={GROUP_TITLE}>Your company</h3>
              <div className={FIELD}>
                <Label htmlFor={`${id}-company-name`}>Company name on documents</Label>
                <Input id={`${id}-company-name`} required maxLength={1000} disabled={locked} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-address`}>Company address</Label>
                <Textarea id={`${id}-address`} rows={3} maxLength={1000} disabled={locked} value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className={PAIR}>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-company-number`}>Company registration number</Label>
                  <Input id={`${id}-company-number`} maxLength={1000} disabled={locked} value={form.companyNumber} onChange={(e) => set('companyNumber', e.target.value)} />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-tax-number`}>Tax or VAT number</Label>
                  <Input id={`${id}-tax-number`} maxLength={1000} disabled={locked} value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3" aria-labelledby={`${id}-g-logo`}>
              <h3 id={`${id}-g-logo`} className={GROUP_TITLE}>Logo</h3>
              <div className={FIELD}>
                <Label htmlFor={`${id}-logo`}>Company logo (PNG or JPEG, up to 300 KB)</Label>
                <Input
                  id={`${id}-logo`} type="file" accept="image/png,image/jpeg" disabled={locked}
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void chooseLogo(file); }}
                />
                <p className="text-xs text-muted-foreground">Without a logo, your company name is written in its place.</p>
              </div>
              {form.logo && (
                <div className="flex flex-wrap items-center gap-3">
                  <img src={form.logo} alt="Company logo" className="max-h-20 max-w-44 rounded-md border border-border bg-background object-contain p-2" />
                  <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => set('logo', '')}>
                    <Trash2 aria-hidden /> Remove logo
                  </Button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3" aria-labelledby={`${id}-g-style`}>
              <h3 id={`${id}-g-style`} className={GROUP_TITLE}>Style</h3>
              <div className={PAIR}>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-layout`}>Layout</Label>
                  <Select value={form.layout} onValueChange={(v) => set('layout', v as DocumentLayout)} disabled={locked}>
                    <SelectTrigger id={`${id}-layout`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_LAYOUTS.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{DOCUMENT_LAYOUTS.find((l) => l.id === form.layout)?.hint}</p>
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-color`}>Brand colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${id}-color`} type="color" disabled={locked}
                      className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:h-8"
                      value={form.color} onChange={(e) => set('color', e.target.value)}
                    />
                    <span className="text-sm tabular-nums text-muted-foreground">{form.color}</span>
                  </div>
                </div>
              </div>
              <div className={PAIR}>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-font`}>Font</Label>
                  <Select value={form.fontFamily} onValueChange={(v) => set('fontFamily', v as DocumentFont)} disabled={locked}>
                    <SelectTrigger id={`${id}-font`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_FONTS.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-font-size`}>Text size</Label>
                  <Select value={String(form.fontSize)} onValueChange={(v) => set('fontSize', Number(v))} disabled={locked}>
                    <SelectTrigger id={`${id}-font-size`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FONT_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} pt</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {workspace.branding?.design && (
                <p className="text-xs text-muted-foreground">
                  This workspace has a custom letterhead made earlier. It stays as it is unless you pick a different layout, which replaces it.
                </p>
              )}
            </section>

            <section className="flex flex-col gap-3" aria-labelledby={`${id}-g-text`}>
              <h3 id={`${id}-g-text`} className={GROUP_TITLE}>Text on every document</h3>
              <div className={FIELD}>
                <Label htmlFor={`${id}-footer`}>Footer</Label>
                <Input id={`${id}-footer`} maxLength={1000} disabled={locked} placeholder="Your website or a short line" value={form.footer} onChange={(e) => set('footer', e.target.value)} />
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-payment`}>How to pay (shown on invoices)</Label>
                <Textarea
                  id={`${id}-payment`} rows={4} maxLength={3000} disabled={locked}
                  placeholder="Bank details, the reference to quote, or who to contact"
                  value={form.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)}
                />
              </div>
            </section>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={locked || !dirty}>
                  {busy === 'look' && <Loader2 className="animate-spin" aria-hidden />}
                  Save document look
                </Button>
                <span role="status" className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Changes apply to new documents. Invoices and receipts already issued, and agreements already sent, keep the look they had.
              </p>
            </div>
          </form>
        </Card>

        <Card title="Emails">
          <form className="flex flex-col gap-3 p-4" onSubmit={(event) => { event.preventDefault(); void saveSender(); }}>
            <p className="text-sm text-muted-foreground">The name customers see on invoice and receipt emails, and where their replies go.</p>
            <div className={PAIR}>
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
                {busy === 'sender' && <Loader2 className="animate-spin" aria-hidden />}
                Save sender details
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Keeping records">
          <form className="flex flex-col gap-3 p-4" onSubmit={(event) => { event.preventDefault(); void saveRetention(); }}>
            <div className={FIELD}>
              <Label htmlFor={`${id}-retention`}>Days to keep a completed agreement</Label>
              <Input
                id={`${id}-retention`} type="number" required min={1} max={3650} disabled={locked}
                className="w-32 tabular-nums" value={days} onChange={(e) => setDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                From 1 to 3650 days. An agreement is only deleted after this period, and never while it is on legal hold.
              </p>
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={locked}>
                {busy === 'retention' && <Loader2 className="animate-spin" aria-hidden />}
                Save retention period
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Preview" className="xl:sticky xl:top-0">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            A sample document in the look on this page, including changes you have not saved yet.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className={FIELD}>
              <Label htmlFor={`${id}-preview-kind`}>Document to preview</Label>
              <Select value={previewKind} onValueChange={(v) => { setPreviewKind(v as PreviewKind); setPreviewRun(0); }}>
                <SelectTrigger id={`${id}-preview-kind`} className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="receipt">Receipt</SelectItem>
                  <SelectItem value="agreement">Agreement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={() => setPreviewRun((n) => n + 1)}>
              <Eye aria-hidden /> {previewRun ? 'Refresh preview' : 'Preview PDF'}
            </Button>
          </div>
          {previewRun > 0 && (
            <PdfFrame
              load={() => brandingPreviewPdf(workspaceId, { ...brandingBody(form, workspace.branding), previewKind })}
              sourceKey={`${previewKind}-${previewRun}`}
              title={`Sample ${previewKind}`}
              filename={`sample-${previewKind}.pdf`}
            />
          )}
        </div>
      </Card>
    </div>
  );
};

export default DocumentSettingsPage;
