// The four-step draft editor: autosave, the steps, the upload, and the gate on sending.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { agreement, clientRow, field, person, polyfillDom } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const state = { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const storage = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn(), from: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }));
const crm = vi.hoisted(() => ({
  companies: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
  deals: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
}));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crm.companies, useCrmDeals: () => crm.deals }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/services/supabase/config', () => ({ supabase: { storage } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/signroom/PdfViewer', () => ({
  default: (props: { agreement?: { id: string; kind: string; version?: string }; fields?: unknown[]; onPlace?: (page: number, x: number, y: number) => void }) => (
    <div data-testid="pdf" data-fields={props.fields?.length ?? 0}>
      {props.agreement?.kind}:{props.agreement?.version}
      {props.onPlace && <button type="button" onClick={() => props.onPlace?.(1, 0.5, 0.5)}>click the page</button>}
    </div>
  ),
}));

import { AgreementEditorPage } from '@/pages/signroom/AgreementEditor';
import { SignroomError } from '@/services/signroom/client';

let stored: Agreement;
const serve = (overrides: Record<string, (body: Record<string, unknown>) => unknown> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (overrides[path]) return overrides[path](body ?? {});
    if (path === 'clients') return [clientRow()];
    if (path === `agreements/${stored.id}`) return stored;
    if (path === `agreements/${stored.id}/save`) {
      const { clearFields: _clear, ...saved } = body as Record<string, unknown>;
      stored = { ...stored, ...(saved as Partial<Agreement>), revision: stored.revision + 1 };
      return stored;
    }
    throw new SignroomError('Not found.', 404);
  });
};

const Detail = () => <div>agreement page for {useParams().id}</div>;
const renderEditor = (step = '') => render(
  <MemoryRouter initialEntries={[`/crm/agreements/a1/edit${step ? `?step=${step}` : ''}`]}>
    <Routes>
      <Route path="/crm/agreements" element={<div>agreements list</div>} />
      <Route path="/crm/agreements/:id" element={<Detail />} />
      <Route path="/crm/agreements/:id/edit" element={<AgreementEditorPage />} />
    </Routes>
  </MemoryRouter>,
);
const posted = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const currentStep = () => screen.getByRole('navigation', { name: 'Steps' }).querySelector('[aria-current="step"]')?.textContent;
const CONFIRM = 'I confirm this is an ordinary agreement without special execution requirements.';

