import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Loader2, Minus, Plus } from 'lucide-react';
import { useSignroom } from '@/hooks/useSignroom';
import { signroomClient, type SignroomClient } from '@/services/signroom/client';
import { moveField, resizeField } from '@/lib/signroom/agreementFields';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { agreementPdfBlob, guestPdfBlob, type AgreementArtifactKind } from './agreements/files';

/** The part of a signing field the viewer draws. */
export type PdfField = {
  id: string;
  participantId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  kind?: string;
  required?: boolean;
};

export interface PdfViewerProps {
  /** A path under /api/signroom/ that streams a PDF; fetched with the sign-in token. */
  path?: string;
  /**
   * An agreement PDF, loaded through a short-lived signed Storage link (any size).
   * `version` reloads it when the stored file changes.
   */
  agreement?: { id: string; kind: AgreementArtifactKind; version?: string };
  /** An agreement PDF for a signing guest (cookie session, no sign-in). */
  guest?: AgreementArtifactKind;
  /** The PDF's bytes, when the caller already has them. */
  data?: Uint8Array;
  fields?: PdfField[];
  selected?: string;
  onSelect?: (id: string) => void;
  /** Called with the page and the point (fractions of the page) when the page is clicked or tapped. */
  onPlace?: (page: number, x: number, y: number) => void;
  /** Makes fields draggable and resizable (mouse, touch and arrow keys) and their labels editable. */
  onFieldChange?: (id: string, patch: Partial<PdfField>) => void;
  recipientNames?: Record<string, string>;
  label?: string;
  /** The widest the page is drawn at 100% zoom, in pixels. */
  maxWidth?: number;
  className?: string;
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;
type RenderTask = import('pdfjs-dist').RenderTask;

const WORKER_SRC = '/signroom/pdf.worker.min.mjs';
const LOAD_ERROR = 'The PDF could not be loaded. Refresh or download the authorised source.';
const RENDER_ERROR = 'Could not render this page. Try the source download.';

/** One colour for each recipient, so it is clear whose field is whose. */
const TINTS = [
  'border-primary bg-primary-soft/85 text-primary-soft-foreground',
  'border-info bg-info-soft/85 text-info-soft-foreground',
  'border-success bg-success-soft/85 text-success-soft-foreground',
  'border-warning bg-warning-soft/85 text-warning-soft-foreground',
];

/** Guests have no sign-in and no workspace: their session is a cookie. */
const guestClient = signroomClient(null);

/**
 * Shows a PDF one page at a time with page thumbnails, zoom and the text of
 * the page for screen readers. With `fields` it draws the signing fields on
 * top; with `onPlace` and `onFieldChange` it becomes the field-placement canvas.
 */
export default function PdfViewer(props: PdfViewerProps) {
  if (props.data || props.guest) return <PdfCanvas {...props} client={guestClient} />;
  return <SignedInPdf {...props} />;
}
export { PdfViewer };

/** Paths and agreements are read as the signed-in person, in the selected workspace. */
function SignedInPdf(props: PdfViewerProps) {
  const { client } = useSignroom();
  return <PdfCanvas {...props} client={client} />;
}

function PdfCanvas({
  client, path, agreement, guest, data, fields = [], selected, onSelect, onPlace, onFieldChange,
  recipientNames = {}, label = 'Agreement PDF', maxWidth = 680, className,
}: PdfViewerProps & { client: SignroomClient }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [ratio, setRatio] = useState(1.414);
  const [pageText, setPageText] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ field: PdfField; x: number; y: number; w: number; h: number; resize: boolean } | null>(null);

