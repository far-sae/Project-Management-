// Importing leads: columns are matched by meaning, names are split, companies are linked.
import { describe, expect, it } from 'vitest';
import {
  SKIP, autoMapColumns, buildCompanyImport, buildLeadImport, companyKey, importOwners, splitFullName,
  type ImportField,
} from '@/lib/crmImport';
import { parseCSV } from '@/lib/csv';

const LEAD_FIELDS: ImportField[] = [
  { key: 'full_name', label: 'Full name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'job_title', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'source', label: 'Source' },
  { key: 'lifecycle_stage', label: 'Lifecycle stage' },
  { key: 'lead_status', label: 'Lead status' },
  { key: 'category', label: 'Category' },
];
const COMPANY_FIELDS: ImportField[] = [
  { key: 'name', label: 'Company name', required: true },
  { key: 'website', label: 'Website' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'annual_revenue', label: 'Annual revenue' },
];

describe('autoMapColumns', () => {
  it('matches columns by what they mean, in any order', () => {
    expect(autoMapColumns(['Mobile', 'Company', 'Email Address', 'Full Name'], LEAD_FIELDS)).toEqual({
      Mobile: 'phone', Company: 'company', 'Email Address': 'email', 'Full Name': 'full_name',
    });
  });

  it('treats a lone “Name” column as the full name', () => {
    expect(autoMapColumns(['Name', 'Email'], LEAD_FIELDS)).toEqual({ Name: 'full_name', Email: 'email' });
  });

  it('keeps first and last name apart when the file has both', () => {
    expect(autoMapColumns(['Last Name', 'First Name'], LEAD_FIELDS)).toEqual({
      'Last Name': 'last_name', 'First Name': 'first_name',
    });
  });

  it('reads the usual business headings', () => {
    expect(autoMapColumns(['Contact Name', 'Company Name', 'Title', 'Status', 'Lead Source', 'Tel'], LEAD_FIELDS)).toEqual({
      'Contact Name': 'full_name', 'Company Name': 'company', Title: 'job_title', Status: 'lead_status',
      'Lead Source': 'source', Tel: 'phone',
    });
  });

  it('never gives two columns the same field', () => {
    expect(autoMapColumns(['Email', 'Work Email', 'Notes'], LEAD_FIELDS)).toEqual({
      Email: 'email', 'Work Email': SKIP, Notes: SKIP,
    });
  });

  it('prefers the exact heading over a loose one, whichever comes first', () => {
    expect(autoMapColumns(['Work Email', 'Email'], LEAD_FIELDS)).toEqual({ 'Work Email': SKIP, Email: 'email' });
  });

  it('maps a company file by company name', () => {
    expect(autoMapColumns(['Company', 'Website', 'Revenue'], COMPANY_FIELDS)).toEqual({
      Company: 'name', Website: 'website', Revenue: 'annual_revenue',
    });
  });
});

describe('splitFullName', () => {
  it('splits first and last name', () => {
    expect(splitFullName('Elena Rossi')).toEqual({ firstName: 'Elena', lastName: 'Rossi' });
  });
  it('keeps everything after the first word as the last name', () => {
    expect(splitFullName('  Mary  Jane van der Berg ')).toEqual({ firstName: 'Mary', lastName: 'Jane van der Berg' });
  });
  it('understands “Last, First”', () => {
    expect(splitFullName('Rossi, Elena')).toEqual({ firstName: 'Elena', lastName: 'Rossi' });
  });
  it('leaves a single name as the first name', () => {
    expect(splitFullName('Marcus')).toEqual({ firstName: 'Marcus', lastName: null });
  });
});

describe('companyKey', () => {
  it('ignores case and spacing so the same company is not added twice', () => {
    expect(companyKey('  Northwind   Studio ')).toBe(companyKey('northwind studio'));
  });
});

describe('importOwners', () => {
  const team = ['u1', 'u2', 'u3'];
  it('gives every lead to me', () => {
    expect(importOwners('me', 'u1', team)).toEqual(['u1']);
  });
  it('leaves leads without an owner', () => {
    expect(importOwners('none', 'u1', team)).toEqual([null]);
  });
  it('shares leads between the team', () => {
    expect(importOwners('team', 'u1', team)).toEqual(team);
  });
  it('gives every lead to one chosen person', () => {
    expect(importOwners('u2', 'u1', team)).toEqual(['u2']);
  });
});

describe('buildLeadImport', () => {
  const base = { organizationId: 'o', workspaceId: 'w', category: null, company: null, owners: ['u1'] };

  it('splits a full name and remembers the company to link', () => {
    const { leads, skipped } = buildLeadImport(
      [{ Name: 'Elena Rossi', Org: 'Northwind Studio', Mail: 'elena@northwind.example' }],
      { Name: 'full_name', Org: 'company', Mail: 'email' }, {}, base,
    );
    expect(skipped).toBe(0);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.companyName).toBe('Northwind Studio');
    expect(leads[0]!.record).toMatchObject({
      organization_id: 'o', workspace_id: 'w', owner_id: 'u1',
      first_name: 'Elena', last_name: 'Rossi', email: 'elena@northwind.example',
    });
    expect(leads[0]!.record).not.toHaveProperty('company');
    expect(leads[0]!.record).not.toHaveProperty('full_name');
  });

  it('lets separate first and last name columns win over the full name', () => {
    const { leads } = buildLeadImport(
      [{ A: 'Tom', B: 'Okafor', C: 'Thomas J Okafor' }],
      { A: 'first_name', B: 'last_name', C: 'full_name' }, {}, base,
    );
    expect(leads[0]!.record).toMatchObject({ first_name: 'Tom', last_name: 'Okafor' });
  });

  it('names a lead from the email or the company when the name is empty', () => {
    const { leads } = buildLeadImport(
      [{ Name: '', Mail: 'priya.nair@harbour.example', Org: '' }, { Name: '', Mail: '', Org: 'Fieldway Logistics' }],
      { Name: 'full_name', Mail: 'email', Org: 'company' }, {}, base,
    );
    expect(leads.map((l) => l.record.first_name)).toEqual(['priya.nair', 'Fieldway Logistics']);
  });

  it('skips rows with nothing to call the lead, and counts them', () => {
    const { leads, skipped } = buildLeadImport(
      [{ Name: 'Aisha Khan', Phone: '1' }, { Name: '', Phone: '2' }],
      { Name: 'full_name', Phone: 'phone' }, {}, base,
    );
    expect(leads).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('shares the leads between owners in turn', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ Name: n }));
    const { leads } = buildLeadImport(rows, { Name: 'full_name' }, {}, { ...base, owners: ['u1', 'u2'] });
    expect(leads.map((l) => l.record.owner_id)).toEqual(['u1', 'u2', 'u1', 'u2', 'u1']);
  });

  it('uses the chosen company and category for rows that have none', () => {
    const { leads } = buildLeadImport(
      [{ Name: 'Jon Petrov', Org: '' }, { Name: 'Aisha Khan', Org: 'Harbour Dental' }],
      { Name: 'full_name', Org: 'company' }, {}, { ...base, company: 'Northwind Studio', category: 'Trade show' },
    );
    expect(leads.map((l) => l.companyName)).toEqual(['Northwind Studio', 'Harbour Dental']);
    expect(leads.map((l) => l.record.category)).toEqual(['Trade show', 'Trade show']);
  });

  it('keeps a per-row category and drops step values the database would reject', () => {
    const { leads } = buildLeadImport(
      [{ Name: 'Jon Petrov', Cat: 'VIP', Status: 'Attempted to contact', Stage: 'Whatever' }],
      { Name: 'full_name', Cat: 'category', Status: 'lead_status', Stage: 'lifecycle_stage' }, {},
      { ...base, category: 'Trade show' },
    );
    expect(leads[0]!.record.category).toBe('VIP');
    expect(leads[0]!.record.lead_status).toBe('attempted_to_contact');
    expect(leads[0]!.record.lifecycle_stage).toBe('lead');
  });

  it('gives every row the same columns, so one empty cell cannot fail the whole import', () => {
    const { leads } = buildLeadImport(
      [{ Name: 'Jon Petrov', Status: 'connected', Extra: 'x' }, { Name: 'Aisha Khan', Status: '', Extra: '' }],
      { Name: 'full_name', Status: 'lead_status', Extra: '__custom__' }, {}, base,
    );
    expect(Object.keys(leads[1]!.record).sort()).toEqual(Object.keys(leads[0]!.record).sort());
    expect(leads[1]!.record).toMatchObject({ lead_status: 'new', lifecycle_stage: 'lead', custom_fields: {}, email: null });
  });

  it('stores unmapped extras as custom fields', () => {
    const { leads } = buildLeadImport(
      [{ Name: 'Jon Petrov', 'Team Size': '12' }],
      { Name: 'full_name', 'Team Size': '__custom__' }, { 'Team Size': 'team_size' }, base,
    );
    expect(leads[0]!.record.custom_fields).toEqual({ team_size: '12' });
  });
});

