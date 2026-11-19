// The controls beside the letterhead page: what is selected, its words, place and style, and the page's own settings.
import React, { useId, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Plus, Trash2 } from 'lucide-react';
import { DOCUMENT_FONTS, type DocumentFont } from '../../../../api/_signroom/shared/documentFonts';
import { elementText } from '../../../../api/_signroom/shared/letterhead';
import type { Branding, LetterheadDesign, LetterheadTextBox } from '../../../../api/_signroom/shared/types';
import {
  ELEMENTS, FOOTER_HEIGHT, HEADER_HEIGHT, ITEM_LABELS, MARGIN, MAX_TEXT_BOXES, PAPER, TEXT_BOX_MAX_CHARS, TEXT_SIZE,
  hasText, itemOf, patchItem, setZone, type ElementId, type Picked,
} from '@/lib/signroom/letterhead';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FIELD, Tick } from '@/components/signroom/billing/shared';
import type { DesignHistory } from './useDesignHistory';

/** The words on the page that belong to the company details, not to the design. */
export type CompanyText = 'companyName' | 'address' | 'footer' | 'companyNumber' | 'taxNumber';

interface Props {
  brand: Branding;
  design: LetterheadDesign;
  history: DesignHistory;
  picked: Picked;
  onPick: (picked: Picked) => void;
  disabled?: boolean;
  /** Their PDF is printed as it is: only the header and footer heights apply. */
  artworkOnly?: boolean;
  onText: (key: CompanyText, value: string) => void;
  onChooseLogo: (file: File | undefined) => void;
  onAddTextBox: () => void;
  onDeleteTextBox: (id: string) => void;
  /** The box holding the selected item's words, so the page can put the cursor in it. */
  wordsRef: React.RefObject<HTMLTextAreaElement>;
}

const GROUP = 'flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0';
const GROUP_TITLE = 'text-xs font-medium text-muted-foreground';
const PAIR = 'grid grid-cols-2 gap-3';
const COLOUR = 'h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:h-8';
const SLIDER = 'h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50';

const keyOf = (picked: Picked) => `${picked.kind}:${picked.id}`;
const pickedOf = (key: string): Picked => {
  const at = key.indexOf(':');
  const id = key.slice(at + 1);
  return key.startsWith('box:') ? { kind: 'box', id } : { kind: 'element', id: id as ElementId };
};
const boxName = (box: LetterheadTextBox) => `Text box: ${box.text.trim().slice(0, 30) || 'empty'}`;

/**
 * A number box that shows what is being typed while it has the cursor, and
 * the real value (after it has been kept on the page) once it has not.
 */
const NumberBox: React.FC<{
  id: string; value: number; onValue: (value: number) => void; disabled?: boolean; min?: number; max?: number;
}> = ({ id, value, onValue, disabled, min, max }) => {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = String(Math.round(value * 10) / 10);
  return (
    <Input
      id={id} type="number" inputMode="decimal" step={1} min={min} max={max} disabled={disabled}
      className="tabular-nums"
      value={typed ?? shown}
      onFocus={() => setTyped(shown)}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        const text = event.target.value;
        if (typed !== null) setTyped(text);
        const next = Number(text);
        if (text.trim() !== '' && Number.isFinite(next)) onValue(next);
      }}
    />
  );
};

