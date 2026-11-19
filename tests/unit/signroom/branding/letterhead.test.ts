// The letterhead designer's rules: where an item may sit, how a drag becomes page points, what is saved.
import { describe, expect, it } from 'vitest';
import { parseDesign } from '../../../../api/_signroom/branding';
import { ELEMENTS, PAPER, presetDesign } from '../../../../api/_signroom/shared/letterhead';
import type { Branding, LetterheadDesign } from '../../../../api/_signroom/shared/types';
import {
  DESIGNS, GRID, MAX_TEXT_BOXES, addTextBox, applyDesign, arrowStep, constrainTextBox, fontStack, itemOf, moveItem,
  pageScale, patchItem, placeOnPage, pointsMoved, recolourDesign, reflowForLogo, removeTextBox, resizeItem, savedDesign,
  setZone, sizeOnPage, textMeasurer, zoneOf,
} from '@/lib/signroom/letterhead';

const brand = (over: Partial<Branding> = {}): Branding => ({
  companyName: 'Sam Studio Ltd', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: '',
  color: '#24543b', fontSize: 12, fontFamily: 'instrument', footer: 'samstudio.example', layout: 'letterhead',
  logoPosition: 'left', paymentInstructions: '', ...over,
});
const classic = (over: Partial<Branding> = {}): LetterheadDesign => presetDesign('classic', brand(over));
const name = { kind: 'element', id: 'companyName' } as const;
const footer = { kind: 'element', id: 'footer' } as const;
const box = (id: string) => ({ kind: 'box', id }) as const;

describe('Screen and page units', () => {
  it('turns the drawn width of the page into pixels per point', () => {
    expect(pageScale(PAPER.width * 2)).toBe(2);
    // Before the page has been laid out its width reads as zero: one pixel per point.
    expect(pageScale(0)).toBe(1);
  });

  it('turns a drag in pixels into points, snapped to the grid or to a tenth of a point', () => {
    expect(GRID).toBe(4);
    expect(pointsMoved(21, 2, true)).toBe(12);
    expect(pointsMoved(-9, 1, true)).toBe(-8);
    expect(pointsMoved(21, 2, false)).toBe(10.5);
    expect(pointsMoved(10, 3, false)).toBe(3.3);
  });

  it('places an item on the page as percentages, so it follows the page at any width', () => {
    expect(placeOnPage({ x: PAPER.width / 2, y: PAPER.height / 4, width: PAPER.width / 10, height: PAPER.height / 20 })).toEqual({
      left: '50%', top: '25%', width: '10%', height: '5%',
    });
    expect(sizeOnPage(PAPER.width / 50)).toBe('2cqw');
  });

  it('reads the arrow keys as one point, or ten with Shift', () => {
    expect(arrowStep('ArrowLeft', false)).toEqual([-1, 0]);
    expect(arrowStep('ArrowDown', true)).toEqual([0, 10]);
    expect(arrowStep('Enter', false)).toBeNull();
  });
});

describe('Keeping items where the server accepts them', () => {
  it('keeps a header item inside the header and a footer item inside the footer', () => {
    const d = classic();
    expect(zoneOf('companyName', d)).toEqual({ top: 12, bottom: 140 });
    expect(zoneOf('footer', d)).toEqual({ top: PAPER.height - 64 + 5, bottom: PAPER.height - 18 });
    const low = moveItem(d, name, d.elements.companyName, 0, 500).elements.companyName;
    expect(low.y).toBe(140 - low.height);
    const high = moveItem(d, footer, d.elements.footer, 0, -500).elements.footer;
    expect(high.y).toBe(PAPER.height - 64 + 5);
  });

  it('keeps an item between the left and right page edges', () => {
    const d = classic();
    expect(moveItem(d, name, d.elements.companyName, -500, 0).elements.companyName.x).toBe(16);
    const right = moveItem(d, name, d.elements.companyName, 900, 0).elements.companyName;
    expect(right.x + right.width).toBeCloseTo(PAPER.width - 16);
  });

  it('resizes from the corner without sliding the item, and never below the smallest size', () => {
    const d = classic();
    const start = d.elements.companyName;
    const wide = resizeItem(d, name, start, 2000, 2000).elements.companyName;
    expect(wide.x).toBeCloseTo(start.x);
    expect(wide.y).toBe(start.y);
    expect(wide.x + wide.width).toBeCloseTo(PAPER.width - 16);
    expect(wide.y + wide.height).toBe(140);
    const small = resizeItem(d, name, start, -2000, -2000).elements.companyName;
    expect([small.width, small.height]).toEqual([20, 12]);
  });

  it('never hides the logo or the company name, and keeps text sizes in range', () => {
    const d = classic();
    expect(patchItem(d, name, { visible: false }).elements.companyName.visible).toBe(true);
    expect(patchItem(d, { kind: 'element', id: 'address' }, { visible: false }).elements.address.visible).toBe(false);
    expect(patchItem(d, name, { fontSize: 400 }).elements.companyName.fontSize).toBe(48);
    expect(patchItem(d, name, { fontSize: 1 }).elements.companyName.fontSize).toBe(8);
  });

  it('pulls items back in when the header or footer gets smaller', () => {
    const d = classic();
    const shorter = setZone(d, 'headerHeight', 110);
    expect(shorter.headerHeight).toBe(110);
    for (const id of ['logo', 'companyName', 'address', 'identifiers', 'rule'] as const) {
      expect(shorter.elements[id].y + shorter.elements[id].height).toBeLessThanOrEqual(110);
    }
    expect(setZone(d, 'headerHeight', 900).headerHeight).toBe(240);
    expect(setZone(d, 'footerHeight', 1).footerHeight).toBe(48);
    expect(setZone(d, 'footerHeight', 80).elements.footer).toEqual(d.elements.footer);
  });
});