beforeAll(polyfillDom);
beforeEach(() => {
  stored = agreement();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  storage.uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
  storage.from.mockReset().mockReturnValue({ uploadToSignedUrl: storage.uploadToSignedUrl });
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('opening the editor', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderEditor();
    expect(screen.getByText('Pick a workspace in the sidebar to edit this agreement.')).toBeTruthy();
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('loads the draft and names its company', async () => {
    renderEditor();
    expect(await screen.findByRole('heading', { name: 'NDA for Northwind Studio' })).toBeTruthy();
    expect((await screen.findByRole('link', { name: 'Northwind Studio' })).getAttribute('href')).toBe('/crm/companies/c1');
    expect(currentStep()).toContain('Document');
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
    // Draft with AI is offered, and nothing is asked of it until the person opens it (see aiDraft.test.tsx).
    expect(screen.getByRole('button', { name: /Draft with AI/ })).toBeTruthy();
    expect(sr.call.mock.calls.some((c) => String(c[0]).endsWith('/ai-draft'))).toBe(false);
  });

  it('sends a sent agreement to its own page instead', async () => {
    stored = agreement({ status: 'Awaiting signatures' });
    renderEditor();
    expect(await screen.findByText('agreement page for a1')).toBeTruthy();
  });

  it('shows the server sentence when the draft cannot be loaded', async () => {
    serve({ 'agreements/a1': () => { throw new SignroomError('Agreement not found.', 404); } });
    renderEditor();
    expect((await screen.findByRole('alert')).textContent).toBe('Agreement not found.');
  });
});

describe('the document step', () => {
  it('is written in a formal reading font, with the document shown beside it as it will look', async () => {
    renderEditor();
    const text = await screen.findByLabelText('Agreement content');
    expect(text.className).toContain('font-serif');
    expect(text.className).not.toContain('font-mono');
    expect(screen.getByRole('region', { name: 'How the document will look' })).toBeTruthy();
  });

  it('saves a changed title by itself, with the revision and only what the server stores', async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Agreement title'), { target: { value: 'Mutual NDA' } });
    expect(screen.getByRole('status').textContent).toContain('Unsaved changes');
    expect(posted('agreements/a1/save')).toEqual([]);
    await waitFor(() => expect(posted('agreements/a1/save')).toHaveLength(1), { timeout: 3000 });
    expect(posted('agreements/a1/save')[0]).toEqual({
      revision: 3, title: 'Mutual NDA', content: 'These are the terms.', participants: agreement().participants, fields: agreement().fields,
      senderFirst: false, sequential: false, deadline: '', reminderDays: 3, subject: '', message: '', clearFields: false,
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All changes saved'));
  });

  it('shows the server sentence and a failed state when a save is refused', async () => {
    serve({ 'agreements/a1/save': () => { throw new SignroomError('This draft changed in another tab. Reload it before saving.', 409); } });
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Agreement title'), { target: { value: 'Mutual NDA' } });
    fireEvent.click(button(/Save draft/));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This draft changed in another tab. Reload it before saving.'));
    expect(screen.getByRole('status').textContent).toContain('Save failed. Retry or reload.');
  });

  it('shows the exact PDF and will not continue without one', async () => {
    stored = agreement({ documentHash: undefined, pages: [], fields: [] });
    renderEditor();
    await screen.findByLabelText('Agreement title');
    expect(screen.queryByTestId('pdf')).toBeNull();
    fireEvent.click(button(/Save and continue/));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Prepare the PDF or upload a document before continuing.'));
    expect(currentStep()).toContain('Document');
  });

  it('prepares the signing PDF from the text', async () => {
    stored = agreement({ documentHash: undefined, pages: [], fields: [] });
    serve({ 'agreements/a1/prepare': () => ({ ...stored, documentHash: 'hash2', pages: [{ width: 595, height: 842 }], revision: 4 }) });
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /Prepare signing PDF/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The exact signing PDF is ready to review.'));
    expect(posted('agreements/a1/prepare')).toEqual([{ revision: 3, clearFields: false }]);
    expect(screen.getByTestId('pdf').textContent).toContain('source:hash2');
    expect(button(/Rebuild PDF/)).toBeTruthy();
  });

  it('asks before a text change clears placed fields, and saves it as approved', async () => {
    renderEditor();
    const text = await screen.findByLabelText('Agreement content');
    fireEvent.change(text, { target: { value: 'New terms.' } });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Changing the document clears all placed fields and requires a new PDF review. Continue?')).toBeTruthy();
    expect((text as HTMLTextAreaElement).value).toBe('These are the terms.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change document' }));
    await waitFor(() => expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('New terms.'));
    fireEvent.click(button(/Save draft/));
    await waitFor(() => expect(posted('agreements/a1/save')).toHaveLength(1));
    expect(posted('agreements/a1/save')[0]).toMatchObject({ content: 'New terms.', fields: [], clearFields: true });
  });

  it('keeps the text and the fields when the change is declined', async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Agreement content'), { target: { value: 'New terms.' } });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep fields' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('These are the terms.');
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
  });

  it('uploads a PDF straight to storage with a signed link, then has the server check it', async () => {
    stored = agreement({ fields: [] });
    serve({
      'agreements/a1/upload-url': () => ({ uploadId: 'up1', path: 'w/quarantine/up1.pdf', token: 'tok' }),
      'agreements/a1/upload': () => ({ ...stored, sourceKind: 'upload', documentHash: 'hash9', pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }], revision: 4 }),
    });
    renderEditor();
    const file = new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Upload agreement PDF'), { target: { files: [file] } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('PDF validated and prepared. Review every page before placing fields.'));
    expect(posted('agreements/a1/upload-url')).toEqual([{ revision: 3, clearFields: false, name: 'terms.pdf', size: file.size }]);
    expect(storage.from).toHaveBeenCalledWith('signroom');
    expect(storage.uploadToSignedUrl).toHaveBeenCalledWith('w/quarantine/up1.pdf', 'tok', file, { contentType: 'application/pdf' });
    expect(posted('agreements/a1/upload')).toEqual([{ uploadId: 'up1', revision: 3, clearFields: false }]);
    expect(screen.getByText('Uploaded PDF is ready')).toBeTruthy();
    expect(screen.getByText(/2 pages/)).toBeTruthy();
    expect(screen.queryByLabelText('Agreement content')).toBeNull();
  });

  it('makes no call when replacing a document that has fields is declined', async () => {
    renderEditor();
    const file = new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Upload agreement PDF'), { target: { files: [file] } });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Replace the document and remove every field placement?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep document' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(posted('agreements/a1/upload-url')).toEqual([]);
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('says so when the upload does not reach storage', async () => {
    stored = agreement({ fields: [] });
    storage.uploadToSignedUrl.mockResolvedValue({ error: { message: 'boom' } });
    serve({ 'agreements/a1/upload-url': () => ({ uploadId: 'up1', path: 'p', token: 't' }) });
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Upload agreement PDF'), {
      target: { files: [new File(['%PDF-1.7'], 'terms.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The upload did not finish. Please try again.'));
    expect(posted('agreements/a1/upload')).toEqual([]);
  });
});

describe('the recipients step', () => {
  it('moves on from the document step and lists the recipients', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /Save and continue/ }));
    expect(await screen.findByRole('heading', { name: 'Who needs to sign?' })).toBeTruthy();
    expect(currentStep()).toContain('Recipients');
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Elena Rossi');
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('elena@northwind.example');
  });

  it('adds the sender as a signer from the signed-in account', async () => {
    renderEditor('recipients');
    fireEvent.click(await screen.findByRole('button', { name: 'Add myself as a signer' }));
    expect(screen.getAllByLabelText('Full name').map((i) => (i as HTMLInputElement).value)).toEqual(['Elena Rossi', 'Sam']);
    expect(screen.getAllByLabelText('Email address').map((i) => (i as HTMLInputElement).value)).toEqual(['elena@northwind.example', 'sam@example.com']);
  });

  it('puts the sender first when they sign first, and locks signing in order', async () => {
    renderEditor('recipients');
    fireEvent.click(await screen.findByRole('checkbox', { name: /I sign first, then choose when to send to the other company/ }));
    expect(screen.getAllByLabelText('Full name').map((i) => (i as HTMLInputElement).value)).toEqual(['Sam', 'Elena Rossi']);
    const inOrder = screen.getByRole('checkbox', { name: /Sign in order/ }) as HTMLInputElement;
    expect(inOrder.checked).toBe(true);
    expect(inOrder.disabled).toBe(true);
    fireEvent.click(button(/Save draft/));
    await waitFor(() => expect(posted('agreements/a1/save')).toHaveLength(1));
    expect(posted('agreements/a1/save')[0]).toMatchObject({ senderFirst: true, sequential: true });
  });

  it('removing a recipient removes their fields, and the step needs a named signer', async () => {
    renderEditor('recipients');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Elena Rossi' }));
    expect(screen.getByText('No recipients yet. Add the person who needs to sign.')).toBeTruthy();
    fireEvent.click(button(/Save and continue/));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Add at least one named signer with an email address.'));
    expect(posted('agreements/a1/save')[0]).toMatchObject({ participants: [], fields: [] });
    expect(currentStep()).toContain('Recipients');
  });
});

