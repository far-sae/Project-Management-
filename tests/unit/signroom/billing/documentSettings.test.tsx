// Document settings: how documents look, who emails come from, how long records are kept.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Branding, Workspace } from '../../../../api/_signroom/shared/types';
import { presetDesign } from '../../../../api/_signroom/shared/letterhead';
import {
  brandingBody, brandingFormOf, layoutOf, logoProblem, retentionBody, senderBody,
} from '@/lib/signroom/branding';
import { contentBounds } from '@/lib/signroom/brandingLogo';
import { stubBrowser, workspace } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'sign-in-token' } } }) } },
}));

import { DocumentSettingsPage } from '@/pages/signroom/DocumentSettings';

const branding = (over: Partial<Branding> = {}): Branding => ({
  companyName: 'Sam Studio Ltd', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: 'GB 123 4567 89',
  color: '#24543b', fontSize: 12, fontFamily: 'instrument', footer: 'samstudio.example', layout: 'letterhead',
  logoPosition: 'left', paymentInstructions: 'Pay by bank transfer within 30 days.', ...over,
});

function serve(ws: Workspace = workspace({ branding: branding() }), role: 'Owner' | 'Member' = 'Owner') {
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (path === 'session') return { user: { id: 'u1', email: 'sam@example.com' }, workspaces: [], workspace: ws, role };
    if (path === 'workspaces/branding') return { ...ws, branding: { ...ws.branding, ...body, logo: undefined }, logo: body?.logo || undefined };
    if (path === 'workspaces/email-settings') return { ok: true, mode: 'securovix', ...body };
    if (path === 'workspaces/settings') return { ...ws, ...body };
    throw new Error(`unexpected ${path}`);
  });
}
const open = async () => {
  render(<MemoryRouter><DocumentSettingsPage /></MemoryRouter>);
  await screen.findByLabelText('Company name on documents');
};
const bodyOf = (path: string) => sr.call.mock.calls.find((c) => c[0] === path)?.[1];
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pdfReply = () => new Response(new Blob(['%PDF']), { status: 200, headers: { 'content-type': 'application/pdf' } });

