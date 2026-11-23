// Find leads: search Apollo for people (free), tick the ones wanted, and add
// them as leads (one credit each). Nobody is bought twice.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProspectReveal, ProspectSearch, RevealedPerson } from '../../api/_prospect/shared/types';

const h = vi.hoisted(() => ({
  organization: { isAdmin: true, isOwner: true, organization: { organizationId: 'org-1' } as { organizationId: string } | null },
  workspaceId: 'ws-1' as string | null,
  leads: { items: [] as Array<{ id: string; customFields: Record<string, string> }>, loading: false, error: null, refresh: vi.fn() },
  prospectSetup: vi.fn(),
  searchProspects: vi.fn(),
  revealProspects: vi.fn(),
  listLeadEmails: vi.fn(),
  createContact: vi.fn(),
  ensureCompaniesByName: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.organization }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmContacts: () => h.leads, useWorkspaceForCreate: () => h.workspaceId }));
vi.mock('@/services/prospects/client', () => ({
  prospectSetup: h.prospectSetup,
  searchProspects: h.searchProspects,
  revealProspects: h.revealProspects,
  errorSentence: (e: unknown) => (e instanceof Error && e.message ? e.message : 'The request could not be completed. Please try again.'),
}));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ listLeadEmails: h.listLeadEmails, createContact: h.createContact }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ ensureCompaniesByName: h.ensureCompaniesByName }));

import { setInternalsVisible } from '@/lib/publicError';
import { CrmFindLeadsPage } from '@/pages/crmHub/FindLeads';

const found = (id: string, firstName: string, company = 'Northwind Studio') =>
  ({ id, firstName, lastNameHidden: 'Ro***i', title: 'Head of Operations', company, hasEmail: true });
const FOUND: ProspectSearch = { total: 60, page: 1, perPage: 25, people: [found('p1', 'Elena'), found('p2', 'Priya', 'Fieldway Logistics'), found('p3', 'Tom', 'Harbour Dental')] };

const revealed = (id: string, firstName: string, email: string, companyName = 'Northwind Studio'): RevealedPerson => ({
  id, firstName, lastName: 'Rossi', title: 'Head of Operations', email, emailStatus: 'verified',
  linkedinUrl: `http://www.linkedin.com/in/${id}`, city: 'Leeds', state: '', country: 'United Kingdom',
  company: { name: companyName, website: '', industry: 'design', size: 40, city: 'Leeds', state: '', country: 'United Kingdom', phone: '' },
});

