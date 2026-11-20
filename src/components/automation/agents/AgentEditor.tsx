// The right side of the agents screen: one agent's name, job, rights and what can be done to it.
import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  askFirstSentence, positionInWords, ranThisMonth, startInWords, startPhrase, toggleRight,
} from '@/lib/automation/draft';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PANEL } from '@/components/automation/assistant/PageStates';
import { RIGHTS, type Agent, type AgentInput, type StepStart } from '../../../../api/_automation/shared/types';

/** Where the open agent sits in the chain. Null when it is in none. */
export type ChainPlace = {
  /** 1-based. */
  position: number;
  starts: StepStart;
  /** The agent before it, or null for the first step. */
  previous: string | null;
  /** The agent after it, or null for the last step. */
  next: { name: string; starts: StepStart } | null;
};

export interface AgentEditorProps {
  /** The saved agent, or null while a new one is being described. */
  agent: Agent | null;
  form: AgentInput;
  onChange: (next: AgentInput) => void;
  /** True while the form differs from what is saved. */
  dirty: boolean;
  /** A member: everything is shown and nothing can be changed. */
  readOnly: boolean;
  /** What is in progress, so its button can say so and the rest wait. */
  busy: null | 'save' | 'pause' | 'delete' | 'chain';
  place: ChainPlace | null;
  /** For a new agent that joins the chain when it is saved: when it will start. */
  joins: StepStart | null;
  /** Where the assistant is, for rewriting the job. */
  assistantHref: string;
  /** A quiet line, such as that the agent was changed elsewhere. */
  notice: string;
  /** The server's sentence when something could not be done. */
  error: string;
  onSave: () => void;
  onDiscard: () => void;
  onPauseToggle: () => void;
  onTest: () => void;
  onRemoveFromChain: () => void;
  onDelete: () => void;
}

const BOX = 'flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-3';
const BOX_TITLE = 'text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground';
const ROW = 'flex min-h-[3rem] items-center justify-between gap-3 px-3 py-2.5';

