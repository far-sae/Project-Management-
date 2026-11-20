import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAutomation } from '@/hooks/useAutomation';
import { errorSentence, errorStatus } from '@/services/automation/client';
import {
  BLANK_AGENT, agentInputOf, automationInputOf, moveItem, newStepId, oneLine, sameAgentInput, stepsWithAgent, stepsWithout,
} from '@/lib/automation/draft';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { useTestRun } from '@/components/automation/TestResultDialog';
import { AddToChainDialog } from '@/components/automation/agents/AddToChainDialog';
import { AgentEditor, type ChainPlace } from '@/components/automation/agents/AgentEditor';
import { ChainList, type AgentRow, type ChainRow } from '@/components/automation/agents/ChainList';
import {
  COLUMNS, LoadFailed, LoadingColumns, NotSetUp, PANEL, ReadOnlyNote,
} from '@/components/automation/assistant/PageStates';
import { PickWorkspace } from '@/components/signroom/billing/shared';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { Button } from '@/components/ui/button';
import type {
  Agent, AgentInput, Automation, AutomationStep, Overview, StepStart, TestResult,
} from '../../../api/_automation/shared/types';

/** What is open on the right: a saved agent (at one step of the chain, or in none), or a new one being described. */
type Selection =
  | { kind: 'agent'; agentId: string; stepId: string | null }
  | { kind: 'new'; joins: StepStart | null };

const TWO_COLUMNS = 'lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]';

/** The selection to show for this data: the one asked for while it still exists, else the chain's first agent. */
function resolveSelection(keep: Selection | null, automation: Automation | null, agents: Agent[]): Selection | null {
  const has = (agentId: string) => agents.some((agent) => agent.id === agentId);
  if (keep?.kind === 'new') return keep;
  if (keep && has(keep.agentId)) {
    const steps = automation?.steps ?? [];
    const step = steps.find((s) => s.id === keep.stepId && s.agentId === keep.agentId) ?? steps.find((s) => s.agentId === keep.agentId);
    return { kind: 'agent', agentId: keep.agentId, stepId: step?.id ?? null };
  }
  const first = automation?.steps.find((step) => has(step.agentId));
  if (first) return { kind: 'agent', agentId: first.agentId, stepId: first.id };
  return agents[0] ? { kind: 'agent', agentId: agents[0].id, stepId: null } : null;
}

const formFor = (selection: Selection | null, agents: Agent[]): AgentInput => {
  const agent = selection?.kind === 'agent' ? agents.find((a) => a.id === selection.agentId) : undefined;
  return agent ? agentInputOf(agent) : { ...BLANK_AGENT, rights: [] };
};

/**
 * The agents of one workspace: the chain they form, and one agent's job,
 * rights and switches. Changing the chain's order, or who is in it, saves the
 * automation; everything else saves the agent.
 */