beforeEach(() => {
  stubBrowser();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Document look helpers', () => {
  it('starts a new workspace from its name and the standard look', () => {
    expect(brandingFormOf({ name: 'Sam Studio' })).toEqual({
      companyName: 'Sam Studio', address: '', companyNumber: '', taxNumber: '', logo: '', color: '#24543b',
      fontFamily: 'instrument', fontSize: 12, footer: '', paymentInstructions: '', layout: 'classic',
    });
    expect(layoutOf({ layout: 'minimal', logoPosition: 'left' })).toBe('minimal');
    expect(layoutOf({ layout: 'minimal', logoPosition: 'right' })).toBe('right');
  });

  it('sends the plain fields, and the layout as the server stores it', () => {
    const body = brandingBody({ ...brandingFormOf({ name: 'Sam Studio' }), layout: 'right' }, undefined);
    expect(body).toMatchObject({ companyName: 'Sam Studio', layout: 'letterhead', logoPosition: 'right', logo: '' });
    expect(body).not.toHaveProperty('design');
    expect(brandingBody({ ...brandingFormOf({ name: 'Sam Studio' }), layout: 'minimal' }, undefined)).toMatchObject({ layout: 'minimal', logoPosition: 'left' });
  });

  it('keeps a custom letterhead made earlier unless a different layout is picked', () => {
    const saved = branding({ design: presetDesign('classic', branding()) });
    const form = brandingFormOf({ name: 'Sam Studio', branding: saved });
    expect(brandingBody(form, saved)).not.toHaveProperty('design');
    const changed = brandingBody({ ...form, layout: 'minimal' }, saved);
    expect(changed.design).toMatchObject({ version: 1, accent: false });
  });

  it('refuses a logo that is the wrong kind or too big', () => {
    expect(logoProblem({ type: 'image/png', size: 20_000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 2_000 })).toBe('Use a PNG or JPEG logo.');
    expect(logoProblem({ type: 'image/jpeg', size: 300_001 })).toBe('Choose a logo smaller than 300 KB.');
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
    serve();
    await open();
    expect(sr.call).toHaveBeenCalledWith('session');
    expect((screen.getByLabelText('Company name on documents') as HTMLInputElement).value).toBe('Sam Studio Ltd');
    expect((screen.getByLabelText('Company address') as HTMLTextAreaElement).value).toBe('1 Canal Street\nLeeds');
    expect((screen.getByLabelText('Company registration number') as HTMLInputElement).value).toBe('01234567');
    expect((screen.getByLabelText('Tax or VAT number') as HTMLInputElement).value).toBe('GB 123 4567 89');
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).value).toBe('#24543b');
    expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Instrument Sans');
    expect(screen.getByRole('combobox', { name: 'Layout' }).textContent).toContain('Classic');
    expect((screen.getByLabelText('Footer') as HTMLInputElement).value).toBe('samstudio.example');
    expect((screen.getByLabelText('How to pay (shown on invoices)') as HTMLTextAreaElement).value).toBe('Pay by bank transfer within 30 days.');
    expect((screen.getByLabelText('Sender name') as HTMLInputElement).value).toBe('Sam Studio');
    expect((screen.getByLabelText('Reply-to email address') as HTMLInputElement).value).toBe('hello@samstudio.example');
    expect((screen.getByLabelText('Days to keep a completed agreement') as HTMLInputElement).value).toBe('365');
    expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the look once something has changed', async () => {
    serve();
    await open();
    type('Company name on documents', 'Sam Studio Limited');
    type('Brand colour', '#112233');
    type('Footer', 'samstudio.example · 0113 496 0000');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save document look' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Document look saved. Documents already issued keep the look they had.',
    ));
    expect(bodyOf('workspaces/branding')).toEqual({
      companyName: 'Sam Studio Limited', address: '1 Canal Street\nLeeds', companyNumber: '01234567', taxNumber: 'GB 123 4567 89',
      logo: '', color: '#112233', fontFamily: 'instrument', fontSize: 12, footer: 'samstudio.example · 0113 496 0000',
      paymentInstructions: 'Pay by bank transfer within 30 days.', layout: 'letterhead', logoPosition: 'left',
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save document look' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('changes the layout and the font', async () => {
    serve();
    await open();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Layout' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Logo on the right' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Layout' }).textContent).toContain('Logo on the right'));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Font' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Lora' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Lora'));
    fireEvent.click(screen.getByRole('button', { name: 'Save document look' }));
    await waitFor(() => expect(bodyOf('workspaces/branding')).toMatchObject({ layout: 'letterhead', logoPosition: 'right', fontFamily: 'lora' }));
  });

  it('saves the sender name and reply-to address', async () => {
    serve();
    await open();
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
    type('Days to keep a completed agreement', '730');
    fireEvent.click(screen.getByRole('button', { name: 'Save retention period' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Retention period saved.'));
    expect(bodyOf('workspaces/settings')).toEqual({ name: 'Sam Studio', retentionDays: 730 });
  });

  it('shows the server sentence when a change is refused', async () => {
    serve();
    await open();
    sr.call.mockRejectedValueOnce(new Error('Only workspace owners and admins can change document settings.'));
    type('Company name on documents', 'Another name');
    fireEvent.click(screen.getByRole('button', { name: 'Save document look' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only workspace owners and admins can change document settings.');
    expect(toast.error).toHaveBeenCalledWith('Only workspace owners and admins can change document settings.');
  });

  it('is read-only for a member', async () => {
    serve(workspace({ branding: branding() }), 'Member');
    await open();
    expect(screen.getByText('Only a workspace owner or admin can change these settings.')).toBeTruthy();
    expect((screen.getByLabelText('Company name on documents') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save sender details' }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(JSON.parse(String(init.body))).toMatchObject({ companyName: 'Sam Studio Limited', previewKind: 'invoice', layout: 'letterhead' });
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
