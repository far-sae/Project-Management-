// The board columns of the project a won deal becomes: an ordered list of names.
import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { LIMITS, moved, rowKey, standardColumns, type ColumnRow } from '@/lib/automation/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HINT, Problem, RowButtons, SUB_TITLE } from './parts';

interface Props {
  columns: ColumnRow[];
  onChange: (columns: ColumnRow[]) => void;
  /** The sentence to show, and which rows it is about. */
  problem?: string;
  badRows?: number[];
  locked: boolean;
}

export const ColumnsEditor: React.FC<Props> = ({ columns, onChange, problem, badRows = [], locked }) => {
  const id = useId();
  /** The row just added, so the cursor lands in it. */
  const [added, setAdded] = useState('');
  const full = columns.length >= LIMITS.columns;

  const add = () => {
    const key = rowKey();
    setAdded(key);
    onChange([...columns, { key, title: '' }]);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={`${id}-title`} className={SUB_TITLE}>Board columns</p>
      <ol aria-labelledby={`${id}-title`} className="flex flex-col gap-1">
        {columns.map((column, index) => (
          <li key={column.key} className="flex items-center gap-2">
            <span aria-hidden className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <Input
              aria-label={`Column ${index + 1}`} autoComplete="off" disabled={locked} className="min-w-0 flex-1"
              autoFocus={column.key === added}
              value={column.title}
              onChange={(event) => onChange(columns.map((each) => (each.key === column.key ? { ...each, title: event.target.value } : each)))}
              aria-invalid={badRows.includes(index) ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : `${id}-hint`}
            />
            <RowButtons
              what={`column ${index + 1}`} first={index === 0} last={index === columns.length - 1}
              removable={columns.length > 1} disabled={locked}
              onMove={(by) => onChange(moved(columns, index, by))}
              onRemove={() => onChange(columns.filter((each) => each.key !== column.key))}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={locked || full} onClick={add}>
          <Plus aria-hidden />
          Add a column
        </Button>
        <Button
          type="button" variant="ghost" size="sm" disabled={locked}
          onClick={() => onChange(standardColumns().map((title) => ({ key: rowKey(), title })))}
        >
          Use the standard columns
        </Button>
      </div>
      <p id={`${id}-hint`} className={HINT}>
        In the order they stand on the board. At least one, and up to {LIMITS.columns}.
      </p>
      <Problem id={`${id}-problem`}>{problem}</Problem>
    </div>
  );
};

export default ColumnsEditor;