export const AutomationAgentsPage: React.FC = () => {
  const { client, workspaceId, workspaceName } = useAutomation();
  const [params, setParams] = useSearchParams();
  const wantsNew = params.get('new') === '1';
  const { ask, dialog: confirmDialog } = useConfirm();
  const test = useTestRun();

  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  /** The overview's one line per agent, used until that agent's job is changed here. */
  const [does, setDoes] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [form, setForm] = useState<AgentInput>(BLANK_AGENT);
  const [busy, setBusy] = useState<null | 'save' | 'pause' | 'delete' | 'chain'>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [chainNotice, setChainNotice] = useState('');
  const [chainError, setChainError] = useState('');
  const [adding, setAdding] = useState(false);

  const loading = useRef(0);
  useEffect(() => () => { loading.current += 1; }, []);

  /**
   * Reads the overview, the chain and the agents. `quiet` keeps what is on the
   * screen while it reads (after a save was refused as out of date); `keep` is
   * the selection to stay on, and `keepForm` leaves what is being typed alone.
   */
  const load = useCallback(async (options: { quiet?: boolean; keep?: Selection | null; keepForm?: boolean } = {}): Promise<boolean> => {
    if (!workspaceId) return false;
    loading.current += 1;
    const mine = loading.current;
    if (!options.quiet) {
      setPhase('loading');
      setLoadError('');
      setNotice('');
      setError('');
      setChainNotice('');
      setChainError('');
    }
    try {
      const next = await client.call<Overview>('overview');
      if (loading.current !== mine) return false;
      let nextAutomation: Automation | null = null;
      let nextAgents: Agent[] = [];
      if (next.setUp) {
        const [chain, list] = await Promise.all([
          next.automation ? client.call<Automation>(`automations/${next.automation.id}`) : Promise.resolve(null),
          client.call<Agent[]>('agents'),
        ]);
        if (loading.current !== mine) return false;
        nextAutomation = chain;
        nextAgents = Array.isArray(list) ? list : [];
      }
      const nextSelection = resolveSelection(options.keep ?? null, nextAutomation, nextAgents);
      setOverview(next);
      setAutomation(nextAutomation);
      setAgents(nextAgents);
      setDoes(Object.fromEntries(next.chain.map((step) => [step.agentId, step.does])));
      setSelection(nextSelection);
      if (!options.keepForm) setForm(formFor(nextSelection, nextAgents));
      setLoadedFor(workspaceId);
      setPhase('ready');
      return true;
    } catch (e) {
      if (loading.current !== mine) return false;
      if (!options.quiet) {
        setLoadError(errorSentence(e));
        setPhase('error');
      }
      return false;
    }
  }, [client, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const owner = overview?.role === 'Owner';
  const ready = phase === 'ready' && Boolean(overview?.setUp) && loadedFor === workspaceId;

  // "?new=1" opens a blank agent, for an owner.
  useEffect(() => {
    if (!ready || !owner || !wantsNew) return;
    setSelection({ kind: 'new', joins: null });
    setForm({ ...BLANK_AGENT, rights: [] });
  }, [ready, owner, wantsNew]);

  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const selectedAgent = selection?.kind === 'agent' ? byId.get(selection.agentId) ?? null : null;
  const base = selectedAgent ? agentInputOf(selectedAgent) : BLANK_AGENT;
  const dirty = selection !== null && !sameAgentInput(form, base);

  const rowOf = useCallback((agent: Agent): AgentRow => ({
    agentId: agent.id,
    name: agent.name,
    does: does[agent.id] || oneLine(agent.job),
    paused: agent.paused,
  }), [does]);

  const rows = useMemo<ChainRow[]>(() => (automation?.steps ?? []).map((step) => {
    const agent = byId.get(step.agentId);
    return {
      ...(agent ? rowOf(agent) : { agentId: step.agentId, name: 'Removed agent', does: 'This agent no longer exists.', paused: false }),
      stepId: step.id,
      starts: step.starts,
    };
  }), [automation, byId, rowOf]);

  const others = useMemo<AgentRow[]>(() => {
    const used = new Set((automation?.steps ?? []).map((step) => step.agentId));
    return agents.filter((agent) => !used.has(agent.id)).map(rowOf);
  }, [automation, agents, rowOf]);

  const place = useMemo<ChainPlace | null>(() => {
    if (selection?.kind !== 'agent' || !selection.stepId) return null;
    const i = rows.findIndex((row) => row.stepId === selection.stepId);
    if (i < 0) return null;
    const next = rows[i + 1];
    return {
      position: i + 1,
      starts: rows[i].starts,
      previous: i > 0 ? rows[i - 1].name : null,
      next: next ? { name: next.name, starts: next.starts } : null,
    };
  }, [selection, rows]);

  const dropNewFromAddress = () => {
    if (wantsNew) setParams({}, { replace: true });
  };

  /** Opens something else on the right, with its own values in the form. */
  const show = (next: Selection | null) => {
    setSelection(next);
    setForm(formFor(next, agents));
    setNotice('');
    setError('');
    if (next?.kind !== 'new') dropNewFromAddress();
  };

  /** Goes on at once when nothing is unsaved; otherwise asks first, and goes on only on "Discard changes". */
  const guarded = (go: () => void) => {
    if (!dirty) { go(); return; }
    const who = selectedAgent ? selectedAgent.name : 'the new agent';
    void ask({
      title: 'Leave without saving?',
      description: `Your changes to ${who} are not saved. They are lost if you go on.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      destructive: true,
    }).then((yes) => { if (yes) go(); });
  };

  const pick = (agentId: string, stepId: string | null) => {
    if (selection?.kind === 'agent' && selection.agentId === agentId && selection.stepId === stepId) return;
    guarded(() => show({ kind: 'agent', agentId, stepId }));
  };

  const startNew = () => {
    if (selection?.kind === 'new' && !selection.joins) return;
    guarded(() => show({ kind: 'new', joins: null }));
  };

  const discard = () => {
    if (selection?.kind === 'new') show(resolveSelection(null, automation, agents));
    else show(selection);
  };

  /**
   * Saves the chain with these steps. Resolves to the saved automation; to
   * 'stale' when it was changed elsewhere and has been read again; or to null
   * when it was refused, with the server's sentence shown.
   */
  const saveChain = async (steps: AutomationStep[]): Promise<Automation | 'stale' | null> => {
    if (!automation) return null;
    setBusy('chain');
    setChainError('');
    setChainNotice('');
    try {
      const next = await client.call<Automation>(
        `automations/${automation.id}`,
        { ...automationInputOf(automation, steps), revision: automation.revision },
        'PATCH',
      );
      setAutomation(next);
      return next;
    } catch (e) {
      if (errorStatus(e) === 409 && (await load({ quiet: true, keep: selection, keepForm: true }))) {
        setChainNotice('The chain was changed elsewhere. The latest version is shown.');
        return 'stale';
      }
      setChainError(errorSentence(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const move = async (index: number, by: -1 | 1) => {
    if (!automation || busy) return;
    const steps = moveItem(automation.steps, index, by);
    if (steps === automation.steps) return;
    const next = await saveChain(steps);
    if (next && next !== 'stale') setSelection((current) => (current?.kind === 'agent' ? resolveSelection(current, next, agents) : current));
  };

  const removeFromChain = async () => {
    if (!automation || selection?.kind !== 'agent' || !selection.stepId || busy) return;
    const stepId = selection.stepId;
    const yes = await ask({
      title: selectedAgent ? `Remove ${selectedAgent.name} from the chain?` : 'Remove this step from the chain?',
      description: selectedAgent
        ? `“${automation.name}” then runs without this step. The agent itself is kept and is listed under “Not in a chain”.`
        : `“${automation.name}” then runs without this step.`,
      confirmLabel: 'Remove from the chain',
      cancelLabel: 'Keep in the chain',
      destructive: true,
    });
    if (!yes) return;
    const next = await saveChain(stepsWithout(automation.steps, stepId));
    if (!next || next === 'stale') return;
    // The agent stays open, now as one in no chain; a step whose agent is gone has nothing left to show.
    if (selectedAgent) setSelection({ kind: 'agent', agentId: selectedAgent.id, stepId: null });
    else show(resolveSelection(null, next, agents));
  };

  const addToChain = async (agentId: string | null, starts: StepStart) => {
    if (!automation || busy) return;
    if (agentId === null) {
      // A new agent is described first; it joins the chain when it is saved.
      setAdding(false);
      guarded(() => show({ kind: 'new', joins: starts }));
      return;
    }
    const id = newStepId();
    const next = await saveChain(stepsWithAgent(automation.steps, agentId, starts, id));
    // Refused with a reason: the dialog stays open and shows it.
    if (!next) return;
    setAdding(false);
    // Changed elsewhere and read again: the list now says so, and nothing was added.
    if (next === 'stale') return;
    if (!dirty) {
      const step = next.steps.find((s) => s.id === id) ?? [...next.steps].reverse().find((s) => s.agentId === agentId);
      show({ kind: 'agent', agentId, stepId: step?.id ?? null });
    }
  };

  const saveAgent = async () => {
    if (!selection || busy) return;
    const body: AgentInput = { name: form.name.trim(), job: form.job.trim(), rights: form.rights, askFirst: form.askFirst };
    if (!body.name || !body.job) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      if (selection.kind === 'agent') {
        if (!selectedAgent) return;
        const next = await client.call<Agent>(`agents/${selectedAgent.id}`, { ...body, revision: selectedAgent.revision }, 'PATCH');
        setAgents((list) => list.map((agent) => (agent.id === next.id ? next : agent)));
        setDoes(({ [next.id]: _old, ...rest }) => rest);
        setForm(agentInputOf(next));
        toast.success('Agent saved.');
        return;
      }
      const made = await client.call<Agent>('agents', body);
      const list = [...agents, made];
      setAgents(list);
      let stepId: string | null = null;
      if (selection.joins && automation) {
        try {
          const id = newStepId();
          const next = await client.call<Automation>(
            `automations/${automation.id}`,
            { ...automationInputOf(automation, stepsWithAgent(automation.steps, made.id, selection.joins, id)), revision: automation.revision },
            'PATCH',
          );
          setAutomation(next);
          stepId = (next.steps.find((s) => s.id === id) ?? next.steps.find((s) => s.agentId === made.id))?.id ?? null;
        } catch (e) {
          setError(`${made.name} was created, but it could not be added to the chain. ${errorSentence(e)}`);
        }
      }
      setSelection({ kind: 'agent', agentId: made.id, stepId });
      setForm(agentInputOf(made));
      dropNewFromAddress();
      toast.success('Agent created.');
    } catch (e) {
      // Someone else saved this agent first: show theirs, and say that this save did not happen.
      if (selection.kind === 'agent' && errorStatus(e) === 409 && (await load({ quiet: true, keep: selection }))) {
        setNotice('This agent was changed elsewhere. The latest version is shown, and your changes were not saved.');
      } else {
        setError(errorSentence(e));
      }
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async () => {
    if (!selectedAgent || busy) return;
    setBusy('pause');
    setError('');
    try {
      const next = await client.call<Agent>(`agents/${selectedAgent.id}/${selectedAgent.paused ? 'resume' : 'pause'}`, {});
      // Only the saved agent changes; what is being typed stays.
      setAgents((list) => list.map((agent) => (agent.id === next.id ? next : agent)));
    } catch (e) {
      setError(errorSentence(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = () => {
    if (!selectedAgent) return;
    const { id, name } = selectedAgent;
    test.start(
      name,
      () => client.call<TestResult>(`agents/${id}/test`, {}),
      dirty ? 'This tries the saved agent. Your unsaved changes are not used.' : '',
    );
  };

  const remove = async () => {
    if (!selectedAgent || busy) return;
    const { id, name } = selectedAgent;
    const yes = await ask({
      title: `Delete ${name}?`,
      description: 'The agent is removed from this workspace. Runs it already took part in keep their record. This cannot be undone.',
      confirmLabel: 'Delete agent',
      cancelLabel: 'Keep agent',
      destructive: true,
    });
    if (!yes) return;
    setBusy('delete');
    setError('');
    setNotice('');
    try {
      await client.call<{ ok: true }>(`agents/${id}`, undefined, 'DELETE');
      const rest = agents.filter((agent) => agent.id !== id);
      const next = resolveSelection(null, automation, rest);
      setAgents(rest);
      setSelection(next);
      setForm(formFor(next, rest));
      toast.success(`${name} was deleted.`);
    } catch (e) {
      // While a chain still uses the agent the server refuses, and its sentence names the automation.
      setError(errorSentence(e));
    } finally {
      setBusy(null);
    }
  };

  const assistantHref = automation ? `/crm/automation/assistant?automation=${automation.id}` : '/crm/automation/assistant';
  const shown = selection?.kind === 'new' || selectedAgent;

  return (
    <AutomationPage
      title="Agents"
      description="Each agent has one job and a list of what it may do. Together they form the chain a new lead goes through."
      actions={ready && owner ? (
        <Button type="button" onClick={startNew} disabled={busy !== null}>
          <Plus aria-hidden /> New agent
        </Button>
      ) : undefined}
    >
      {!workspaceId ? (
        <PickWorkspace what="its agents" />
      ) : phase === 'error' ? (
        <LoadFailed message={loadError} onRetry={() => void load()} />
      ) : phase === 'loading' || !overview || loadedFor !== workspaceId ? (
        <LoadingColumns label="Loading agents" className={TWO_COLUMNS} />
      ) : !overview.setUp ? (
        <NotSetUp workspaceName={workspaceName} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {!owner && <ReadOnlyNote>Only a workspace owner or admin can change agents. You can read them here.</ReadOnlyNote>}
          <div className={`${COLUMNS} ${TWO_COLUMNS}`}>
            <ChainList
              title={automation?.name ?? null}
              rows={rows}
              others={others}
              selected={selection?.kind === 'agent' ? { agentId: selection.agentId, stepId: selection.stepId } : null}
              readOnly={!owner}
              busy={busy !== null}
              error={adding ? '' : chainError}
              notice={chainNotice}
              onPick={pick}
              onMove={(index, by) => void move(index, by)}
              onAdd={owner && automation ? () => { setChainError(''); setAdding(true); } : undefined}
            />
            {shown ? (
              <AgentEditor
                agent={selectedAgent}
                form={form}
                onChange={(next) => { setForm(next); setError(''); }}
                dirty={dirty}
                readOnly={!owner}
                busy={busy}
                place={place}
                joins={selection?.kind === 'new' ? selection.joins : null}
                assistantHref={assistantHref}
                notice={notice}
                error={error}
                onSave={() => void saveAgent()}
                onDiscard={discard}
                onPauseToggle={() => void togglePause()}
                onTest={runTest}
                onRemoveFromChain={() => void removeFromChain()}
                onDelete={() => void remove()}
              />
            ) : selection?.kind === 'agent' ? (
              <section aria-label="Agent details" className={`${PANEL} flex min-h-[20rem] flex-col items-center justify-center gap-3 p-4 text-center`}>
                <p className="text-sm font-medium text-foreground">This agent no longer exists.</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Its step is still in the chain, and the automation cannot be turned on while it is.
                </p>
                {owner && selection.stepId && (
                  <Button type="button" variant="outline" onClick={() => void removeFromChain()} disabled={busy !== null}>
                    Remove this step from the chain
                  </Button>
                )}
              </section>
            ) : (
              <section aria-label="Agent details" className={`${PANEL} flex min-h-[20rem] flex-col items-center justify-center gap-2 p-4 text-center`}>
                <p className="text-sm font-medium text-foreground">No agents yet.</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {owner ? 'Make the first one with “New agent”.' : 'An owner or admin of the workspace makes them.'}
                </p>
              </section>
            )}
          </div>
        </div>
      )}
      {automation && (
        <AddToChainDialog
          open={adding}
          onOpenChange={setAdding}
          automationName={automation.name}
          candidates={others.map((row) => ({ id: row.agentId, name: row.name }))}
          busy={busy === 'chain'}
          error={adding ? chainError : ''}
          onAdd={(agentId, starts) => void addToChain(agentId, starts)}
        />
      )}
      {confirmDialog}
      {test.dialog}
    </AutomationPage>
  );
};

export default AutomationAgentsPage;