export const AgentEditor: React.FC<AgentEditorProps> = ({
  agent, form, onChange, dirty, readOnly, busy, place, joins, assistantHref, notice, error,
  onSave, onDiscard, onPauseToggle, onTest, onRemoveFromChain, onDelete,
}) => {
  const id = useId();
  const working = busy !== null;
  const fixed = readOnly || working;
  const complete = Boolean(form.name.trim() && form.job.trim());

  return (
    <section aria-label="Agent details" className={cn(PANEL, 'flex flex-col gap-5 p-4')}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {place && (
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold tabular-nums text-background">
              {place.position}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-sm font-semibold text-foreground">{agent ? agent.name : 'New agent'}</h2>
              {agent?.paused && <StatusPill tone="warning">Paused</StatusPill>}
            </div>
            <p className="text-xs text-muted-foreground">
              {agent
                ? `${place ? positionInWords(place.position) : 'Not in a chain'} · ${ranThisMonth(agent.runsThisMonth)}`
                : joins
                  ? `It joins the end of the chain when you save it, and starts ${startPhrase(joins, false)}.`
                  : 'It is in no chain until you add it to one.'}
            </p>
          </div>
        </div>
        {agent && !readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onTest} disabled={working}>Test on a sample lead</Button>
            <Button type="button" variant="outline" onClick={onPauseToggle} disabled={working}>
              {busy === 'pause' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {agent.paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        )}
      </header>

      {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{notice}</p>}
      {agent?.paused && (
        <p className="text-sm text-muted-foreground">While it is paused, its step waits and the run goes no further.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium text-foreground">Name</label>
        <Input
          id={`${id}-name`}
          value={form.name}
          maxLength={80}
          disabled={fixed}
          className="max-w-md"
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-job`} className="text-sm font-medium text-foreground">Its one job</label>
        <Textarea
          id={`${id}-job`}
          value={form.job}
          rows={6}
          disabled={fixed}
          aria-describedby={`${id}-job-hint`}
          className="min-h-[9rem] resize-y leading-relaxed"
          placeholder="For example: decide whether this lead is a good fit for us, give a score from 1 to 5 and one sentence explaining it."
          onChange={(e) => onChange({ ...form, job: e.target.value })}
        />
        <p id={`${id}-job-hint`} className="text-xs text-muted-foreground">
          Written in plain words.{' '}
          <Link to={assistantHref} className="font-medium text-foreground underline underline-offset-4">The assistant</Link>
          {' '}can rewrite it for you.
        </p>
      </div>

      {agent && (place ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={BOX}>
            <h3 className={BOX_TITLE}>{place.previous ? `Receives from ${place.previous}` : 'Receives the new lead'}</h3>
            <p className="break-words text-sm text-foreground">
              {place.previous
                ? `The lead, its company and its deal, the recent notes, and what ${place.previous} handed on.`
                : 'The lead as it was added, with its company and the recent notes.'}
            </p>
            <p className="text-xs text-muted-foreground">{startInWords(place.starts, place.position === 1)}.</p>
          </div>
          <div className={BOX}>
            <h3 className={BOX_TITLE}>{place.next ? `Hands on to ${place.next.name}` : 'Last in the chain'}</h3>
            <p className="break-words text-sm text-foreground">
              {place.next
                ? `Its result goes to ${place.next.name}, which starts ${startPhrase(place.next.starts, false)}.`
                : 'Nothing comes after it. Its result is kept in the run’s record.'}
            </p>
            <p className="text-xs text-muted-foreground">If it decides the lead should go no further, the run stops here.</p>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          It is in no chain yet, so it receives nothing and hands nothing on.
          {!readOnly && ' Use “Add an agent to the chain” to put it to work.'}
        </p>
      ))}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">What it is allowed to do</legend>
        <div className="divide-y divide-border rounded-lg border border-border bg-background">
          <div className={ROW}>
            <div className="min-w-0">
              <p className="text-sm text-foreground">Read the lead, its company and its deal</p>
              <p className="text-xs text-muted-foreground">Every agent can read. Reading changes nothing.</p>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Always</span>
          </div>
          {RIGHTS.map((right) => (
            <div key={right.key} className={ROW}>
              <div className="min-w-0">
                <label htmlFor={`${id}-${right.key}`} className="text-sm text-foreground">{right.label}</label>
                <p id={`${id}-${right.key}-note`} className="text-xs text-muted-foreground">{right.note}</p>
              </div>
              <Switch
                id={`${id}-${right.key}`}
                aria-describedby={`${id}-${right.key}-note`}
                checked={form.rights.includes(right.key)}
                disabled={fixed}
                onCheckedChange={(on) => onChange({ ...form, rights: toggleRight(form.rights, right.key, on) })}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">An agent can never do more than this list, whatever it is told.</p>
      </fieldset>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-ask`} className="text-sm font-medium text-foreground">Ask me before it acts</label>
          <p id={`${id}-ask-note`} className="text-xs text-muted-foreground">
            {askFirstSentence(form.name, form.rights, form.askFirst)}
          </p>
        </div>
        <Switch
          id={`${id}-ask`}
          aria-describedby={`${id}-ask-note`}
          checked={form.askFirst}
          disabled={fixed}
          onCheckedChange={(askFirst) => onChange({ ...form, askFirst })}
        />
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!readOnly && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDiscard} disabled={working || (Boolean(agent) && !dirty)}>Discard</Button>
            <Button type="button" onClick={onSave} disabled={working || !dirty || !complete}>
              {busy === 'save' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              Save agent
            </Button>
          </div>
          {!complete && <p className="text-right text-xs text-muted-foreground">An agent needs a name and a job.</p>}
        </div>
      )}

      {agent && !readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
          <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
            {place
              ? 'Removing it from the chain keeps the agent. An agent can be deleted once no chain uses it.'
              : 'Deleting removes the agent from this workspace. Runs it took part in keep their record.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {place && (
              <Button type="button" variant="outline" onClick={onRemoveFromChain} disabled={working}>
                {busy === 'chain' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
                Remove from the chain
              </Button>
            )}
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete} disabled={working}>
              {busy === 'delete' && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              Delete agent
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

export default AgentEditor;
