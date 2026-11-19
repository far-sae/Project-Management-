// Undo and redo for the letterhead design.
import { useRef, useState } from 'react';
import type { LetterheadDesign } from '../../../../api/_signroom/shared/types';

const STEPS_KEPT = 40;
const same = (a: LetterheadDesign, b: LetterheadDesign) => JSON.stringify(a) === JSON.stringify(b);

export interface DesignHistory {
  /** A finished change: one step that Undo takes back. */
  commit: (next: LetterheadDesign) => void;
  /** A change while dragging: shown at once, but not yet a step. */
  preview: (next: LetterheadDesign) => void;
  /** The drag has ended: one step back to how the design was before it, if anything moved. */
  settle: (before: LetterheadDesign) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Keeps the steps taken on a design that lives in the page's own form, so
 * they survive moving between the sections of the page.
 */
export function useDesignHistory(design: LetterheadDesign, setDesign: (next: LetterheadDesign) => void): DesignHistory {
  const [past, setPast] = useState<LetterheadDesign[]>([]);
  const [future, setFuture] = useState<LetterheadDesign[]>([]);
  // The newest design, even between two changes made before the next render.
  const live = useRef(design);
  live.current = design;

  const show = (next: LetterheadDesign) => {
    live.current = next;
    setDesign(next);
  };
  const remember = (before: LetterheadDesign) => {
    setPast((steps) => [...steps, before].slice(-STEPS_KEPT));
    setFuture([]);
  };

  return {
    commit: (next) => {
      if (same(next, live.current)) return;
      remember(live.current);
      show(next);
    },
    preview: show,
    settle: (before) => {
      if (!same(before, live.current)) remember(before);
    },
    undo: () => {
      const previous = past[past.length - 1];
      if (!previous) return;
      const current = live.current;
      setFuture((steps) => [current, ...steps]);
      setPast((steps) => steps.slice(0, -1));
      show(previous);
    },
    redo: () => {
      const next = future[0];
      if (!next) return;
      const current = live.current;
      setPast((steps) => [...steps, current].slice(-STEPS_KEPT));
      setFuture((steps) => steps.slice(1));
      show(next);
    },
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
