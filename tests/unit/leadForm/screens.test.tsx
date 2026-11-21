// The web form's two screens: the public page a visitor fills in, and the
// window in the CRM where a form is made and its link is copied.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LeadForm } from '@/services/supabase/crmHub/leadForms';

const h = vi.hoisted(() => ({
  listLeadForms: vi.fn(),
  createLeadForm: vi.fn(),
  updateLeadForm: vi.fn(),
  deleteLeadForm: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { user: { userId: 'u1' } },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/components/crmHub/OwnerField', () => ({
  OwnerField: ({ value }: { value: string }) => <div data-testid="owner">{value || 'nobody'}</div>,
}));
vi.mock('@/services/supabase/crmHub/leadForms', async (original) => ({
  ...(await original<typeof import('@/services/supabase/crmHub/leadForms')>()),
  listLeadForms: h.listLeadForms,
  createLeadForm: h.createLeadForm,
  updateLeadForm: h.updateLeadForm,
  deleteLeadForm: h.deleteLeadForm,
}));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));

import { LeadFormPage } from '@/pages/LeadFormPage';
import { LeadFormsDialog } from '@/components/crmHub/LeadFormsDialog';

const FORM_ID = '0f000000-0000-4000-8000-000000000001';
const PUBLIC = { heading: 'Talk to us', intro: 'We answer within a day.', askPhone: true, askCompany: false, askMessage: true, buttonLabel: 'Send it', thankYou: 'Thank you, Elena.' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('web form page', () => {
  const open = (fetchMock: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[`/f/${FORM_ID}`]}>
        <Routes><Route path="/f/:formId" element={<LeadFormPage />} /></Routes>
      </MemoryRouter>,
    );
  };

  it('shows the questions the form asks, and only those', async () => {
    const fetchMock = vi.fn(async () => json(200, PUBLIC));
    open(fetchMock);
    expect(await screen.findByRole('heading', { name: 'Talk to us' })).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/lead-form?id=${FORM_ID}`);
    expect(screen.getByText('We answer within a day.')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText(/^Phone/)).toBeTruthy();
    expect(screen.getByLabelText(/^How can we help/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Company/)).toBeNull();
    // Nothing can be sent before a name and an email are there.
    expect(screen.getByRole('button', { name: 'Send it' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends what was typed and thanks the visitor', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? json(200, { ok: true, thankYou: 'Thank you, Elena.' }) : json(200, PUBLIC)));
    open(fetchMock);
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Elena Rossi' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'elena@northwind.example' } });
    fireEvent.change(screen.getByLabelText(/^How can we help/), { target: { value: 'We need a website.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect((await screen.findByRole('status')).textContent).toBe('Thank you, Elena.');
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/lead-form?id=${FORM_ID}`);
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Elena Rossi', email: 'elena@northwind.example', phone: '', company: '', message: 'We need a website.', website: '' });
    // The form is gone once it has been sent.
    expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull();
  });

  it('keeps the trap field away from people', async () => {
    open(vi.fn(async () => json(200, PUBLIC)));
    await screen.findByLabelText('Your name');
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Website' })).toBeNull();
  });

  it("shows the server's reason and keeps what was typed when sending fails", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? json(429, { error: 'Too many messages were sent from here. Please try again later.' }) : json(200, PUBLIC)));
    open(fetchMock);
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Elena' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'elena@northwind.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Too many messages were sent from here. Please try again later.');
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Elena');
  });

  it('says so when the form is switched off or gone', async () => {
    open(vi.fn(async () => json(404, { error: 'This form is no longer available.' })));
    expect((await screen.findByRole('alert')).textContent).toBe('This form is no longer available.');
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });
});

describe('web forms in the CRM', () => {
  const stored = (over: Partial<LeadForm> = {}): LeadForm => ({
    id: FORM_ID, organizationId: 'org-1', workspaceId: 'ws-1', name: 'Contact form', enabled: true, askPhone: true, askCompany: true, askMessage: true,
    heading: 'Get in touch', intro: '', buttonLabel: 'Send', thankYou: 'Thank you. We will be in touch soon.', source: 'Website form', ownerId: null,
    createdAt: new Date('2026-11-21T10:00:00Z'), ...over,
  });
  const show = () => render(<LeadFormsDialog open onOpenChange={() => undefined} organizationId="org-1" workspaceId="ws-1" />);

  beforeEach(() => {
    h.listLeadForms.mockReset().mockResolvedValue([]);
    h.createLeadForm.mockReset();
    h.updateLeadForm.mockReset();
    h.deleteLeadForm.mockReset().mockResolvedValue(undefined);
    h.toast.success.mockClear();
  });

  it('makes a form and then shows its link and the code for a website', async () => {
    h.createLeadForm.mockResolvedValue(stored({ name: 'Website enquiry' }));
    show();
    expect(await screen.findByText(/No form yet/)).toBeTruthy();
    expect(h.listLeadForms).toHaveBeenCalledWith('ws-1');
    fireEvent.click(screen.getByRole('button', { name: 'New form' }));
    fireEvent.change(screen.getByLabelText('Name of the form'), { target: { value: 'Website enquiry' } });
    fireEvent.click(screen.getByLabelText('Company'));
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));

    await waitFor(() => expect(h.createLeadForm).toHaveBeenCalled());
    expect(h.createLeadForm.mock.calls[0]).toMatchObject(['org-1', 'ws-1', { name: 'Website enquiry', askCompany: false, askPhone: true, enabled: true }, 'u1']);
    const link = (await screen.findByLabelText('Link to the form')) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/f/${FORM_ID}`);
    expect((screen.getByLabelText('Code for your website') as HTMLTextAreaElement).value).toContain(`<iframe src="${window.location.origin}/f/${FORM_ID}"`);
  });

  it('lists the forms with whether they are on, and saves a change', async () => {
    h.listLeadForms.mockResolvedValue([stored(), stored({ id: 'f2', name: 'Old campaign', enabled: false })]);
    h.updateLeadForm.mockImplementation(async (_id: string, input: Partial<LeadForm>) => stored({ ...input }));
    show();
    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Contact formOn', 'Old campaignOff']);
    fireEvent.click(within(rows[0]).getByRole('button'));
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'Ask us anything' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Form is switched on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateLeadForm).toHaveBeenCalled());
    expect(h.updateLeadForm.mock.calls[0]).toMatchObject([FORM_ID, { heading: 'Ask us anything', enabled: false }]);
  });

  it('deletes a form only after a second press', async () => {
    h.listLeadForms.mockResolvedValue([stored()]);
    show();
    fireEvent.click(within((await screen.findAllByRole('listitem'))[0]).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this form' }));
    expect(h.deleteLeadForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(h.deleteLeadForm).toHaveBeenCalledWith(FORM_ID));
  });

  it('says what to run while web forms are not set up', async () => {
    h.listLeadForms.mockRejectedValue(new Error('Web forms are not set up yet: run supabase/migrations/192_crm_lead_forms.sql in the Supabase SQL editor.'));
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('192_crm_lead_forms.sql');
    expect(screen.getByRole('button', { name: 'New form' }).hasAttribute('disabled')).toBe(true);
  });
});
