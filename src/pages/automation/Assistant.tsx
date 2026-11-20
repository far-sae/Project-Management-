import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAutomation } from '@/hooks/useAutomation';
import { errorSentence, errorStatus } from '@/services/automation/client';
import { draftAfterSave, draftFromAutomation } from '@/lib/automation/draft';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { useTestRun } from '@/components/automation/TestResultDialog';
import { Conversation } from '@/components/automation/assistant/Conversation';
import { DraftPanel } from '@/components/automation/assistant/DraftPanel';
import {
  COLUMNS, LoadFailed, LoadingColumns, NotSetUp, ReadOnlyNote,
} from '@/components/automation/assistant/PageStates';
import {
  clearConversation, readConversation, writeConversation, type ChatEntry,
} from '@/components/automation/assistant/storage';
import { PickWorkspace } from '@/components/signroom/billing/shared';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { Button } from '@/components/ui/button';
import type {
  Agent, AssistantReply, Automation, AutomationDraft, AutomationStatus, Autonomy, Overview, TestResult, WorkspaceRules,
} from '../../../api/_automation/shared/types';

/** The saved automation behind the draft, once there is one. */
type Saved = { id: string; revision: number; status: AutomationStatus };

const savedOf = (automation: Automation): Saved => ({ id: automation.id, revision: automation.revision, status: automation.status });

/**
 * The assistant: the person says what should happen in their own words, the
 * assistant answers with a draft automation, and the person checks it, tries
 * it on a sample lead and turns it on. Nothing is saved until they save it.
 */
