// The letterhead designer: the page, the items on it, and the controls beside it.
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PAPER, presetDesign } from '../../../../api/_signroom/shared/letterhead';
import type { Branding, LetterheadDesign } from '../../../../api/_signroom/shared/types';
import { addTextBox, patchItem, placeOnPage } from '@/lib/signroom/letterhead';
import { LetterheadDesigner } from '@/components/signroom/branding/LetterheadDesigner';
import { useDesignHistory } from '@/components/signroom/branding/useDesignHistory';
import { stubBrowser } from '../billing/fixtures';

const brand = (over: Partial<Branding> = {}): Branding => ({
  companyName: 'Sam Studio Ltd', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: 'GB 123',
  color: '#24543b', secondaryColor: '#172c35', fontSize: 12, fontFamily: 'instrument', footer: 'samstudio.example',
  layout: 'letterhead', logoPosition: 'left', paymentInstructions: '', ...over,
});

/** The design as the page holding the designer would keep it. */
let latest: LetterheadDesign;
const onText = vi.fn();
const onChooseDesign = vi.fn();
const onChooseLogo = vi.fn();

const Harness: React.FC<{ start: LetterheadDesign; disabled?: boolean; artworkOnly?: boolean; backgroundUrl?: string; logo?: string }> = ({
  start, disabled, artworkOnly, backgroundUrl, logo,
}) => {
  const [design, setDesign] = useState(start);
  const history = useDesignHistory(design, setDesign);
  latest = design;
  return (
    <LetterheadDesigner
      brand={brand({ logo })} design={design} history={history} disabled={disabled} artworkOnly={artworkOnly}
      backgroundUrl={backgroundUrl} onText={onText} onChooseDesign={onChooseDesign} onChooseLogo={onChooseLogo}
    />
  );
};

const classic = () => presetDesign('classic', brand());
const show = (start: LetterheadDesign = classic(), props: Partial<React.ComponentProps<typeof Harness>> = {}) =>
  render(<Harness start={start} {...props} />);
const page = () => within(screen.getByRole('group', { name: 'Letterhead page' }));
const item = (name: string) => page().getByRole('button', { name });
/** Tabbing to an item selects it. */
const select = (name: string) => fireEvent.focus(item(name));
const press = (target: HTMLElement, key: string, more: Record<string, unknown> = {}) => fireEvent.keyDown(target, { key, ...more });
const number = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  stubBrowser();
  // jsdom cannot measure text: the designer then falls back to its rule of thumb.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  onText.mockReset();
  onChooseDesign.mockReset();
  onChooseLogo.mockReset();
});
afterEach(cleanup);

