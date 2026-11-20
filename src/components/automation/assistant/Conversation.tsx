// The left side of the assistant: a plain conversation, a few ideas, and the box to write in.
import React, { useEffect, useId, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { assumptionsHeading } from '@/lib/automation/draft';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PANEL } from './PageStates';
import type { ChatEntry } from './storage';

/** Examples a person can start from. Pressing one puts its sentence in the box; nothing is sent. */
export const ASSISTANT_IDEAS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Research and qualify new leads',
    text: 'When a new lead comes in, find out about their company, decide if they are a good fit, and email the good ones our intro.',
  },
  {
    label: 'Remind the owner after 3 days',
    text: 'If a lead does not reply in 3 days, remind whoever owns the lead and draft the next email.',
  },
  {
    label: 'Start the project when a deal is won',
    text: 'When we win the deal, create the project in this workspace and give the kick-off tasks to the project lead.',
  },
  {
    label: 'Skip imported leads',
    text: 'Do not run this for leads that came from an import.',
  },
];

export interface ConversationProps {
  messages: ChatEntry[];
  input: string;
  onInput: (text: string) => void;
  onSend: () => void;
  /** True while the assistant is working on a reply. */
  waiting: boolean;
  onCancel: () => void;
  /** The server's sentence when the last message could not be answered. */
  error: string;
  /** A quiet line, such as "Cancelled. Nothing was changed." */
  note: string;
  /** Shown once there is something to clear. */
  onStartAgain?: () => void;
  /** True while the page is busy with something else, such as saving. */
  disabled?: boolean;
}

export const Conversation: React.FC<ConversationProps> = ({
  messages, input, onInput, onSend, waiting, onCancel, error, note, onStartAgain, disabled,
}) => {
  const id = useId();
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // The newest line stays in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, waiting]);

  const blocked = waiting || Boolean(disabled);

  return (
    <section aria-labelledby={`${id}-title`} className={cn(PANEL, 'flex min-h-[32rem] flex-col gap-4 p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">Tell me what should happen</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Say it in your own words. I build the automation, you check it and turn it on.
          </p>
        </div>
        {onStartAgain && (
          <Button type="button" variant="ghost" size="sm" onClick={onStartAgain} disabled={blocked}>Start again</Button>
        )}
      </div>

      <div
        ref={log}
        role="log"
        aria-label="Conversation"
        tabIndex={0}
        className="flex max-h-[28rem] min-h-[12rem] flex-1 flex-col gap-3 overflow-y-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {messages.length === 0 && !waiting && (
          <p className="m-auto max-w-xs px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing here yet. Describe what should happen to a new lead, or start from one of the ideas below.
          </p>
        )}
        {messages.map((message, i) => (message.role === 'user' ? (
          <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
            <span className="sr-only">You: </span>{message.text}
          </div>
        ) : (
          <div key={i} className="flex max-w-[92%] flex-col gap-2 self-start rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground">
            <p className="whitespace-pre-wrap break-words"><span className="sr-only">Assistant: </span>{message.text}</p>
            {message.assumptions && message.assumptions.length > 0 && (
              <>
                <p>{assumptionsHeading(message.assumptions.length)}</p>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {message.assumptions.map((assumption, n) => <li key={n} className="break-words">{assumption}</li>)}
                </ul>
              </>
            )}
          </div>
        )))}
        {waiting && (
          <div role="status" aria-live="polite" className="flex max-w-[92%] flex-wrap items-center gap-x-3 gap-y-2 self-start rounded-xl border border-border bg-background px-3 py-2.5">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
            <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
              Working on it… This can take a minute. Nothing is saved until you save it.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Ideas" className="flex flex-wrap gap-1.5">
          {ASSISTANT_IDEAS.map((idea) => (
            <button
              key={idea.label}
              type="button"
              disabled={blocked}
              title={idea.text}
              onClick={() => { onInput(idea.text); box.current?.focus(); }}
              className="inline-flex min-h-[2rem] items-center rounded-full border border-border bg-background px-2.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {idea.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2 focus-within:border-ring">
          <Textarea
            ref={box}
            value={input}
            rows={2}
            disabled={blocked}
            aria-label="Message the assistant"
            aria-describedby={`${id}-hint`}
            placeholder="Describe a change, or a new automation…"
            className="min-h-[3rem] flex-1 resize-none border-0 bg-transparent px-1 py-1 focus-visible:ring-0"
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              onSend();
            }}
          />
          <Button type="button" onClick={onSend} disabled={blocked || !input.trim()}>Send</Button>
        </div>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">Enter sends. Shift and Enter starts a new line.</p>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {note && !error && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
    </section>
  );
};

export default Conversation;
