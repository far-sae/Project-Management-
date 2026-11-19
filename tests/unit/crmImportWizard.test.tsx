// Importing a file of leads: names are split, each lead is linked to its company.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; rows: Array<Record<string, unknown>> }>,
  ensure: vi.fn(),
  onImported: vi.fn(),
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        h.inserted.push({ table, rows });
        return { error: null };
      },
    }),
  },
}));
vi.mock('@/services/supabase/crmHub/companies', () => ({ ensureCompaniesByName: h.ensure }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ listLeadCategories: async () => [] }));
vi.mock('@/hooks/useCrmHub', () => ({
  useWorkspaceForCreate: () => 'w',
  useCrmCompanies: () => ({
    items: [{ id: 'c1', name: 'Northwind Studio' }], loading: false, error: null, refresh: async () => {},
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'o',
      members: [
        { userId: 'u1', displayName: 'Sam', email: 'sam@example.com', role: 'owner', status: 'active' },
        { userId: 'u2', displayName: 'Priya', email: 'priya@example.com', role: 'member', status: 'active' },
      ],
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CsvImportWizard } from '@/components/crmHub/CsvImportWizard';

const FILE = [
  'Name,Company,Email',
  'Elena Rossi,northwind studio,elena@northwind.example',
  'Tom Okafor,Harbour Dental,tom@harbour.example',
  ',,',
].join('\n');

const upload = (text: string, name = 'leads.csv') => {
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => text });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  h.inserted = [];
  h.ensure.mockReset();
  h.ensure.mockResolvedValue(new Map([['northwind studio', 'c1'], ['harbour dental', 'c-new']]));
  h.onImported.mockReset();
});
afterEach(cleanup);

describe('Lead import', () => {
  it('matches the columns without help and says what will happen', async () => {
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload(FILE);

    await screen.findByText('leads.csv');
    expect(screen.getByLabelText('Field for column Name').textContent).toContain('Full name');
    expect(screen.getByLabelText('Field for column Company').textContent).toContain('Company');
    expect(screen.getByLabelText('Field for column Email').textContent).toContain('Email');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText(/2 leads will be added/i)).toBeTruthy();
    expect(screen.getByText(/linked to 2 companies/i)).toBeTruthy();
    expect(screen.getByText(/1 new company will be created/i)).toBeTruthy();
  });

  it('adds the leads linked to their companies', async () => {
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload(FILE);
    await screen.findByText('leads.csv');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /import 2 leads/i }));

    await waitFor(() => expect(h.onImported).toHaveBeenCalled());
    expect(h.ensure).toHaveBeenCalledWith('o', 'w', ['northwind studio', 'Harbour Dental'], 'u1');
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.table).toBe('crm_contacts');
    expect(h.inserted[0]!.rows).toMatchObject([
      { first_name: 'Elena', last_name: 'Rossi', company_id: 'c1', owner_id: 'u1', workspace_id: 'w' },
      { first_name: 'Tom', last_name: 'Okafor', company_id: 'c-new', owner_id: 'u1', workspace_id: 'w' },
    ]);
  });

  it('asks for a name column when the file has none', async () => {
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" />);
    upload('Notes,Score\nMet at the fair,4');
    await screen.findByText('leads.csv');
    expect(screen.getByText(/match a column to full name, first name, email or company/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
