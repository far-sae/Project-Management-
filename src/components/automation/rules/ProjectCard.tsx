// "The project a won deal becomes": its name, who leads it, who is added, its board columns and kick-off tasks.
import React, { useId, useLayoutEffect, useRef } from 'react';
import { DEAL_OWNER, PLACEHOLDERS, insertAt, nameExample } from '@/lib/automation/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, FIELD } from '@/components/signroom/billing/shared';
import { ColumnsEditor } from './ColumnsEditor';
import type { RulesCardProps } from './LimitsCard';
import { HINT, Problem, SwitchRow } from './parts';
import { TasksEditor } from './TasksEditor';

export interface Person { userId: string; name: string }

interface Props extends RulesCardProps {
  /** The workspace's name, for the sentences. */
  place: string;
  /** The workspace's members, or null when they could not be loaded. */
  people: Person[] | null;
  /** A member only reads: there is nothing to choose, so nothing to say about what cannot be chosen. */
  readOnly?: boolean;
}

export const ProjectCard: React.FC<Props> = ({ form, set, problems, locked, place, people, readOnly }) => {
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  /** Where the cursor goes once a placeholder has been put in. */
  const caret = useRef<number | null>(null);
  /** Where the cursor was when it last left the name box. */
  const leftAt = useRef<{ start: number | null; end: number | null } | null>(null);
  const example = nameExample(form.nameTemplate);
  const known = people ?? [];
  /** Saved as the lead, but not (or no longer) among the people listed. */
  const stranger = form.lead !== DEAL_OWNER && !known.some((person) => person.userId === form.lead);

  useLayoutEffect(() => {
    if (caret.current === null || !nameInput.current) return;
    nameInput.current.focus();
    nameInput.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [form.nameTemplate]);

  const insert = (token: string) => {
    const input = nameInput.current;
    // Pressing a button takes the cursor out of the box, so go by where it was when it left. Never in the box: at the end.
    const at = input && document.activeElement === input ? { start: input.selectionStart, end: input.selectionEnd } : leftAt.current;
    const next = insertAt(form.nameTemplate, token, at?.start ?? null, at?.end ?? null);
    caret.current = next.caret;
    leftAt.current = { start: next.caret, end: next.caret };
    set('nameTemplate', next.text);
  };

  return (
    <Card title={`The project a won deal becomes in ${place}`}>
      <div className="flex flex-col gap-5 p-4">
        <p className="text-sm text-muted-foreground">The last agent builds this. Another workspace can have a different one.</p>

        <div className={FIELD}>
          <Label htmlFor={`${id}-name`}>Project name</Label>
          <Input
            id={`${id}-name`} ref={nameInput} autoComplete="off" disabled={locked}
            value={form.nameTemplate} onChange={(event) => set('nameTemplate', event.target.value)}
            onBlur={(event) => { leftAt.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; }}
            aria-invalid={problems.nameTemplate ? true : undefined}
            aria-describedby={problems.nameTemplate ? `${id}-name-hint ${id}-name-problem` : `${id}-name-hint`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className={HINT}>Put in:</span>
            {PLACEHOLDERS.map((placeholder) => (
              <Button
                key={placeholder.token} type="button" variant="outline" size="sm" disabled={locked}
                aria-label={`Insert ${placeholder.token}`} title={`Becomes ${placeholder.means}`}
                onClick={() => insert(placeholder.token)}
              >
                {placeholder.token}
              </Button>
            ))}
          </div>
          <p id={`${id}-name-hint`} className={HINT} aria-live="polite">{`For example: ${example}`}</p>
          <Problem id={`${id}-name-problem`}>{problems.nameTemplate}</Problem>
        </div>

        <div className={FIELD}>
          <Label htmlFor={`${id}-lead`}>Project lead</Label>
          <Select value={form.lead} onValueChange={(value) => set('lead', value)} disabled={locked}>
            <SelectTrigger id={`${id}-lead`} className="sm:max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEAL_OWNER}>Whoever owns the deal</SelectItem>
              {stranger && <SelectItem value={form.lead}>{people ? 'Someone no longer in this workspace' : 'One person'}</SelectItem>}
              {known.map((person) => <SelectItem key={person.userId} value={person.userId}>{person.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className={HINT}>
            {people || readOnly
              ? 'Gets the kick-off tasks.'
              : `The people in ${place} could not be loaded, so only the deal owner can be chosen for now.`}
          </p>
        </div>

        <SwitchRow
          label={`Add everyone in ${place} to the project`}
          checked={form.addEveryone} disabled={locked}
          onChange={(checked) => set('addEveryone', checked)}
        />

        <ColumnsEditor
          columns={form.columns} onChange={(columns) => set('columns', columns)}
          problem={problems.columns} badRows={problems.badColumns} locked={locked}
        />

        <TasksEditor
          tasks={form.tasks} onChange={(tasks) => set('tasks', tasks)}
          problem={problems.tasks} badRows={problems.badTasks} locked={locked}
        />

        <SwitchRow
          label="Let the agent add tasks it finds in the deal notes"
          checked={form.agentMayAddTasks} disabled={locked}
          onChange={(checked) => set('agentMayAddTasks', checked)}
        />
      </div>
    </Card>
  );
};

export default ProjectCard;
