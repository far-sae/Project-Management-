import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  Columns,
  FileJson,
  Image,
  Keyboard,
  Lightbulb,
  Link2,
  Map as MapIcon,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCcw,
  Scan,
  Search,
  Sparkles,
  Eraser,
  Undo2,
  Wand2,
  X,
  LayoutGrid,
  ListTree,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PlaceholderKind } from './mindMapTypes';
import { searchMindMap, type SearchItem, type SearchKind } from './mindMapSearch';

// ─────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────

export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export const modKeyLabel = (): string => (isMacPlatform() ? '⌘' : 'Ctrl');

/** Press feedback + focus ring shared by every toolbar control. */
export const PRESSABLE =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[color,background-color,transform] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

const toolBtn = (opts: { icon?: boolean; active?: boolean } = {}) =>
  cn(
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium',
    '[@media(pointer:coarse)]:h-10',
    opts.icon ? 'w-8 [@media(pointer:coarse)]:w-10' : 'px-2.5',
    opts.active
      ? 'bg-primary-soft text-primary-soft-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    PRESSABLE,
    '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
  );

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;

// ─────────────────────────────────────────────────────────────
// Mode switch (Project map / AI mind map)
// ─────────────────────────────────────────────────────────────

export type MindMapMode = 'project' | 'ai';

export const MindMapModeSwitch: React.FC<{
  mode: MindMapMode;
  onChange: (mode: MindMapMode) => void;
  className?: string;
}> = ({ mode, onChange, className }) => {
  const item = (value: MindMapMode, icon: React.ReactNode, long: string, short: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      onClick={() => onChange(value)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium [@media(pointer:coarse)]:h-9',
        '[&_svg]:h-3.5 [&_svg]:w-3.5',
        mode === value
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        PRESSABLE,
      )}
    >
      {icon}
      <span className="hidden sm:inline">{long}</span>
      <span className="sm:hidden">{short}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Mind map mode"
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5', className)}
    >
      {item('project', <ListTree aria-hidden />, 'Project map', 'Project')}
      {item('ai', <Wand2 aria-hidden />, 'AI mind map', 'AI')}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Find
// ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<SearchKind, string> = {
  task: 'Task',
  subtask: 'Subtask',
  column: 'Column',
  idea: 'Idea',
  project: 'Project',
};

export interface MindMapFindProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SearchItem[];
  /** `viaKeyboard` lets the caller skip camera animation for keyboard picks. */
  onSelect: (id: string, viaKeyboard: boolean) => void;
}