describe('Text boxes', () => {
  it('adds a text box in the header, up to twelve', () => {
    let d = addTextBox(classic(), 'b1', 'lora');
    expect(d.textBoxes).toEqual([{
      id: 'b1', text: 'Your text', x: 42, y: 112, width: 240, height: 24, fontSize: 12, fontFamily: 'lora',
      color: '#243536', align: 'left', visible: true,
    }]);
    for (let n = 2; n <= 14; n++) d = addTextBox(d, `b${n}`, 'lora');
    expect(d.textBoxes).toHaveLength(MAX_TEXT_BOXES);
    expect(removeTextBox(d, 'b3').textBoxes).toHaveLength(MAX_TEXT_BOXES - 1);
    expect(itemOf(d, box('b2'))?.x).toBe(42);
    expect(itemOf(d, box('gone'))).toBeUndefined();
  });

  it('lets a text box go anywhere on the page but not off it', () => {
    const d = addTextBox(classic(), 'b1', 'instrument');
    const start = d.textBoxes![0]!;
    const far = moveItem(d, box('b1'), start, 5000, 5000).textBoxes![0]!;
    expect(far.x + far.width).toBeCloseTo(PAPER.width - 16);
    expect(far.y + far.height).toBeCloseTo(PAPER.height - 16);
    const near = moveItem(d, box('b1'), start, -5000, -5000).textBoxes![0]!;
    expect([near.x, near.y]).toEqual([16, 16]);
    const tall = resizeItem(d, box('b1'), start, 5000, 5000).textBoxes![0]!;
    expect(tall.x).toBeCloseTo(42);
    expect(tall.height).toBe(240);
    expect(tall.x + tall.width).toBeCloseTo(PAPER.width - 16);
    // The server's own limits for where a box may start.
    const corner = constrainTextBox({ x: 9999, y: 9999, width: 20, height: 12 });
    expect(corner.x).toBeLessThanOrEqual(PAPER.width - 36);
    expect(corner.x).toBeCloseTo(PAPER.width - 36);
    expect(corner.y).toBe(PAPER.height - 30);
  });

  it('changes the words and style of one box only', () => {
    let d = addTextBox(addTextBox(classic(), 'b1', 'instrument'), 'b2', 'instrument');
    d = patchItem(d, box('b2'), { text: 'Registered in England', bold: true, align: 'right' });
    expect(d.textBoxes![0]).toMatchObject({ text: 'Your text' });
    expect(d.textBoxes![1]).toMatchObject({ text: 'Registered in England', bold: true, align: 'right' });
    expect(patchItem(d, box('b2'), { text: 'x'.repeat(1200) }).textBoxes![1]!.text).toHaveLength(1000);
  });
});

