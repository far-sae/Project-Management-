// Importing a file of leads: names are split, each lead is linked to its company.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; rows: Array<Record<string, unknown>> }>,
  ensure: vi.fn(),
  onImported: vi.fn(),
  listLeadEmails: vi.fn(),
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
vi.mock('@/services/supabase/crmHub/contacts', () => ({ listLeadCategories: async () => [], listLeadEmails: h.listLeadEmails }));
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
  h.listLeadEmails.mockReset().mockResolvedValue([]);
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
    expect(h.ensure).toHaveBeenCalledWith('o', 'w', [{ name: 'northwind studio' }, { name: 'Harbour Dental' }], 'u1');
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.table).toBe('crm_contacts');
    expect(h.inserted[0]!.rows).toMatchObject([
      { first_name: 'Elena', last_name: 'Rossi', company_id: 'c1', owner_id: 'u1', workspace_id: 'w' },
      { first_name: 'Tom', last_name: 'Okafor', company_id: 'c-new', owner_id: 'u1', workspace_id: 'w' },
    ]);
  });

  it('leaves out a lead that is already in the CRM, matched by email, unless told to add it again', async () => {
    h.listLeadEmails.mockResolvedValue(['  ELENA@Northwind.example ']);
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload(FILE);
    await screen.findByText('leads.csv');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const box = (await screen.findByRole('checkbox', { name: /Leave out 1 lead that is already in the CRM/ })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(h.listLeadEmails).toHaveBeenCalledWith('o', 'w');
    expect(screen.getByText('1 lead will be added')).toBeTruthy();

    // Unticked, the lead is added again.
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: /import 2 leads/i })).toBeTruthy();
    fireEvent.click(box);

    fireEvent.click(screen.getByRole('button', { name: /import 1 lead$/i }));
    await waitFor(() => expect(h.onImported).toHaveBeenCalled());
    expect(h.inserted[0]!.rows).toMatchObject([{ first_name: 'Tom', last_name: 'Okafor' }]);
    // Only the company of the lead that is added is looked up.
    expect(h.ensure).toHaveBeenCalledWith('o', 'w', [{ name: 'Harbour Dental' }], 'u1');
  });

  it('adds a lead once when the file lists it twice', async () => {
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload(['Name,Company,Email', 'Elena Rossi,Northwind,elena@northwind.example', 'E. Rossi,Northwind,Elena@Northwind.example', 'No Email,Northwind,', 'No Email,Northwind,'].join('\n'));
    await screen.findByText('leads.csv');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('checkbox', { name: /Leave out 1 lead that is already in the CRM or repeated in this file/ })).toBeTruthy();
    // Leads with no email cannot be compared, so both are kept.
    expect(screen.getByRole('button', { name: /import 3 leads/i })).toBeTruthy();
  });

  it('says so when the leads already in the CRM could not be read', async () => {
    h.listLeadEmails.mockRejectedValue(new Error('down'));
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload(FILE);
    await screen.findByText('leads.csv');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/duplicates are not checked this time/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /import 2 leads/i })).toBeTruthy();
  });

  it('lines up a file from the old Clients export and imports each company with its lead', async () => {
    h.ensure.mockResolvedValue(new Map([['harbour cafe', 'c-cafe']]));
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" onImported={h.onImported} />);
    upload([
      'name,legal_name,industry,category,type,status,website,email,phone,city,tags,account_owner_name,tax_id,notes',
      'Harbour Cafe,,Hospitality,customer,active,harbourcafe.example,hello@harbourcafe.example,+15551112222,Boston,vip;hot,Sam Example',
    ].join('\n'));

    await screen.findByText('leads.csv');
    expect(screen.getByText(/one column out of line/i)).toBeTruthy();
    expect(screen.getByLabelText('Field for column name').textContent).toContain('Company');
    expect(screen.getByLabelText('Field for column email').textContent).toContain('Email');
    expect(screen.getByLabelText('Field for column tags').textContent).toContain('custom field');
    expect(screen.queryByLabelText('Field for column tax_id')).toBeNull();
    expect(screen.queryByLabelText('Field for column category')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /import 1 lead/i }));

    await waitFor(() => expect(h.onImported).toHaveBeenCalled());
    expect(h.ensure.mock.calls[0]![2]).toEqual([{
      name: 'Harbour Cafe', website: 'harbourcafe.example', industry: 'Hospitality', city: 'Boston',
      email: 'hello@harbourcafe.example', phone: '+15551112222',
    }]);
    expect(h.inserted[0]!.rows).toMatchObject([{
      first_name: 'Harbour Cafe', email: 'hello@harbourcafe.example', phone: '+15551112222', company_id: 'c-cafe',
      lifecycle_stage: 'customer', custom_fields: { tags: 'vip;hot', account_owner_name: 'Sam Example' },
    }]);
  });

  it('asks for a name column when the file has none', async () => {
    render(<CsvImportWizard open onOpenChange={() => {}} resource="contacts" />);
    upload('Notes,Score\nMet at the fair,4');
    await screen.findByText('leads.csv');
    expect(screen.getByText(/match a column to full name, first name, email or company/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('an Excel workbook', () => {
  // A workbook with one sheet: Name and Email, one row. Built like Excel builds it.
  const workbook = async (): Promise<Uint8Array> => {
    const { strToU8, zipSync } = await import('fflate');
    const u8 = (text: string) => new Uint8Array(strToU8(text));
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    return zipSync({
      'xl/worksheets/sheet1.xml': u8(`<worksheet ${ns}><sheetData><row r="1">${cell('A1', 'Name')}${cell('B1', 'Email')}</row><row r="2">${cell('A2', 'Elena Rossi')}${cell('B2', 'elena@northwind.example')}</row></sheetData></worksheet>`),
    });
  };
  const give = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('is read like a CSV: its headings are matched and its rows counted', async () => {
    const bytes = await workbook();
    const file = new File([bytes], 'Leads.xlsx');
    // jsdom's File has no arrayBuffer(); the browser's has.
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    render(<CsvImportWizard open onOpenChange={() => undefined} resource="contacts" onImported={h.onImported} />);
    give(file);
    expect(await screen.findByText(/Leads\.xlsx/)).toBeTruthy();
    expect(screen.getByText(/1 row/)).toBeTruthy();
  });

  it('asks for .xlsx or CSV when given the old Excel format', async () => {
    render(<CsvImportWizard open onOpenChange={() => undefined} resource="contacts" onImported={h.onImported} />);
    give(new File(['x'], 'old.xls'));
    const { toast } = await import('sonner');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Save the sheet as Excel workbook (.xlsx) or as CSV first, then choose that file.'));
  });
});
