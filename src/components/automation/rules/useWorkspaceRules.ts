// Reads everything the workspace rules screen shows, holds what is being edited, and saves it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Overview, WorkspaceRow, WorkspaceRules } from '../../../../api/_automation/shared/types';
import { useAutomation } from '@/hooks/useAutomation';
import {
  formChanged, hasProblems, rulesBody, rulesFormOf, rulesProblems, type RulesForm, type RulesProblems,
} from '@/lib/automation/rules';
import { errorSentence, errorStatus } from '@/services/automation/client';
import type { Person } from './ProjectCard';

export const CHECK_FIELDS = 'Check the marked fields, then save again.';
export const CHANGED_ELSEWHERE =
  'These rules were changed somewhere else while you were editing. The latest rules are shown now: make your changes again, then save.';

/** The list of workspaces at the top of the screen. */
export interface WorkspacesList {
  /** Null until the first answer, and again when the list may not or could not be read. */
  rows: WorkspaceRow[] | null;
  loading: boolean;
  /** The server's sentence, when it is worth showing. */
  error: string;
}

/** Where the rules themselves stand. */
export type RulesView =
  | { phase: 'loading' }
  /** `quiet`: the server says what is not set up yet (503). Not a fault on the page. */
  | { phase: 'failed'; sentence: string; quiet: boolean }
  /** Automation has not been set up in this workspace. */
  | { phase: 'notSetUp' }
  | { phase: 'ready'; readOnly: boolean; people: Person[] | null };

/** What is being edited, once the rules are in. */
interface Editing { rules: WorkspaceRules; saved: RulesForm; form: RulesForm }

const NO_PROBLEMS: RulesProblems = { badColumns: [], badTasks: [] };

export function useWorkspaceRules() {
  const { client, workspaceId, workspaceName } = useAutomation();
  const [list, setList] = useState<WorkspacesList>({ rows: null, loading: Boolean(workspaceId), error: '' });
  const [view, setView] = useState<RulesView>({ phase: 'loading' });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  /** A refusal from the server, kept on the page. */
  const [notice, setNotice] = useState('');
  /** Set by a save that found something wrong: from then on the problems are shown as they come and go. */
  const [checked, setChecked] = useState(false);
  /** Goes up whenever the workspace changes or the page asks again, so an overtaken answer is dropped. */
  const latest = useRef(0);

  const accept = useCallback((rules: WorkspaceRules) => {
    const form = rulesFormOf(rules);
    setEditing({ rules, saved: form, form });
    setChecked(false);
  }, []);

  const loadList = useCallback(async () => {
    const mine = latest.current;
    setList((old) => ({ rows: old.rows, loading: true, error: '' }));
    try {
      const rows = await client.call<WorkspaceRow[]>('workspaces');
      if (mine === latest.current) setList({ rows: Array.isArray(rows) ? rows : [], loading: false, error: '' });
    } catch (err) {
      // 403: this person may not see the list. 503: the page already says what is missing. Neither is a fault to show here.
      const silent = [403, 503].includes(errorStatus(err));
      if (mine === latest.current) setList({ rows: null, loading: false, error: silent ? '' : errorSentence(err) });
    }
  }, [client]);

  const loadRules = useCallback(async () => {
    const mine = latest.current;
    setView({ phase: 'loading' });
    setEditing(null);
    setNotice('');
    try {
      const overview = await client.call<Overview>('overview');
      if (mine !== latest.current) return;
      if (!overview.setUp) { setView({ phase: 'notSetUp' }); return; }
      const [rules, people] = await Promise.all([
        client.call<WorkspaceRules>('rules'),
        // Without the people the rules can still be read and changed: only the choice of project lead is smaller.
        client.call<Person[]>('people').then((found) => (Array.isArray(found) ? found : null), () => null),
      ]);
      if (mine !== latest.current) return;
      accept(rules);
      setView({ phase: 'ready', readOnly: overview.role !== 'Owner', people });
    } catch (err) {
      if (mine === latest.current) setView({ phase: 'failed', sentence: errorSentence(err), quiet: errorStatus(err) === 503 });
    }
  }, [client, accept]);

  useEffect(() => {
    latest.current += 1;
    setSaving(false);
    if (!workspaceId) return;
    void loadList();
    void loadRules();
    return () => { latest.current += 1; };
  }, [workspaceId, loadList, loadRules]);

  const set = useCallback(<K extends keyof RulesForm>(key: K, value: RulesForm[K]) => {
    setEditing((old) => (old ? { ...old, form: { ...old.form, [key]: value } } : old));
  }, []);

  /** Puts back what was last saved. */
  const discard = useCallback(() => {
    setEditing((old) => (old ? { ...old, form: old.saved } : old));
    setChecked(false);
    setNotice('');
  }, []);

  const save = useCallback(async () => {
    if (!editing || saving) return;
    if (hasProblems(rulesProblems(editing.form))) {
      setChecked(true);
      setNotice('');
      toast.error(CHECK_FIELDS);
      return;
    }
    const mine = latest.current;
    setSaving(true);
    setNotice('');
    try {
      const stored = await client.call<WorkspaceRules>('rules', rulesBody(editing.form, editing.rules.revision));
      if (mine !== latest.current) return;
      accept(stored);
      // The list above shows this workspace too.
      setList((old) => ({
        ...old,
        rows: old.rows && old.rows.map((row) => (
          row.workspaceId === workspaceId ? { ...row, enabled: stored.enabled, autonomy: stored.autonomy } : row
        )),
      }));
      toast.success('Workspace rules saved.');
    } catch (err) {
      if (mine !== latest.current) return;
      if (errorStatus(err) !== 409) {
        const sentence = errorSentence(err);
        setNotice(sentence);
        toast.error(sentence);
        return;
      }
      // Saved by someone else meanwhile: show theirs, and say so.
      try {
        const theirs = await client.call<WorkspaceRules>('rules');
        if (mine !== latest.current) return;
        accept(theirs);
        setNotice(CHANGED_ELSEWHERE);
        toast.error(CHANGED_ELSEWHERE);
      } catch (again) {
        if (mine === latest.current) setView({ phase: 'failed', sentence: errorSentence(again), quiet: errorStatus(again) === 503 });
      }
    } finally {
      if (mine === latest.current) setSaving(false);
    }
  }, [client, workspaceId, editing, saving, accept]);

  const dirty = editing ? formChanged(editing.saved, editing.form) : false;
  const problems = editing && checked ? rulesProblems(editing.form) : NO_PROBLEMS;

  return {
    workspaceId,
    workspaceName,
    list,
    reloadList: loadList,
    view,
    reload: loadRules,
    /** The rules as the server last gave them, and as they stand on the screen. Null until they are in. */
    rules: editing?.rules ?? null,
    form: editing?.form ?? null,
    set,
    discard,
    dirty,
    saving,
    save,
    /** What a tried save found wrong. Empty until a save was tried. */
    problems,
    /** One sentence for the top of the page: what to put right, or the server's refusal. */
    notice: hasProblems(problems) ? CHECK_FIELDS : notice,
  };
}
