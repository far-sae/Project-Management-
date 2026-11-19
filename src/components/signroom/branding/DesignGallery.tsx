// The plain layouts and ready-made designs to start a letterhead from, each drawn small with the company's own details.
import React from 'react';
import {
  BRAND_TEMPLATES, elementText, fitLetterheadText, presetDesign, templateDecorations,
} from '../../../../api/_signroom/shared/letterhead';
import type { Branding } from '../../../../api/_signroom/shared/types';
import { DESIGNS, ELEMENTS, PAPER, fontStack } from '@/lib/signroom/letterhead';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const isReadyMade = (id: string) => BRAND_TEMPLATES.some((template) => template.id === id);
/** Stand-in text and lines for the body of the page: document colours, the same in light and dark. */
const BODY_INK = '#183238';
const BODY_LINE = '#dce2e3';

/** One design as a small page. Missing details are filled with examples so every design shows its full shape. */
export const DesignThumb: React.FC<{ design: string; brand: Branding }> = ({ design: name, brand }) => {
  const sample: Branding = {
    ...brand,
    address: brand.address || 'Company address, City, Country',
    footer: brand.footer || 'company.example',
    companyNumber: brand.companyNumber || '12345678',
  };
  const design = presetDesign(name, sample);
  return (
    <svg viewBox={`0 0 ${PAPER.width} ${PAPER.height}`} aria-hidden className="block h-auto w-full rounded-md border border-border">
      <rect width={PAPER.width} height={PAPER.height} fill="#ffffff" />
      {design.accent && <rect width={PAPER.width} height={6} fill={brand.color} />}
      {templateDecorations(design, brand.color, brand.secondaryColor).map((shape, n) => (shape.points
        ? <polygon key={n} points={shape.points.map((point) => point.join(',')).join(' ')} fill={shape.color} />
        : <rect key={n} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} />))}
      {ELEMENTS.map((id) => {
        const item = design.elements[id];
        if (!item.visible) return null;
        if (id === 'logo') {
          return brand.logo
            ? <image key={id} href={brand.logo} x={item.x} y={item.y} width={item.width} height={item.height} preserveAspectRatio="xMidYMin meet" />
            : null;
        }
        if (id === 'rule') return <rect key={id} x={item.x} y={item.y} width={item.width} height={Math.max(2, item.height)} fill={item.color} />;
        const fitted = fitLetterheadText(elementText(id, sample), item, (text, size) => text.length * size * 0.53);
        const x = item.align === 'center' ? item.x + item.width / 2 : item.align === 'right' ? item.x + item.width : item.x;
        return (
          <text
            key={id} x={x} y={item.y + fitted.size} fontFamily={fontStack(item.fontFamily)} fontSize={fitted.size}
            fontWeight={item.bold ? 700 : 400} fill={item.color}
            textAnchor={item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start'}
          >
            {fitted.lines.map((line, n) => <tspan key={n} x={x} dy={n ? fitted.size * 1.25 : 0}>{line}</tspan>)}
          </text>
        );
      })}
      <text x={48} y={design.headerHeight + 48} fontFamily={fontStack(brand.fontFamily)} fontSize={23} fontWeight={700} fill={BODY_INK}>
        Service agreement
      </text>
      {[0, 1, 2].map((block) => (
        <g key={block} transform={`translate(48 ${design.headerHeight + 96 + block * 140})`}>
          <rect width={180} height={8} fill={BODY_INK} opacity={0.7} />
          {[492, 475, 490, 450, 340].map((width, n) => <rect key={n} y={24 + n * 16} width={width} height={5} fill={BODY_LINE} />)}
        </g>
      ))}
    </svg>
  );
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: Branding;
  /** The ready-made design in use, if the letterhead still carries one. */
  current?: string;
  onChoose: (design: string) => void;
}

/** A dialog with every design to pick from. Picking one closes it. */
export const DesignGallery: React.FC<Props> = ({ open, onOpenChange, brand, current, onChoose }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>Choose a design</DialogTitle>
        <DialogDescription>
          Each design is shown with your own details and colours. Choosing one replaces where the items sit now. Text boxes you added are kept, and Undo takes the change back.
        </DialogDescription>
      </DialogHeader>
      {open && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DESIGNS.map((design) => {
            const kind = isReadyMade(design.id) ? 'design' : 'layout';
            const inUse = current === design.id;
            return (
              <button
                key={design.id}
                type="button"
                aria-label={`Use the ${design.name} ${kind}`}
                aria-pressed={inUse}
                onClick={() => { onChoose(design.id); onOpenChange(false); }}
                className={cn(
                  'flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  inUse ? 'border-primary' : 'border-border',
                )}
              >
                <DesignThumb design={design.id} brand={brand} />
                <span className="text-sm font-medium text-foreground">{design.name}</span>
                <span className="text-xs text-muted-foreground">{design.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

export default DesignGallery;
