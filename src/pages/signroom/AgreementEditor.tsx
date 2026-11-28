import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Copy, Loader2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useSignroom } from '@/hooks/useSignroom';
import type { SignroomClient } from '@/services/signroom/client';
import { sendBlockers } from '@/lib/signroom/agreementFields';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AiDraftDialog } from '@/components/signroom/agreements/AiDraftDialog';
import { EditorDocumentStep } from '@/components/signroom/agreements/EditorDocumentStep';
import { EditorRecipientsStep, newId } from '@/components/signroom/agreements/EditorRecipientsStep';
import { EditorFieldsStep } from '@/components/signroom/agreements/EditorFieldsStep';
import { EditorReviewStep } from '@/components/signroom/agreements/EditorReviewStep';
import { TextPromptDialog } from '@/components/signroom/agreements/TextPromptDialog';
import { SAVE_STATE_LABEL, useAgreementDraft } from '@/components/signroom/agreements/useAgreementDraft';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { downloadAgreementPdf, messageOf, uploadAgreementPdf } from '@/components/signroom/agreements/files';
import type { Agreement, Client } from '../../../api/_signroom/shared/types';

const STEPS = [
  { key: 'document', label: 'Document' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'fields', label: 'Fields' },
  { key: 'review', label: 'Review and send' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

/** The four-step editor for a draft agreement: document, recipients, fields, then review and send. */
export const AgreementEditorPage: React.FC = () => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { client, workspaceId } = useSignroom();
  const [initial, setInitial] = useState<Agreement | null>(null);
  const [forClient, setForClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId || !id) { setInitial(null); setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const agreement = await client.call<Agreement>(`agreements/${id}`);
      setInitial(agreement);
      client.call<Client[]>('clients')
        .then((list) => setForClient(list.find((c) => c.id === agreement.clientId) ?? null))
        .catch(() => setForClient(null));
    } catch (e) {
      setInitial(null);
      setLoadError(messageOf(e, 'Could not load this agreement.'));
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId, id]);

  useEffect(() => { void load(); }, [load]);

  const me = useMemo(() => {
    const email = user?.email ?? '';
    return { name: user?.displayName?.trim() || email.split('@')[0] || '', email };
  }, [user?.email, user?.displayName]);

  if (!workspaceId) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Pick a workspace in the sidebar to edit this agreement.</p>
    </main>
  );

  if (loading && !initial) return (
    <main className="flex flex-1 items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading agreement" />
    </main>
  );

  if (!initial) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
      <p role="alert" className="text-sm font-medium">{loadError || 'Agreement not found.'}</p>
      <Button asChild variant="outline">
        <Link to="/crm/agreements"><ChevronLeft aria-hidden />Back to agreements</Link>
      </Button>
    </main>
  );

  // Only a draft outside Trash can be edited: anything else is frozen and has its own page.
  if (initial.status !== 'Draft' || initial.trashedAt) return <Navigate to={`/crm/agreements/${initial.id}`} replace />;

  return <DraftEditor key={initial.id} initial={initial} forClient={forClient} client={client} me={me} />;
};

