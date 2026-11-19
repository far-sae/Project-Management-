/**
 * The letterhead designer's rules, with no screen in them: where an item may
 * sit on the page, how a drag in pixels becomes page points, and the design
 * as the documents server accepts it.
 *
 * Everything is measured in PDF points on an A4 page (595.28 by 841.89).
 */
import { documentFont, type DocumentFont } from '../../../api/_signroom/shared/documentFonts';
import {
  BRAND_TEMPLATES, ELEMENTS, PAPER, constrainElement, presetDesign, type ElementId,
} from '../../../api/_signroom/shared/letterhead';
import type {
  Branding, LetterheadDesign, LetterheadElement, LetterheadTextBox,
} from '../../../api/_signroom/shared/types';

export { ELEMENTS, PAPER };
export type { ElementId };

/** Dragging snaps to this many points when snapping is on. */
export const GRID = 4;
/** Nothing may sit closer to the page edge than this. */
export const EDGE = 16;
/** Where "move to the left margin" and "move to the right margin" put an item. */
export const MARGIN = 42;
export const MAX_TEXT_BOXES = 12;
export const TEXT_BOX_MAX_CHARS = 1000;
export const HEADER_HEIGHT = { min: 110, max: 240 } as const;
export const FOOTER_HEIGHT = { min: 48, max: 100 } as const;
export const TEXT_SIZE = { min: 8, max: 48 } as const;

/** One thing on the page: a built-in item (logo, company name…) or a text box the person added. */
export type Picked = { kind: 'element'; id: ElementId } | { kind: 'box'; id: string };
export type Frame = Pick<LetterheadElement, 'x' | 'y' | 'width' | 'height'>;

/** What each built-in item is called on screen. */
export const ITEM_LABELS: Record<ElementId, string> = {
  logo: 'Company logo',
  companyName: 'Company name',
  address: 'Address',
  identifiers: 'Registration and tax details',
  rule: 'Dividing line',
  footer: 'Footer',
  pageNumber: 'Page number',
};

/** The built-in items that hold words (the logo and the dividing line do not). */
export const hasText = (id: ElementId): boolean => id !== 'logo' && id !== 'rule';