describe('Letterhead designer: the page', () => {
  it('draws a saved design where it was saved', () => {
    let start = patchItem(classic(), { kind: 'element', id: 'companyName' }, { x: 100, y: 40, width: 300, height: 30, bold: true });
    start = patchItem(start, { kind: 'element', id: 'identifiers' }, { visible: false });
    start = addTextBox(start, 'b1', 'lora');
    start = patchItem(start, { kind: 'box', id: 'b1' }, { text: 'Registered in England', x: 300, y: 60 });
    show(start);

    const name = item('Company name on the page');
    expect(name.style.left).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).left);
    expect(name.style.top).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).top);
    expect(name.style.width).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).width);
    expect(name.textContent).toContain('Sam Studio Ltd');
    expect(item('Address on the page').textContent).toContain('1 Canal Street');
    expect(item('Footer on the page').textContent).toContain('samstudio.example');
    expect(page().queryByRole('button', { name: 'Registration and tax details on the page' })).toBeNull();
    const box = item('Text box "Registered in England" on the page');
    expect(box.style.left).toBe(placeOnPage({ x: 300, y: 60, width: 240, height: 24 }).left);
    expect(box.textContent).toContain('Registered in England');
  });

  it('moves the selected item with the arrow keys: one point, or ten with Shift', () => {
    show();
    const name = item('Company name on the page');
    fireEvent.focus(name);
    expect(name.getAttribute('aria-pressed')).toBe('true');
    press(name, 'ArrowRight');
    press(name, 'ArrowDown', { shiftKey: true });
    expect(latest.elements.companyName).toMatchObject({ x: 43, y: 37 });
    expect(number('Distance from the left (pt)').value).toBe('43');
    expect(number('Distance from the top (pt)').value).toBe('37');
    // It stops at the page edge.
    for (let n = 0; n < 10; n++) press(name, 'ArrowLeft', { shiftKey: true });
    expect(latest.elements.companyName.x).toBe(16);
  });

  it('resizes the selected item with the arrow keys on its corner handle', () => {
    show();
    select('Address on the page');
    const handle = item('Resize Address');
    press(handle, 'ArrowLeft', { shiftKey: true });
    press(handle, 'ArrowDown');
    expect(latest.elements.address).toMatchObject({ x: 42, y: 63, width: 498, height: 39 });
    expect(number('Width (pt)').value).toBe('498');
  });

  it('drags an item with the pointer, on the grid', () => {
    show();
    const name = item('Company name on the page');
    fireEvent.pointerDown(name, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(name, { pointerId: 1, clientX: 121, clientY: 109 });
    expect(latest.elements.companyName).toMatchObject({ x: 62, y: 35 });
    fireEvent.pointerUp(name, { pointerId: 1 });
    // The whole drag is one step back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(latest.elements.companyName).toMatchObject({ x: 42, y: 27 });
  });

  it('takes changes back and puts them on again', () => {
    show();
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    const name = item('Company name on the page');
    press(name, 'ArrowRight');
    press(name, 'ArrowRight');
    fireEvent.click(undo);
    expect(latest.elements.companyName.x).toBe(43);
    fireEvent.click(redo);
    expect(latest.elements.companyName.x).toBe(44);
    expect(redo.disabled).toBe(true);
  });

  it('shows the uploaded letterhead behind the page, and only the header and footer when it is printed as it is', () => {
    show(classic(), { backgroundUrl: 'blob:letterhead', artworkOnly: true });
    expect((screen.getByAltText('Your letterhead PDF') as HTMLImageElement).src).toBe('blob:letterhead');
    expect(page().queryByRole('button')).toBeNull();
    expect(screen.getByText(/Your PDF is printed as it is/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Header height (pt)'), { target: { value: '200' } });
    expect(latest.headerHeight).toBe(200);
  });
});

describe('Letterhead designer: the controls', () => {
  it('sets the position and size of the selected item from the number boxes', () => {
    show();
    select('Footer on the page');
    fireEvent.change(number('Width (pt)'), { target: { value: '300' } });
    fireEvent.change(number('Distance from the left (pt)'), { target: { value: '120' } });
    expect(latest.elements.footer).toMatchObject({ x: 120, width: 300 });
    // A number that would push the item off the page is pulled back to the edge.
    fireEvent.change(number('Distance from the left (pt)'), { target: { value: '900' } });
    expect(latest.elements.footer.x + 300).toBeCloseTo(PAPER.width - 16);
    fireEvent.click(screen.getByRole('button', { name: 'Centre on the page' }));
    expect(latest.elements.footer.x).toBeCloseTo((PAPER.width - 300) / 2);
  });

  it('styles the text of the selected item', () => {
    show();
    const name = item('Company name on the page');
    fireEvent.focus(name);
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    press(name, 'u', { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Text in the centre' }));
    fireEvent.change(screen.getByLabelText('Text size of this item (pt)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Colour of this item'), { target: { value: '#112233' } });
    expect(latest.elements.companyName).toMatchObject({
      bold: true, italic: true, underline: true, align: 'center', fontSize: 30, color: '#112233',
    });
    expect(name.querySelector('[data-text]')?.getAttribute('style')).toContain('italic');
  });

  it('changes the words of an item through the page that owns them', () => {
    show();
    select('Address on the page');
    fireEvent.change(screen.getByLabelText('Words in this item'), { target: { value: '2 Dock Road' } });
    expect(onText).toHaveBeenCalledWith('address', '2 Dock Road');
    select('Registration and tax details on the page');
    fireEvent.change(screen.getByLabelText('Registration number on the page'), { target: { value: '7654321' } });
    expect(onText).toHaveBeenCalledWith('companyNumber', '7654321');
  });

  it('hides and shows an item, but never the logo or the company name', () => {
    show();
    select('Address on the page');
    fireEvent.click(screen.getByLabelText('Show this item on the page'));
    expect(latest.elements.address.visible).toBe(false);
    expect(page().queryByRole('button', { name: 'Address on the page' })).toBeNull();
    // Still selected in the list, so it can be shown again.
    fireEvent.click(screen.getByLabelText('Show this item on the page'));
    expect(latest.elements.address.visible).toBe(true);
    select('Company name on the page');
    expect(screen.queryByLabelText('Show this item on the page')).toBeNull();
  });

  it('adds a text box, changes its words, moves it and deletes it', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add a text box' }));
    expect(latest.textBoxes).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Words in this text box'), { target: { value: 'VAT registered' } });
    const box = item('Text box "VAT registered" on the page');
    expect(box.getAttribute('aria-pressed')).toBe('true');
    press(box, 'ArrowDown', { shiftKey: true });
    expect(latest.textBoxes![0]).toMatchObject({ text: 'VAT registered', x: 42, y: 122 });
    press(item('Resize text box "VAT registered"'), 'ArrowRight', { shiftKey: true });
    expect(latest.textBoxes![0]!.width).toBe(250);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this text box' }));
    expect(latest.textBoxes).toHaveLength(0);
    expect(page().queryByRole('button', { name: /Text box/ })).toBeNull();
  });

  it('stops adding text boxes at twelve', () => {
    let start = classic();
    for (let n = 1; n <= 12; n++) start = addTextBox(start, `b${n}`, 'inter');
    show(start);
    expect((screen.getByRole('button', { name: 'Add a text box' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('12 of 12 text boxes used.')).toBeTruthy();
  });

  it('changes the header and footer heights and the colour strip', () => {
    show();
    fireEvent.change(screen.getByLabelText('Header height (pt)'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Footer height (pt)'), { target: { value: '90' } });
    expect(latest).toMatchObject({ headerHeight: 110, footerHeight: 90 });
    expect(latest.elements.rule.y + latest.elements.rule.height).toBeLessThanOrEqual(110);
    fireEvent.click(screen.getByLabelText('Colour strip along the top'));
    expect(latest.accent).toBe(false);
  });

  it('offers the plain layouts and ready-made designs, and passes the choice on', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a design' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a design' });
    expect(within(dialog).getAllByRole('button', { name: /^Use the / })).toHaveLength(12);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use the Executive design' }));
    expect(onChooseDesign).toHaveBeenCalledWith('executive');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lets the logo be replaced from the designer', () => {
    show(classic(), { logo: 'data:image/png;base64,AAAA' });
    select('Company logo on the page');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Replace the logo (PNG or JPEG, up to 300 KB)'), { target: { files: [file] } });
    expect(onChooseLogo).toHaveBeenCalledWith(file);
  });

  it('changes nothing while it is read-only', () => {
    show(classic(), { disabled: true });
    const name = item('Company name on the page');
    press(name, 'ArrowRight');
    fireEvent.pointerDown(name, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(name, { pointerId: 1, clientX: 180, clientY: 100 });
    expect(latest.elements.companyName.x).toBe(42);
    expect(page().queryByRole('button', { name: 'Resize Company name' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Choose a design' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add a text box' }) as HTMLButtonElement).disabled).toBe(true);
    expect(number('Distance from the left (pt)').disabled).toBe(true);
    expect((screen.getByLabelText('Header height (pt)') as HTMLInputElement).disabled).toBe(true);
  });
});
