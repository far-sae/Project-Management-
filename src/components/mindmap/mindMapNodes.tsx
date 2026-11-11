import React, { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeTypes } from '@xyflow/react';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IDEA_PALETTE, paletteFor, type PlaceholderKind } from './mindMapTypes';

// ─────────────────────────────────────────────────────────────
// Shared node styling
// ─────────────────────────────────────────────────────────────

/** Base card: rounded-xl, 1px border, subtle shadow, hover lift (transform
 *  only, motion-safe), clear selected ring. */
const cardClass = (selected?: boolean) =>
  cn(
    'group relative rounded-xl border bg-card text-card-foreground shadow-sm',
    'motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:-translate-y-0.5',
    selected ? 'border-primary/60 ring-2 ring-primary' : 'border-border',
  );

/** Small square icon button used inside nodes (≥32px hit area; 40px on touch). */
const nodeIconButton =
  'nodrag inline-flex h-8 w-8 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[color,background-color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.97]';

/** All four sides expose both a source and a target handle so links can be
 *  drawn from any side to any side. Hidden at rest for a clean canvas; they
 *  appear on hover / selection (and stay faintly visible on touch screens
 *  where hover doesn't exist). */
const ConnectionHandles: React.FC<{ visible?: boolean }> = memo(({ visible }) => {
  const base = cn(
    '!w-3 !h-3 !min-w-0 !min-h-0 !border-2 !border-card !bg-primary nodrag',
    'motion-safe:transition-opacity motion-safe:duration-150',
    visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-60',
  );
  const target = cn(base, '!bg-muted-foreground/70');
  return (
    <>
      <Handle id="t-src" type="source" position={Position.Top} className={base} />
      <Handle id="t-tgt" type="target" position={Position.Top} className={target} />
      <Handle id="r-src" type="source" position={Position.Right} className={base} />
      <Handle id="r-tgt" type="target" position={Position.Right} className={target} />
      <Handle id="b-src" type="source" position={Position.Bottom} className={base} />
      <Handle id="b-tgt" type="target" position={Position.Bottom} className={target} />
      <Handle id="l-src" type="source" position={Position.Left} className={base} />
      <Handle id="l-tgt" type="target" position={Position.Left} className={target} />
    </>
  );
});
ConnectionHandles.displayName = 'ConnectionHandles';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ─────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────

export interface ProjectNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  taskCount: number;
  columnCount: number;
}