export const LetterheadInspector: React.FC<Props> = ({
  brand, design, history, picked, onPick, disabled, artworkOnly, onText, onChooseLogo, onAddTextBox, onDeleteTextBox, wordsRef,
}) => {
  const id = useId();
  const item = itemOf(design, picked);
  const boxes = design.textBoxes ?? [];
  const element = picked.kind === 'element' ? picked.id : null;
  const words = picked.kind === 'box' || (element !== null && hasText(element));
  const patch = (change: Partial<LetterheadTextBox>) => history.commit(patchItem(design, picked, change));

  const zones = (
    <section className={GROUP} aria-labelledby={`${id}-g-page`}>
      <h3 id={`${id}-g-page`} className={GROUP_TITLE}>Page</h3>
      <div className={FIELD}>
        <Label htmlFor={`${id}-header`}>Header height (pt)</Label>
        <div className="flex items-center gap-3">
          <input
            id={`${id}-header`} type="range" className={SLIDER} disabled={disabled}
            min={HEADER_HEIGHT.min} max={HEADER_HEIGHT.max} step={1} value={design.headerHeight}
            onChange={(event) => history.commit(setZone(design, 'headerHeight', Number(event.target.value)))}
          />
          <output htmlFor={`${id}-header`} className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{Math.round(design.headerHeight)} pt</output>
        </div>
      </div>
      <div className={FIELD}>
        <Label htmlFor={`${id}-footer`}>Footer height (pt)</Label>
        <div className="flex items-center gap-3">
          <input
            id={`${id}-footer`} type="range" className={SLIDER} disabled={disabled}
            min={FOOTER_HEIGHT.min} max={FOOTER_HEIGHT.max} step={1} value={design.footerHeight}
            onChange={(event) => history.commit(setZone(design, 'footerHeight', Number(event.target.value)))}
          />
          <output htmlFor={`${id}-footer`} className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{Math.round(design.footerHeight)} pt</output>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The document itself is written between the header and the footer, on every page.
      </p>
    </section>
  );

  if (artworkOnly) {
    return (
      <aside className="flex min-w-0 flex-col gap-4" aria-label="Letterhead controls">
        <p className="text-sm text-muted-foreground">
          Your PDF is printed as it is. Set the header and footer heights so the document stays clear of your artwork.
        </p>
        {zones}
      </aside>
    );
  }

  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="Letterhead controls">
      <section className={GROUP} aria-labelledby={`${id}-g-item`}>
        <h3 id={`${id}-g-item`} className={GROUP_TITLE}>Selected item</h3>
        <div className={FIELD}>
          <Label htmlFor={`${id}-item`}>Item to change</Label>
          <Select value={keyOf(picked)} onValueChange={(key) => onPick(pickedOf(key))}>
            <SelectTrigger id={`${id}-item`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {ELEMENTS.map((each) => <SelectItem key={each} value={`element:${each}`}>{ITEM_LABELS[each]}</SelectItem>)}
              {boxes.map((box) => <SelectItem key={box.id} value={`box:${box.id}`}>{boxName(box)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="outline" size="sm" disabled={disabled || boxes.length >= MAX_TEXT_BOXES} onClick={onAddTextBox}>
            <Plus aria-hidden /> Add a text box
          </Button>
          <span className="text-xs text-muted-foreground">{boxes.length} of {MAX_TEXT_BOXES} text boxes used.</span>
        </div>

        {item && element !== null && element !== 'logo' && element !== 'companyName' && (
          <Tick checked={item.visible} disabled={disabled} onChange={(visible) => patch({ visible })}>Show this item on the page</Tick>
        )}
        {(element === 'companyName' || element === 'address' || element === 'footer') && (
          <div className={FIELD}>
            <Label htmlFor={`${id}-words`}>Words in this item</Label>
            <Textarea
              id={`${id}-words`} ref={wordsRef} rows={3} maxLength={1000} disabled={disabled}
              value={elementText(element, brand)} onChange={(event) => onText(element, event.target.value)}
            />
          </div>
        )}
        {element === 'identifiers' && (
          <>
            <div className={FIELD}>
              <Label htmlFor={`${id}-company-number`}>Registration number on the page</Label>
              <Input id={`${id}-company-number`} maxLength={1000} disabled={disabled} value={brand.companyNumber} onChange={(event) => onText('companyNumber', event.target.value)} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-tax-number`}>Tax number on the page</Label>
              <Input id={`${id}-tax-number`} maxLength={1000} disabled={disabled} value={brand.taxNumber} onChange={(event) => onText('taxNumber', event.target.value)} />
            </div>
          </>
        )}
        {element === 'pageNumber' && (
          <p className="text-xs text-muted-foreground">Each page shows its own number and how many pages there are.</p>
        )}
        {element === 'logo' && (
          <div className={FIELD}>
            <Label htmlFor={`${id}-logo`}>Replace the logo (PNG or JPEG, up to 300 KB)</Label>
            <Input
              id={`${id}-logo`} type="file" accept="image/png,image/jpeg" disabled={disabled}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onChooseLogo(file); }}
            />
            {!brand.logo && <p className="text-xs text-muted-foreground">There is no logo yet, so this space stays empty.</p>}
          </div>
        )}
        {item && picked.kind === 'box' && (
          <>
            <div className={FIELD}>
              <Label htmlFor={`${id}-box-words`}>Words in this text box</Label>
              <Textarea
                id={`${id}-box-words`} ref={wordsRef} rows={3} maxLength={TEXT_BOX_MAX_CHARS} disabled={disabled}
                value={(item as LetterheadTextBox).text} onChange={(event) => patch({ text: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">A text box is printed on every page.</p>
            </div>
            <div>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onDeleteTextBox(picked.id)}>
                <Trash2 aria-hidden /> Delete this text box
              </Button>
            </div>
          </>
        )}
      </section>

      {item && (
        <section className={GROUP} aria-labelledby={`${id}-g-place`}>
          <h3 id={`${id}-g-place`} className={GROUP_TITLE}>Position and size</h3>
          <div className={PAIR}>
            <div className={FIELD}>
              <Label htmlFor={`${id}-x`}>Distance from the left (pt)</Label>
              <NumberBox id={`${id}-x`} value={item.x} disabled={disabled} onValue={(x) => patch({ x })} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-y`}>Distance from the top (pt)</Label>
              <NumberBox id={`${id}-y`} value={item.y} disabled={disabled} onValue={(y) => patch({ y })} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-width`}>Width (pt)</Label>
              <NumberBox id={`${id}-width`} value={item.width} disabled={disabled} onValue={(width) => patch({ width })} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-height`}>Height (pt)</Label>
              <NumberBox id={`${id}-height`} value={item.height} disabled={disabled} onValue={(height) => patch({ height })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => patch({ x: MARGIN })}>Move to the left margin</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => patch({ x: (PAPER.width - item.width) / 2 })}>Centre on the page</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => patch({ x: PAPER.width - MARGIN - item.width })}>Move to the right margin</Button>
          </div>
        </section>
      )}

      {item && (words || element === 'rule' || element === 'logo') && (
        <section className={GROUP} aria-labelledby={`${id}-g-style`}>
          <h3 id={`${id}-g-style`} className={GROUP_TITLE}>{words ? 'Text style' : 'Style'}</h3>
          {words && (
            <>
              <div className={PAIR}>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-font`}>Font of this item</Label>
                  <Select
                    value={item.fontFamily || brand.fontFamily || 'instrument'} disabled={disabled}
                    onValueChange={(font) => patch({ fontFamily: font as DocumentFont })}
                  >
                    <SelectTrigger id={`${id}-font`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_FONTS.map((font) => <SelectItem key={font.id} value={font.id}>{font.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-size`}>Text size of this item (pt)</Label>
                  <NumberBox
                    id={`${id}-size`} value={item.fontSize} min={TEXT_SIZE.min} max={TEXT_SIZE.max} disabled={disabled}
                    onValue={(fontSize) => patch({ fontSize })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Text weight and slant">
                {([['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']] as const).map(([key, label]) => (
                  <Button
                    key={key} type="button" size="sm" variant={item[key] ? 'default' : 'outline'} aria-pressed={!!item[key]}
                    disabled={disabled} onClick={() => patch({ [key]: !item[key] })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {element !== 'rule' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={words ? 'Text alignment' : 'Logo alignment'}>
              {([['left', 'to the left', AlignLeft], ['center', 'in the centre', AlignCenter], ['right', 'to the right', AlignRight]] as const).map(([align, where, Icon]) => (
                <Button
                  key={align} type="button" size="sm" variant={item.align === align ? 'default' : 'outline'} aria-pressed={item.align === align}
                  disabled={disabled} onClick={() => patch({ align })}
                >
                  <Icon aria-hidden /> {words ? 'Text' : 'Logo'} {where}
                </Button>
              ))}
            </div>
          )}
          {element !== 'logo' && (
            <div className={FIELD}>
              <Label htmlFor={`${id}-colour`}>Colour of this item</Label>
              <div className="flex items-center gap-2">
                <input
                  id={`${id}-colour`} type="color" className={COLOUR} disabled={disabled}
                  value={item.color} onChange={(event) => patch({ color: event.target.value })}
                />
                <span className="text-sm tabular-nums text-muted-foreground">{item.color}</span>
              </div>
            </div>
          )}
          {words && <p className="text-xs text-muted-foreground">Text gets smaller to fit its box. If it still does not fit, make the box bigger.</p>}
        </section>
      )}

      {zones}
    </aside>
  );
};

export default LetterheadInspector;
