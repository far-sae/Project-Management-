// The letterhead designer: an A4 page whose items can be dragged, with their controls beside it.
import React, { useEffect, useId, useRef, useState } from 'react';
import { LayoutTemplate, Redo2, Undo2 } from 'lucide-react';
import type { Branding, LetterheadDesign } from '../../../../api/_signroom/shared/types';
import {
  GRID, addTextBox, itemOf, newTextBoxId, removeTextBox, type Picked,
} from '@/lib/signroom/letterhead';
import { Button } from '@/components/ui/button';
import { Tick } from '@/components/signroom/billing/shared';
import { DesignGallery } from './DesignGallery';
import { LetterheadInspector, type CompanyText } from './LetterheadInspector';
import { LetterheadPage } from './LetterheadPage';
import type { DesignHistory } from './useDesignHistory';

export interface LetterheadDesignerProps {
  /** The company's words, colours and logo as they are on the page now, saved or not. */
  brand: Branding;
  design: LetterheadDesign;
  history: DesignHistory;
  /** Nothing can be changed (a member looking at the settings, or a save in progress). */
  disabled?: boolean;
  /** The person's own letterhead page as a picture, drawn behind everything. */
  backgroundUrl?: string | null;
  /** Their PDF is printed as it is: of the design, only the header and footer heights apply. */
  artworkOnly?: boolean;
  onText: (key: CompanyText, value: string) => void;
  /** A plain layout or ready-made design was picked, by its name. */
  onChooseDesign: (design: string) => void;
  onChooseLogo: (file: File | undefined) => void;
}

const FIRST: Picked = { kind: 'element', id: 'companyName' };

export const LetterheadDesigner: React.FC<LetterheadDesignerProps> = ({
  brand, design, history, disabled, backgroundUrl, artworkOnly, onText, onChooseDesign, onChooseLogo,
}) => {
  const hintId = useId();
  const [picked, setPicked] = useState<Picked>(FIRST);
  const [snap, setSnap] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const wordsRef = useRef<HTMLTextAreaElement>(null);
  /** Set when the page asks for the words box, which may only exist after the next render. */
  const [wordsWanted, setWordsWanted] = useState(0);

  // A text box that is gone (deleted, or undone) cannot stay selected.
  const current = itemOf(design, picked) ? picked : FIRST;

  useEffect(() => {
    if (wordsWanted) wordsRef.current?.focus();
  }, [wordsWanted]);

  const addBox = () => {
    const id = newTextBoxId();
    history.commit(addTextBox(design, id, brand.fontFamily ?? 'instrument'));
    setPicked({ kind: 'box', id });
  };
  const deleteBox = (id: string) => {
    history.commit(removeTextBox(design, id));
    setPicked(FIRST);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!artworkOnly && (
        <p id={hintId} className="text-sm text-muted-foreground">
          Drag an item to move it, or drag the round handle at its corner to resize it. With the keyboard: Tab to an item, then use the
          arrow keys to move it by 1 pt, or by 10 pt while holding Shift. On its handle, the arrow keys resize it. Enter puts the cursor in its words.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Designer tools">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={disabled || artworkOnly} onClick={() => setGalleryOpen(true)}>
            <LayoutTemplate aria-hidden /> Choose a design
          </Button>
          <Button type="button" variant="outline" disabled={disabled || !history.canUndo} onClick={history.undo}>
            <Undo2 aria-hidden /> Undo
          </Button>
          <Button type="button" variant="outline" disabled={disabled || !history.canRedo} onClick={history.redo}>
            <Redo2 aria-hidden /> Redo
          </Button>
        </div>
        {!artworkOnly && (
          <>
            <Tick checked={snap} onChange={setSnap} disabled={disabled}>Snap to a {GRID} pt grid while dragging</Tick>
            <Tick checked={design.accent} disabled={disabled} onChange={(accent) => history.commit({ ...design, accent })}>
              Colour strip along the top
            </Tick>
          </>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="mx-auto w-full max-w-2xl">
            <LetterheadPage
              brand={brand} design={design} history={history} picked={current} onPick={setPicked} snap={snap} disabled={disabled}
              backgroundUrl={backgroundUrl} artworkOnly={artworkOnly} hintId={hintId}
              onEditWords={(target) => { setPicked(target); setWordsWanted((n) => n + 1); }}
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            An A4 page. The dashed lines and the outlines around items are guides: they are not printed.
          </p>
        </div>
        <LetterheadInspector
          brand={brand} design={design} history={history} picked={current} onPick={setPicked} disabled={disabled}
          artworkOnly={artworkOnly} onText={onText} onChooseLogo={onChooseLogo} onAddTextBox={addBox} onDeleteTextBox={deleteBox}
          wordsRef={wordsRef}
        />
      </div>

      <DesignGallery open={galleryOpen} onOpenChange={setGalleryOpen} brand={brand} current={design.template} onChoose={onChooseDesign} />
    </div>
  );
};

export default LetterheadDesigner;