export const ProjectNode: React.FC<{ data: ProjectNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div className={cn(cardClass(selected), 'w-[320px] px-4 py-3.5')}>
    <ConnectionHandles visible={selected} />
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Project</p>
        <p className="text-[15px] font-semibold leading-snug text-foreground line-clamp-2">{data.label}</p>
      </div>
    </div>
    {data.description ? (
      <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground line-clamp-2">{data.description}</p>
    ) : null}
    <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5 text-[12px] text-muted-foreground tabular-nums">
      <span>{plural(data.taskCount, 'task')}</span>
      <span aria-hidden className="h-3 w-px bg-border" />
      <span>{plural(data.columnCount, 'column')}</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Column
// ─────────────────────────────────────────────────────────────

export interface ColumnNodeData extends Record<string, unknown> {
  label: string;
  color?: string;
  count: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const ColumnNode: React.FC<{ data: ColumnNodeData; selected?: boolean }> = ({ data, selected }) => {
  const canCollapse = !!data.onToggleCollapse && data.count > 0;
  return (
    <div className={cn(cardClass(selected), 'w-[264px] overflow-visible py-2.5 pl-4 pr-1.5')}>
      <ConnectionHandles visible={selected} />
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
        style={{ backgroundColor: data.color || 'hsl(var(--muted-foreground))' }}
      />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{data.label}</p>
          <p className="text-[12px] text-muted-foreground tabular-nums">{plural(data.count, 'task')}</p>
        </div>
        {data.collapsed && data.count > 0 && (
          <span
            className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground tabular-nums"
            title={`${plural(data.count, 'task')} hidden`}
          >
            +{data.count}
          </span>
        )}
        {canCollapse && (
          <button
            type="button"
            className={nodeIconButton}
            aria-expanded={!data.collapsed}
            aria-label={data.collapsed ? `Expand ${data.label}` : `Collapse ${data.label}`}
            title={data.collapsed ? 'Show tasks' : 'Hide tasks'}
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleCollapse?.();
            }}
          >
            {data.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Task
// ─────────────────────────────────────────────────────────────

export interface TaskAssigneeChip {
  name: string;
  photoURL?: string;
}

export interface TaskNodeData extends Record<string, unknown> {
  label: string;
  columnName: string;
  columnColor?: string;
  priority?: string;
  dueLabel?: string;
  overdue?: boolean;
  assignees: TaskAssigneeChip[];
  subtaskTotal: number;
  subtaskDone: number;
  attachmentCount: number;
  onOpen?: () => void;
  onAttachFiles?: (files: FileList) => void;
  isUploading?: boolean;
  onAddChild?: () => void;
}

const PRIORITY_CLASSES: Record<string, string> = {
  high: 'bg-destructive-soft text-destructive-soft-foreground',
  urgent: 'bg-destructive-soft text-destructive-soft-foreground',
  medium: 'bg-warning-soft text-warning-soft-foreground',
  low: 'bg-success-soft text-success-soft-foreground',
};

export const initialsOf = (name: string): string => {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const AvatarStack: React.FC<{ people: TaskAssigneeChip[] }> = ({ people }) => {
  if (people.length === 0) return null;
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5" aria-label={`Assigned to ${people.map((p) => p.name).join(', ')}`}>
      {shown.map((p, i) =>
        p.photoURL ? (
          <img
            key={`${p.name}-${i}`}
            src={p.photoURL}
            alt=""
            title={p.name}
            className="h-6 w-6 rounded-full object-cover ring-2 ring-card"
          />
        ) : (
          <span
            key={`${p.name}-${i}`}
            title={p.name}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-2 ring-card"
          >
            {initialsOf(p.name)}
          </span>
        ),
      )}
      {extra > 0 && (
        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-card tabular-nums">
          +{extra}
        </span>
      )}
    </div>
  );
};

export const TaskNode: React.FC<{ data: TaskNodeData; selected?: boolean }> = ({ data, selected }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={cn(cardClass(selected), 'w-[300px]')}>
      <ConnectionHandles visible={selected} />
      {/* Click lets React Flow select the card too (so Tab works after the
          panel closes); the parent ignores onOpen while connecting. */}
      <button
        type="button"
        onClick={() => data.onOpen?.()}
        className="block w-full rounded-xl px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open task ${data.label}`}
      >
        <p className="text-[14px] font-medium leading-snug text-foreground line-clamp-2 break-words">{data.label}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: data.columnColor || 'hsl(var(--muted-foreground))' }}
            aria-hidden
          />
          <span className="truncate">{data.columnName}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {data.priority && (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize',
                  PRIORITY_CLASSES[data.priority] || 'bg-muted text-muted-foreground',
                )}
              >
                {data.priority}
              </span>
            )}
            {data.dueLabel && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] tabular-nums',
                  data.overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                )}
                title={data.overdue ? 'Overdue' : 'Due date'}
              >
                <CalendarDays className="h-3 w-3" aria-hidden />
                {data.dueLabel}
              </span>
            )}
            {data.subtaskTotal > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums" title="Subtasks done">
                <Check className="h-3 w-3" aria-hidden />
                {data.subtaskDone}/{data.subtaskTotal}
              </span>
            )}
            {data.attachmentCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums" title="Attachments">
                <Paperclip className="h-3 w-3" aria-hidden />
                {data.attachmentCount}
              </span>
            )}
          </div>
          <AvatarStack people={data.assignees} />
        </div>
      </button>

      {(data.onAttachFiles || data.onAddChild) && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) data.onAttachFiles?.(files);
              e.target.value = '';
            }}
          />
          <div
            className={cn(
              'nodrag absolute -top-6 right-2 flex items-center rounded-lg border border-border bg-popover p-0.5 shadow-sm',
              'motion-safe:transition-opacity motion-safe:duration-150',
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}
          >
            {data.onAddChild && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onAddChild?.();
                }}
                title="Add connected idea (Tab)"
                aria-label="Add connected idea"
                className={nodeIconButton}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            {data.onAttachFiles && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={data.isUploading}
              title={data.isUploading ? 'Uploading…' : 'Attach files to this task'}
              aria-label="Attach files to this task"
              className={cn(nodeIconButton, 'disabled:opacity-50')}
            >
              {data.isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Subtask
// ─────────────────────────────────────────────────────────────

export interface SubtaskNodeData extends Record<string, unknown> {
  label: string;
  completed: boolean;
}

export const SubtaskNode: React.FC<{ data: SubtaskNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div className={cn(cardClass(selected), 'w-[260px] rounded-lg px-3 py-2')}>
    <ConnectionHandles visible={selected} />
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          data.completed ? 'border-success bg-success text-success-foreground' : 'border-border',
        )}
        aria-hidden
      >
        {data.completed && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <p
        className={cn(
          'truncate text-[13px] leading-snug',
          data.completed ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
      >
        {data.label}
      </p>
      <span className="sr-only">{data.completed ? '(done)' : '(open)'}</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Idea / placeholder
// ─────────────────────────────────────────────────────────────

export interface IdeaNodeData extends Record<string, unknown> {
  label: string;
  color?: string;
  kind?: PlaceholderKind;
  projectDescription?: string;
  attachmentCount?: number;
  subtaskProgress?: { completed: number; total: number };
  /** Task-shape placeholders open the placeholder side panel. */
  onOpen?: () => void;
  /** Controlled inline editing (F2 / double-click / Tab / Enter / N). */
  isEditing?: boolean;
  onStartEdit: () => void;
  /** Called with the final label when editing ends (Enter / blur). */
  onCommit: (label: string) => void;
  onCancelEdit: () => void;
  /** Tab while editing: commit and add a connected child. */
  onCommitAndAddChild?: (label: string) => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
  onAddChild?: () => void;
}

const UNTITLED: Record<string, string> = {
  project: 'Untitled project',
  column: 'Untitled column',
  task: 'Untitled task',
  idea: 'Untitled idea',
};

export const IdeaNode: React.FC<{ data: IdeaNodeData; selected?: boolean }> = ({ data, selected }) => {
  const palette = paletteFor(data.color);
  const kind = data.kind;
  const editing = !!data.isEditing;
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (editing) {
      doneRef.current = false;
      setDraft(data.label);
      // Focus after mount; select so typing replaces the placeholder text.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const finish = (mode: 'commit' | 'cancel' | 'child') => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = draft.trim();
    const label = trimmed || data.label;
    if (mode === 'cancel') data.onCancelEdit();
    else if (mode === 'child' && data.onCommitAndAddChild) data.onCommitAndAddChild(label);
    else data.onCommit(label);
  };

  const labelText = data.label || UNTITLED[kind ?? 'idea'];

  const labelBlock = editing ? (
    <textarea
      ref={inputRef}
      value={draft}
      aria-label="Edit label"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish('commit')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish('commit');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish('cancel');
        } else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          finish('child');
        }
      }}
      rows={kind === 'project' ? 1 : 2}
      className={cn(
        'nodrag nowheel min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1 leading-snug text-foreground outline-none focus:ring-2 focus:ring-ring',
        kind === 'project' ? 'text-[15px] font-semibold' : 'text-sm font-medium',
      )}
    />
  ) : (
    <p
      className={cn(
        'min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words leading-snug',
        kind === 'project' ? 'text-[15px] font-semibold' : 'text-sm font-medium',
        data.label ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {labelText}
    </p>
  );

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    data.onStartEdit();
  };

  const placeholderTag = (
    <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Placeholder
    </span>
  );

  const hoverToolbar = (
    <div
      className={cn(
        'nodrag absolute -top-6 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-sm',
        'motion-safe:transition-opacity motion-safe:duration-150',
        selected && !editing ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        editing && 'hidden',
      )}
      role="toolbar"
      aria-label="Idea actions"
    >
      {IDEA_PALETTE.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onColorChange(p.name);
          }}
          title={`Colour: ${p.name}`}
          aria-label={`Colour: ${p.name}`}
          aria-pressed={palette.name === p.name}
          className="nodrag inline-flex h-8 w-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'h-3.5 w-3.5 rounded-full',
              p.dot,
              palette.name === p.name ? 'ring-2 ring-foreground/50 ring-offset-1 ring-offset-popover' : 'opacity-80',
            )}
          />
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {data.onAddChild && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddChild?.();
          }}
          title="Add connected idea (Tab)"
          aria-label="Add connected idea"
          className={nodeIconButton}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          data.onStartEdit();
        }}
        title="Rename (F2)"
        aria-label="Rename"
        className={nodeIconButton}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          data.onDelete();
        }}
        title="Delete (Del)"
        aria-label="Delete"
        className={cn(nodeIconButton, 'hover:bg-destructive-soft hover:text-destructive')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // Placeholder shells share the board node shapes but read as "not on the
  // board": dashed border + Placeholder tag.
  const placeholderCard = (extra: string) =>
    cn(cardClass(selected), 'border-dashed', !selected && 'border-muted-foreground/40', extra);

  if (kind === 'project') {
    return (
      <div className={placeholderCard('w-[300px] px-4 py-3')} onDoubleClick={onDoubleClick}>
        <ConnectionHandles visible={selected} />
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> Project
          </span>
          {placeholderTag}
        </div>
        <div className="mt-1 flex items-start gap-2">{labelBlock}</div>
        {data.projectDescription && !editing && (
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground line-clamp-2">{data.projectDescription}</p>
        )}
        {hoverToolbar}
      </div>
    );
  }

  if (kind === 'column') {
    return (
      <div className={placeholderCard('w-[264px] py-2.5 pl-4 pr-3')} onDoubleClick={onDoubleClick}>
        <ConnectionHandles visible={selected} />
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1 rounded-l-xl', palette.dot)} />
        <div className="flex items-start gap-2">{labelBlock}</div>
        <div className="mt-1">{placeholderTag}</div>
        {hoverToolbar}
      </div>
    );
  }

  if (kind === 'task') {
    const sp = data.subtaskProgress;
    const attachments = data.attachmentCount ?? 0;
    return (
      <div className={placeholderCard('w-[300px]')} onDoubleClick={onDoubleClick}>
        <ConnectionHandles visible={selected} />
        <div
          role={editing ? undefined : 'button'}
          tabIndex={editing ? undefined : -1}
          onClick={() => {
            if (!editing) data.onOpen?.();
          }}
          className={cn('block w-full rounded-xl px-3.5 py-3 text-left', !editing && 'cursor-pointer')}
        >
          <div className="flex items-start gap-2">
            <span className={cn('mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full', palette.dot)} aria-hidden />
            {labelBlock}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {placeholderTag}
            {sp && sp.total > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                <Check className="h-3 w-3" aria-hidden />
                {sp.completed}/{sp.total}
              </span>
            )}
            {attachments > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                <Paperclip className="h-3 w-3" aria-hidden />
                {attachments}
              </span>
            )}
            {data.onOpen && !editing && (
              <button
                type="button"
                className="nodrag ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onOpen?.();
                }}
              >
                Open
              </button>
            )}
          </div>
        </div>
        {hoverToolbar}
      </div>
    );
  }

  // Plain brainstorm idea.
  return (
    <div
      className={cn(
        cardClass(selected),
        'min-w-[180px] max-w-[260px] px-3 py-2.5',
        !selected && palette.ring,
      )}
      onDoubleClick={onDoubleClick}
    >
      {/* Soft palette tint over the opaque card so the dotted canvas never shows through. */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-0 rounded-xl', palette.bg)} />
      <ConnectionHandles visible={selected} />
      <div className="relative flex items-start gap-2">
        <span className={cn('mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full', palette.dot)} aria-hidden />
        {labelBlock}
      </div>
      {hoverToolbar}
    </div>
  );
};

export const NODE_TYPES: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  column: ColumnNode as unknown as NodeTypes[string],
  task: TaskNode as unknown as NodeTypes[string],
  subtask: SubtaskNode as unknown as NodeTypes[string],
  idea: IdeaNode as unknown as NodeTypes[string],
};
