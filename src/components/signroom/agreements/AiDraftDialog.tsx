import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, PenLine, TriangleAlert } from 'lucide-react';
import { useSignroom } from '@/hooks/useSignroom';
import {
  AI_REPLACE_SENTENCE, AI_REQUIREMENT_PROMPTS, AI_REQUIREMENTS_MAX, AI_REVIEW_SENTENCE, AI_WRITER_SENTENCE,
  requirementsCount, requirementsProblem, senderNameOf,
} from '@/lib/signroom/aiDraft';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Agreement, AiDraft, Workspace } from '../../../../api/_signroom/shared/types';
import { Notice } from './Card';
import { messageOf } from './files';

export interface AiDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft agreement the text is for. Its type and its client decide what is written. */
  agreement: Pick<Agreement, 'id' | 'type'>;
  /** The client's name as the agreement has it, once it is known. */
  clientName?: string;
  /** Whether using a draft now would replace text or clear placed fields. Asked at the moment of use. */
  wouldReplace: () => boolean;
  /** Runs before the request is sent. Resolving to false stops it (the draft could not be saved). */
  beforeDraft?: () => Promise<boolean>;
  /** The person chose to use this text. Nothing is saved or sent by the dialog itself. */
  onUse: (content: string) => void;
}

type Phase = 'write' | 'waiting' | 'review';

/**
 * Draft with AI: the person describes what the agreement must cover, waits
 * while it is written, then reads the result and chooses to use it or not.
 * The server saves nothing; the text only reaches the document through `onUse`.
 */
export const AiDraftDialog: React.FC<AiDraftDialogProps> = ({
  open, onOpenChange, agreement, clientName, wouldReplace, beforeDraft, onUse,
}) => {
  const id = useId();
  const { client, workspaceId } = useSignroom();
  const [requirements, setRequirements] = useState('');
  const [phase, setPhase] = useState<Phase>('write');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [company, setCompany] = useState('');
  /** The request being waited for. Cancelling moves this on, so a reply that arrives late matches nothing and is dropped. */
  const request = useRef(0);
  const running = useRef(false);

  useEffect(() => () => { request.current += 1; }, []);

  // The company's name is shown, not asked for: the server uses the one on the workspace's documents.
  useEffect(() => {
    if (!open || company || !workspaceId) return;
    let active = true;
    client.call<{ workspace?: Pick<Workspace, 'name' | 'branding'> }>('session')
      .then((session) => { if (active && session.workspace) setCompany(senderNameOf(session.workspace)); })
      .catch(() => { /* The name is only shown for reference; the draft does not depend on it. */ });
    return () => { active = false; };
  }, [open, company, client, workspaceId]);

  const text = requirements.trim();
  const problem = requirementsProblem(requirements);
  const tooLong = text.length > AI_REQUIREMENTS_MAX;

  const start = async () => {
    if (running.current || problem) return;
    running.current = true;
    request.current += 1;
    const mine = request.current;
    setError('');
    setNote('');
    setPhase('waiting');
    try {
      if (beforeDraft && !(await beforeDraft())) {
        if (request.current === mine) setPhase('write');
        return;
      }
      if (request.current !== mine) return;
      const reply = await client.call<AiDraft>(`agreements/${agreement.id}/ai-draft`, { requirements: text });
      if (request.current !== mine) return;
      if (typeof reply?.content !== 'string' || !reply.content.trim()) throw new Error('The draft came back empty. Try again.');
      setResult(reply.content);
      setPhase('review');
    } catch (e) {
      if (request.current !== mine) return;
      setError(messageOf(e, 'The draft could not be written. Please try again.'));
      setPhase('write');
    } finally {
      if (request.current === mine) running.current = false;
    }
  };

  /** Stops waiting. The server cannot be stopped, so its reply is simply ignored when it comes. */
  const cancel = () => {
    request.current += 1;
    running.current = false;
    setPhase('write');
    setNote('Cancelled. Nothing was changed.');
  };

  const discard = () => {
    setResult('');
    setConfirming(false);
    setPhase('write');
    setNote('Draft discarded. Nothing was changed.');
  };

  const applyDraft = () => {
    const content = result;
    setResult('');
    setConfirming(false);
    setPhase('write');
    setNote('');
    onUse(content);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While a draft is being written only Cancel stops the wait, so a stray click outside does not lose it.
        if (!next && phase === 'waiting') return;
        if (!next) setConfirming(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft with AI</DialogTitle>
          <DialogDescription>
            {phase === 'review'
              ? 'Read the draft. Use it to put it in the document, or discard it.'
              : phase === 'waiting'
                ? 'Your draft is being written.'
                : `Describe what this agreement must cover. ${AI_WRITER_SENTENCE}`}
          </DialogDescription>
        </DialogHeader>

        {phase === 'write' && (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5 sm:grid-cols-3">
                {[
                  ['Your company', company || 'Your company'],
                  ['Client', clientName || 'The client on this agreement'],
                  ['Document type', agreement.type],
                ].map(([term, value]) => (
                  <div key={term} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{term}</dt>
                    <dd className="break-words text-sm font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">The draft uses these names, as the agreement has them.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-requirements`}>Your requirements</Label>
              <Textarea
                id={`${id}-requirements`}
                value={requirements}
                onChange={(e) => { setRequirements(e.target.value); setNote(''); }}
                rows={8}
                autoFocus
                aria-describedby={`${id}-prompts ${id}-count`}
                aria-invalid={tooLong || undefined}
                className="min-h-[11rem] resize-y leading-relaxed"
                placeholder="For example: a mutual NDA for discussing a website redesign, confidentiality for two years, England and Wales jurisdiction…"
              />
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <p className={cn('min-w-0 flex-1 basis-48 text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
                  {problem}
                </p>
                <p id={`${id}-count`} className={cn('text-xs tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
                  {requirementsCount(requirements)}
                </p>
              </div>
            </div>

            <div id={`${id}-prompts`} className="flex flex-col gap-1">
              <p className="text-xs font-medium text-foreground">Worth including</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-muted-foreground">
                {AI_REQUIREMENT_PROMPTS.map((prompt) => <li key={prompt}>{prompt}</li>)}
              </ul>
            </div>

            <Notice icon={<TriangleAlert />}>{AI_REVIEW_SENTENCE}</Notice>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {note && !error && <p className="text-sm text-muted-foreground">{note}</p>}
          </div>
        )}

        {phase === 'waiting' && (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
            <p className="text-sm font-medium text-foreground">Writing the draft…</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              This can take a few minutes. Keep this page open. Nothing changes in your document until you choose to use the draft.
            </p>
          </div>
        )}

        {phase === 'review' && (
          <div className="flex min-w-0 flex-col gap-4">
            <div
              role="region"
              aria-label="Draft text"
              tabIndex={0}
              className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-secondary/50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">{result}</pre>
            </div>
            <Notice icon={<TriangleAlert />}>{AI_REVIEW_SENTENCE}</Notice>
            {confirming && (
              <div role="alert" className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">The document already has text.</p>
                  <p className="text-sm text-muted-foreground">{AI_REPLACE_SENTENCE}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applyDraft}>Replace document</Button>
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Keep current document</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'write' && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="button" disabled={Boolean(problem)} onClick={() => void start()}>
                <PenLine aria-hidden /> Draft
              </Button>
            </>
          )}
          {phase === 'waiting' && <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>}
          {phase === 'review' && !confirming && (
            <>
              <Button type="button" variant="outline" onClick={discard}>Discard</Button>
              <Button type="button" onClick={() => (wouldReplace() ? setConfirming(true) : applyDraft())}>Use this draft</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AiDraftDialog;
