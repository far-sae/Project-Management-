import React from 'react';
import { HelpCircle, Lightbulb, Plus, Wand2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRESSABLE, modKeyLabel } from './MindMapToolbar';

// ─────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ─────────────────────────────────────────────────────────────

export const shortcutList = (mod: string): Array<[string, string]> => [
  ['N', 'Add idea'],
  ['Tab', 'Add connected idea to the selected card'],
  ['Enter', 'Add idea below the selected idea'],
  ['F2 / double-click', 'Rename idea'],
  ['Del / Backspace', 'Delete selected ideas or links'],
  ['C', 'Connect two cards'],
  ['Esc', 'Stop editing / clear selection'],
  [`${mod}+Z`, 'Undo'],
  [`${mod}+Shift+Z`, 'Redo'],
  [`${mod}+F`, 'Find on map'],
  [`${mod}+= / ${mod}+−`, 'Zoom in / out'],
  [`${mod}+0`, 'Fit to screen'],
  ['Shift + drag', 'Select several cards'],
  ['?', 'Show shortcuts'],
];

export const ShortcutsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const mod = modKeyLabel();
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="absolute bottom-14 left-3 z-20 w-[300px] max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold">Keyboard shortcuts</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close shortcuts"
          title="Close (Esc)"
          className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground', PRESSABLE)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="space-y-1.5 text-[12.5px]">
        {shortcutList(mod).map(([key, desc]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{desc}</dt>
            <dd>
              <kbd className="whitespace-nowrap rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                {key}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export const HelpButton: React.FC<{ open: boolean; onToggle: () => void }> = ({ open, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label="Keyboard shortcuts and help"
    aria-expanded={open}
    title="Shortcuts & help (?)"
    className={cn(
      'absolute bottom-3 left-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10',
      PRESSABLE,
    )}
  >
    <HelpCircle className="h-4 w-4" />
  </button>
);

// ─────────────────────────────────────────────────────────────
// First-time tip
// ─────────────────────────────────────────────────────────────

export const TIP_STORAGE_KEY = 'mindmap_tip_dismissed_v1';

export const readTipDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(TIP_STORAGE_KEY) === '1';
  } catch {
    return true; // storage blocked → don't nag
  }
};

export const writeTipDismissed = () => {
  try {
    window.localStorage.setItem(TIP_STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
};

export const FirstTimeTip: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <div
    role="status"
    className="absolute bottom-14 left-3 z-10 w-[300px] max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
  >
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
        <Lightbulb className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        <p className="font-semibold text-foreground">Quick tip</p>
        <p className="text-muted-foreground">
          Select any card and press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px] text-foreground">Tab</kbd> to
          branch off an idea. Double-click an idea to rename it. Press{' '}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px] text-foreground">?</kbd> for all shortcuts.
        </p>
      </div>
    </div>
    <div className="mt-2 flex justify-end">
      <button
        type="button"
        onClick={onDismiss}
        className={cn('inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium text-foreground hover:bg-muted', PRESSABLE)}
      >
        Got it
      </button>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────

export const MindMapEmptyState: React.FC<{ onAddIdea: () => void; onOpenAI: () => void }> = ({
  onAddIdea,
  onOpenAI,
}) => (
  <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-4">
    <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
      <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
        <Lightbulb className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-base font-semibold text-foreground">Map out your project</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        Your board’s columns and tasks appear here automatically. Add ideas to brainstorm around
        them — they live on the map and never change the board.
      </p>
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAddIdea}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 [@media(pointer:coarse)]:h-10',
            PRESSABLE,
          )}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add idea
        </button>
        <button
          type="button"
          onClick={onOpenAI}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-muted [@media(pointer:coarse)]:h-10',
            PRESSABLE,
          )}
        >
          <Wand2 className="h-4 w-4" aria-hidden /> Add from AI mind map
        </button>
      </div>
    </div>
  </div>
);