const DraftEditor: React.FC<{
  initial: Agreement;
  forClient: Client | null;
  client: SignroomClient;
  me: { name: string; email: string };
}> = ({ initial, forClient, client, me }) => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { draft, saveState, update, save: saveDraft, adopt, latest, clearApproved } = useAgreementDraft(initial, client);
  const { ask, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [special, setSpecial] = useState(false);
  const [writeInstead, setWriteInstead] = useState(false);
  const [sendError, setSendError] = useState('');
  const [namingTemplate, setNamingTemplate] = useState(false);
  const [draftingWithAi, setDraftingWithAi] = useState(false);
  const [aiWritten, setAiWritten] = useState(false);
  const sendKey = useRef(newId());
  const top = useRef<HTMLElement>(null);

  // The step is part of the address, so a reload or a shared link lands on the same step.
  const step = Math.max(0, STEPS.findIndex((s) => s.key === params.get('step')));
  const goTo = (index: number) => {
    const next = new URLSearchParams(params);
    if (index === 0) next.delete('step');
    else next.set('step', STEPS[index].key);
    setParams(next, { replace: true });
    top.current?.scrollTo?.({ top: 0 });
  };
  const goToKey = (key: StepKey) => goTo(STEPS.findIndex((s) => s.key === key));

  /**
   * A save the person asked for (Save draft, a step, preparing the PDF, sending). The reminder that the text was
   * written by AI stays through the editor's own background saves and goes once the person has saved themselves.
   */
  const save = async (): Promise<Agreement | null> => {
    const saved = await saveDraft();
    if (saved) setAiWritten(false);
    return saved;
  };

  const blockers = sendBlockers(draft, me);

  /** A change to the text clears the placed fields and the prepared PDF, so it asks first when there are fields. */
  const applyText = (content: string) => update({ content, documentHash: undefined, pages: [], fields: [] });
  const editText = (content: string) => {
    if (latest().fields.length && !clearApproved.current) {
      void ask({
        title: 'Change the document?',
        description: 'Changing the document clears all placed fields and requires a new PDF review. Continue?',
        confirmLabel: 'Change document',
        cancelLabel: 'Keep fields',
        destructive: true,
      }).then((yes) => {
        if (!yes) return;
        clearApproved.current = true;
        applyText(content);
      });
      return;
    }
    applyText(content);
  };

  /** Puts an AI draft the person chose to use into the document. The dialog has already asked before replacing anything. */
  const applyAiDraft = (content: string) => {
    clearApproved.current = true;
    applyText(content);
    setAiWritten(true);
  };

  const prepare = async () => {
    if (!latest().content.trim()) {
      toast.error('Write the agreement first.');
      return;
    }
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      adopt(await client.call<Agreement>(`agreements/${saved.id}/prepare`, {
        revision: saved.revision,
        clearFields: clearApproved.current,
      }));
      setWriteInstead(false);
      toast.success('The exact signing PDF is ready to review.');
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    let clear = false;
    if (latest().fields.length) {
      clear = await ask({
        title: 'Replace the document?',
        description: 'Replace the document and remove every field placement?',
        confirmLabel: 'Replace document',
        cancelLabel: 'Keep document',
        destructive: true,
      });
      if (!clear) return;
    }
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      adopt(await uploadAgreementPdf(client, saved.id, file, saved.revision, clear));
      setWriteInstead(false);
      toast.success('PDF validated and prepared. Review every page before placing fields.');
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const switchToWriting = async () => {
    if (latest().fields.length) {
      const yes = await ask({
        title: 'Write the document instead?',
        description: 'Switch to authored text and clear all field placements?',
        confirmLabel: 'Write instead',
        cancelLabel: 'Keep uploaded PDF',
        destructive: true,
      });
      if (!yes) return;
    }
    clearApproved.current = true;
    setWriteInstead(true);
    update({ sourceKind: 'authored', documentHash: undefined, pages: [], fields: [] });
  };

  const downloadSource = async () => {
    try {
      await downloadAgreementPdf(client, draft.id, 'source');
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const next = async () => {
    const saved = await save();
    if (!saved) return;
    if (step === 0 && !saved.documentHash) {
      toast.error('Prepare the PDF or upload a document before continuing.');
      return;
    }
    if (step === 1 && !saved.participants.some((p) => p.role === 'signer' && p.name && p.email)) {
      toast.error('Add at least one named signer with an email address.');
      return;
    }
    goTo(Math.min(STEPS.length - 1, step + 1));
  };

  const leave = async () => {
    if (await save()) navigate('/crm/agreements');
  };

  const send = async () => {
    setSendError('');
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const sent = await client.call<Agreement>(`agreements/${saved.id}/send`, {
        revision: saved.revision,
        eligible,
        specialRequirements: special,
        idempotencyKey: sendKey.current,
      });
      adopt(sent);
      const message = sent.status !== 'Awaiting signatures'
        ? 'This agreement was cancelled while it was being sent.'
        : saved.senderFirst
          ? 'Agreement prepared for your first signature.'
          : 'Agreement sent. Invitations are on their way.';
      if (sent.status === 'Awaiting signatures') toast.success(message);
      else toast.message(message);
      navigate(`/crm/agreements/${sent.id}`);
    } catch (e) {
      const message = messageOf(e);
      setSendError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async (name: string) => {
    setBusy(true);
    try {
      await client.call(`agreements/${draft.id}/template`, { name });
      setNamingTemplate(false);
      toast.success('Template saved with recipient roles and field positions.');
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const saveProblem = saveState === 'failed' || saveState === 'offline';

  return (
    <main ref={top} className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="flex flex-col gap-3">
          <Button variant="ghost" size="sm" className="-ml-2.5 self-start text-muted-foreground" onClick={() => void leave()}>
            <ChevronLeft aria-hidden />Agreements
          </Button>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-72">
              <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">{draft.title || 'Untitled agreement'}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {forClient && (forClient.crmCompanyId
                  ? <Link to={`/crm/companies/${forClient.crmCompanyId}`} className="text-foreground hover:underline">{forClient.name}</Link>
                  : <span>{forClient.name}</span>)}
                {draft.dealId && <Link to={`/crm/deals/${draft.dealId}`} className="hover:text-foreground hover:underline">· View deal</Link>}
                <span>{forClient ? '· ' : ''}{draft.type} · Draft</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span
                role="status"
                aria-live="polite"
                className={cn('inline-flex items-center gap-1.5 text-xs', saveProblem ? 'text-destructive' : 'text-muted-foreground')}
              >
                {saveState === 'saved' && <Check className="h-3.5 w-3.5" aria-hidden />}
                {SAVE_STATE_LABEL[saveState]}
              </span>
              <Button variant="outline" disabled={busy} onClick={() => void save()}>
                <Save aria-hidden /> Save draft
              </Button>
            </div>
          </div>
        </div>

        <nav aria-label="Steps">
          <ol className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s.key} className="min-w-0 flex-1 basis-36">
                <button
                  type="button"
                  aria-current={step === i ? 'step' : undefined}
                  onClick={async () => { if (await save()) goTo(i); }}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9',
                    step === i
                      ? 'border-foreground bg-secondary font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold tabular-nums',
                      step > i ? 'bg-success text-success-foreground' : step === i ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {step > i ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {step === 0 ? (
          <EditorDocumentStep
            draft={draft}
            workspaceId={draft.workspaceId}
            busy={busy}
            uploaded={draft.sourceKind === 'upload' && !writeInstead}
            onTitle={(title) => update({ title })}
            onText={editText}
            onUpload={(file) => void upload(file)}
            onWriteInstead={() => void switchToWriting()}
            onPrepare={() => void prepare()}
            onDownloadSource={() => void downloadSource()}
            onDraftWithAi={() => setDraftingWithAi(true)}
            aiWritten={aiWritten}
          />
        ) : step === 1 ? (
          <EditorRecipientsStep draft={draft} me={me} update={update} />
        ) : step === 2 ? (
          <EditorFieldsStep draft={draft} update={update} onGoTo={goToKey} />
        ) : (
          <EditorReviewStep
            draft={draft}
            update={update}
            eligible={eligible}
            onEligible={setEligible}
            special={special}
            onSpecial={setSpecial}
            blockers={blockers}
            sendError={sendError}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => (step ? goTo(step - 1) : void leave())}>
            <ArrowLeft aria-hidden /> {step ? 'Back' : 'Close draft'}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {step === STEPS.length - 1 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => { if (await save()) setNamingTemplate(true); }}
              >
                <Copy aria-hidden /> Save as template
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button disabled={busy} onClick={() => void next()}>
                Save and continue <ArrowRight aria-hidden />
              </Button>
            ) : (
              <Button disabled={busy || !eligible || special || blockers.length > 0} onClick={() => void send()}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                {busy ? 'Preparing…' : draft.senderFirst ? 'Prepare for my first signature' : 'Send agreement'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {confirmDialog}
      <AiDraftDialog
        open={draftingWithAi}
        onOpenChange={setDraftingWithAi}
        agreement={draft}
        clientName={forClient?.name}
        wouldReplace={() => Boolean(latest().content.trim() || latest().fields.length)}
        // Anything just typed is saved first: a background save landing mid-draft would make the server refuse it as changed.
        beforeDraft={async () => Boolean(await saveDraft())}
        onUse={applyAiDraft}
      />
      <TextPromptDialog
        open={namingTemplate}
        onOpenChange={setNamingTemplate}
        title="Save as template"
        description="The template keeps the document, the recipient roles and the field positions."
        label="Template name"
        initialValue={draft.title}
        maxLength={100}
        confirmLabel="Save template"
        busy={busy}
        onConfirm={(name) => void saveTemplate(name)}
      />
    </main>
  );
};

export default AgreementEditorPage;
