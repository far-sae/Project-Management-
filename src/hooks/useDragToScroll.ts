import { useEffect, useState } from 'react';

/** Movement (px) before a press becomes a pan, so ordinary clicks still work. */
const THRESHOLD = 5;

/** Things that keep their own press behaviour: cards (dnd-kit), controls, text. */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="button"], [role="menuitem"], [contenteditable=""], [contenteditable="true"], [aria-roledescription="sortable"], [data-no-pan]';

/** True when the press landed on `el`'s own scrollbar rather than its content. */
function onScrollbar(el: Element, x: number, y: number): boolean {
  const html = el as HTMLElement;
  if (!html.clientWidth && !html.clientHeight) return false;
  const r = el.getBoundingClientRect();
  return (
    (html.clientWidth > 0 && x > r.left + html.clientLeft + html.clientWidth) ||
    (html.clientHeight > 0 && y > r.top + html.clientTop + html.clientHeight)
  );
}

/**
 * Click-and-drag on empty space to slide a scroll container (like Trello).
 * Helps people on a laptop touchpad, where scrolling a wide board sideways
 * is awkward. Presses on cards, buttons and fields are left alone.
 *
 * Also: an up/down mouse wheel slides the board left/right when the pointer
 * isn't over a column that can scroll itself (headers, gaps, short columns).
 * Column lists mark themselves with `data-column-scroll`.
 *
 * Returns a callback ref, so it attaches whenever the element appears
 * (e.g. after a page finishes loading).
 */
export function useDragToScroll<T extends HTMLElement = HTMLDivElement>(): (node: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el) return;

    let start: { x: number; y: number; left: number; top: number } | null = null;
    let panning = false;
    let suppressClickUntil = 0;

    const stop = () => {
      // Swallow the click that follows a pan so it doesn't open anything.
      if (panning) suppressClickUntil = Date.now() + 300;
      start = null;
      panning = false;
      el.style.removeProperty('cursor');
      el.style.removeProperty('user-select');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    const swallowClick = (e: MouseEvent) => {
      if (Date.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!panning) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        panning = true;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }
      e.preventDefault();
      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return; // touch already scrolls natively
      const target = e.target as Element | null;
      if (!target || target.closest(INTERACTIVE)) return;
      if (onScrollbar(target, e.clientX, e.clientY)) return;
      start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      panning = false;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || e.defaultPrevented) return; // zoom / native sideways
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // touchpad sideways swipe
      if (el.scrollHeight > el.clientHeight + 1) return; // board scrolls vertically itself
      const target = e.target as Element | null;
      const list = target?.closest('[data-column-scroll]') as HTMLElement | null;
      if (list && list.scrollHeight > list.clientHeight + 1) return; // let the column scroll
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      e.preventDefault();
      el.scrollLeft += e.deltaY * unit;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', swallowClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('click', swallowClick, true);
      stop();
    };
  }, [el]);

  return setEl;
}