describe('buildCompanyImport', () => {
  it('reads the revenue as a number and skips rows without a name', () => {
    const { records, skipped } = buildCompanyImport(
      [{ Company: 'Northwind Studio', Revenue: '£1,200,000' }, { Company: '', Revenue: '5' }],
      { Company: 'name', Revenue: 'annual_revenue' }, {}, { organizationId: 'o', workspaceId: 'w', ownerId: 'u1' },
    );
    expect(skipped).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      organization_id: 'o', workspace_id: 'w', owner_id: 'u1', name: 'Northwind Studio', annual_revenue: 1200000,
      website: null, custom_fields: {},
    });
  });
});

describe('parseCSV', () => {
  it('reads a file saved by a spreadsheet: byte-order mark, Windows line ends, spaces in headings', () => {
    const rows = parseCSV('﻿Name , Email\r\nElena Rossi,elena@northwind.example\r\n');
    expect(rows).toEqual([{ Name: 'Elena Rossi', Email: 'elena@northwind.example' }]);
  });

  it('reads semicolon and tab separated files', () => {
    expect(parseCSV('Name;Email\nTom;tom@fieldway.example')).toEqual([{ Name: 'Tom', Email: 'tom@fieldway.example' }]);
    expect(parseCSV('Name\tEmail\nTom\ttom@fieldway.example')).toEqual([{ Name: 'Tom', Email: 'tom@fieldway.example' }]);
  });

  it('keeps commas and line breaks that sit inside quotes', () => {
    const rows = parseCSV('Name,Notes\n"Rossi, Elena","Line one\nLine two"\nTom,ok');
    expect(rows).toEqual([
      { Name: 'Rossi, Elena', Notes: 'Line one\nLine two' },
      { Name: 'Tom', Notes: 'ok' },
    ]);
  });

  it('ignores empty lines and empty headings', () => {
    const rows = parseCSV('Name,,Email\n\nTom,x,tom@fieldway.example\n,,\n');
    expect(rows).toEqual([{ Name: 'Tom', Email: 'tom@fieldway.example' }]);
  });
});
