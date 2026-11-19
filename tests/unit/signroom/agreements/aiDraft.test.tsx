// Draft with AI in the agreement editor: the requirements, the wait, the review, and the notice it leaves behind.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Agreement, AiDraft } from '../../../../api/_signroom/shared/types';
import { agreement, clientRow, polyfillDom } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the loading effects for ever.
  const state = { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }));
const crm = vi.hoisted(() => ({
  companies: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
  deals: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
}));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crm.companies, useCrmDeals: () => crm.deals }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/signroom/PdfViewer', () => ({ default: () => <div data-testid="pdf" /> }));

import { AgreementEditorPage } from '@/pages/signroom/AgreementEditor';
import { SignroomError } from '@/services/signroom/client';

const AI = 'agreements/a1/ai-draft';
const SAVE = 'agreements/a1/save';
const REQUIREMENTS = 'A mutual NDA for a website redesign, two years, England and Wales.';
const DRAFT = '# Mutual NDA\n\nEach party keeps the other party’s information confidential for two years from the date of this agreement.';
const REVIEW = 'AI drafts need human review. Check every clause and fill all placeholders before preparing the PDF. Nothing is sent automatically.';
const REPLACE = 'Replace the current document text? This clears the prepared PDF and all field placements. Review and prepare the new PDF before sending.';
const reply = (content = DRAFT): AiDraft => ({ content, model: 'test-model', reviewRequired: true });

let stored: Agreement;
const serve = (overrides: Record<string, (body: Record<string, unknown>) => unknown> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (overrides[path]) return overrides[path](body ?? {});
    if (path === 'clients') return [clientRow()];
    if (path === 'session') return { workspace: { id: 'w', name: 'Acme', branding: { companyName: 'Acme Design Ltd' } }, role: 'Member' };
    if (path === `agreements/${stored.id}`) return stored;
    if (path === SAVE) {
      const { clearFields: _clear, ...saved } = body as Record<string, unknown>;
      stored = { ...stored, ...(saved as Partial<Agreement>), revision: stored.revision + 1 };
      return stored;
    }
    if (path === AI) return reply();
    throw new SignroomError('Not found.', 404);
  });
};

/** A reply the test settles when it chooses, as a slow server would. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const renderEditor = () => render(
  <MemoryRouter initialEntries={['/crm/agreements/a1/edit']}>
    <Routes>
      <Route path="/crm/agreements" element={<div>agreements list</div>} />
      <Route path="/crm/agreements/:id" element={<div>agreement page</div>} />
      <Route path="/crm/agreements/:id/edit" element={<AgreementEditorPage />} />
    </Routes>
  </MemoryRouter>,
);
const posted = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);
const editorText = () => (screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value;
const openDialog = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Draft with AI/ }));
  return screen.findByRole('dialog');
};
const requirementsBox = (dialog: HTMLElement) => within(dialog).getByLabelText('Your requirements') as HTMLTextAreaElement;
const draftButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Draft' }) as HTMLButtonElement;
/** Opens the dialog, writes the requirements and asks for a draft. */
const askForDraft = async (requirements = REQUIREMENTS) => {
  const dialog = await openDialog();
  fireEvent.change(requirementsBox(dialog), { target: { value: requirements } });
  fireEvent.click(draftButton(dialog));
  return dialog;
};
const blank = () => agreement({ content: '', documentHash: undefined, pages: [], fields: [] });

beforeAll(polyfillDom);
beforeEach(() => {
  stored = agreement();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('offering Draft with AI', () => {
  it('offers it on a draft whose text is written here', async () => {
    renderEditor();
    expect(await screen.findByRole('button', { name: /Draft with AI/ })).toBeTruthy();
    expect(screen.queryByText(/written by AI/)).toBeNull();
    expect(posted(AI)).toEqual([]);
  });

  it('does not offer it for an uploaded PDF', async () => {
    stored = agreement({ sourceKind: 'upload' });
    renderEditor();
    expect(await screen.findByText('Uploaded PDF is ready')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Draft with AI/ })).toBeNull();
  });
});