const show = async () => {
  render(<MemoryRouter><CrmFindLeadsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByLabelText('Checking')).toBeNull());
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const search = async () => {
  type('Job titles', 'Head of Operations, COO');
  type('Where they live', 'United Kingdom');
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('table');
};
const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Choose ${name}` }));
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  for (const fn of [h.prospectSetup, h.searchProspects, h.revealProspects, h.listLeadEmails, h.createContact, h.ensureCompaniesByName, h.toast.success, h.toast.error, h.toast.warning, h.leads.refresh]) fn.mockReset();
  h.organization = { isAdmin: true, isOwner: true, organization: { organizationId: 'org-1' } };
  h.workspaceId = 'ws-1';
  h.leads.items = [];
  h.prospectSetup.mockResolvedValue({ configured: true, ready: true, problem: null });
  h.searchProspects.mockResolvedValue(FOUND);
  h.listLeadEmails.mockResolvedValue([]);
  h.ensureCompaniesByName.mockImplementation(async (_org: string, _ws: string, companies: Array<{ name: string }>) =>
    new Map(companies.map((c) => [c.name.toLowerCase(), `co-${c.name.split(' ')[0]!.toLowerCase()}`])));
  h.createContact.mockImplementation(async (input: { firstName: string }) => ({ id: `lead-${input.firstName}` }));
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('who may find leads', () => {
  it('is the owner and admins: anybody else is told so, and nothing is asked of the server', async () => {
    h.organization = { ...h.organization, isAdmin: false, isOwner: false };
    await show();
    expect(screen.getByText('Only the owner and admins can find leads.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(h.prospectSetup).not.toHaveBeenCalled();
  });

  it('needs a workspace to put the leads in', async () => {
    h.workspaceId = null;
    await show();
    expect(screen.getByText(/Pick a workspace in the sidebar first/)).toBeTruthy();
    expect(h.prospectSetup).not.toHaveBeenCalled();
  });
});

describe('while it is not switched on', () => {
  const problem = "Finding leads is not set up yet: APOLLO_API_KEY is missing in Vercel's environment variables.";

  it('tells the people who run the site exactly what is missing', async () => {
    h.prospectSetup.mockResolvedValue({ configured: false, ready: false, problem });
    await show();
    expect(screen.getByText(problem)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('tells everybody else only that it is not switched on', async () => {
    setInternalsVisible(false);
    h.prospectSetup.mockResolvedValue({ configured: false, ready: false, problem });
    await show();
    expect(document.body.textContent).not.toMatch(/APOLLO_API_KEY|Vercel/);
    expect(screen.getByText('This is not switched on yet. Please contact support.')).toBeTruthy();
  });
});

describe('searching', () => {
  it('says what is free and what costs, before anything is pressed', async () => {
    await show();
    expect(screen.getByText(/Searching is free/)).toBeTruthy();
    expect(screen.getByText(/1 Apollo credit/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Only people with a verified email' }) as HTMLInputElement).checked).toBe(true);
  });

  it('sends what was typed, for this workspace, and lists who was found', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Director' }));
    fireEvent.click(screen.getByRole('button', { name: '11–50' }));
    await search();
    expect(h.searchProspects).toHaveBeenCalledWith('ws-1', {
      titles: ['Head of Operations', 'COO'], locations: ['United Kingdom'], keywords: '', domains: [], sizes: ['11,50'], seniorities: ['director'], verifiedOnly: true,
    }, 1);
    expect(screen.getByText('60 people found')).toBeTruthy();
    // The free search shows only part of the last name, and no email.
    expect(within(row('Elena Ro***i')).getByText('Northwind Studio')).toBeTruthy();
    expect(within(row('Priya Ro***i')).getByText('Fieldway Logistics')).toBeTruthy();
    expect(document.body.textContent).not.toContain('@');
  });

  it('asks for something to search by before it asks the server', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(h.searchProspects).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Add at least one thing to search by');
  });

  it('goes to the next page, and back', async () => {
    await show();
    await search();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(h.searchProspects).toHaveBeenLastCalledWith('ws-1', expect.anything(), 2));
  });

  it('says when nobody matches', async () => {
    h.searchProspects.mockResolvedValue({ total: 0, page: 1, perPage: 25, people: [] });
    await show();
    type('Job titles', 'Lion tamer');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Nobody matches. Try fewer or wider filters.')).toBeTruthy();
  });

  it('says so in plain words when the search fails', async () => {
    h.searchProspects.mockRejectedValue(new Error("Apollo's limit for this hour is reached. Try again in a few minutes."));
    await show();
    type('Job titles', 'CEO');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Apollo's limit for this hour is reached. Try again in a few minutes."));
  });
});

describe('adding people as leads', () => {
  const reveal = (people: RevealedPerson[], over: Partial<ProspectReveal> = {}) =>
    h.revealProspects.mockResolvedValue({ people, credits: people.length, notFound: 0, unverified: 0, ...over });

  it('marks a person who is a lead already, and does not let them be bought again', async () => {
    h.leads.items = [{ id: 'lead-9', customFields: { 'Apollo ID': 'p2' } }];
    await show();
    await search();
    expect(within(row('Priya Ro***i')).getByText('Already a lead')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Choose Priya Ro***i' })).toBeNull();
    // "Choose everyone" skips them too.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Choose everyone on this page' }));
    expect(screen.getByRole('button', { name: 'Add 2 to leads' })).toBeTruthy();
  });

  it('says what it will cost, and buys nothing until that is confirmed', async () => {
    reveal([revealed('p1', 'Elena', 'elena@northwind.example'), revealed('p3', 'Tom', 'tom@harbour.example', 'Harbour Dental')]);
    await show();
    await search();
    expect((screen.getByRole('button', { name: 'Add to leads' }) as HTMLButtonElement).disabled).toBe(true);
    tick('Elena Ro***i');
    tick('Tom Ro***i');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to leads' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('up to 2 Apollo credits');
    expect(confirm.textContent).toContain('Phone numbers are not fetched');
    expect(h.revealProspects).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(h.revealProspects).not.toHaveBeenCalled();
  });

  it('adds them with their company, their job and where they came from', async () => {
    reveal([revealed('p1', 'Elena', 'elena@northwind.example'), revealed('p3', 'Tom', 'tom@harbour.example', 'Harbour Dental')]);
    await show();
    await search();
    tick('Elena Ro***i');
    tick('Tom Ro***i');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to leads' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 2 leads' }));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Added 2 leads. 2 Apollo credits used.'));
    expect(h.revealProspects).toHaveBeenCalledWith('ws-1', ['p1', 'p3'], true);
    expect(h.ensureCompaniesByName).toHaveBeenCalledWith('org-1', 'ws-1', [
      expect.objectContaining({ name: 'Northwind Studio', industry: 'design', company_size: '40' }),
      expect.objectContaining({ name: 'Harbour Dental' }),
    ], 'u1');
    expect(h.createContact).toHaveBeenCalledTimes(2);
    expect(h.createContact).toHaveBeenCalledWith({
      organizationId: 'org-1', workspaceId: 'ws-1', firstName: 'Elena', lastName: 'Rossi', email: 'elena@northwind.example',
      jobTitle: 'Head of Operations', companyId: 'co-northwind', source: 'Apollo',
      customFields: { 'Apollo ID': 'p1', LinkedIn: 'http://www.linkedin.com/in/p1', Location: 'Leeds, United Kingdom', 'Email status': 'verified' },
    }, 'u1');
    // They cannot be bought a second time from this list.
    expect(within(row('Elena Ro***i')).getByText('Added')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Choose Elena Ro***i' })).toBeNull();
    expect(h.leads.refresh).toHaveBeenCalled();
  });

  it('does not add somebody whose email is in the CRM already, and says so', async () => {
    h.listLeadEmails.mockResolvedValue(['ELENA@northwind.example']);
    reveal([revealed('p1', 'Elena', 'elena@northwind.example'), revealed('p3', 'Tom', 'tom@harbour.example', 'Harbour Dental')], { unverified: 1 });
    await show();
    await search();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Choose everyone on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 to leads' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 3 leads' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Added 1 lead. 2 Apollo credits used. 1 was already a lead. 1 had no verified email.'));
    expect(h.createContact).toHaveBeenCalledTimes(1);
    expect(h.createContact.mock.calls[0]![0]).toMatchObject({ firstName: 'Tom' });
  });

  it('says why it stopped part-way, after adding who was paid for', async () => {
    reveal([revealed('p1', 'Elena', 'elena@northwind.example')], { stopped: "Apollo's limit for this hour is reached. Try again in a few minutes." });
    await show();
    await search();
    tick('Elena Ro***i');
    tick('Tom Ro***i');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to leads' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 2 leads' }));
    await waitFor(() => expect(h.createContact).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith("Apollo's limit for this hour is reached. Try again in a few minutes."));
    // Tom was not bought: he can still be chosen.
    expect(screen.getByRole('checkbox', { name: 'Choose Tom Ro***i' })).toBeTruthy();
  });

  it('says so in plain words when nothing could be bought', async () => {
    h.revealProspects.mockRejectedValue(new Error('Apollo could not be reached. Please try again.'));
    await show();
    await search();
    tick('Elena Ro***i');
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 to leads' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 1 lead' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Apollo could not be reached. Please try again.'));
    expect(h.createContact).not.toHaveBeenCalled();
  });
});