  useEffect(() => {
    let disposed = false;
    let task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined;
    setError('');
    setDoc(null);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        let bytes = data ? data.slice() : undefined;
        if (!bytes && agreement) {
          bytes = new Uint8Array(await (await agreementPdfBlob(client, agreement.id, agreement.kind)).blob.arrayBuffer());
        } else if (!bytes && guest) {
          bytes = new Uint8Array(await (await guestPdfBlob(client, guest)).blob.arrayBuffer());
        } else if (!bytes && path) {
          bytes = new Uint8Array(await (await client.pdf(path)).arrayBuffer());
        }
        if (disposed || !bytes) return;
        task = pdfjs.getDocument({ data: bytes, enableXfa: false });
        const pdf = await task.promise;
        if (!disposed) {
          setDoc(pdf);
          setPage(1);
        }
      } catch {
        if (!disposed) setError(LOAD_ERROR);
      }
    })();
    return () => {
      disposed = true;
      void task?.destroy();
    };
    // The agreement object is keyed by its parts, so a new object with the same parts does not reload.
  }, [client, path, data, guest, agreement?.id, agreement?.kind, agreement?.version]);

  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(220, Math.min(maxWidth, entries[0].contentRect.width - 24)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [maxWidth]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: RenderTask | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const view = p.getViewport({ scale: 1 });
        setRatio(view.height / view.width);
        const viewport = p.getViewport({ scale: (width * zoom) / view.width });
        const el = canvas.current;
        if (!el) return;
        const device = window.devicePixelRatio || 1;
        el.width = viewport.width * device;
        el.height = viewport.height * device;
        el.style.width = `${viewport.width}px`;
        el.style.height = `${viewport.height}px`;
        task = p.render({
          canvas: el,
          canvasContext: el.getContext('2d')!,
          viewport,
          transform: device !== 1 ? [device, 0, 0, device, 0, 0] : undefined,
        });
        await task.promise;
        const text = await p.getTextContent();
        if (!cancelled) setPageText(text.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === 'RenderingCancelledException')) setError(RENDER_ERROR);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width, zoom]);

  function startDrag(e: React.PointerEvent<HTMLElement>, field: PdfField, resize = false) {
    if (!onFieldChange || e.button !== 0 || editingField === field.id) return;
    const paper = e.currentTarget.closest('[data-pdf-paper]');
    if (!paper) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(field.id);
    const r = paper.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { field: { ...field }, x: e.clientX, y: e.clientY, w: r.width || 1, h: r.height || 1, resize };
  }

  function continueDrag(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    const dx = (e.clientX - g.x) / g.w;
    const dy = (e.clientY - g.y) / g.h;
    onFieldChange?.(g.field.id, g.resize ? resizeField(g.field, dx, dy) : moveField(g.field, dx, dy));
  }

  const endDrag = () => { drag.current = null; };

  /** Arrow keys nudge a field by 1% of the page; with Shift they resize it. */
  function nudge(e: React.KeyboardEvent, field: PdfField) {
    if (e.key === 'Enter') { onSelect?.(field.id); return; }
    if (!onFieldChange || editingField === field.id) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01],
    };
    const by = step[e.key];
    if (!by) return;
    e.preventDefault();
    onSelect?.(field.id);
    onFieldChange(field.id, e.shiftKey ? resizeField(field, by[0], by[1]) : moveField(field, by[0], by[1]));
  }

  const recipientIds = Object.keys(recipientNames);
  const pages = doc?.numPages ?? 0;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)} role="group" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous PDF page">
            <ChevronLeft />
          </Button>
          <span className="px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            Page {page} of {pages || '…'}
          </span>
          <Button type="button" size="icon" variant="ghost" disabled={!doc || page >= pages} onClick={() => setPage(page + 1)} aria-label="Next PDF page">
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">
            <Minus />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button type="button" size="icon" variant="ghost" onClick={() => setZoom(Math.min(2, zoom + 0.25))} aria-label="Zoom in">
            <Plus />
          </Button>
        </div>
      </div>

      <div className="flex min-w-0">
        {pages > 1 && (
          <nav className="hidden max-h-[70vh] w-24 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2 sm:flex" aria-label="PDF pages">
            {Array.from({ length: pages }, (_, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setPage(i + 1)}
                aria-label={`Go to PDF page ${i + 1}`}
                aria-current={page === i + 1 ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-1 text-[0.6875rem] tabular-nums text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  page === i + 1 ? 'border-foreground text-foreground' : 'border-border hover:bg-secondary',
                )}
              >
                <PdfThumb doc={doc!} page={i + 1} />
                <span>{i + 1}</span>
              </button>
            ))}
          </nav>
        )}

        <div ref={container} className="min-w-0 flex-1 overflow-auto bg-secondary/50 p-3">
          {error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
              <p role="alert" className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : !doc ? (
            <div role="status" className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading document…
            </div>
          ) : (
            <div
              data-pdf-paper
              className={cn('relative mx-auto border border-border bg-background', onPlace && 'cursor-crosshair')}
              style={{ width: width * zoom, height: width * zoom * ratio }}
              onClick={(e) => {
                if (!onPlace) return;
                const r = e.currentTarget.getBoundingClientRect();
                onPlace(page, (e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1));
              }}
            >
              <canvas
                ref={canvas}
                role="img"
                aria-label={`${label}, page ${page}. Use the accessible text and authorised download for this document.`}
                className="block"
              />
              {fields.filter((f) => f.page === page).map((f) => {
                const who = recipientNames[f.participantId];
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={f.id}
                    data-field={f.id}
                    onPointerDown={(e) => startDrag(e, f)}
                    onPointerMove={continueDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={() => { if (onFieldChange) setEditingField(f.id); }}
                    onKeyDown={(e) => nudge(e, f)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect?.(f.id);
                    }}
                    aria-pressed={selected === f.id}
                    aria-label={`${f.label}, ${who || 'your field'}, page ${page}${f.required ? ', required' : ''}`}
                    className={cn(
                      'absolute flex items-center overflow-hidden rounded-md border px-1 text-[0.6875rem] font-medium leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      TINTS[Math.max(0, recipientIds.indexOf(f.participantId)) % TINTS.length],
                      selected === f.id && 'ring-2 ring-ring',
                      onFieldChange ? 'cursor-move touch-none select-none' : 'cursor-pointer',
                    )}
                    style={{
                      left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`,
                    }}
                  >
                    {editingField === f.id ? (
                      <input
                        autoFocus
                        aria-label="Edit field label"
                        defaultValue={f.label}
                        className="h-full w-full min-w-0 bg-background px-1 text-[0.6875rem] text-foreground outline-none"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          onFieldChange?.(f.id, { label: e.target.value.slice(0, 120) });
                          setEditingField(null);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                      />
                    ) : (
                      <span className="truncate">{f.kind === 'signature' ? '✍ ' : ''}{f.label}</span>
                    )}
                    {onFieldChange && selected === f.id && (
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Resize ${f.label}`}
                        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none rounded-tl-md bg-foreground"
                        onPointerDown={(e) => startDrag(e, f, true)}
                        onPointerMove={continueDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <details className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Accessible text for page {page}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words">
          {pageText || 'No extractable text on this page. Use the authorised source download and assigned field list.'}
        </p>
      </details>
    </div>
  );
}

function PdfThumb({ doc, page }: { doc: PdfDoc; page: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | undefined;
    void (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled || !ref.current) return;
        const viewport = p.getViewport({ scale: 64 / p.getViewport({ scale: 1 }).width });
        ref.current.width = viewport.width;
        ref.current.height = viewport.height;
        task = p.render({ canvas: ref.current, canvasContext: ref.current.getContext('2d')!, viewport });
        await task.promise;
      } catch {
        // A thumbnail that fails to draw leaves its page number, which is enough to navigate.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);
  return <canvas ref={ref} aria-hidden="true" className="max-w-full border border-border bg-background" />;
}