describe('the requirements', () => {
  it('names the parties as the agreement knows them, and says what to include', async () => {
    renderEditor();
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Acme Design Ltd')).toBeTruthy();
    expect(await within(dialog).findByText('Northwind Studio')).toBeTruthy();
    expect(within(dialog).getByText('NDA')).toBeTruthy();
    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'What each party must do, and what is delivered.',
      'Fees, payment terms, start date and how long it runs.',
      'Notice to end it, confidentiality and governing law.',
    ]);
    expect(dialog.textContent).toContain('Claude, Anthropic’s AI, writes the draft from what you enter here.');
    expect(dialog.textContent).toContain(REVIEW);
    // The parties are shown, not asked for.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
  });

  it('counts the characters and needs at least 20', async () => {
    renderEditor();
    const dialog = await openDialog();
    expect(within(dialog).getByText('0 / 10,000')).toBeTruthy();
    expect(draftButton(dialog).disabled).toBe(true);

    fireEvent.change(requirementsBox(dialog), { target: { value: 'Too short' } });
    expect(within(dialog).getByText('9 / 10,000')).toBeTruthy();
    expect(within(dialog).getByText('Write at least 20 characters.')).toBeTruthy();
    expect(draftButton(dialog).disabled).toBe(true);

    fireEvent.change(requirementsBox(dialog), { target: { value: REQUIREMENTS } });
    expect(within(dialog).queryByText('Write at least 20 characters.')).toBeNull();
    expect(draftButton(dialog).disabled).toBe(false);
    expect(posted(AI)).toEqual([]);
  });

  it('will not send more than 10,000 characters', async () => {
    renderEditor();
    const dialog = await openDialog();
    fireEvent.change(requirementsBox(dialog), { target: { value: 'a'.repeat(10_001) } });
    expect(within(dialog).getByText('10,001 / 10,000')).toBeTruthy();
    expect(within(dialog).getByText('Keep the requirements to 10,000 characters or fewer.')).toBeTruthy();
    expect(draftButton(dialog).disabled).toBe(true);
  });
});