describe('the fields step', () => {
  it('adds a field for the chosen signer from the button and from a click on the page', async () => {
    stored = agreement({ fields: [] });
    renderEditor('fields');
    expect(await screen.findByText('No fields placed yet. Every signer needs a required signature field.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Field recipient' }).textContent).toContain('Elena Rossi');

    fireEvent.click(button(/Add field/));
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Signature');
    expect(screen.getByText(/Elena Rossi · Page 1 · Required/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Full name/ }));
    fireEvent.click(button('click the page'));
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Full name');
    expect((screen.getByLabelText('Left %') as HTMLInputElement).value).toBe('50');
    expect(screen.getByTestId('pdf').getAttribute('data-fields')).toBe('2');

    fireEvent.click(button(/Save draft/));
    await waitFor(() => expect(posted('agreements/a1/save')).toHaveLength(1));
    const saved = (posted('agreements/a1/save')[0] as { fields: { kind: string; participantId: string; page: number }[] }).fields;
    expect(saved.map((f) => [f.kind, f.participantId, f.page])).toEqual([['signature', 'p1', 1], ['full_name', 'p1', 1]]);
  });

  it('edits and deletes the selected field from the inspector', async () => {
    renderEditor('fields');
    fireEvent.click(await screen.findByRole('button', { name: /1\. Signature/ }));
    fireEvent.change(screen.getByLabelText('Width %'), { target: { value: '40' } });
    expect((screen.getByLabelText('Width %') as HTMLInputElement).value).toBe('40');
    // A size that would push the field off the page is ignored.
    fireEvent.change(screen.getByLabelText('Left %'), { target: { value: '90' } });
    expect((screen.getByLabelText('Left %') as HTMLInputElement).value).toBe('10');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Required' }));
    expect(screen.getByText(/Elena Rossi · Page 1 · Optional/)).toBeTruthy();
    fireEvent.click(button(/Delete field/));
    expect(screen.getByText('No fields placed yet. Every signer needs a required signature field.')).toBeTruthy();
  });

  it('adds a signature for each signer', async () => {
    stored = agreement({
      fields: [], participants: [person('p1', 'Elena Rossi', 'elena@northwind.example'), person('p2', 'Sam', 'sam@example.com', { order: 2 })],
    });
    renderEditor('fields');
    fireEvent.click(await screen.findByRole('button', { name: 'Add signature for each signer' }));
    expect(screen.getByText(/Elena Rossi · Page 1 · Required/)).toBeTruthy();
    expect(screen.getByText(/Sam · Page 1 · Required/)).toBeTruthy();
  });

  it('sends the person back to the document when there is no PDF yet', async () => {
    stored = agreement({ documentHash: undefined, pages: [], fields: [] });
    renderEditor('fields');
    expect(await screen.findByText('Prepare a PDF before placing fields.')).toBeTruthy();
    fireEvent.click(button('Back to document'));
    expect(currentStep()).toContain('Document');
  });
});

