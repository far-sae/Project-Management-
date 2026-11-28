// The live preview beside the agreement editor: the text being typed, as the
// PDF it will become, drawn by the server with the workspace's letterhead.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => {
  const call = vi.fn();
  return { preview: vi.fn(), call, signroom: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' }, toast: { success: vi.fn(), error: vi.fn() } };
});
vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => h.signroom }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/components/signroom/billing/brandingPreviewRequest', () => ({ agreementPreviewPdf: h.preview }));

import { AgreementLivePreview } from '@/components/signroom/agreements/AgreementLivePreview';

const pdf = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' });
let made = 0;
const revoked: string[] = [];

const show = (content: string, title = 'Website care') =>
  render(<AgreementLivePreview workspaceId="w" agreementId="a1" title={title} content={content} delayMs={1000} />);
/** Lets the timers run and the answer land. */
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  h.preview.mockReset();
  h.preview.mockImplementation(async () => pdf());
  h.call.mockReset();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  // Unless a test says otherwise, the person is not the owner: the look is not theirs to change.
  h.call.mockImplementation(async (path: string) => (path === 'session' ? { workspace: { id: 'w', name: 'Northwind Studio' }, role: 'Member' } : {}));
  made = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++made}`) as never;
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); }) as never;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the live preview of an agreement', () => {
  it('shows the document straight away when the editor opens on a text', async () => {
    show('# Terms\nWe look after the website.');
    await settle(0);
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.preview).toHaveBeenCalledWith('w', 'a1', { title: 'Website care', content: '# Terms\nWe look after the website.' });
    expect(screen.getByTitle('Preview of the agreement').getAttribute('src')).toBe('blob:preview-1');
  });

  it('waits until typing stops, and then asks once for the latest text', async () => {
    const view = show('One');
    await settle(0);
    h.preview.mockClear();
    for (const text of ['One t', 'One tw', 'One two']) {
      view.rerender(<AgreementLivePreview workspaceId="w" agreementId="a1" title="Website care" content={text} delayMs={1000} />);
      await settle(300);
    }
    expect(h.preview).not.toHaveBeenCalled();
    expect(screen.getByText('Updating…')).toBeTruthy();
    await settle(1000);
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.preview).toHaveBeenLastCalledWith('w', 'a1', { title: 'Website care', content: 'One two' });
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('keeps the last document on screen while the next one is drawn, then frees the old one', async () => {
    const view = show('One');
    await settle(0);
    let finish: (blob: Blob) => void = () => {};
    h.preview.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    view.rerender(<AgreementLivePreview workspaceId="w" agreementId="a1" title="Website care" content="One two" delayMs={1000} />);
    await settle(1000);
    // Still the first one, not an empty box.
    expect(screen.getByTitle('Preview of the agreement').getAttribute('src')).toBe('blob:preview-1');
    await act(async () => { finish(pdf()); });
    expect(screen.getByTitle('Preview of the agreement').getAttribute('src')).toBe('blob:preview-2');
    expect(revoked).toEqual(['blob:preview-1']);
  });

  it('asks for nothing while there is no text, and says what the space is for', async () => {
    show('   ');
    await settle(2000);
    expect(h.preview).not.toHaveBeenCalled();
    expect(screen.getByText(/Start writing, and the document shows here/)).toBeTruthy();
  });

  it('says in the server’s own words why the text cannot be drawn yet', async () => {
    h.preview.mockRejectedValue(new Error('Resolve all {{placeholders}} before preparing the PDF.'));
    show('Dear {{client_name}},');
    await settle(0);
    expect(screen.getByRole('alert').textContent).toBe('Resolve all {{placeholders}} before preparing the PDF.');
  });

  it('ignores an answer that a newer text has overtaken', async () => {
    const answers: ((blob: Blob) => void)[] = [];
    h.preview.mockImplementation(() => new Promise<Blob>((resolve) => { answers.push(resolve); }));
    const view = show('One');
    await settle(0);
    view.rerender(<AgreementLivePreview workspaceId="w" agreementId="a1" title="Website care" content="Two" delayMs={1000} />);
    await settle(1000);
    expect(answers).toHaveLength(2);
    await act(async () => { answers[1](pdf()); });
    await act(async () => { answers[0](pdf()); });
    // Only the answer to the newest text is shown.
    expect(made).toBe(1);
  });

  it('points to where the letterhead, the logo and the font are chosen, without leaving the draft', () => {
    show('Terms');
    const link = screen.getByRole('link', { name: /Letterhead, logo and font/ });
    expect(link.getAttribute('href')).toBe('/crm/document-settings');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('the font of the documents, chosen beside the preview', () => {
  const asOwner = (branding: Record<string, unknown> | undefined) =>
    h.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      if (path === 'session') return { workspace: { id: 'w', name: 'Northwind Studio', branding }, role: 'Owner' };
      if (path === 'workspaces/branding') return { id: 'w', name: 'Northwind Studio', branding: { ...branding, ...body } };
      return {};
    });

  it('shows the font in use, and marks the formal ones', async () => {
    asOwner({ fontFamily: 'inter', layout: 'minimal', logoPosition: 'left' });
    show('Terms');
    await settle(0);
    const select = screen.getByLabelText('Font of your documents') as HTMLSelectElement;
    expect(select.value).toBe('inter');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Instrument Sans', 'Inter', 'Lora (formal)', 'Source Serif 4 (formal)', 'Roboto Mono']);
  });

  it('saves a new font without touching the rest of the look, and draws the document again', async () => {
    asOwner({ fontFamily: 'inter', layout: 'minimal', logoPosition: 'right', color: '#112233' });
    show('Terms');
    await settle(0);
    h.preview.mockClear();
    await act(async () => { fireEvent.change(screen.getByLabelText('Font of your documents'), { target: { value: 'source-serif' } }); });
    // The layout and the side of the logo go along: the server would put them back to its own without them.
    expect(h.call).toHaveBeenCalledWith('workspaces/branding', { fontFamily: 'source-serif', layout: 'minimal', logoPosition: 'right' });
    await settle(0);
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Font of your documents') as HTMLSelectElement).value).toBe('source-serif');
    expect(h.toast.success).toHaveBeenCalledWith('Your documents now use Source Serif 4.');
  });

  it('starts from the font every workspace begins with when none was chosen', async () => {
    asOwner(undefined);
    show('Terms');
    await settle(0);
    expect((screen.getByLabelText('Font of your documents') as HTMLSelectElement).value).toBe('instrument');
    await act(async () => { fireEvent.change(screen.getByLabelText('Font of your documents'), { target: { value: 'lora' } }); });
    expect(h.call).toHaveBeenCalledWith('workspaces/branding', { fontFamily: 'lora', layout: 'letterhead', logoPosition: 'left' });
  });

  it('puts the choice back, and says so, when it could not be saved', async () => {
    h.call.mockImplementation(async (path: string) => {
      if (path === 'session') return { workspace: { id: 'w', name: 'N', branding: { fontFamily: 'inter' } }, role: 'Owner' };
      throw new Error('Only the workspace owner can do that.');
    });
    show('Terms');
    await settle(0);
    await act(async () => { fireEvent.change(screen.getByLabelText('Font of your documents'), { target: { value: 'lora' } }); });
    expect(h.toast.error).toHaveBeenCalledWith('Only the workspace owner can do that.');
    expect((screen.getByLabelText('Font of your documents') as HTMLSelectElement).value).toBe('inter');
  });

  it('is not offered to somebody who is not the owner of the workspace, or when that cannot be known', async () => {
    show('Terms');
    await settle(0);
    expect(screen.queryByLabelText('Font of your documents')).toBeNull();
    cleanup();
    h.call.mockRejectedValue(new Error('offline'));
    show('Terms');
    await settle(0);
    expect(screen.queryByLabelText('Font of your documents')).toBeNull();
  });
});
