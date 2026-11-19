// Document settings: how documents look, the letterhead, who emails come from, how long records are kept.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { parseBranding } from '../../../../api/_signroom/branding';
import type { Branding, LetterheadDesign, TemplateFile, Workspace } from '../../../../api/_signroom/shared/types';
import { presetDesign } from '../../../../api/_signroom/shared/letterhead';
import {
  brandOf, brandingBody, brandingFormOf, layoutOf, letterheadProblem, logoProblem, retentionBody, senderBody,
  withBrandColour, withDesign, withLogo,
} from '@/lib/signroom/branding';
import { contentBounds } from '@/lib/signroom/brandingLogo';
import { addTextBox, patchItem, placeOnPage, recolourDesign, savedDesign } from '@/lib/signroom/letterhead';
import { stubBrowser, workspace } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  const upload = vi.fn();
  return { call, pdf, upload, state: { client: { call, pdf, upload }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const image = vi.hoisted(() => ({ pdfPageImage: vi.fn() }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'sign-in-token' } } }) } },
}));
// Drawing a PDF page needs a real canvas; the page only needs the picture's address.
vi.mock('@/components/signroom/branding/letterheadImage', () => image);

import { DocumentSettingsPage } from '@/pages/signroom/DocumentSettings';

const branding = (over: Partial<Branding> = {}): Branding => ({
  companyName: 'Sam Studio Ltd', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: 'GB 123 4567 89',
  color: '#24543b', fontSize: 12, fontFamily: 'instrument', footer: 'samstudio.example', layout: 'letterhead',
  logoPosition: 'left', paymentInstructions: 'Pay by bank transfer within 30 days.', ...over,
});
const letterhead: TemplateFile = { workspaceId: 'w', hash: 'h-old', name: 'our-letterhead.pdf' };
const uploaded: TemplateFile = { workspaceId: 'w', hash: 'h-new', name: 'new-letterhead.pdf' };
const pdfFile = (name = 'new-letterhead.pdf', size = 2000, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });

function serve(ws: Workspace = workspace({ branding: branding() }), role: 'Owner' | 'Member' = 'Owner') {
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (path === 'session') return { user: { id: 'u1', email: 'sam@example.com' }, workspaces: [], workspace: ws, role };
    if (path === 'workspaces/branding') {
      // As the server answers: the letterhead PDF is kept unless the request names another, or none.
      const named = body?.backgroundTemplate as { hash: string } | null | undefined;
      const backgroundTemplate = named === undefined ? ws.branding?.backgroundTemplate : named && { ...uploaded, hash: named.hash };
      return { ...ws, branding: { ...ws.branding, ...body, backgroundTemplate, logo: undefined }, logo: body?.logo || undefined };
    }
    if (path === 'workspaces/email-settings') return { ok: true, mode: 'securovix', ...body };
    // The email-connection card, mounted on this page beside the sender card, asks for this.
    if (path === 'email-connection') return { configured: false, provider: 'smtp', status: 'none', mode: 'platform', callbackUri: '' };
    if (path === 'workspaces/settings') return { ...ws, ...body };
    throw new Error(`unexpected ${path}`);
  });
}
const open = async () => {
  render(<MemoryRouter><DocumentSettingsPage /></MemoryRouter>);
  await screen.findByLabelText('Company name on documents');
};
const bodyOf = (path: string) => sr.call.mock.calls.find((c) => c[0] === path)?.[1] as Record<string, unknown>;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pdfReply = () => new Response(new Blob(['%PDF']), { status: 200, headers: { 'content-type': 'application/pdf' } });
const tab = (name: RegExp) => screen.getByRole('tab', { name });
/** The section a tab opens, shown or not. */
const panel = (name: RegExp) => document.getElementById(tab(name).getAttribute('aria-controls')!)!;
/** Opens one of the page's sections, the way a click on its tab does. */
const openTab = (name: RegExp) => fireEvent.mouseDown(tab(name), { button: 0 });
const letterheadPage = () => within(screen.getByRole('group', { name: 'Letterhead page' }));
const saveLook = () => fireEvent.click(screen.getByRole('button', { name: 'Save document look' }));
const savedLook = async () => {
  saveLook();
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Document look saved. Documents already issued keep the look they had.'));
  return bodyOf('workspaces/branding');
};