describe('waiting for the draft', () => {
  it('sends the requirements once, however often Draft is pressed, and says it can take a few minutes', async () => {
    const slow = deferred<AiDraft>();
    serve({ [AI]: () => slow.promise });
    renderEditor();
    const dialog = await openDialog();
    fireEvent.change(requirementsBox(dialog), { target: { value: `  ${REQUIREMENTS}  ` } });
    const press = draftButton(dialog);
    fireEvent.click(press);
    fireEvent.click(press);

    expect(await within(dialog).findByText(/This can take a few minutes/)).toBeTruthy();
    await waitFor(() => expect(posted(AI)).toEqual([{ requirements: REQUIREMENTS }]));
    expect(within(dialog).queryByRole('button', { name: 'Draft' })).toBeNull();
    expect(within(dialog).queryByLabelText('Your requirements')).toBeNull();

    // Closing the dialog does not stop the wait; only Cancel does.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(within(dialog).getByText(/This can take a few minutes/)).toBeTruthy();

    await act(async () => { slow.resolve(reply()); });
    expect(await within(dialog).findByRole('button', { name: 'Use this draft' })).toBeTruthy();
    expect(posted(AI)).toHaveLength(1);
  });

  it('saves what was just typed first, so the draft is not refused as changed', async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Agreement title'), { target: { value: 'Mutual NDA' } });
    const dialog = await askForDraft();
    await within(dialog).findByRole('button', { name: 'Use this draft' });
    expect(sr.call.mock.calls.map((c) => c[0]).filter((path) => path === SAVE || path === AI)).toEqual([SAVE, AI]);
  });

  it('does not ask for a draft when that save is refused', async () => {
    serve({ [SAVE]: () => { throw new SignroomError('This draft changed in another tab. Reload it before saving.', 409); } });
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Agreement title'), { target: { value: 'Mutual NDA' } });
    const dialog = await askForDraft();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This draft changed in another tab. Reload it before saving.'));
    await waitFor(() => expect(requirementsBox(dialog).value).toBe(REQUIREMENTS));
    expect(posted(AI)).toEqual([]);
  });

  it('can be cancelled, and then ignores a reply that arrives late', async () => {
    const slow = deferred<AiDraft>();
    serve({ [AI]: () => slow.promise });
    renderEditor();
    const dialog = await askForDraft();
    await waitFor(() => expect(posted(AI)).toHaveLength(1));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requirementsBox(dialog).value).toBe(REQUIREMENTS);
    expect(within(dialog).getByText('Cancelled. Nothing was changed.')).toBeTruthy();

    await act(async () => { slow.resolve(reply()); });
    expect(within(dialog).queryByRole('button', { name: 'Use this draft' })).toBeNull();
    expect(within(dialog).queryByText(/Each party keeps/)).toBeNull();
    expect(requirementsBox(dialog).value).toBe(REQUIREMENTS);
    expect(editorText()).toBe('These are the terms.');
    expect(posted(SAVE)).toEqual([]);
  });

  it('ignores a late failure after cancelling too', async () => {
    const slow = deferred<AiDraft>();
    serve({ [AI]: () => slow.promise });
    renderEditor();
    const dialog = await askForDraft();
    await waitFor(() => expect(posted(AI)).toHaveLength(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await act(async () => { slow.reject(new SignroomError('Drafting failed just now. Try again.', 503)); });
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it.each([
    [400, 'Describe your requirements in 20 to 10,000 characters.'],
    [400, 'The draft came back incomplete. Try again with shorter requirements.'],
    [409, 'The agreement changed while drafting. Try again.'],
    [429, 'You’ve drafted with AI 5 times this hour. Try again in 12 minutes.'],
    [503, 'Draft with AI is not set up yet.'],
    [503, 'Drafting failed just now. Try again.'],
  ])('shows the server’s sentence for a %i and keeps the requirements', async (status, sentence) => {
    serve({ [AI]: () => { throw new SignroomError(sentence, status); } });
    renderEditor();
    const dialog = await askForDraft();
    expect((await within(dialog).findByRole('alert')).textContent).toBe(sentence);
    expect(requirementsBox(dialog).value).toBe(REQUIREMENTS);
    expect(draftButton(dialog).disabled).toBe(false);
    expect(editorText()).toBe('These are the terms.');

    // Trying again sends a fresh request.
    serve();
    fireEvent.click(draftButton(dialog));
    expect(await within(dialog).findByRole('button', { name: 'Use this draft' })).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(posted(AI)).toHaveLength(2);
  });
});

describe('the draft that comes back', () => {
  it('is shown for review, and nothing is saved or put in the document yet', async () => {
    renderEditor();
    const dialog = await askForDraft();
    expect(await within(dialog).findByText(/Each party keeps the other party’s information confidential/)).toBeTruthy();
    expect(dialog.textContent).toContain(REVIEW);
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(editorText()).toBe('These are the terms.');
    expect(posted(SAVE)).toEqual([]);
    expect(screen.queryByText(/written by AI/)).toBeNull();
  });

  it('is dropped by Discard', async () => {
    renderEditor();
    const dialog = await askForDraft();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Discard' }));
    expect(within(dialog).queryByText(/Each party keeps/)).toBeNull();
    expect(requirementsBox(dialog).value).toBe(REQUIREMENTS);
    expect(editorText()).toBe('These are the terms.');
    expect(screen.queryByText(/written by AI/)).toBeNull();
  });

  it('is still there after the dialog is closed and opened again', async () => {
    renderEditor();
    const dialog = await askForDraft();
    await within(dialog).findByRole('button', { name: 'Use this draft' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const again = await openDialog();
    expect(within(again).getByText(/Each party keeps/)).toBeTruthy();
    expect(posted(AI)).toHaveLength(1);
  });

  it('asks before replacing text that is already there, and keeps it when the answer is no', async () => {
    renderEditor();
    const dialog = await askForDraft();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use this draft' }));
    const question = within(dialog).getByRole('alert');
    expect(question.textContent).toContain('The document already has text.');
    expect(question.textContent).toContain(REPLACE);
    expect(editorText()).toBe('These are the terms.');

    fireEvent.click(within(question).getByRole('button', { name: 'Keep current document' }));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByText(/Each party keeps/)).toBeTruthy();
    expect(editorText()).toBe('These are the terms.');
    expect(screen.queryByText(/written by AI/)).toBeNull();
  });

  it('replaces the text once that is confirmed', async () => {
    renderEditor();
    const dialog = await askForDraft();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use this draft' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace document' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editorText()).toBe(DRAFT);
    // The old PDF no longer matches the text, so it is gone until a new one is prepared.
    expect(screen.queryByTestId('pdf')).toBeNull();
    expect(screen.getByRole('button', { name: /Prepare signing PDF/ })).toBeTruthy();
  });

  it('goes straight into an empty document', async () => {
    stored = blank();
    renderEditor();
    const dialog = await askForDraft();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use this draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editorText()).toBe(DRAFT);
  });

  it('leaves a notice that stays until the person saves, and never prepares or sends by itself', async () => {
    stored = blank();
    renderEditor();
    const dialog = await askForDraft();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use this draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const notice = screen.getByText('This text was written by AI.').closest('div') as HTMLElement;
    expect(notice.textContent).toContain(REVIEW);

    // The editor keeps the text safe as it does any typing; the notice is not cleared by that.
    await waitFor(() => expect(posted(SAVE)).toHaveLength(1), { timeout: 3000 });
    expect(posted(SAVE)[0]).toMatchObject({ content: DRAFT, fields: [], clearFields: true });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All changes saved'));
    expect(screen.getByText('This text was written by AI.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(screen.queryByText('This text was written by AI.')).toBeNull());

    const paths = sr.call.mock.calls.map((c) => c[0] as string);
    expect(paths.filter((path) => /\/(send|prepare)$/.test(path))).toEqual([]);
  });

  it('says so when the reply has no text in it', async () => {
    serve({ [AI]: () => reply('   ') });
    renderEditor();
    const dialog = await askForDraft();
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The draft came back empty. Try again.');
    expect(within(dialog).queryByRole('button', { name: 'Use this draft' })).toBeNull();
  });
});
