import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const WIDTH = 600;
const HEIGHT = 180;
/** Ink is drawn dark on a white pad in both themes, because it is stamped onto a white PDF page. */
const INK = '#1f2933';

/**
 * An optional drawn signature (mouse, pen or touch). Reports a PNG data URL
 * after each stroke, and an empty string when cleared. A typed signature is
 * always asked for as well, so nobody has to draw.
 */
export default function SignaturePad({ onChange }: { onChange: (image: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * WIDTH) / (r.width || WIDTH), ((e.clientY - r.top) * HEIGHT) / (r.height || HEIGHT)];
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={ref}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Optional drawn signature. A typed signature is always available below."
        className="w-full touch-none rounded-md border border-border bg-white"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const c = e.currentTarget.getContext('2d');
          if (!c) return;
          setDrawing(true);
          setHasInk(true);
          c.strokeStyle = INK;
          c.lineWidth = 2.4;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(...point(e));
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const c = e.currentTarget.getContext('2d');
          if (!c) return;
          c.lineTo(...point(e));
          c.stroke();
        }}
        onPointerUp={() => {
          if (!drawing) return;
          setDrawing(false);
          if (ref.current) onChange(ref.current.toDataURL('image/png'));
        }}
        onPointerCancel={() => setDrawing(false)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {hasInk ? 'Drawn signature added' : 'Draw with a mouse or touch, or use the typed signature below.'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            ref.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
            setHasInk(false);
            onChange('');
          }}
        >
          Clear drawing
        </Button>
      </div>
    </div>
  );
}
export { SignaturePad };
