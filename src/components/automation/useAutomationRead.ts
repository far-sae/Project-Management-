// One read from the automation server for the selected workspace, with its loading and failure states.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAutomation } from '@/hooks/useAutomation';
import { errorSentence, errorStatus } from '@/services/automation/client';

export interface AutomationRead<T> {
  /** What the server last answered, or null before the first answer. */
  data: T | null;
  /** The server's sentence when the last read failed, else ''. */
  error: string;
  /** True when the server answered 503: automation is not ready on the server yet, and `error` names what is missing. */
  notReady: boolean;
  loading: boolean;
  /** Reads again. With `nudge`, first asks the server to work through what is waiting (a failed nudge is ignored). */
  reload: (options?: { nudge?: boolean }) => Promise<void>;
  /** Puts an answer from another call (a change that replies with the same shape) in place of a read. */
  setData: (next: T) => void;
}

/** `key` says which workspace and path the rest belongs to, so an answer is never shown for another one. */
type State<T> = { key: string | null; data: T | null; error: string; notReady: boolean; loading: boolean };

/**
 * Reads `path` whenever it or the workspace changes. With no workspace
 * selected, or a null path, nothing is called and `data` stays null.
 */
export function useAutomationRead<T>(path: string | null, options: { nudgeOnLoad?: boolean } = {}): AutomationRead<T> {
  const { client, workspaceId } = useAutomation();
  const nudgeOnLoad = options.nudgeOnLoad === true;
  const target = workspaceId ? path : null;
  const key = target === null ? null : `${workspaceId} ${target}`;
  const [state, setState] = useState<State<T>>({ key, data: null, error: '', notReady: false, loading: key !== null });
  /** Goes up with every read, so an answer that arrives late for an older read is dropped. */
  const turn = useRef(0);

  const read = useCallback(async (nudge: boolean) => {
    turn.current += 1;
    const mine = turn.current;
    if (target === null || key === null) return;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, data: null, error: '', notReady: false, loading: true }));
    if (nudge) {
      try { await client.call('nudge', {}); } catch { /* The read below says what is wrong, if anything is. */ }
      if (mine !== turn.current) return;
    }
    try {
      const data = await client.call<T>(target);
      if (mine === turn.current) setState({ key, data, error: '', notReady: false, loading: false });
    } catch (e) {
      if (mine !== turn.current) return;
      const notReady = errorStatus(e) === 503;
      setState((s) => ({
        key, data: notReady || s.key !== key ? null : s.data, error: errorSentence(e), notReady, loading: false,
      }));
    }
  }, [client, target, key]);

  useEffect(() => {
    void read(nudgeOnLoad);
    return () => { turn.current += 1; };
  }, [read, nudgeOnLoad]);

  const reload = useCallback((next?: { nudge?: boolean }) => read(next?.nudge === true), [read]);
  const setData = useCallback((next: T) => {
    turn.current += 1;
    setState({ key, data: next, error: '', notReady: false, loading: false });
  }, [key]);

  // Between a change of path and its first answer, what is held belongs to the old path: show nothing of it.
  if (state.key !== key) {
    return { data: null, error: '', notReady: false, loading: key !== null, reload, setData };
  }
  return { data: state.data, error: state.error, notReady: state.notReady, loading: state.loading, reload, setData };
}
