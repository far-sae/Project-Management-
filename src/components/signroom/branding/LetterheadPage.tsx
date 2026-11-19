// The A4 page of the letterhead designer: everything that is printed, and the handles to move it.
import React, { useMemo, useRef } from 'react';
import {
  elementText, fitLetterheadText, templateDecorations,
} from '../../../../api/_signroom/shared/letterhead';
import type {
  Branding, LetterheadDesign, LetterheadElement, LetterheadTextBox,
} from '../../../../api/_signroom/shared/types';
import {
  ELEMENTS, ITEM_LABELS, PAPER, arrowStep, fontStack, hasText, itemOf, moveItem, pageScale, patchItem, placeOnPage,
  pointsMoved, resizeItem, sizeOnPage, textMeasurer, type ElementId, type Frame, type Picked,
} from '@/lib/signroom/letterhead';
import { cn } from '@/lib/utils';
import type { DesignHistory } from './useDesignHistory';

interface Props {
  brand: Branding;
  design: LetterheadDesign;
  history: DesignHistory;
  picked: Picked;
  onPick: (picked: Picked) => void;
  /** Double-click or Enter on an item with words: the designer puts the cursor in its words box. */
  onEditWords: (picked: Picked) => void;
  /** Dragging moves in steps of the grid. */
  snap: boolean;
  disabled?: boolean;
  /** The person's own letterhead page as a picture. */
  backgroundUrl?: string | null;
  /** Their PDF is printed as it is: none of the items are drawn over it. */
  artworkOnly?: boolean;
  /** The paragraph that explains the keys, read out with each item. */
  hintId: string;
}

type Drag = { picked: Picked; mode: 'move' | 'resize'; x: number; y: number; scale: number; start: Frame; before: LetterheadDesign };

const samePick = (a: Picked, b: Picked) => a.kind === b.kind && a.id === b.id;
const ITEM = 'absolute touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';
const GUIDE_CHIP = 'pointer-events-none absolute right-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground';
/** The sample body's ink and the grey of its stand-in lines: document colours, the same in light and dark. */
const BODY_INK = '#243536';
const BODY_LINE = '#e6e9e4';
const BODY_LINES = [80, 94, 87, 70, 91, 83, 65];
/** A non-breaking space, so an empty line keeps its height. */
const NBSP = String.fromCharCode(160);