export const MindMapFind: React.FC<MindMapFindProps> = ({ open, onOpenChange, items, onSelect }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const results = useMemo(() => searchMindMap(items, query, 8), [items, query]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) {
    return (
      <button
        type="button"
        className={toolBtn({ icon: true })}
        onClick={() => onOpenChange(true)}
        aria-label="Find on map"
        title={`Find on map (${modKeyLabel()}+F)`}
      >
        <Search aria-hidden />
      </button>
    );
  }

  const choose = (idx: number, viaKeyboard: boolean) => {
    const r = results[idx];
    if (!r) return;
    onSelect(r.id, viaKeyboard);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) onOpenChange(false);
      }}
    >
      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background pl-2 pr-1 [@media(pointer:coarse)]:h-10">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find tasks, ideas…"
          role="combobox"
          aria-label="Find on map"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          className="w-40 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground sm:w-52"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(active, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onOpenChange(false);
              setQuery('');
            }
          }}
        />
        <button
          type="button"
          aria-label="Close find"
          title="Close (Esc)"
          className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground', PRESSABLE)}
          onClick={() => {
            onOpenChange(false);
            setQuery('');
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {query.trim() && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {results.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No matches on this map</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Matches">
              {results.map((r, i) => (
                <li
                  key={r.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i, false)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]',
                    i === active ? 'bg-muted text-foreground' : 'text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.label}</span>
                    {r.context && <span className="block truncate text-[11px] text-muted-foreground">{r.context}</span>}
                  </span>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                    {KIND_LABEL[r.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────

export interface MindMapToolbarProps {
  modeSwitch?: React.ReactNode;
  onAddIdea: () => void;
  onAddShape: (kind: PlaceholderKind) => void;
  connectMode: boolean;
  onToggleConnect: () => void;
  onTidyUp: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitView: () => void;
  find: MindMapFindProps;
  onExportPng: () => void;
  onExportJson: () => void;
  hiddenLinkCount: number;
  onRestoreLinks: () => void;
  canClearPlaceholders: boolean;
  onClearPlaceholders: () => void;
  onResetLayout: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  onShowShortcuts: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export const MindMapToolbar: React.FC<MindMapToolbarProps> = (p) => {
  const mod = modKeyLabel();
  const shapeItem = (kind: PlaceholderKind, icon: React.ReactNode, title: string, desc: string) => (
    <DropdownMenuItem onSelect={() => p.onAddShape(kind)} className="items-start gap-2.5 py-2">
      <span className="mt-0.5 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="flex flex-col">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[12px] text-muted-foreground">{desc}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <div
      role="toolbar"
      aria-label="Mind map tools"
      className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85"
    >
      {p.modeSwitch}
      {p.modeSwitch && <Divider />}

      {/* Add idea — split button */}
      <div className="inline-flex items-center">
        <button
          type="button"
          onClick={p.onAddIdea}
          title="Add idea (N)"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-l-lg bg-primary pl-2.5 pr-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 [@media(pointer:coarse)]:h-10',
            '[&_svg]:h-4 [&_svg]:w-4',
            PRESSABLE,
          )}
        >
          <Plus aria-hidden />
          Add idea
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More shapes"
              title="More shapes"
              className={cn(
                'inline-flex h-8 w-7 items-center justify-center rounded-r-lg border-l border-primary-foreground/20 bg-primary text-primary-foreground hover:bg-primary/90 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-9',
                PRESSABLE,
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={p.onAddIdea} className="items-start gap-2.5 py-2">
              <span className="mt-0.5 text-muted-foreground"><Lightbulb className="h-4 w-4" /></span>
              <span className="flex flex-1 flex-col">
                <span className="text-[13px] font-medium">Idea</span>
                <span className="text-[12px] text-muted-foreground">A free-form note you can link to anything</span>
              </span>
              <DropdownMenuShortcut>N</DropdownMenuShortcut>
            </DropdownMenuItem>
            {shapeItem('task', <CheckSquare />, 'Task card', 'Looks like a task — with notes, subtasks and files')}
            {shapeItem('column', <Columns />, 'Column', 'Looks like a board column')}
            {shapeItem('project', <Sparkles />, 'Project header', 'A header card for a group of ideas')}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11.5px] font-normal text-muted-foreground">
              Placeholders only — the board isn’t changed
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        className={toolBtn({ active: p.connectMode })}
        onClick={p.onToggleConnect}
        aria-pressed={p.connectMode}
        title={p.connectMode ? 'Cancel connecting (Esc)' : 'Connect — click one card, then another (C)'}
      >
        <Link2 aria-hidden />
        <span className="hidden md:inline">{p.connectMode ? 'Cancel' : 'Connect'}</span>
        <span className="sr-only md:hidden">{p.connectMode ? 'Cancel connecting' : 'Connect'}</span>
      </button>
      <button
        type="button"
        className={toolBtn()}
        onClick={p.onTidyUp}
        title={`Tidy up — re-arrange the map neatly (undo with ${mod}+Z)`}
      >
        <LayoutGrid aria-hidden />
        <span className="hidden md:inline">Tidy up</span>
        <span className="sr-only md:hidden">Tidy up</span>
      </button>

      <Divider />
      <button
        type="button"
        className={toolBtn({ icon: true })}
        onClick={p.onUndo}
        disabled={!p.canUndo}
        aria-label="Undo"
        title={`Undo (${mod}+Z)`}
      >
        <Undo2 aria-hidden />
      </button>
      <button
        type="button"
        className={toolBtn({ icon: true })}
        onClick={p.onRedo}
        disabled={!p.canRedo}
        aria-label="Redo"
        title={`Redo (${mod}+Shift+Z)`}
      >
        <Redo2 aria-hidden />
      </button>

      <Divider />
      <div className="inline-flex items-center" role="group" aria-label="Zoom">
        <button type="button" className={toolBtn({ icon: true })} onClick={p.onZoomOut} aria-label="Zoom out" title={`Zoom out (${mod}+−)`}>
          <Minus aria-hidden />
        </button>
        <button
          type="button"
          className={cn(toolBtn(), 'w-14 px-0 tabular-nums')}
          onClick={p.onZoomReset}
          aria-label={`Zoom ${Math.round(p.zoom * 100)}% — reset to 100%`}
          title="Reset zoom to 100%"
        >
          {Math.round(p.zoom * 100)}%
        </button>
        <button type="button" className={toolBtn({ icon: true })} onClick={p.onZoomIn} aria-label="Zoom in" title={`Zoom in (${mod}+=)`}>
          <Plus aria-hidden />
        </button>
        <button type="button" className={toolBtn({ icon: true })} onClick={p.onFitView} aria-label="Fit to screen" title={`Fit to screen (${mod}+0)`}>
          <Scan aria-hidden />
        </button>
      </div>

      <Divider />
      <MindMapFind {...p.find} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={toolBtn({ icon: true })} aria-label="More options" title="More options">
            <MoreHorizontal aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={p.onExportPng}>
            <Image className="mr-2 h-4 w-4" aria-hidden /> Export PNG
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={p.onExportJson}>
            <FileJson className="mr-2 h-4 w-4" aria-hidden /> Export JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {p.hiddenLinkCount > 0 && (
            <DropdownMenuItem onSelect={p.onRestoreLinks}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Restore hidden links ({p.hiddenLinkCount})
            </DropdownMenuItem>
          )}
          <DropdownMenuCheckboxItem checked={p.showMiniMap} onCheckedChange={p.onToggleMiniMap}>
            <MapIcon className="mr-2 h-4 w-4" aria-hidden /> Show minimap
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={p.onClearPlaceholders} disabled={!p.canClearPlaceholders}>
            <Eraser className="mr-2 h-4 w-4" aria-hidden /> Clear placeholders…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={p.onResetLayout}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Reset layout…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={p.onShowShortcuts}>
            <Keyboard className="mr-2 h-4 w-4" aria-hidden /> Keyboard shortcuts
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        className={toolBtn({ icon: true })}
        onClick={p.onToggleFullscreen}
        aria-pressed={p.isFullscreen}
        aria-label={p.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        title={p.isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {p.isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
      </button>
    </div>
  );
};