/** The plain layouts, then the ready-made designs with their artwork. */
export const DESIGNS: ReadonlyArray<{ id: string; name: string; description: string }> = [
  { id: 'classic', name: 'Classic', description: 'Logo on the left with a coloured strip and rule' },
  { id: 'right', name: 'Logo on the right', description: 'Company details on the left, logo on the right' },
  { id: 'centered', name: 'Centred', description: 'Logo, name and address in the middle' },
  { id: 'minimal', name: 'Minimal', description: 'Plain header with no coloured strip or rule' },
  ...BRAND_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

// ---------------------------------------------------------------- screen and page units

/** Pixels per point for a page drawn this many pixels wide. */
export const pageScale = (pageWidthPx: number): number => (pageWidthPx > 0 ? pageWidthPx / PAPER.width : 1);

/** A drag of so many pixels, in points: on the grid when snapping, otherwise to a tenth of a point. */
export function pointsMoved(pixels: number, scale: number, snap: boolean): number {
  const points = pixels / scale;
  return snap ? Math.round(points / GRID) * GRID : Math.round(points * 10) / 10;
}

/** Where an item sits, as percentages of the page, so it follows the page at any width. */
export function placeOnPage(frame: Frame): { left: string; top: string; width: string; height: string } {
  return {
    left: `${round4((frame.x / PAPER.width) * 100)}%`,
    top: `${round4((frame.y / PAPER.height) * 100)}%`,
    width: `${round4((frame.width / PAPER.width) * 100)}%`,
    height: `${round4((frame.height / PAPER.height) * 100)}%`,
  };
}

/** A length in points as a share of the page's width (the page is a CSS size container). */
export const sizeOnPage = (points: number): string => `${round4((points / PAPER.width) * 100)}cqw`;

/** How far an arrow key moves an item: one point, or ten with Shift. Null for any other key. */
export function arrowStep(key: string, shift: boolean): [number, number] | null {
  const step = shift ? 10 : 1;
  if (key === 'ArrowLeft') return [-step, 0];
  if (key === 'ArrowRight') return [step, 0];
  if (key === 'ArrowUp') return [0, -step];
  if (key === 'ArrowDown') return [0, step];
  return null;
}

// ---------------------------------------------------------------- where items may sit

const inFooter = (id: ElementId) => id === 'footer' || id === 'pageNumber';
const alwaysShown = (id: ElementId) => id === 'logo' || id === 'companyName';

/** The band a built-in item must stay inside: the header, or the footer for the footer text and page number. */
export function zoneOf(id: ElementId, design: Pick<LetterheadDesign, 'headerHeight' | 'footerHeight'>): { top: number; bottom: number } {
  return inFooter(id)
    ? { top: PAPER.height - design.footerHeight + 5, bottom: PAPER.height - 18 }
    : { top: 12, bottom: design.headerHeight };
}

/** A text box may sit anywhere on the page, a margin in from every edge. */
export function constrainTextBox<T extends Frame>(box: T): T {
  const width = clamp(box.width, 20, PAPER.width - 2 * EDGE);
  const height = clamp(box.height, 12, 240);
  return {
    ...box,
    width,
    height,
    x: clamp(box.x, EDGE, Math.min(PAPER.width - 36, PAPER.width - EDGE - width)),
    y: clamp(box.y, EDGE, Math.min(PAPER.height - 30, PAPER.height - EDGE - height)),
  };
}

export function itemOf(design: LetterheadDesign, picked: Picked): LetterheadElement | LetterheadTextBox | undefined {
  return picked.kind === 'element' ? design.elements[picked.id] : design.textBoxes?.find((b) => b.id === picked.id);
}

/** The design with one item changed, pulled back to where it is allowed to be. */
export function patchItem(design: LetterheadDesign, picked: Picked, patch: Partial<LetterheadTextBox>): LetterheadDesign {
  const tidy = <T extends LetterheadElement>(item: T): T => ({
    ...item,
    fontSize: clamp(item.fontSize, TEXT_SIZE.min, TEXT_SIZE.max),
  });
  if (picked.kind === 'element') {
    const { id: _id, text: _text, ...style } = patch;
    const next = constrainElement(picked.id, tidy({ ...design.elements[picked.id], ...style }), design);
    if (alwaysShown(picked.id)) next.visible = true;
    return { ...design, elements: { ...design.elements, [picked.id]: next } };
  }
  const { id: _id, ...change } = patch;
  return {
    ...design,
    textBoxes: (design.textBoxes ?? []).map((box) => {
      if (box.id !== picked.id) return box;
      const next = constrainTextBox(tidy({ ...box, ...change }));
      return { ...next, text: next.text.slice(0, TEXT_BOX_MAX_CHARS) };
    }),
  };
}

/** Moves an item from where it started by so many points. */
export function moveItem(design: LetterheadDesign, picked: Picked, start: Frame, dx: number, dy: number): LetterheadDesign {
  return patchItem(design, picked, { x: start.x + dx, y: start.y + dy });
}

/** Resizes an item from its bottom-right corner: the top-left corner stays where it is. */
export function resizeItem(design: LetterheadDesign, picked: Picked, start: Frame, dw: number, dh: number): LetterheadDesign {
  const bottom = picked.kind === 'element' ? zoneOf(picked.id, design).bottom : PAPER.height - EDGE;
  return patchItem(design, picked, {
    width: Math.min(start.width + dw, PAPER.width - EDGE - start.x),
    height: Math.min(start.height + dh, bottom - start.y),
  });
}

/** Changes the header or footer height and pulls back any item that no longer fits in it. */
export function setZone(design: LetterheadDesign, key: 'headerHeight' | 'footerHeight', value: number): LetterheadDesign {
  const range = key === 'headerHeight' ? HEADER_HEIGHT : FOOTER_HEIGHT;
  const next: LetterheadDesign = { ...design, [key]: clamp(value, range.min, range.max) };
  const elements = { ...next.elements };
  for (const id of ELEMENTS) elements[id] = constrainElement(id, elements[id], next);
  return { ...next, elements };
}

// ---------------------------------------------------------------- text boxes

/** A new text box, near the bottom of the header. Nothing is added once there are twelve. */
export function addTextBox(design: LetterheadDesign, id: string, fontFamily: DocumentFont): LetterheadDesign {
  const boxes = design.textBoxes ?? [];
  if (boxes.length >= MAX_TEXT_BOXES) return design;
  const box: LetterheadTextBox = {
    id, text: 'Your text', x: MARGIN, y: design.headerHeight - 28, width: 240, height: 24, fontSize: 12, fontFamily,
    color: '#243536', align: 'left', visible: true,
  };
  return { ...design, textBoxes: [...boxes, box] };
}

export function removeTextBox(design: LetterheadDesign, id: string): LetterheadDesign {
  return { ...design, textBoxes: (design.textBoxes ?? []).filter((box) => box.id !== id) };
}

/** A name for a new text box that the server accepts (letters, digits, hyphens). */
export function newTextBoxId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `box-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// ---------------------------------------------------------------- designs

/** A plain layout or ready-made design for this company, keeping the text boxes the person added. */
export function applyDesign(name: string, brand: Branding, current: LetterheadDesign): LetterheadDesign {
  const next = presetDesign(name, brand);
  return current.textBoxes?.length ? { ...next, textBoxes: current.textBoxes } : next;
}

/** After the brand colour changes: the rule, and any item that was in the old brand colour, follow it. */
export function recolourDesign(design: LetterheadDesign, from: string, to: string): LetterheadDesign {
  const elements = { ...design.elements };
  for (const id of ELEMENTS) {
    if (id === 'rule' || elements[id].color.toLowerCase() === from.toLowerCase()) elements[id] = { ...elements[id], color: to };
  }
  return { ...design, elements };
}

const FLOWED: ElementId[] = ['logo', 'companyName', 'address'];
const sameFrame = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Every layout puts the company name beside the logo when there is one, and
 * across the page when there is not. When a logo is added or removed and the
 * person has not moved those items, they are put where the layout wants them.
 */
export function reflowForLogo(design: LetterheadDesign, before: Branding, after: Branding): LetterheadDesign {
  if (!!before.logo === !!after.logo) return design;
  for (const { id: name } of DESIGNS) {
    const was = presetDesign(name, before);
    if (!FLOWED.every((id) => sameFrame(design.elements[id], was.elements[id]))) continue;
    const now = presetDesign(name, after);
    const elements = { ...design.elements };
    for (const id of FLOWED) {
      const { x, y, width, height } = now.elements[id];
      elements[id] = { ...elements[id], x, y, width, height };
    }
    return { ...design, elements };
  }
  return design;
}

/**
 * The design as it is sent to the server: positions to a hundredth of a
 * point, and anything the server would refuse (an item outside its band, a
 * text size out of range, a hidden logo) put right first.
 */
export function savedDesign(design: LetterheadDesign): LetterheadDesign {
  const headerHeight = clamp(round2(design.headerHeight), HEADER_HEIGHT.min, HEADER_HEIGHT.max);
  const footerHeight = clamp(round2(design.footerHeight), FOOTER_HEIGHT.min, FOOTER_HEIGHT.max);
  const zones = { ...design, headerHeight, footerHeight };
  const rounded = <T extends LetterheadElement>(item: T): T => ({
    ...item,
    x: round2(item.x),
    y: round2(item.y),
    width: round2(item.width),
    height: round2(item.height),
    fontSize: clamp(round2(item.fontSize), TEXT_SIZE.min, TEXT_SIZE.max),
  });
  const elements = {} as LetterheadDesign['elements'];
  for (const id of ELEMENTS) {
    // Rounded first, then held in its band: the band's edges are worked out exactly as the server does.
    const held = constrainElement(id, rounded(design.elements[id]), zones);
    elements[id] = { ...held, x: Math.min(held.x, PAPER.width - 36), visible: alwaysShown(id) ? true : held.visible };
  }
  // Written out in full, as the server stores a text box.
  const textBoxes = (design.textBoxes ?? []).slice(0, MAX_TEXT_BOXES).map((box) => ({
    ...constrainTextBox(rounded(box)),
    text: box.text.slice(0, TEXT_BOX_MAX_CHARS),
    visible: box.visible !== false,
    bold: !!box.bold,
    italic: !!box.italic,
    underline: !!box.underline,
  }));
  return {
    version: 1,
    ...(textBoxes.length ? { textBoxes } : {}),
    headerHeight,
    footerHeight,
    accent: !!design.accent,
    elements,
    ...(design.template ? { template: design.template } : {}),
  };
}

// ---------------------------------------------------------------- text on the page

const FALLBACK_FONTS: Record<DocumentFont, string> = {
  instrument: '"Instrument Sans", Inter, system-ui, sans-serif',
  inter: 'Inter, system-ui, sans-serif',
  lora: 'Lora, Georgia, serif',
  'source-serif': '"Source Serif 4", Georgia, serif',
  mono: '"Roboto Mono", ui-monospace, monospace',
};

/** The document font by its PDF name, then the nearest font a browser is sure to have. */
export function fontStack(id: string | undefined): string {
  const font = documentFont(id);
  return `${font.css}, ${FALLBACK_FONTS[font.id]}`;
}

export type Measure = (text: string, size: number, family?: string, bold?: boolean, italic?: boolean) => number;

/** Measures a line of text in points: with the browser when it can, by a rule of thumb when it cannot. */
export function textMeasurer(context: CanvasRenderingContext2D | null): Measure {
  return (text, size, family, bold = false, italic = false) => {
    if (!context) return text.length * size * 0.52;
    context.font = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${fontStack(family)}`;
    return context.measureText(text).width;
  };
}