beforeEach(() => {
  stubBrowser();
  // jsdom cannot measure text: the designer then falls back to its rule of thumb.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  sr.pdf.mockReset().mockResolvedValue(new Blob(['%PDF']));
  sr.upload.mockReset().mockResolvedValue(uploaded);
  image.pdfPageImage.mockReset().mockResolvedValue('blob:letterhead-page');
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Document look helpers', () => {
  it('starts a new workspace from its name and the standard look', () => {
    const form = brandingFormOf({ name: 'Sam Studio' });
    expect(form).toEqual({
      companyName: 'Sam Studio', address: '', companyNumber: '', taxNumber: '', logo: '', color: '#24543b',
      secondaryColor: '#172c35', fontFamily: 'instrument', fontSize: 12, bodyBold: false, bodyItalic: false, footer: '',
      paymentInstructions: '', layout: 'classic', backgroundTemplate: null, templateOverlay: false,
      design: presetDesign('classic', brandOf(form)),
    });
    expect(layoutOf({ layout: 'minimal', logoPosition: 'left' })).toBe('minimal');
    expect(layoutOf({ layout: 'minimal', logoPosition: 'right' })).toBe('right');
  });

  it('starts from what is saved: the design, the colours, the body style and the letterhead PDF', () => {
    const design = patchItem(presetDesign('executive', branding()), { kind: 'element', id: 'companyName' }, { x: 60 });
    const form = brandingFormOf({
      name: 'Sam Studio',
      branding: branding({ design, secondaryColor: '#334455', bodyBold: true, backgroundTemplate: letterhead, templateOverlay: true }),
    });
    expect(form).toMatchObject({
      design, secondaryColor: '#334455', bodyBold: true, bodyItalic: false, backgroundTemplate: letterhead, templateOverlay: true,
    });
    // A workspace from before the designer starts from the layout it had.
    expect(brandingFormOf({ name: 'Sam Studio', branding: branding({ logoPosition: 'right' }) }).design)
      .toEqual(presetDesign('right', branding({ logoPosition: 'right' })));
  });

  it('sends every field the server stores, with the design', () => {
    const form = { ...brandingFormOf({ name: 'Sam Studio' }), bodyItalic: true, secondaryColor: '#334455' };
    const body = brandingBody(form, undefined);
    expect(body).toEqual({
      companyName: 'Sam Studio', address: '', companyNumber: '', taxNumber: '', logo: '', color: '#24543b',
      secondaryColor: '#334455', fontFamily: 'instrument', fontSize: 12, bodyBold: false, bodyItalic: true, footer: '',
      paymentInstructions: '', layout: 'letterhead', logoPosition: 'left', templateOverlay: false,
      design: savedDesign(form.design),
    });
    expect(brandingBody({ ...form, layout: 'right' }, undefined)).toMatchObject({ layout: 'letterhead', logoPosition: 'right' });
    expect(brandingBody({ ...form, layout: 'minimal' }, undefined)).toMatchObject({ layout: 'minimal', logoPosition: 'left' });
  });

  it('names the letterhead PDF only when it has changed', () => {
    const saved = branding({ backgroundTemplate: letterhead });
    const form = brandingFormOf({ name: 'Sam Studio', branding: saved });
    expect(brandingBody(form, saved)).not.toHaveProperty('backgroundTemplate');
    expect(brandingBody({ ...form, backgroundTemplate: uploaded }, saved).backgroundTemplate).toEqual({ hash: 'h-new' });
    expect(brandingBody({ ...form, backgroundTemplate: null }, saved).backgroundTemplate).toBeNull();
    expect(brandingBody(brandingFormOf({ name: 'Sam Studio' }), undefined)).not.toHaveProperty('backgroundTemplate');
  });

  it('builds a request the server accepts and stores as it was meant', () => {
    let form = withDesign(brandingFormOf({ name: 'Sam Studio', branding: branding() }), 'prestige');
    form = { ...form, design: addTextBox(form.design, 'b1', 'lora'), backgroundTemplate: uploaded, templateOverlay: true, bodyBold: true };
    const stored = parseBranding(brandingBody(form, branding()), { ...workspace({ branding: branding() }), templateFiles: [uploaded] });
    expect(stored).toMatchObject({
      companyName: 'Sam Studio Ltd', secondaryColor: '#172c35', bodyBold: true, bodyItalic: false, templateOverlay: true,
      backgroundTemplate: uploaded,
    });
    expect(stored.design).toEqual(savedDesign(form.design));
    expect(stored.design?.template).toBe('prestige');
  });

  it('follows the brand colour, the logo and a chosen design in the letterhead', () => {
    const form = brandingFormOf({ name: 'Sam Studio', branding: branding() });
    expect(withBrandColour(form, '#112233')).toMatchObject({
      color: '#112233', design: recolourDesign(form.design, '#24543b', '#112233'),
    });
    expect(withLogo(form, 'data:image/png;base64,AAAA').design.elements.companyName.x).toBe(140);
    const right = withDesign(form, 'right');
    expect(right.layout).toBe('right');
    expect(right.design.elements.logo.x).toBe(471);
    // A ready-made design has no old layout of its own: the one stored stays.
    expect(withDesign(right, 'executive')).toMatchObject({ layout: 'right', design: { template: 'executive' } });
  });

  it('refuses a logo that is the wrong kind or too big', () => {
    expect(logoProblem({ type: 'image/png', size: 20_000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 2_000 })).toBe('Use a PNG or JPEG logo.');
    expect(logoProblem({ type: 'image/jpeg', size: 300_001 })).toBe('Choose a logo smaller than 300 KB.');
  });

  it('refuses a letterhead that is not a PDF, is empty or is over 4 MB', () => {
    expect(letterheadProblem({ name: 'letterhead.pdf', type: 'application/pdf', size: 4 * 1024 * 1024 })).toBeNull();
    expect(letterheadProblem({ name: 'LETTERHEAD.PDF', type: '', size: 2000 })).toBeNull();
    expect(letterheadProblem({ name: 'letterhead.docx', type: 'application/msword', size: 2000 })).toBe('Choose a PDF file for your letterhead.');
    expect(letterheadProblem({ name: 'letterhead.pdf', type: 'application/pdf', size: 4 * 1024 * 1024 + 1 })).toBe('Choose a single-page PDF up to 4 MB.');
    expect(letterheadProblem({ name: 'letterhead.pdf', type: 'application/pdf', size: 0 })).toBe('Choose a single-page PDF up to 4 MB.');
  });

  it('finds the logo inside the empty margin around it', () => {
    // 3 by 3, see-through except the middle pixel.
    const data = new Uint8ClampedArray(36);
    data.set([10, 20, 30, 255], 4 * 4);
    expect(contentBounds(data, 3, 3)).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
    expect(contentBounds(new Uint8ClampedArray(36), 3, 3)).toBeNull();
  });

  it('builds the sender and retention requests without touching anything else', () => {
    expect(senderBody({ senderName: ' Sam ', replyTo: 'sam@samstudio.example ' }, { senderEmail: '' })).toEqual({
      senderName: 'Sam', senderEmail: 'sam@samstudio.example', replyTo: 'sam@samstudio.example',
    });
    expect(senderBody({ senderName: 'Sam', replyTo: 'sam@samstudio.example' }, { senderEmail: 'billing@samstudio.example' }).senderEmail)
      .toBe('billing@samstudio.example');
    expect(retentionBody({ name: 'Sam Studio' }, 30)).toEqual({ name: 'Sam Studio', retentionDays: 30 });
  });
});

