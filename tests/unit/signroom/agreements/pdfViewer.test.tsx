// The PDF viewer (how the bytes are fetched, and placing fields with a mouse, touch or keys) and the signature pad.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { polyfillDom } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  const state = { client: { call, pdf, upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, pdf, state };
});
const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/services/supabase/config', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock('pdfjs-dist', () => pdfjs);

import PdfViewer, { type PdfField } from '@/components/signroom/PdfViewer';
import SignaturePad from '@/components/signroom/SignaturePad';

const page = () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  getTextContent: async () => ({ items: [{ str: 'First' }, { str: 'clause' }] }),
});
const loaded = (numPages = 2) => ({
  promise: Promise.resolve({ numPages, getPage: async () => page() }),
  destroy: async () => {},
});
const field = (over: Partial<PdfField> = {}): PdfField => ({
  id: 'f1', participantId: 'p1', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05, label: 'Signature', kind: 'signature', required: true, ...over,
});
const fetched: { url: string; init?: RequestInit }[] = [];

beforeAll(() => {
  polyfillDom();
  // jsdom has no canvas drawing and no layout: give the page a size of 600 by 800.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,INK';
  Element.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800, x: 0, y: 0, toJSON: () => ({}),
  });
});
beforeEach(() => {
  fetched.length = 0;
  sr.call.mockReset();
  sr.pdf.mockReset();
  pdfjs.getDocument.mockReset().mockImplementation(() => loaded());
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    fetched.push({ url, init });
    if (url.startsWith('/api/signroom/guest/artifact-url')) {
      return new Response(JSON.stringify({ url: 'https://storage.example/guest-source', filename: 'source.pdf' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('%PDF-1.7');
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PdfViewer', () => {
  it('loads an agreement through a short-lived signed link, with no sign-in sent to storage', async () => {
    sr.call.mockResolvedValue({ url: 'https://storage.example/source', filename: 'source.pdf' });
    render(<PdfViewer agreement={{ id: 'a1', kind: 'source', version: 'hash1' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading document…');
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledWith('agreements/a1/artifact-url?kind=source');
    expect(fetched).toEqual([{ url: 'https://storage.example/source', init: { credentials: 'omit', cache: 'no-store' } }]);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/signroom/pdf.worker.min.mjs');
    expect(await screen.findByText('First clause')).toBeTruthy();
  });

  it('loads again when the stored file changes, not on every render', async () => {
    sr.call.mockResolvedValue({ url: 'https://storage.example/source', filename: 'source.pdf' });
    const view = render(<PdfViewer agreement={{ id: 'a1', kind: 'source', version: 'hash1' }} />);
    await screen.findByText('Page 1 of 2');
    view.rerender(<PdfViewer agreement={{ id: 'a1', kind: 'source', version: 'hash1' }} />);
    expect(sr.call).toHaveBeenCalledTimes(1);
    view.rerender(<PdfViewer agreement={{ id: 'a1', kind: 'source', version: 'hash2' }} />);
    await waitFor(() => expect(sr.call).toHaveBeenCalledTimes(2));
  });

  it('loads a guest’s PDF with the guest link and no workspace', async () => {
    render(<PdfViewer guest="source" />);
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy();
    expect(fetched.map((f) => f.url)).toEqual(['/api/signroom/guest/artifact-url?kind=source', 'https://storage.example/guest-source']);
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('loads a path the server streams', async () => {
    sr.pdf.mockResolvedValue(new Blob(['%PDF-1.7']));
    render(<PdfViewer path="billing/i1/preview" label="Invoice preview" />);
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy();
    expect(sr.pdf).toHaveBeenCalledWith('billing/i1/preview');
    expect(screen.getByRole('group', { name: 'Invoice preview' })).toBeTruthy();
  });

  it('says so in its own sentence when the PDF cannot be loaded', async () => {
    sr.call.mockRejectedValue(new Error('This file is not ready.'));
    render(<PdfViewer agreement={{ id: 'a1', kind: 'source' }} />);
    expect((await screen.findByRole('alert')).textContent).toBe('The PDF could not be loaded. Refresh or download the authorised source.');
  });

  it('moves between pages and shows only that page’s fields', async () => {
    render(<PdfViewer data={new Uint8Array([1, 2, 3])} fields={[field(), field({ id: 'f2', page: 2, label: 'Initials', kind: 'initials' })]} recipientNames={{ p1: 'Elena Rossi' }} />);
    expect(await screen.findByRole('button', { name: 'Signature, Elena Rossi, page 1, required' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Initials/ })).toBeNull();
    expect((screen.getByRole('button', { name: 'Previous PDF page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next PDF page' }));
    expect(await screen.findByRole('button', { name: 'Initials, Elena Rossi, page 2, required' })).toBeTruthy();
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to PDF page 1' }));
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeTruthy();
  });

  it('places a field where the page is clicked or tapped', async () => {
    const onPlace = vi.fn();
    render(<PdfViewer data={new Uint8Array([1])} onPlace={onPlace} />);
    await screen.findByText('Page 1 of 2');
    fireEvent.click(document.querySelector('[data-pdf-paper]') as HTMLElement, { clientX: 150, clientY: 400 });
    expect(onPlace).toHaveBeenCalledWith(1, 0.25, 0.5);
  });

  it('drags a field with the pointer and resizes it from its corner', async () => {
    const onFieldChange = vi.fn();
    const onSelect = vi.fn();
    const onPlace = vi.fn();
    render(<PdfViewer data={new Uint8Array([1])} fields={[field()]} selected="f1" onSelect={onSelect} onFieldChange={onFieldChange} onPlace={onPlace} />);
    const box = await screen.findByRole('button', { name: /^Signature, your field/ });
    // A touch drag is the same pointer events as a mouse drag.
    fireEvent.pointerDown(box, { clientX: 100, clientY: 200, button: 0, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(box, { clientX: 160, clientY: 280, pointerId: 1, pointerType: 'touch' });
    expect(onSelect).toHaveBeenCalledWith('f1');
    const moved = onFieldChange.mock.calls.at(-1) as [string, { x: number; y: number }];
    expect(moved[0]).toBe('f1');
    expect(moved[1].x).toBeCloseTo(0.2);
    expect(moved[1].y).toBeCloseTo(0.3);
    fireEvent.pointerUp(box, { pointerId: 1 });
    onFieldChange.mockClear();
    fireEvent.pointerMove(box, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(onFieldChange).not.toHaveBeenCalled();

    const corner = screen.getByRole('button', { name: 'Resize Signature' });
    fireEvent.pointerDown(corner, { clientX: 240, clientY: 200, button: 0, pointerId: 2 });
    fireEvent.pointerMove(corner, { clientX: 300, clientY: 240, pointerId: 2 });
    const resized = onFieldChange.mock.calls.at(-1) as [string, { width: number; height: number }];
    expect(resized[1].width).toBeCloseTo(0.4);
    expect(resized[1].height).toBeCloseTo(0.1);
    // Selecting or dragging a field never drops a new one under it.
    fireEvent.click(box);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('nudges a field with the arrow keys', async () => {
    const onFieldChange = vi.fn();
    render(<PdfViewer data={new Uint8Array([1])} fields={[field()]} onFieldChange={onFieldChange} />);
    const box = await screen.findByRole('button', { name: /^Signature, your field/ });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(onFieldChange.mock.calls.at(-1)?.[1].x).toBeCloseTo(0.11);
    fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
    expect(onFieldChange.mock.calls.at(-1)?.[1].height).toBeCloseTo(0.06);
  });

  it('leaves fields alone when it is read-only', async () => {
    const onSelect = vi.fn();
    render(<PdfViewer data={new Uint8Array([1])} fields={[field()]} onSelect={onSelect} />);
    const box = await screen.findByRole('button', { name: /^Signature, your field/ });
    fireEvent.pointerDown(box, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 160, clientY: 280, pointerId: 1 });
    expect(screen.queryByRole('button', { name: 'Resize Signature' })).toBeNull();
    fireEvent.click(box);
    expect(onSelect).toHaveBeenCalledWith('f1');
  });
});

describe('SignaturePad', () => {
  it('reports a PNG after a stroke and nothing after clearing', () => {
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const pad = screen.getByLabelText('Optional drawn signature. A typed signature is always available below.');
    expect(screen.getByText('Draw with a mouse or touch, or use the typed signature below.')).toBeTruthy();
    fireEvent.pointerDown(pad, { clientX: 60, clientY: 80, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(pad, { clientX: 120, clientY: 160, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(context.moveTo).toHaveBeenCalledWith(60, 18);
    expect(context.lineTo).toHaveBeenCalledWith(120, 36);
    expect(onChange).toHaveBeenLastCalledWith('data:image/png;base64,INK');
    expect(screen.getByText('Drawn signature added')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawing' }));
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 600, 180);
    expect(onChange).toHaveBeenLastCalledWith('');
    getContext.mockRestore();
  });
});