describe('review and send', () => {
  it('cannot send until the ordinary-agreement confirmation is ticked, then sends with a one-use key', async () => {
    serve({ 'agreements/a1/send': () => ({ ...stored, status: 'Awaiting signatures', sentAt: '2026-11-19T10:00:00.000Z' }) });
    renderEditor('review');
    const send = await screen.findByRole('button', { name: /Send agreement/ }) as HTMLButtonElement;
    expect(screen.getByText('Signature placed')).toBeTruthy();
    expect(screen.getByText('Deeds, witnessing, notarisation and special execution requirements are outside this release.')).toBeTruthy();
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: CONFIRM }));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(await screen.findByText('agreement page for a1')).toBeTruthy();
    const [body] = posted('agreements/a1/send') as { revision: number; eligible: boolean; specialRequirements: boolean; idempotencyKey: string }[];
    expect(body).toMatchObject({ revision: 3, eligible: true, specialRequirements: false });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(toast.success).toHaveBeenCalledWith('Agreement sent. Invitations are on their way.');
  });

  it('cannot send a document with special signing requirements', async () => {
    renderEditor('review');
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'This document has special signing requirements.' }));
    expect(screen.getByRole('alert').textContent).toBe('Sending is unavailable. Use a process suited to the document’s execution requirements.');
    expect(screen.queryByRole('checkbox', { name: CONFIRM })).toBeNull();
    expect(button(/Send agreement/).disabled).toBe(true);
    // Un-ticking it asks for the confirmation again rather than remembering the old one.
    fireEvent.click(screen.getByRole('checkbox', { name: 'This document has special signing requirements.' }));
    expect((screen.getByRole('checkbox', { name: CONFIRM }) as HTMLInputElement).checked).toBe(false);
    expect(button(/Send agreement/).disabled).toBe(true);
  });

  it('lists what the server still requires, in its sentences, and keeps Send off until they are met', async () => {
    stored = agreement({
      fields: [], deadline: '2020-01-01',
      participants: [person('p1', 'Elena Rossi', 'elena@northwind.example'), person('p2', '', 'not-an-email', { order: 2 })],
    });
    renderEditor('review');
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM }));
    const list = within(screen.getByText('Before you can send').parentElement as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(list).toEqual([
      'Every recipient needs a name.',
      'Enter a valid email address.',
      'Add a required signature field for Elena Rossi.',
      'Choose a future deadline.',
    ]);
    expect(screen.getAllByText('Signature missing')).toHaveLength(2);
    expect(screen.getByText('Missing name')).toBeTruthy();
    expect(button(/Send agreement/).disabled).toBe(true);
    expect(posted('agreements/a1/send')).toEqual([]);
  });

  it('shows the server sentence when the send is refused, and stays on the page', async () => {
    const sentence = 'Rebuild or re-upload the draft PDF to apply the current company logo before sending.';
    serve({ 'agreements/a1/send': () => { throw new SignroomError(sentence, 400); } });
    renderEditor('review');
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM }));
    fireEvent.click(button(/Send agreement/));
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(toast.error).toHaveBeenCalledWith(sentence);
    expect(screen.queryByText(/agreement page for/)).toBeNull();
    expect(button(/Send agreement/).disabled).toBe(false);
  });

  it('says so when the agreement was cancelled while it was being sent', async () => {
    serve({ 'agreements/a1/send': () => ({ ...stored, status: 'Cancelled' }) });
    renderEditor('review');
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM }));
    fireEvent.click(button(/Send agreement/));
    await screen.findByText('agreement page for a1');
    expect(toast.message).toHaveBeenCalledWith('This agreement was cancelled while it was being sent.');
  });

  it('prepares for the sender’s first signature when they sign first', async () => {
    stored = agreement({
      senderFirst: true, sequential: true,
      participants: [person('m', 'Sam', 'sam@example.com'), person('p1', 'Elena Rossi', 'elena@northwind.example', { order: 2 })],
      fields: [field({ id: 'f0', participantId: 'm' }), field()],
    });
    serve({ 'agreements/a1/send': () => ({ ...stored, status: 'Awaiting signatures', senderReleasePending: true }) });
    renderEditor('review');
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM }));
    fireEvent.click(button('Prepare for my first signature'));
    await screen.findByText('agreement page for a1');
    expect(toast.success).toHaveBeenCalledWith('Agreement prepared for your first signature.');
  });

  it('saves a template under the name given', async () => {
    serve({ 'agreements/a1/template': () => ({ id: 't9' }) });
    renderEditor('review');
    fireEvent.click(await screen.findByRole('button', { name: /Save as template/ }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('Template name') as HTMLInputElement;
    expect(name.value).toBe('NDA for Northwind Studio');
    fireEvent.change(name, { target: { value: 'Standard NDA' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Template saved with recipient roles and field positions.'));
    expect(posted('agreements/a1/template')).toEqual([{ name: 'Standard NDA' }]);
  });

  it('saves and goes back to the list from the back button', async () => {
    renderEditor('review');
    await screen.findByRole('button', { name: /Send agreement/ });
    fireEvent.click(button('Agreements'));
    expect(await screen.findByText('agreements list')).toBeTruthy();
  });
});
