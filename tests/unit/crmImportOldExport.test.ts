// Importing a file exported by the old Clients module: its values sit one column
// to the left of their headings, and each row is a company, not a person.
import { describe, expect, it } from 'vitest';
import {
  autoMapColumns, buildLeadImport, realignShiftedColumns, type ImportField,
} from '@/lib/crmImport';
import { parseCSVTable, tableToRecords } from '@/lib/csv';

const OLD_EXPORT = [
  'name,legal_name,industry,category,type,status,website,email,phone,address_line1,address_line2,city,state,postal_code,country,annual_revenue,employee_count,rating,source,description,tags,account_owner_name,account_number,tax_id,primary_contact_name,primary_contact_email,lifecycle_stage,notes',
  "Harbour Cafe,,Hospitality,customer,active,harbourcafe.example,hello@harbourcafe.example,+15551112222,12 Main St,,Boston,MA,02108,USA,500000,5,Active,Web Research,Interested in a yearly contract.,vip;hot,Sam Example",
  'Northwind Studio,,Software,customer,active,www.northwind.example,info@northwind.example,02079460101,128 City Road,,London,United Kingdom,EC1V 2NX,United Kingdom,2000000,200,Active,Online Store,,,Sam Example',
].join('\n');

const LEAD_FIELDS: ImportField[] = [
  { key: 'full_name', label: 'Full name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'job_title', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'company_website', label: 'Company website' },
  { key: 'company_industry', label: 'Company industry' },
  { key: 'company_address', label: 'Company address' },
  { key: 'company_city', label: 'Company city' },
  { key: 'company_country', label: 'Company country' },
  { key: 'company_size', label: 'Company size' },
  { key: 'company_revenue', label: 'Company revenue' },
  { key: 'source', label: 'Source' },
  { key: 'lifecycle_stage', label: 'Lifecycle stage' },
  { key: 'lead_status', label: 'Lead status' },
  { key: 'category', label: 'Category' },
];

const read = (text: string) => {
  const table = parseCSVTable(text);
  const fixed = realignShiftedColumns(table.headers, table.rows);
  return { ...fixed, records: tableToRecords(fixed.headers, table.rows) };
};

describe('realignShiftedColumns', () => {
  it('lines the values up with their headings again and says which heading had no values', () => {
    const { dropped, records } = read(OLD_EXPORT);
    expect(dropped).toBe('category');
    expect(records[0]).toMatchObject({
      name: 'Harbour Cafe', industry: 'Hospitality', type: 'customer', status: 'active',
      website: 'harbourcafe.example', email: 'hello@harbourcafe.example', phone: '+15551112222',
      address_line1: '12 Main St', city: 'Boston', country: 'USA', annual_revenue: '500000',
      employee_count: '5', source: 'Web Research', tags: 'vip;hot', account_owner_name: 'Sam Example',
    });
    expect(records[1]).toMatchObject({ email: 'info@northwind.example', city: 'London', postal_code: 'EC1V 2NX' });
  });

  it('leaves a file alone when its values are under the right headings', () => {
    const good = 'name,website,email,phone\nHarbour Cafe,harbourcafe.example,hello@harbourcafe.example,+15551112222';
    const { dropped, headers } = read(good);
    expect(dropped).toBeNull();
    expect(headers).toEqual(['name', 'website', 'email', 'phone']);
  });

  it('leaves a file alone when nothing in it can be checked', () => {
    expect(read('name,notes,score\nHarbour Cafe,met at the fair').dropped).toBeNull();
  });

  it('does not guess when dropping a heading would not fix every row', () => {
    const mixed = [
      'name,category,website,email',
      'Harbour Cafe,harbourcafe.example,hello@harbourcafe.example',
      'Northwind Studio,vip,not a website,also not an email',
    ].join('\n');
    expect(read(mixed).dropped).toBeNull();
  });
});

describe('a file of companies imported as leads', () => {
  const { records, headers } = read(OLD_EXPORT);
  const filled = headers.filter((h) => records.some((r) => r[h]?.trim()));
  const mapping = autoMapColumns(filled, LEAD_FIELDS);

  it('reads “name” as the company when the file is about companies', () => {
    expect(mapping).toMatchObject({
      name: 'company', website: 'company_website', industry: 'company_industry',
      address_line1: 'company_address', city: 'company_city', country: 'company_country',
      employee_count: 'company_size', annual_revenue: 'company_revenue',
      email: 'email', phone: 'phone', source: 'source', type: 'lifecycle_stage',
    });
  });

  it('still reads “name” as a person in a plain list of people', () => {
    expect(autoMapColumns(['name', 'email', 'phone'], LEAD_FIELDS)).toMatchObject({ name: 'full_name' });
  });

  it('creates one lead per company, named after it, carrying the company’s details', () => {
    const { leads, skipped } = buildLeadImport(records, mapping, {}, {
      organizationId: 'o', workspaceId: 'w', category: null, company: null, owners: ['u1'],
    });
    expect(skipped).toBe(0);
    expect(leads).toHaveLength(2);
    expect(leads[0]!.record).toMatchObject({
      first_name: 'Harbour Cafe', last_name: null, email: 'hello@harbourcafe.example', phone: '+15551112222',
      source: 'Web Research', lifecycle_stage: 'customer',
    });
    expect(leads[0]!.companyName).toBe('Harbour Cafe');
    expect(leads[0]!.companyDetails).toEqual({
      website: 'harbourcafe.example', industry: 'Hospitality', address: '12 Main St', city: 'Boston',
      country: 'USA', company_size: '5', annual_revenue: 500000,
      email: 'hello@harbourcafe.example', phone: '+15551112222',
    });
  });

  it('keeps a person’s own email and phone off the company', () => {
    const { leads } = buildLeadImport(
      [{ Name: 'Elena Rossi', Org: 'Northwind Studio', Mail: 'elena@northwind.example', Site: 'northwind.example' }],
      { Name: 'full_name', Org: 'company', Mail: 'email', Site: 'company_website' }, {},
      { organizationId: 'o', workspaceId: 'w', category: null, company: null, owners: ['u1'] },
    );
    expect(leads[0]!.companyDetails).toEqual({ website: 'northwind.example' });
  });
});