export const AutomationAssistantPage: React.FC = () => {
  const { client, workspaceId, workspaceName } = useAutomation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const automationParam = params.get('automation');
  const { ask, dialog: confirmDialog } = useConfirm();
  const test = useTestRun();

  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  /** The workspace the state below was loaded for; nothing is stored for another one. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  /** The saved automation as a draft, which "Start again" goes back to. */
  const [savedDraft, setSavedDraft] = useState<AutomationDraft | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  /** True while the draft differs from what is saved. */
  const [dirty, setDirty] = useState(false);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [sendError, setSendError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<null | 'draft' | 'on'>(null);
  const [saveError, setSaveError] = useState('');
  const [stale, setStale] = useState(false);

  const loading = useRef(0);
  /** The message being waited for. Cancelling moves this on, so a reply that arrives late matches nothing and is dropped. */
  const request = useRef(0);
  const running = useRef(false);
  const pending = useRef<{ history: ChatEntry[]; text: string } | null>(null);
  /** An automation this page saved itself: the address then names it, and there is nothing to load again. */
  const adopted = useRef<string | null>(null);

  useEffect(() => () => { request.current += 1; loading.current += 1; }, []);

  const load = useCallback(async (options: { force?: boolean; discard?: boolean } = {}) => {
    if (!workspaceId) return;
    if (!options.force && automationParam && adopted.current === `${workspaceId}:${automationParam}`) return;
    // Anything loaded from here on comes from the server, so the page's own copy is no longer the latest.
    adopted.current = null;
    loading.current += 1;
    const mine = loading.current;
    request.current += 1;
    running.current = false;
    setPhase('loading');
    setLoadError('');
    setWaiting(false);
    setSendError('');
    setNote('');
    setSaveError('');
    setStale(false);
    try {
      const next = await client.call<Overview>('overview');
      if (loading.current !== mine) return;
      let nextSaved: Saved | null = null;
      let fromServer: AutomationDraft | null = null;
      const owner = next.role === 'Owner';
      if (next.setUp) {
        // How much agents may do alone decides what "needs approval" means; the page works without knowing.
        client.call<WorkspaceRules>('rules')
          .then((rules) => { if (loading.current === mine) setAutonomy(rules?.autonomy ?? null); })
          .catch(() => { if (loading.current === mine) setAutonomy(null); });
        // A member cannot build, so they are shown the workspace's automation to read.
        const target = automationParam ?? (owner ? null : next.automation?.id ?? null);
        if (target) {
          const [automation, agents] = await Promise.all([
            client.call<Automation>(`automations/${target}`),
            client.call<Agent[]>('agents'),
          ]);
          if (loading.current !== mine) return;
          const does = next.automation?.id === automation.id
            ? Object.fromEntries(next.chain.map((step) => [step.agentId, step.does]))
            : {};
          fromServer = draftFromAutomation(automation, Array.isArray(agents) ? agents : [], does);
          nextSaved = savedOf(automation);
        }
      }
      const stored = owner && next.setUp ? readConversation(workspaceId, nextSaved?.id ?? null) : null;
      // Unsaved changes come back only when the automation has not been changed by someone else since.
      const kept = stored?.draft && !options.discard && (!nextSaved || stored.revision === nextSaved.revision) ? stored.draft : null;
      setOverview(next);
      setSaved(nextSaved);
      setSavedDraft(fromServer);
      setMessages(stored?.messages ?? []);
      setDraft(kept ?? fromServer);
      setDirty(Boolean(kept));
      setLoadedFor(workspaceId);
      setPhase('ready');
    } catch (e) {
      if (loading.current !== mine) return;
      setLoadError(errorSentence(e));
      setPhase('error');
    }
  }, [client, workspaceId, automationParam]);

  useEffect(() => { void load(); }, [load]);

  const owner = overview?.role === 'Owner';
  const ready = phase === 'ready' && Boolean(overview?.setUp) && loadedFor === workspaceId;

  // The conversation is kept for the tab, so a refresh does not lose it.
  useEffect(() => {
    if (!ready || !owner || !workspaceId || waiting) return;
    const automationId = saved?.id ?? null;
    if (messages.length === 0 && !dirty) { clearConversation(workspaceId, automationId); return; }
    writeConversation(workspaceId, automationId, { revision: saved?.revision ?? null, messages, draft: dirty ? draft : null });
  }, [ready, owner, workspaceId, waiting, saved, messages, draft, dirty]);

  const changeDraft = (next: AutomationDraft) => {
    setDraft(next);
    setDirty(true);
    setSaveError('');
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running.current || !ready || !owner || saving) return;
    running.current = true;
    request.current += 1;
    const mine = request.current;
    const history = messages;
    const outgoing: ChatEntry[] = [...history, { role: 'user', text }];
    pending.current = { history, text };
    setMessages(outgoing);
    setInput('');
    setSendError('');
    setNote('');
    setWaiting(true);
    try {
      const reply = await client.call<AssistantReply>('assistant', {
        messages: outgoing.map((message) => ({ role: message.role, text: message.text })),
        draft,
      });
      if (request.current !== mine) return;
      if (typeof reply?.reply !== 'string' || !reply.reply.trim()) throw new Error('empty reply');
      const assumptions = Array.isArray(reply.assumptions) ? reply.assumptions.filter((a) => typeof a === 'string' && a.trim()) : [];
      setMessages([...outgoing, { role: 'assistant', text: reply.reply, ...(assumptions.length ? { assumptions } : {}) }]);
      if (reply.draft) {
        setDraft(reply.draft);
        setDirty(true);
        setSaveError('');
      }
    } catch (e) {
      if (request.current !== mine) return;
      // What was written goes back in the box, so nothing has to be typed twice.
      setMessages(history);
      setInput(text);
      setSendError(errorSentence(e));
    } finally {
      if (request.current === mine) {
        running.current = false;
        pending.current = null;
        setWaiting(false);
      }
    }
  };

  /** Stops waiting. The server cannot be stopped, so its reply is simply ignored when it comes. */
  const cancel = () => {
    request.current += 1;
    running.current = false;
    const was = pending.current;
    pending.current = null;
    if (was) {
      setMessages(was.history);
      setInput(was.text);
    }
    setWaiting(false);
    setNote('Cancelled. Nothing was changed.');
  };

  const startAgain = async () => {
    const yes = await ask({
      title: 'Start again?',
      description: saved
        ? 'The conversation is cleared and the draft goes back to the saved automation. Changes you have not saved are lost.'
        : 'The conversation and the draft are cleared. This cannot be undone.',
      confirmLabel: 'Start again',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!yes) return;
    request.current += 1;
    running.current = false;
    pending.current = null;
    setWaiting(false);
    setMessages([]);
    setDraft(savedDraft);
    setDirty(false);
    setInput('');
    setSendError('');
    setNote('');
    setSaveError('');
    setStale(false);
  };

  const runTest = () => {
    if (!draft) return;
    const tried = draft;
    test.start(tried.name.trim() || 'The draft', () => client.call<TestResult>('automations/test-draft', { draft: tried }));
  };

  const save = async (turnOn: boolean) => {
    if (!draft || saving || waiting || !workspaceId) return;
    setSaving(turnOn ? 'on' : 'draft');
    setSaveError('');
    setStale(false);
    let current = saved;
    let savedNow = false;
    let patching = false;
    try {
      if (!current || dirty) {
        patching = Boolean(current);
        const automation = current
          ? await client.call<Automation>(`automations/${current.id}`, { ...draft, revision: current.revision }, 'PATCH')
          : await client.call<Automation>('automations', draft);
        patching = false;
        savedNow = true;
        const first = !current;
        current = savedOf(automation);
        const next = draftAfterSave(draft, automation);
        setSaved(current);
        setDraft(next);
        setSavedDraft(next);
        setDirty(false);
        if (first) {
          // From here on the address names the saved automation, so a refresh changes it instead of making another.
          clearConversation(workspaceId, null);
          adopted.current = `${workspaceId}:${automation.id}`;
          setParams({ automation: automation.id }, { replace: true });
        }
      }
      if (!turnOn) {
        toast.success(current.status === 'draft' ? 'Saved as a draft.' : 'Changes saved.');
        return;
      }
      const on = await client.call<Automation>(`automations/${current.id}/turn-on`, {});
      clearConversation(workspaceId, current.id);
      clearConversation(workspaceId, null);
      // Leaving the page: nothing more is stored for this conversation.
      setLoadedFor(null);
      toast.success(`“${on.name}” is on. New leads in ${workspaceName || 'this workspace'} start it.`);
      navigate('/crm/automation');
    } catch (e) {
      const sentence = errorSentence(e);
      setStale(patching && errorStatus(e) === 409);
      // The save itself went through; only turning it on was refused.
      const kept = current?.status === 'draft' ? 'Saved as a draft' : 'Saved';
      setSaveError(savedNow && turnOn ? `${kept}, but it could not be turned on. ${sentence}` : sentence);
    } finally {
      setSaving(null);
    }
  };

  const busy = waiting || saving !== null;
  const named = Boolean(draft?.name.trim());
  const hasSteps = Boolean(draft && draft.steps.length > 0);
  const isOn = saved?.status === 'on';
  /** Saved before and not a draft any more: saving it again is "Save changes", and only when there are some. */
  const wasOn = saved?.status === 'paused';
  const nothingToSave = Boolean(saved) && !dirty;
  const hint = !draft ? '' : !named
    ? 'Give the automation a name to save it.'
    : !hasSteps ? 'Add at least one step before it can be tested or turned on.' : '';

  const footer = owner && draft ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={runTest} disabled={busy || !hasSteps}>Test on a sample lead</Button>
        {isOn ? (
          <Button type="button" onClick={() => void save(false)} disabled={busy || !named || nothingToSave}>
            {saving === 'draft' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
            Save changes
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => void save(false)} disabled={busy || !named || nothingToSave}>
              {saving === 'draft' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {wasOn ? 'Save changes' : 'Save as draft'}
            </Button>
            <Button type="button" onClick={() => void save(true)} disabled={busy || !named || !hasSteps}>
              {saving === 'on' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              Save and turn on
            </Button>
          </>
        )}
      </div>
      {hint && <p className="text-right text-xs text-muted-foreground">{hint}</p>}
      {saveError && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <p role="alert" className="min-w-0 text-right text-sm text-destructive">{saveError}</p>
          {stale && (
            <Button type="button" variant="outline" size="sm" onClick={() => void load({ force: true, discard: true })}>
              Load the saved version
            </Button>
          )}
        </div>
      )}
    </div>
  ) : undefined;

  const panel = (
    <DraftPanel
      draft={draft}
      workspaceName={workspaceName}
      status={saved?.status ?? null}
      autonomy={autonomy}
      readOnly={!owner}
      locked={busy}
      onChange={changeDraft}
      footer={footer}
    />
  );

  return (
    <AutomationPage
      title="Assistant"
      description="Describe what should happen to a new lead. The assistant builds the automation for you to check."
    >
      {!workspaceId ? (
        <PickWorkspace what="its automation" />
      ) : phase === 'error' ? (
        <LoadFailed message={loadError} onRetry={() => void load({ force: true })} />
      ) : phase === 'loading' || !overview || loadedFor !== workspaceId ? (
        <LoadingColumns label="Loading the assistant" className="lg:grid-cols-2" />
      ) : !overview.setUp ? (
        <NotSetUp workspaceName={workspaceName} />
      ) : !owner ? (
        <div className="flex min-w-0 max-w-3xl flex-col gap-4">
          <ReadOnlyNote>
            {draft
              ? 'Only a workspace owner or admin builds automations. You can read this one.'
              : 'Only a workspace owner or admin builds automations. There is none in this workspace yet.'}
          </ReadOnlyNote>
          {draft && panel}
        </div>
      ) : (
        <div className={`${COLUMNS} lg:grid-cols-2`}>
          <Conversation
            messages={messages}
            input={input}
            onInput={(text) => { setInput(text); setNote(''); }}
            onSend={() => void send()}
            waiting={waiting}
            onCancel={cancel}
            error={sendError}
            note={note}
            onStartAgain={messages.length > 0 || dirty ? () => void startAgain() : undefined}
            disabled={saving !== null}
          />
          {panel}
        </div>
      )}
      {confirmDialog}
      {test.dialog}
    </AutomationPage>
  );
};

export default AutomationAssistantPage;
