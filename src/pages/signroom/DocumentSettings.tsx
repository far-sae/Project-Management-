// How invoices, receipts and agreements look, the letterhead, who the emails come from, and how long records are kept.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LetterheadDesign, TemplateFile, Workspace } from '../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence } from '@/lib/signroom/billing';
import {
  brandOf, brandingBody, brandingFormOf, letterheadProblem, logoProblem, withBrandColour, withDesign, withLogo,
  type BrandingForm,
} from '@/lib/signroom/branding';
import { readAsDataUrl, trimLogo } from '@/lib/signroom/brandingLogo';
import { applyDesign } from '@/lib/signroom/letterhead';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { Card, EmptyState, PickWorkspace } from '@/components/signroom/billing/shared';
import { UnsavedGuard } from '@/components/signroom/billing/UnsavedGuard';
import { ColourField } from '@/components/signroom/branding/ColourField';
import { LetterheadDesigner } from '@/components/signroom/branding/LetterheadDesigner';
import { LetterheadUploadCard } from '@/components/signroom/branding/LetterheadUploadCard';
import { LookCard } from '@/components/signroom/branding/LookCard';
import { PreviewCard } from '@/components/signroom/branding/PreviewCard';
import { RetentionCard } from '@/components/signroom/branding/RetentionCard';
import { SenderCard } from '@/components/signroom/branding/SenderCard';
import { EmailConnectionPanel } from '@/components/signroom/email/EmailConnectionPanel';
import { useDesignHistory } from '@/components/signroom/branding/useDesignHistory';
import { useLetterheadImage } from '@/components/signroom/branding/useLetterheadImage';

/** What the documents server says about the workspace in use and the person's role in it. */
interface SessionView { workspace: Workspace; role: 'Owner' | 'Member' }

