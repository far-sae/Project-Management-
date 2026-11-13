import { useCallback, useEffect, useState, type RefObject } from 'react';

const EDGE = 4;

/**
 * Whether a scroll area has more content above / below the visible part,
 * kept up to date as it scrolls, resizes or gains items. `scrollDown`
 * moves most of a screen so people without a scroll wheel can page through.
 */
export function useScrollEdges(ref: RefObject<HTMLElement>) {
  const [edges, setEdges] = useState({ canScrollUp: false, canScrollDown: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const canScrollUp = el.scrollTop > EDGE;
    const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE;
    setEdges((prev) =>
      prev.canScrollUp === canScrollUp && prev.canScrollDown === canScrollDown
        ? prev
        : { canScrollUp, canScrollDown },
    );
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    resize?.observe(el);
    const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
    mutations?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [ref, update]);

  const scrollBy = useCallback(
    (direction: 1 | -1) => {
      const el = ref.current;
      if (!el) return;
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollBy({ top: direction * Math.round(el.clientHeight * 0.8), behavior: reduce ? 'auto' : 'smooth' });
    },
    [ref],
  );

  return {
    ...edges,
    scrollDown: useCallback(() => scrollBy(1), [scrollBy]),
    scrollUp: useCallback(() => scrollBy(-1), [scrollBy]),
  };
}