export const LetterheadPage: React.FC<Props> = ({
  brand, design, history, picked, onPick, onEditWords, snap, disabled, backgroundUrl, artworkOnly, hintId,
}) => {
  const paper = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // The newest design, even between two pointer moves that arrive before the next render.
  const live = useRef(design);
  live.current = design;
  const measure = useMemo(() => {
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      // No canvas here: text is measured by a rule of thumb instead.
    }
    return textMeasurer(context);
  }, []);

  const begin = (event: React.PointerEvent<HTMLElement>, target: Picked, mode: Drag['mode']) => {
    const start = itemOf(live.current, target);
    if (disabled || event.button !== 0 || !start) return;
    event.stopPropagation();
    onPick(target);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      picked: target, mode, x: event.clientX, y: event.clientY, start, before: live.current,
      scale: pageScale(paper.current?.getBoundingClientRect().width ?? 0),
    };
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const held = drag.current;
    if (!held) return;
    const dx = pointsMoved(event.clientX - held.x, held.scale, snap);
    const dy = pointsMoved(event.clientY - held.y, held.scale, snap);
    const next = held.mode === 'move'
      ? moveItem(live.current, held.picked, held.start, dx, dy)
      : resizeItem(live.current, held.picked, held.start, dx, dy);
    history.preview(next);
    live.current = next;
  };
  const end = () => {
    if (!drag.current) return;
    history.settle(drag.current.before);
    drag.current = null;
  };

  const keyOnItem = (event: React.KeyboardEvent<HTMLElement>, target: Picked, words: boolean) => {
    if (event.target !== event.currentTarget) return;
    const item = itemOf(live.current, target);
    if (disabled || !item) return;
    const style = ({ b: 'bold', i: 'italic', u: 'underline' } as const)[event.key.toLowerCase() as 'b' | 'i' | 'u'];
    if ((event.ctrlKey || event.metaKey) && style && words) {
      event.preventDefault();
      history.commit(patchItem(live.current, target, { [style]: !item[style] }));
      return;
    }
    if (event.key === 'Enter' && words) {
      event.preventDefault();
      onEditWords(target);
      return;
    }
    const step = arrowStep(event.key, event.shiftKey);
    if (!step) return;
    event.preventDefault();
    history.commit(moveItem(live.current, target, item, step[0], step[1]));
  };
  const keyOnHandle = (event: React.KeyboardEvent<HTMLElement>, target: Picked) => {
    const item = itemOf(live.current, target);
    const step = arrowStep(event.key, event.shiftKey);
    if (disabled || !item || !step) return;
    event.preventDefault();
    history.commit(resizeItem(live.current, target, item, step[0], step[1]));
  };

  /** What every item on the page shares: its place, selection, and the pointer and key handling. */
  const itemProps = (target: Picked, frame: Frame, label: string, words: boolean) => {
    const selected = samePick(picked, target);
    return {
      role: 'button',
      tabIndex: 0,
      'aria-label': `${label} on the page`,
      'aria-pressed': selected,
      'aria-describedby': hintId,
      'aria-disabled': disabled || undefined,
      className: cn(
        ITEM,
        disabled ? 'cursor-default' : 'cursor-move',
        selected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50',
      ),
      style: placeOnPage(frame),
      onFocus: () => onPick(target),
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => begin(event, target, 'move'),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      onDoubleClick: () => { if (words && !disabled) onEditWords(target); },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => keyOnItem(event, target, words),
    };
  };

  /** The round handle at the bottom-right corner of the selected item. */
  const handle = (target: Picked, frame: Frame, label: string) => {
    if (disabled || !samePick(picked, target)) return null;
    const corner = placeOnPage({ x: frame.x + frame.width, y: frame.y + frame.height, width: 0, height: 0 });
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Resize ${label}`}
        aria-describedby={hintId}
        className="absolute z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize touch-none rounded-full border-2 border-background bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        style={{ left: corner.left, top: corner.top }}
        onPointerDown={(event) => begin(event, target, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => keyOnHandle(event, target)}
      />
    );
  };

  const textStyle = (item: LetterheadElement, size: number): React.CSSProperties => ({
    fontSize: sizeOnPage(size),
    lineHeight: 1.25,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? 'italic' : 'normal',
    textDecoration: item.underline ? 'underline' : 'none',
    fontFamily: fontStack(item.fontFamily || brand.fontFamily),
    color: item.color,
    textAlign: item.align,
  });

  /** Words fitted to their box the way the PDF fits them: wrapped, then shrunk until they fit. */
  const words = (value: string, item: LetterheadElement, placeholder: string) => {
    const family = item.fontFamily || brand.fontFamily;
    const fitted = fitLetterheadText(value, item, (text, size) => measure(text, size, family, item.bold, item.italic));
    return (
      <div data-text className="h-full w-full overflow-hidden whitespace-pre" style={textStyle(item, fitted.size)}>
        {value
          ? fitted.lines.map((line, n) => <div key={n}>{line || NBSP}</div>)
          : <span style={{ opacity: 0.45 }}>{placeholder}</span>}
      </div>
    );
  };

  const element = (id: ElementId) => {
    const item = design.elements[id];
    if (!item.visible) return null;
    const target: Picked = { kind: 'element', id };
    const label = ITEM_LABELS[id];
    let inside: React.ReactNode;
    if (id === 'logo') {
      inside = brand.logo ? (
        <img
          src={brand.logo} alt="" draggable={false} className="h-full w-full object-contain"
          style={{ objectPosition: `${item.align} top` }}
        />
      ) : (
        // No logo yet: its place is only marked while it is selected, so it does not sit over the company name.
        samePick(picked, target) && <span className="block" style={{ fontSize: sizeOnPage(9), color: BODY_INK, opacity: 0.45 }}>Logo goes here</span>
      );
    } else if (id === 'rule') {
      inside = <div className="h-full w-full" style={{ background: item.color }} />;
    } else {
      inside = words(elementText(id, brand), item, label);
    }
    return (
      <React.Fragment key={id}>
        <div {...itemProps(target, item, label, hasText(id))}>{inside}</div>
        {handle(target, item, label)}
      </React.Fragment>
    );
  };

  const textBox = (box: LetterheadTextBox) => {
    if (!box.visible) return null;
    const target: Picked = { kind: 'box', id: box.id };
    const name = `"${box.text.slice(0, 30)}"`;
    return (
      <React.Fragment key={box.id}>
        <div {...itemProps(target, box, `Text box ${name}`, true)}>{words(box.text, box, 'Empty text box')}</div>
        {handle(target, box, `text box ${name}`)}
      </React.Fragment>
    );
  };

  const share = (points: number) => `${(points / PAPER.height) * 100}%`;

  return (
    <div
      ref={paper}
      role="group"
      aria-label="Letterhead page"
      className="relative isolate w-full overflow-hidden rounded-md border border-border"
      style={{ aspectRatio: `${PAPER.width} / ${PAPER.height}`, background: '#ffffff', containerType: 'inline-size' }}
    >
      {backgroundUrl && (
        <img src={backgroundUrl} alt="Your letterhead PDF" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
      )}
      {!artworkOnly && (
        <>
          {design.accent && (
            <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: share(6), background: brand.color }} />
          )}
          <svg viewBox={`0 0 ${PAPER.width} ${PAPER.height}`} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
            {templateDecorations(design, brand.color, brand.secondaryColor).map((shape, n) => (shape.points
              ? <polygon key={n} points={shape.points.map((point) => point.join(',')).join(' ')} fill={shape.color} />
              : <rect key={n} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} />))}
          </svg>
        </>
      )}

      {/* A stand-in for the document itself, between the header and the footer. */}
      <div
        aria-hidden
        className="pointer-events-none absolute overflow-hidden"
        style={{
          left: '8%', right: '8%', top: share(design.headerHeight + 34), bottom: share(design.footerHeight + 16),
          color: BODY_INK, fontFamily: fontStack(brand.fontFamily), fontSize: sizeOnPage(brand.fontSize),
          fontWeight: brand.bodyBold ? 700 : 400, fontStyle: brand.bodyItalic ? 'italic' : 'normal',
        }}
      >
        <div style={{ fontSize: sizeOnPage(22), marginBottom: sizeOnPage(10) }}>Your document title</div>
        <div style={{ marginBottom: sizeOnPage(14) }}>Your agreement, invoice or receipt is written here.</div>
        {BODY_LINES.map((width, n) => (
          <div key={n} style={{ width: `${width}%`, height: sizeOnPage(6), marginBottom: sizeOnPage(12), background: BODY_LINE }} />
        ))}
      </div>

      {/* Guides: where the header ends and the footer starts. They are not printed. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-primary/60" style={{ height: share(design.headerHeight) }}>
        <span className={cn(GUIDE_CHIP, 'bottom-0 translate-y-full')}>Header ends</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-primary/60" style={{ height: share(design.footerHeight) }}>
        <span className={cn(GUIDE_CHIP, 'top-0 -translate-y-full')}>Footer starts</span>
      </div>

      {!artworkOnly && (
        <>
          {ELEMENTS.map(element)}
          {(design.textBoxes ?? []).map(textBox)}
        </>
      )}
    </div>
  );
};

export default LetterheadPage;