describe('Designs', () => {
  it('offers four plain layouts and the eight ready-made designs', () => {
    expect(DESIGNS.map((d) => d.id)).toEqual([
      'classic', 'right', 'centered', 'minimal',
      'executive', 'metropolitan', 'editorial', 'horizon', 'ledger', 'studio', 'prestige', 'minimal-corporate',
    ]);
  });

  it('applies a design and keeps the text boxes the person added', () => {
    const d = addTextBox(classic(), 'b1', 'instrument');
    const next = applyDesign('executive', brand(), d);
    expect(next.template).toBe('executive');
    expect(next.textBoxes).toEqual(d.textBoxes);
    expect(applyDesign('minimal', brand(), classic())).not.toHaveProperty('textBoxes');
  });

  it('recolours the rule and anything in the old brand colour', () => {
    const d = patchItem(classic(), name, { color: '#24543b' });
    const next = recolourDesign(d, '#24543B', '#112233');
    expect(next.elements.rule.color).toBe('#112233');
    expect(next.elements.companyName.color).toBe('#112233');
    expect(next.elements.address.color).toBe('#35443e');
  });

  it('makes room for a logo when one is added to an untouched layout, and closes the gap when it goes', () => {
    const without = classic();
    expect(without.elements.companyName.x).toBe(42);
    const added = reflowForLogo(without, brand(), brand({ logo: 'data:image/png;base64,AAAA' }));
    expect(added.elements.companyName).toMatchObject({ x: 140, width: 410 });
    expect(added.elements.address).toMatchObject({ x: 140, width: 410 });
    const removed = reflowForLogo(added, brand({ logo: 'data:image/png;base64,AAAA' }), brand());
    expect(removed.elements.companyName).toMatchObject({ x: 42, width: 508 });
  });

  it('keeps the style and leaves a layout the person has moved alone', () => {
    const styled = patchItem(classic(), name, { color: '#112233', fontSize: 30 });
    const added = reflowForLogo(styled, brand(), brand({ logo: 'data:image/png;base64,AAAA' }));
    expect(added.elements.companyName).toMatchObject({ x: 140, color: '#112233', fontSize: 30 });
    const moved = moveItem(classic(), name, classic().elements.companyName, 20, 0);
    expect(reflowForLogo(moved, brand(), brand({ logo: 'data:image/png;base64,AAAA' }))).toBe(moved);
    expect(reflowForLogo(moved, brand(), brand())).toBe(moved);
  });
});

describe('The design that is saved', () => {
  it('is accepted by the server for every design, with and without a logo', () => {
    for (const { id } of DESIGNS) {
      for (const logo of [undefined, 'data:image/png;base64,AAAA']) {
        const saved = savedDesign(presetDesign(id, brand({ logo })));
        expect(parseDesign(saved), id).toEqual(saved);
      }
    }
  });

  it('is accepted by the server after items are pushed into every corner', () => {
    let d = addTextBox(addTextBox(classic(), 'b1', 'mono'), 'b2', 'mono');
    for (const id of ELEMENTS) {
      const picked = { kind: 'element', id } as const;
      d = resizeItem(d, picked, d.elements[id], -999, -999);
      d = moveItem(d, picked, d.elements[id], id === 'logo' ? -999 : 999.123, id === 'rule' ? -999 : 999.456);
    }
    d = moveItem(d, box('b1'), d.textBoxes![0]!, 999.99, 999.99);
    d = resizeItem(d, box('b2'), d.textBoxes![1]!, -999, -999);
    d = moveItem(d, box('b2'), d.textBoxes![1]!, 999.99, 999.99);
    d = setZone(setZone(d, 'footerHeight', 48), 'headerHeight', 110);
    expect(() => parseDesign(savedDesign(d))).not.toThrow();
  });

  it('rounds positions to a hundredth of a point and repairs what the server would refuse', () => {
    const d = classic();
    const rough: LetterheadDesign = {
      ...d,
      headerHeight: 500,
      elements: {
        ...d.elements,
        companyName: { ...d.elements.companyName, x: 42.123456, fontSize: 90, visible: false },
        address: { ...d.elements.address, y: 9999 },
      },
      textBoxes: [{ ...addTextBox(d, 'b1', 'inter').textBoxes![0]!, x: -40, text: 'y'.repeat(1001) }],
    };
    const saved = savedDesign(rough);
    expect(saved.headerHeight).toBe(240);
    expect(saved.elements.companyName).toMatchObject({ x: 42.12, fontSize: 48, visible: true });
    expect(saved.elements.address.y + saved.elements.address.height).toBeLessThanOrEqual(240);
    expect(saved.textBoxes![0]).toMatchObject({ x: 16 });
    expect(saved.textBoxes![0]!.text).toHaveLength(1000);
    expect(() => parseDesign(saved)).not.toThrow();
  });

  it('leaves out text boxes when there are none', () => {
    expect(savedDesign(classic())).not.toHaveProperty('textBoxes');
    expect(savedDesign(removeTextBox(addTextBox(classic(), 'b1', 'inter'), 'b1'))).not.toHaveProperty('textBoxes');
  });
});

describe('Text on the page', () => {
  it('names the document font first and a font every browser has after it', () => {
    expect(fontStack('lora')).toBe('DocumentLora, Lora, Georgia, serif');
    expect(fontStack('mono')).toContain('monospace');
    expect(fontStack(undefined)).toContain('DocumentInstrument');
  });

  it('measures text with the browser when it can, and by a rule of thumb when it cannot', () => {
    const fonts: string[] = [];
    const context = {
      set font(value: string) { fonts.push(value); },
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    const measure = textMeasurer(context as unknown as CanvasRenderingContext2D);
    expect(measure('abcd', 12, 'lora', true, true)).toBe(28);
    expect(fonts[0]).toBe('italic 700 12px DocumentLora, Lora, Georgia, serif');
    expect(textMeasurer(null)('abcd', 10)).toBeCloseTo(20.8);
  });
});
