// The kick-off tasks every new project starts with: a title, and in how many days it is due.
import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { LIMITS, moved, rowKey, wholeNumberOf, type TaskRow } from '@/lib/automation/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HINT, Problem, RowButtons, SUB_TITLE } from './parts';

interface Props {
  tasks: TaskRow[];
  onChange: (tasks: TaskRow[]) => void;
  /** The sentence to show, and which rows it is about. */
  problem?: string;
  badRows?: number[];
  locked: boolean;
}

export const TasksEditor: React.FC<Props> = ({ tasks, onChange, problem, badRows = [], locked }) => {
  const id = useId();
  /** The row just added, so the cursor lands in it. */
  const [added, setAdded] = useState('');
  const full = tasks.length >= LIMITS.tasks;

  const add = () => {
    const key = rowKey();
    setAdded(key);
    onChange([...tasks, { key, title: '', days: '1' }]);
  };
  const patch = (key: string, change: Partial<TaskRow>) => onChange(tasks.map((each) => (each.key === key ? { ...each, ...change } : each)));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={`${id}-title`} className={SUB_TITLE}>Kick-off tasks</p>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No kick-off tasks. The project starts with an empty board.
        </p>
      ) : (
        <ol aria-labelledby={`${id}-title`} className="rounded-lg border border-border">
          {tasks.map((task, index) => {
            // In a row the sentence is about, mark the box that is wrong.
            const bad = badRows.includes(index);
            const title = task.title.trim();
            const days = wholeNumberOf(task.days);
            const badDays = bad && (days === null || days > LIMITS.taskDays);
            const badTitle = bad && (!title || title.length > LIMITS.taskTitle || !badDays);
            const described = problem ? `${id}-problem` : `${id}-hint`;
            return (
              <li key={task.key} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-b border-border p-2 last:border-b-0">
                <Input
                  aria-label={`Task ${index + 1}`} autoComplete="off" disabled={locked} className="min-w-0 flex-1 basis-60"
                  autoFocus={task.key === added}
                  value={task.title} onChange={(event) => patch(task.key, { title: event.target.value })}
                  aria-invalid={badTitle ? true : undefined} aria-describedby={described}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span aria-hidden className="text-xs text-muted-foreground">due in</span>
                  <Input
                    aria-label={`Days until task ${index + 1} is due`} inputMode="numeric" autoComplete="off" disabled={locked}
                    className="w-16 text-center tabular-nums"
                    value={task.days} onChange={(event) => patch(task.key, { days: event.target.value })}
                    aria-invalid={badDays ? true : undefined} aria-describedby={described}
                  />
                  <span aria-hidden className="text-xs text-muted-foreground">days</span>
                  <RowButtons
                    what={`task ${index + 1}`} first={index === 0} last={index === tasks.length - 1} disabled={locked}
                    onMove={(by) => onChange(moved(tasks, index, by))}
                    onRemove={() => onChange(tasks.filter((each) => each.key !== task.key))}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={locked || full} onClick={add}>
          <Plus aria-hidden />
          Add a task
        </Button>
      </div>
      <p id={`${id}-hint`} className={HINT}>
        Given to the project lead, due that many days after the project is created. Up to {LIMITS.tasks}.
      </p>
      <Problem id={`${id}-problem`}>{problem}</Problem>
    </div>
  );
};

export default TasksEditor;