describe('Document settings page', () => {
  it('shows what is saved for the workspace', async () => {
    serve(workspace({ branding: branding({ secondaryColor: '#334455', bodyBold: true }) }));
    await open();
    expect(sr.call).toHaveBeenCalledWith('session');
    expect((screen.getByLabelText('Company name on documents') as HTMLInputElement).value).toBe('Sam Studio Ltd');
    expect((screen.getByLabelText('Company address') as HTMLTextAreaElement).value).toBe('1 Canal Street\nLeeds');
    expect((screen.getByLabelText('Company registration number') as HTMLInputElement).value).toBe('01234567');
    expect((screen.getByLabelText('Tax or VAT number') as HTMLInputElement).value).toBe('GB 123 4567 89');
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).value).toBe('#24543b');
    expect((screen.getByLabelText('Second colour') as HTMLInputElement).value).toBe('#334455');
    expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Instrument Sans');
    expect(screen.getByRole('button', { name: 'Bold body text' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Italic body text' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Footer') as HTMLInputElement).value).toBe('samstudio.example');
    expect((screen.getByLabelText('How to pay (shown on invoices)') as HTMLTextAreaElement).value).toBe('Pay by bank transfer within 30 days.');
    expect((screen.getByLabelText('Sender name') as HTMLInputElement).value).toBe('Sam Studio');
    expect((screen.getByLabelText('Reply-to email address') as HTMLInputElement).value).toBe('hello@samstudio.example');
    expect((screen.getByLabelText('Days to keep a completed agreement') as HTMLInputElement).value).toBe('365');
    expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is split into four sections and shows one at a time', async () => {
    serve();
    await open();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Company & look', 'Letterhead', 'Emails', 'Records']);
    expect(panel(/Company & look/).hidden).toBe(false);
    expect(panel(/Emails/).hidden).toBe(true);
    // The look is saved from the two sections that change it, and previewed there too.
    expect(screen.getByRole('button', { name: 'Save document look' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Preview PDF/ })).toBeTruthy();

    openTab(/Emails/);
    expect(panel(/Company & look/).hidden).toBe(true);
    expect(panel(/Emails/).hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Save sender details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save document look' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Preview PDF/ })).toBeNull();

    openTab(/Records/);
    expect(screen.getByRole('button', { name: 'Save retention period' })).toBeTruthy();
    openTab(/Letterhead/);
    expect(panel(/Letterhead/).hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Save document look' })).toBeTruthy();
  });

  it('keeps the sender details in a card of their own in the emails section', async () => {
    serve();
    await open();
    openTab(/Emails/);
    const card = screen.getByRole('region', { name: 'Sender details' });
    expect(within(card).getByLabelText('Sender name')).toBeTruthy();
    expect(within(card).getByLabelText('Reply-to email address')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Save sender details' })).toBeTruthy();
    expect(panel(/Emails/).contains(card)).toBe(true);
  });

  it('saves the look once something has changed', async () => {
    serve();
    await open();
    type('Company name on documents', 'Sam Studio Limited');
    type('Brand colour', '#112233');
    type('Footer', 'samstudio.example · 0113 496 0000');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(await savedLook()).toEqual({
      companyName: 'Sam Studio Limited', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: 'GB 123 4567 89',
      logo: '', color: '#112233', secondaryColor: '#172c35', fontFamily: 'instrument', fontSize: 12, bodyBold: false, bodyItalic: false,
      footer: 'samstudio.example · 0113 496 0000', paymentInstructions: 'Pay by bank transfer within 30 days.',
      layout: 'letterhead', logoPosition: 'left', templateOverlay: false,
      // The rule on the letterhead follows the brand colour.
      design: savedDesign(recolourDesign(presetDesign('classic', branding()), '#24543b', '#112233')),
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('changes the font, the body style and the second colour', async () => {
    serve();
    await open();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Font' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Lora' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Lora'));
    fireEvent.click(screen.getByRole('button', { name: 'Bold body text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Italic body text' }));
    type('Second colour as a hex code', '#AABBCC');
    expect((screen.getByLabelText('Second colour') as HTMLInputElement).value).toBe('#aabbcc');
    // Half-typed colours wait until they are whole.
    type('Brand colour as a hex code', '#12');
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).value).toBe('#24543b');
    expect(await savedLook()).toMatchObject({ fontFamily: 'lora', bodyBold: true, bodyItalic: true, secondaryColor: '#aabbcc', color: '#24543b' });
  });

  it('will not save the look without a company name', async () => {
    serve();
    await open();
    type('Company name on documents', '  ');
    saveLook();
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the company name for your documents.');
    expect(sr.call.mock.calls.some((c) => c[0] === 'workspaces/branding')).toBe(false);
  });

  it('saves the sender name and reply-to address', async () => {
    serve();
    await open();
    openTab(/Emails/);
    type('Sender name', 'Sam at Sam Studio');
    type('Reply-to email address', 'accounts@samstudio.example');
    fireEvent.click(screen.getByRole('button', { name: 'Save sender details' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sender details saved. They apply to emails sent from now on.'));
    expect(bodyOf('workspaces/email-settings')).toEqual({
      senderName: 'Sam at Sam Studio', senderEmail: 'billing@samstudio.example', replyTo: 'accounts@samstudio.example',
    });
  });

  it('saves the retention period on its own', async () => {
    serve();
    await open();
    openTab(/Records/);
    type('Days to keep a completed agreement', '730');
    fireEvent.click(screen.getByRole('button', { name: 'Save retention period' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Retention period saved.'));
    expect(bodyOf('workspaces/settings')).toEqual({ name: 'Sam Studio', retentionDays: 730 });
  });

  it('keeps what was typed in one section while another is open', async () => {
    serve();
    await open();
    openTab(/Emails/);
    type('Sender name', 'Sam at Sam Studio');
    openTab(/Records/);
    openTab(/Emails/);
    expect((screen.getByLabelText('Sender name') as HTMLInputElement).value).toBe('Sam at Sam Studio');
  });

  it('shows the server sentence when a change is refused', async () => {
    serve();
    await open();
    sr.call.mockRejectedValueOnce(new Error('Only workspace owners and admins can change document settings.'));
    type('Company name on documents', 'Another name');
    saveLook();
    expect((await screen.findByRole('alert')).textContent).toBe('Only workspace owners and admins can change document settings.');
    expect(toast.error).toHaveBeenCalledWith('Only workspace owners and admins can change document settings.');
  });

  it('is read-only for a member', async () => {
    serve(workspace({ branding: branding({ backgroundTemplate: letterhead, templateOverlay: true }) }), 'Member');
    await open();
    expect(screen.getByText('Only a workspace owner or admin can change these settings.')).toBeTruthy();
    expect((screen.getByLabelText('Company name on documents') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Bold body text' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true);

    openTab(/Letterhead/);
    expect((screen.getByLabelText('Replace the letterhead PDF (one A4 portrait page, up to 4 MB)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove the letterhead PDF' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Choose a design' }) as HTMLButtonElement).disabled).toBe(true);
    const name = letterheadPage().getByRole('button', { name: 'Company name on the page' });
    fireEvent.keyDown(name, { key: 'ArrowRight' });
    expect(name.style.left).toBe(placeOnPage({ x: 42, y: 27, width: 508, height: 29 }).left);
    // Only an owner may read the stored PDF, so a member is not shown its picture and nothing is asked for.
    expect(sr.pdf).not.toHaveBeenCalled();
    expect(screen.getByText('our-letterhead.pdf')).toBeTruthy();

    openTab(/Emails/);
    expect((screen.getByRole('button', { name: 'Save sender details' }) as HTMLButtonElement).disabled).toBe(true);
    openTab(/Records/);
    expect((screen.getByRole('button', { name: 'Save retention period' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews a sample PDF in the look on the page, saved or not', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => pdfReply());
    vi.stubGlobal('fetch', fetchMock);
    serve();
    await open();
    type('Company name on documents', 'Sam Studio Limited');
    fireEvent.click(screen.getByRole('button', { name: /Preview PDF/ }));
    expect(await screen.findByTitle('Sample invoice')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/signroom/workspaces/branding-preview');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sign-in-token', 'X-Signroom-Workspace': 'w' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      companyName: 'Sam Studio Limited', previewKind: 'invoice', layout: 'letterhead', design: { version: 1, headerHeight: 140 },
    });
    expect(sr.call.mock.calls.some((c) => c[0] === 'workspaces/branding')).toBe(false);
  });

  it('shows the server sentence when the preview is refused, and a plain one when the reply is not readable', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Choose a valid brand colour.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    serve();
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Preview PDF/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a valid brand colour.');

    fetchMock.mockImplementationOnce(async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    fireEvent.click(screen.getByRole('button', { name: /Refresh preview/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The PDF preview could not be generated.'));
  });

  it('refuses a logo over 300 KB without sending anything, and shows a good one', async () => {
    serve();
    await open();
    const input = screen.getByLabelText('Company logo (PNG or JPEG, up to 300 KB)');
    const big = new File([new Uint8Array(300_001)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Choose a logo smaller than 300 KB.'));
    expect(screen.queryByAltText('Company logo')).toBeNull();

    const good = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [good] } });
    const shown = await screen.findByAltText('Company logo') as HTMLImageElement;
    expect(shown.src.startsWith('data:image/png;base64,')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Remove logo/ }));
    expect(screen.queryByAltText('Company logo')).toBeNull();
  });

  it('shows the server sentence when the settings cannot be loaded', async () => {
    sr.call.mockRejectedValue(new Error('You do not have access to this workspace.'));
    render(<MemoryRouter><DocumentSettingsPage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    serve();
    render(<MemoryRouter><DocumentSettingsPage /></MemoryRouter>);
    expect(screen.getByText('Pick a workspace in the sidebar to see its document settings.')).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
    expect(within(document.body).queryByLabelText('Company name on documents')).toBeNull();
  });
});

describe('Letterhead section', () => {
  const custom = (): LetterheadDesign => {
    let design = patchItem(presetDesign('classic', branding()), { kind: 'element', id: 'companyName' }, { x: 100, y: 40, width: 300, height: 30 });
    design = addTextBox(design, 'b1', 'lora');
    return patchItem(design, { kind: 'box', id: 'b1' }, { text: 'Registered in England', x: 300, y: 60 });
  };

  it('loads the saved design into the designer', async () => {
    serve(workspace({ branding: branding({ design: custom() }) }));
    await open();
    openTab(/Letterhead/);
    const name = letterheadPage().getByRole('button', { name: 'Company name on the page' });
    expect(name.style.left).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).left);
    expect(name.style.top).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).top);
    expect(name.textContent).toContain('Sam Studio Ltd');
    expect(letterheadPage().getByRole('button', { name: 'Text box "Registered in England" on the page' })).toBeTruthy();
    // Nothing has changed yet, and nothing is fetched when there is no letterhead PDF.
    expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true);
    expect(sr.pdf).not.toHaveBeenCalled();
  });

  it('moves and resizes an item with the keyboard and saves where it ended up', async () => {
    serve(workspace({ branding: branding({ design: custom() }) }));
    await open();
    openTab(/Letterhead/);
    const name = letterheadPage().getByRole('button', { name: 'Company name on the page' });
    fireEvent.focus(name);
    fireEvent.keyDown(name, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(name, { key: 'ArrowUp' });
    fireEvent.keyDown(letterheadPage().getByRole('button', { name: 'Resize Company name' }), { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    const body = await savedLook();
    expect((body.design as LetterheadDesign).elements.companyName).toMatchObject({ x: 110, y: 39, width: 300, height: 40 });
    expect((body.design as LetterheadDesign).textBoxes).toMatchObject(custom().textBoxes!);
  });

  it('shows on the page the words typed in the company section', async () => {
    serve();
    await open();
    type('Company name on documents', 'Sam Studio Limited');
    openTab(/Letterhead/);
    expect(letterheadPage().getByRole('button', { name: 'Company name on the page' }).textContent).toContain('Sam Studio Limited');
    fireEvent.focus(letterheadPage().getByRole('button', { name: 'Footer on the page' }));
    type('Words in this item', 'samstudio.example · Leeds');
    expect((screen.getByLabelText('Footer') as HTMLInputElement).value).toBe('samstudio.example · Leeds');
  });

  it('starts from a ready-made design, keeps the text boxes, and takes it back with Undo', async () => {
    serve(workspace({ branding: branding({ design: custom() }) }));
    await open();
    openTab(/Letterhead/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a design' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use the Executive design' }));
    const name = () => letterheadPage().getByRole('button', { name: 'Company name on the page' });
    expect(name().style.left).toBe(placeOnPage({ x: 42, y: 51, width: 508, height: 29 }).left);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(name().style.left).toBe(placeOnPage({ x: 100, y: 40, width: 300, height: 30 }).left);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    const body = await savedLook();
    expect(body.design).toMatchObject({ template: 'executive', textBoxes: custom().textBoxes });
  });

  it('uploads a letterhead PDF, shows it behind the page and saves it', async () => {
    serve();
    await open();
    openTab(/Letterhead/);
    const file = pdfFile();
    fireEvent.change(screen.getByLabelText('Letterhead PDF (one A4 portrait page, up to 4 MB)'), { target: { files: [file] } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Letterhead PDF checked and uploaded. Save the document look to start using it.'));
    expect(sr.upload).toHaveBeenCalledWith('workspaces/branding-template', file);
    expect(screen.getByText('new-letterhead.pdf')).toBeTruthy();
    expect(screen.getByText('Not saved yet')).toBeTruthy();
    // The stored page is fetched and drawn behind the designer's page.
    expect(((await screen.findByAltText('Your letterhead PDF')) as HTMLImageElement).src).toBe('blob:letterhead-page');
    expect(sr.pdf).toHaveBeenCalledWith('workspaces/branding-template?hash=h-new');
    // Printed as it is: none of the designer's items are drawn over it until asked for.
    expect(letterheadPage().queryByRole('button')).toBeNull();

    const body = await savedLook();
    expect(body).toMatchObject({ backgroundTemplate: { hash: 'h-new' }, templateOverlay: false });
    expect(body.design).toEqual(savedDesign(presetDesign('minimal', branding())));
    await waitFor(() => expect(screen.getByText('In use')).toBeTruthy());
  });

  it('prints the company details on top of the PDF when asked', async () => {
    serve(workspace({ branding: branding({ backgroundTemplate: letterhead }) }));
    await open();
    openTab(/Letterhead/);
    expect(screen.getByText('our-letterhead.pdf')).toBeTruthy();
    expect(screen.getByText('In use')).toBeTruthy();
    await screen.findByAltText('Your letterhead PDF');
    expect(sr.pdf).toHaveBeenCalledWith('workspaces/branding-template?hash=h-old');
    expect(letterheadPage().queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByLabelText('Also print my logo, company details and text boxes on top of this PDF'));
    expect(letterheadPage().getByRole('button', { name: 'Company name on the page' })).toBeTruthy();
    const body = await savedLook();
    expect(body.templateOverlay).toBe(true);
    expect(body).not.toHaveProperty('backgroundTemplate');
  });

  it('replaces the letterhead PDF and removes it', async () => {
    serve(workspace({ branding: branding({ backgroundTemplate: letterhead }) }));
    await open();
    openTab(/Letterhead/);
    fireEvent.change(screen.getByLabelText('Replace the letterhead PDF (one A4 portrait page, up to 4 MB)'), { target: { files: [pdfFile()] } });
    expect(await screen.findByText('new-letterhead.pdf')).toBeTruthy();
    expect(screen.queryByText('our-letterhead.pdf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the letterhead PDF' }));
    expect(screen.queryByText('new-letterhead.pdf')).toBeNull();
    expect(screen.queryByAltText('Your letterhead PDF')).toBeNull();
    expect(screen.getByLabelText('Letterhead PDF (one A4 portrait page, up to 4 MB)')).toBeTruthy();
    // With no PDF the designer's own items are printed again.
    expect(letterheadPage().getByRole('button', { name: 'Company name on the page' })).toBeTruthy();
    expect((await savedLook()).backgroundTemplate).toBeNull();
  });

  it('refuses a file that is not a PDF, or is too big, without sending it', async () => {
    serve();
    await open();
    openTab(/Letterhead/);
    const input = screen.getByLabelText('Letterhead PDF (one A4 portrait page, up to 4 MB)');
    fireEvent.change(input, { target: { files: [pdfFile('letterhead.docx', 2000, 'application/msword')] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a PDF file for your letterhead.');
    fireEvent.change(input, { target: { files: [pdfFile('big.pdf', 4 * 1024 * 1024 + 1)] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Choose a single-page PDF up to 4 MB.'));
    expect(toast.error).toHaveBeenCalledWith('Choose a single-page PDF up to 4 MB.');
    expect(sr.upload).not.toHaveBeenCalled();
  });

  it('shows the server sentence when it refuses the PDF', async () => {
    serve();
    await open();
    openTab(/Letterhead/);
    sr.upload.mockRejectedValueOnce(new Error('Use an A4 portrait template so your letterhead fits the document.'));
    fireEvent.change(screen.getByLabelText('Letterhead PDF (one A4 portrait page, up to 4 MB)'), { target: { files: [pdfFile()] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Use an A4 portrait template so your letterhead fits the document.');
    expect(toast.error).toHaveBeenCalledWith('Use an A4 portrait template so your letterhead fits the document.');
    expect(screen.queryByText('new-letterhead.pdf')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the stored PDF cannot be drawn, and still lets the settings be used', async () => {
    image.pdfPageImage.mockRejectedValue(new Error('broken'));
    serve(workspace({ branding: branding({ backgroundTemplate: letterhead }) }));
    await open();
    openTab(/Letterhead/);
    expect(await screen.findByText('Your letterhead PDF could not be shown on the page below. It is still used on your documents.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove the letterhead PDF' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Leaving document settings', () => {
  // The app's router builds a Request for every move. Node's Request refuses jsdom's AbortSignal, so stand in a plain one.
  class PlainRequest {
    readonly method = 'GET';
    readonly headers = new Headers();
    readonly signal: AbortSignal | null | undefined;
    constructor(readonly url: string, init?: RequestInit) { this.signal = init?.signal; }
  }
  beforeEach(() => { vi.stubGlobal('Request', PlainRequest); });

  const openInApp = async () => {
    const router = createMemoryRouter(
      [
        { path: '/settings', element: <><Link to="/elsewhere">Elsewhere</Link><DocumentSettingsPage /></> },
        { path: '/elsewhere', element: <p>Another page</p> },
      ],
      { initialEntries: ['/settings'] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByLabelText('Company name on documents');
  };
  const leavingIsStopped = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('asks before an unsaved letterhead change is lost, and stays or leaves as chosen', async () => {
    serve();
    await openInApp();
    expect(leavingIsStopped()).toBe(false);
    openTab(/Letterhead/);
    fireEvent.keyDown(letterheadPage().getByRole('button', { name: 'Company name on the page' }), { key: 'ArrowDown' });
    expect(leavingIsStopped()).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const ask = within(await screen.findByRole('alertdialog'));
    expect(ask.getByText('Leave without saving?')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('Another page')).toBeTruthy();
  });

  it('does not ask once the look has been saved, or when nothing changed', async () => {
    serve();
    await openInApp();
    type('Footer', 'samstudio.example · Leeds');
    await savedLook();
    await waitFor(() => expect(leavingIsStopped()).toBe(false));
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByText('Another page')).toBeTruthy();
  });
});
