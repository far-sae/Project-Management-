// "Test on a sample lead": what each step received, decided and would do. Nothing is changed or sent by a test.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { errorSentence } from '@/services/automation/client';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { TestResult } from '../../../api/_automation/shared/types';

export interface TestResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being tried: the automation's or the agent's name. */
  subject: string;
  /** True while the server is working on it. */
  loading: boolean;
  /** The server's sentence when the test could not be run. */
  error: string;
  result: TestResult | null;
  /** One more line under the description, for example that unsaved changes were not used. */
  note?: string;
  onRetry?: () => void;
}

const Part: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
  <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
    <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">{term}</dt>
    <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
  </div>
);

/** The result of trying a chain, or one agent, on a lead without doing anything. */
export const TestResultDialog: React.FC<TestResultDialogProps> = ({
  open, onOpenChange, subject, loading, error, result, note, onRetry,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Test on a sample lead</DialogTitle>
        <DialogDescription>
          {result && !loading
            ? `${subject} was tried on ${result.leadName}. Nothing was changed or sent.`
            : `Trying ${subject} on a sample lead. Nothing is changed or sent.`}
        </DialogDescription>
      </DialogHeader>

      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      {loading && (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
          <p className="text-sm font-medium text-foreground">Running the test…</p>
          <p className="max-w-sm text-sm text-muted-foreground">This can take a minute. Close this window to stop waiting.</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border px-4 py-4">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          {onRetry && <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>}
        </div>
      )}

      {!loading && !error && result && (
        <div className="flex min-w-0 flex-col gap-3">
          {result.steps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No step ran in this test.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {result.steps.map((step) => (
                <li key={`${step.n}-${step.agentName}`} className="flex gap-3 rounded-lg border border-border bg-background px-3 py-3">
                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold tabular-nums text-foreground">
                    {step.n}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        <span className="sr-only">Step {step.n}: </span>{step.agentName}
                      </span>
                      {step.needsApproval && <StatusPill tone="warning">Would wait for a person</StatusPill>}
                      {step.stopsChain && <StatusPill tone="muted">Would stop the run here</StatusPill>}
                    </div>
                    <dl className="flex flex-col gap-1.5">
                      <Part term="Received">{step.received || 'Nothing.'}</Part>
                      <Part term="Decided">{step.decided || 'Nothing.'}</Part>
                      <Part term="Would do">
                        {step.wouldDo.length === 0 ? 'Nothing.' : (
                          <ul className="flex list-disc flex-col gap-0.5 pl-4">
                            {step.wouldDo.map((line, i) => <li key={i}>{line}</li>)}
                          </ul>
                        )}
                      </Part>
                    </dl>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {result.note && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{result.note}</p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{loading ? 'Stop waiting' : 'Done'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

type TestState = { open: boolean; subject: string; loading: boolean; error: string; result: TestResult | null; note: string };
const CLOSED: TestState = { open: false, subject: '', loading: false, error: '', result: null, note: '' };

/**
 * Runs a test and shows it in the dialog: `start('Writer', () => client.call(…))`.
 * Render `dialog` once. Closing the dialog while a test is running stops the
 * wait; the server's reply is then ignored when it comes.
 */
export function useTestRun(): {
  start: (subject: string, call: () => Promise<TestResult>, note?: string) => void;
  dialog: React.ReactNode;
} {
  const [state, setState] = useState<TestState>(CLOSED);
  const request = useRef(0);
  const last = useRef<{ subject: string; call: () => Promise<TestResult>; note: string } | null>(null);

  useEffect(() => () => { request.current += 1; }, []);

  const start = useCallback((subject: string, call: () => Promise<TestResult>, note = '') => {
    request.current += 1;
    const mine = request.current;
    last.current = { subject, call, note };
    setState({ open: true, subject, loading: true, error: '', result: null, note });
    call().then(
      (result) => {
        if (request.current !== mine) return;
        if (!result || !Array.isArray(result.steps)) {
          setState((s) => ({ ...s, loading: false, error: 'The test came back empty. Try again.' }));
          return;
        }
        setState((s) => ({ ...s, loading: false, result }));
      },
      (e) => {
        if (request.current !== mine) return;
        setState((s) => ({ ...s, loading: false, error: errorSentence(e) }));
      },
    );
  }, []);

  const close = useCallback(() => {
    request.current += 1;
    setState(CLOSED);
  }, []);

  const retry = useCallback(() => {
    if (last.current) start(last.current.subject, last.current.call, last.current.note);
  }, [start]);

  const dialog = (
    <TestResultDialog
      open={state.open}
      onOpenChange={(open) => { if (!open) close(); }}
      subject={state.subject}
      loading={state.loading}
      error={state.error}
      result={state.result}
      note={state.note}
      onRetry={retry}
    />
  );

  return { start, dialog };
}

export default TestResultDialog;