/** The sections of the page. The first two change the document look and share one save. */
type Section = 'look' | 'letterhead' | 'emails' | 'records';
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'look', label: 'Company & look' },
  { id: 'letterhead', label: 'Letterhead' },
  { id: 'emails', label: 'Emails' },
  { id: 'records', label: 'Records' },
];

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
  const [section, setSection] = useState<Section>('look');
  const [form, setForm] = useState<BrandingForm>(() => brandingFormOf(workspace));
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(brandingFormOf(workspace)));
  const [busy, setBusy] = useState<null | 'look' | 'upload'>(null);
  /** The server's refusal, kept on the page as well as in a toast. */
  const [refused, setRefused] = useState('');
  /** Set once the letterhead section has been opened: the stored PDF is not fetched before then. */
  const [letterheadSeen, setLetterheadSeen] = useState(false);

  const dirty = JSON.stringify(form) !== savedForm;
  const locked = readOnly || busy !== null;
  const lookSection = section === 'look' || section === 'letterhead';
  const template = form.backgroundTemplate;
  /** Their own PDF, printed as it is: none of the designer's items are drawn over it. */
  const artworkOnly = !!template && !form.templateOverlay;

  const set = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) => {
    setForm((old) => ({ ...old, [key]: value }));
  };
  const history = useDesignHistory(form.design, (design: LetterheadDesign) => set('design', design));
  // Only an owner may read the stored PDF, so a member is shown the page without it.
  const picture = useLetterheadImage(client, template?.hash ?? null, letterheadSeen && !readOnly);

  /** Says why something was refused, on the page and in a toast. Called with nothing, it clears the page. */
  const refuse = (err?: unknown, fallback?: string) => {
    const sentence = err === undefined ? '' : typeof err === 'string' ? err : errorSentence(err, fallback);
    setRefused(sentence);
    if (sentence) toast.error(sentence);
  };

  const open = (next: string) => {
    setSection(next as Section);
    if (next === 'letterhead') setLetterheadSeen(true);
  };

  const chooseLogo = async (file: File | undefined | 'remove') => {
    if (file === 'remove') { setForm((old) => withLogo(old, '')); return; }
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) { refuse(problem); return; }
    refuse();
    try {
      // Without the empty margin around it, so it fills its place and lines up with the name.
      const logo = await trimLogo(await readAsDataUrl(file));
      setForm((old) => withLogo(old, logo));
    } catch (err) {
      refuse(err, 'The logo could not be read.');
    }
  };

  const chooseDesign = (name: string) => {
    setForm((old) => ({ ...old, layout: withDesign(old, name).layout }));
    history.commit(applyDesign(name, brandOf(form), form.design));
  };

  const uploadLetterhead = async (file: File | undefined) => {
    if (!file) return;
    const problem = letterheadProblem(file);
    if (problem) { refuse(problem); return; }
    setBusy('upload');
    refuse();
    try {
      const stored = await client.upload<TemplateFile>('workspaces/branding-template', file);
      // A plain header to start from: their own page already carries the artwork.
      history.commit(applyDesign('minimal', brandOf(form), form.design));
      setForm((old) => ({ ...old, backgroundTemplate: stored, templateOverlay: false }));
      toast.success('Letterhead PDF checked and uploaded. Save the document look to start using it.');
    } catch (err) {
      refuse(err, 'Could not upload the letterhead PDF');
    } finally {
      setBusy(null);
    }
  };

  const saveLook = async () => {
    if (!form.companyName.trim()) { refuse('Enter the company name for your documents.'); return; }
    setBusy('look');
    refuse();
    try {
      const saved = await client.call<Workspace>('workspaces/branding', brandingBody(form, workspace.branding));
      const next = brandingFormOf(saved);
      setForm(next);
      setSavedForm(JSON.stringify(next));
      onSaved(saved);
      toast.success('Document look saved. Documents already issued keep the look they had.');
    } catch (err) {
      refuse(err, 'Could not save the document look');
    } finally {
      setBusy(null);
    }
  };

  const unsavedMark = dirty && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="has unsaved changes" role="img" />;
  const panelProps = (value: Section) => ({
    value,
    forceMount: true as const,
    // Every section stays on the page so nothing typed is lost; only the open one is shown.
    hidden: section !== value,
    className: 'mt-0 flex min-w-0 flex-col gap-4 data-[state=inactive]:hidden',
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <UnsavedGuard when={dirty} what="Your changes to how documents look" />
      {readOnly && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Only a workspace owner or admin can change these settings.
        </p>
      )}
      {refused && <p role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">{refused}</p>}

      <Tabs value={section} onValueChange={open} className="flex min-w-0 flex-col gap-4">
        <TabsList aria-label="Document settings sections" className="flex h-auto w-full flex-wrap justify-start">
          {SECTIONS.map((each) => (
            <TabsTrigger key={each.id} value={each.id} className="h-10">
              {each.label}
              {(each.id === 'look' || each.id === 'letterhead') && unsavedMark}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className={cn('grid min-w-0 grid-cols-1 items-start gap-4', section === 'look' && 'xl:grid-cols-2')}>
          <div className="min-w-0">
            <TabsContent {...panelProps('look')}>
              <LookCard form={form} set={set} onLogo={(file) => void chooseLogo(file)} locked={locked} />
            </TabsContent>

            <TabsContent {...panelProps('letterhead')}>
              <LetterheadUploadCard
                template={template}
                saved={!!template && template.hash === workspace.branding?.backgroundTemplate?.hash}
                overlay={form.templateOverlay}
                onOverlay={(overlay) => set('templateOverlay', overlay)}
                onFile={(file) => void uploadLetterhead(file)}
                onRemove={() => set('backgroundTemplate', null)}
                uploading={busy === 'upload'}
                locked={locked}
                pictureFailed={picture.failed}
              />
              <Card title="Letterhead designer">
                <div className="flex flex-col gap-4 p-4">
                  {/* Their own PDF, printed as it is, keeps its own colours. */}
                  {!artworkOnly && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-3xl">
                      <ColourField
                        id={`${id}-color`} label="Brand colour" value={form.color} disabled={locked}
                        onValue={(hex) => setForm((old) => withBrandColour(old, hex))}
                        hint="The colour strip, the dividing line and the ready-made designs use it."
                      />
                      <ColourField
                        id={`${id}-second-color`} label="Second colour" value={form.secondaryColor} disabled={locked}
                        onValue={(hex) => set('secondaryColor', hex)}
                        hint="The ready-made designs use it for their bands and corners."
                      />
                    </div>
                  )}
                  <LetterheadDesigner
                    brand={brandOf(form)}
                    design={form.design}
                    history={history}
                    disabled={locked}
                    backgroundUrl={template ? picture.url : null}
                    artworkOnly={artworkOnly}
                    onText={(key, value) => set(key, value)}
                    onChooseDesign={chooseDesign}
                    onChooseLogo={(file) => void chooseLogo(file)}
                  />
                </div>
              </Card>
            </TabsContent>

            <TabsContent {...panelProps('emails')}>
              <div className="flex max-w-3xl flex-col gap-4">
                <SenderCard workspace={workspace} readOnly={readOnly} onSaved={onSaved} onRefused={refuse} />
                {/* Sending from the workspace's own mailbox instead of from TaskCalendar. */}
                <EmailConnectionPanel readOnly={readOnly} />
              </div>
            </TabsContent>

            <TabsContent {...panelProps('records')}>
              <div className="flex max-w-3xl flex-col gap-4">
                <RetentionCard workspace={workspace} readOnly={readOnly} onSaved={onSaved} onRefused={refuse} />
              </div>
            </TabsContent>
          </div>

          {lookSection && (
            <PreviewCard
              workspaceId={workspaceId}
              body={() => brandingBody(form, workspace.branding)}
              className={section === 'look' ? 'xl:sticky xl:top-0' : undefined}
            />
          )}
        </div>
      </Tabs>

      {lookSection && (
        <div className="sticky bottom-0 -mb-6 flex flex-col gap-1 border-t border-border bg-background py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={locked || !dirty} onClick={() => void saveLook()}>
              {busy === 'look' && <Loader2 className="animate-spin" aria-hidden />}
              Save document look
            </Button>
            <span role="status" className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            One save covers the company details, the look and the letterhead. It applies to new documents: invoices and receipts already
            issued, and agreements already sent, keep the look they had.
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentSettingsPage;
