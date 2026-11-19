// A company record: what kind of company it is, where it is, and what is going on with it.
import { describe, expect, it } from 'vitest';
import {
  COMPANY_TYPES, companyAddressLines, companyDomain, companyRelationship, companyRollups,
  filterCompanies, sortCompanies, websiteHref,
} from '@/lib/crmCompany';

const day = (n: number) => new Date(2026, 10, n, 10, 0);

const company = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, website: null, industry: null, type: null, ownerId: null, address: null, city: null,
  state: null, postalCode: null, country: null, updatedAt: day(1), ...over,
});

describe('companyDomain and websiteHref', () => {
  it('shows just the domain, however the website was typed', () => {
    expect(companyDomain('https://www.northwind.example/about?x=1')).toBe('northwind.example');
    expect(companyDomain('Northwind.Example')).toBe('northwind.example');
    expect(companyDomain('  ')).toBeNull();
    expect(companyDomain(null)).toBeNull();
  });
  it('makes a link that opens, with or without the https part', () => {
    expect(websiteHref('northwind.example')).toBe('https://northwind.example');
    expect(websiteHref('http://northwind.example')).toBe('http://northwind.example');
    expect(websiteHref(null)).toBeNull();
  });
});

describe('companyAddressLines', () => {
  it('lays the address out the way it is written on a letter', () => {
    expect(companyAddressLines(company('c', {
      address: '128 City Road', city: 'London', state: 'Greater London', postalCode: 'EC1V 2NX', country: 'United Kingdom',
    }))).toEqual(['128 City Road', 'London, Greater London EC1V 2NX', 'United Kingdom']);
  });
  it('leaves out what is not known', () => {
    expect(companyAddressLines(company('c', { city: 'Boston', country: 'USA' }))).toEqual(['Boston', 'USA']);
    expect(companyAddressLines(company('c'))).toEqual([]);
  });
});

describe('companyRelationship', () => {
  it('uses the type someone chose', () => {
    expect(companyRelationship({ type: 'Partner' }, { wonDeals: 3, openDeals: 0 })).toMatchObject({ label: 'Partner', chosen: true });
  });
  it('reads an imported “customer” as Customer', () => {
    expect(companyRelationship({ type: 'customer' }, undefined)).toMatchObject({ label: 'Customer', tone: 'success', chosen: true });
  });
  it('works it out from the deals when nobody chose: a won deal makes a customer', () => {
    expect(companyRelationship({ type: null }, { wonDeals: 1, openDeals: 0 })).toMatchObject({ label: 'Customer', tone: 'success', chosen: false });
    expect(companyRelationship({ type: null }, { wonDeals: 0, openDeals: 2 })).toMatchObject({ label: 'Prospect', chosen: false });
    expect(companyRelationship({ type: '' }, { wonDeals: 0, openDeals: 0 })).toMatchObject({ label: 'Prospect' });
  });
  it('offers the usual kinds of company', () => {
    expect(COMPANY_TYPES).toEqual(['Prospect', 'Customer', 'Partner', 'Supplier', 'Reseller', 'Competitor', 'Other']);
  });
});

describe('companyRollups', () => {
  const rollups = companyRollups({
    contacts: [{ companyId: 'c1' }, { companyId: 'c1' }, { companyId: 'c2' }, { companyId: null }],
    deals: [
      { companyId: 'c1', status: 'open', value: 4000, updatedAt: day(5) },
      { companyId: 'c1', status: 'open', value: 1000, updatedAt: day(3) },
      { companyId: 'c1', status: 'won', value: 9500, updatedAt: day(2) },
      { companyId: 'c2', status: 'lost', value: 7000, updatedAt: day(4) },
    ],
    activities: [{ companyId: 'c2', createdAt: day(9) }, { companyId: 'c1', createdAt: day(4) }],
  });

  it('counts each company’s leads and deals and adds up their value', () => {
    expect(rollups.get('c1')).toMatchObject({ leads: 2, openDeals: 2, openValue: 5000, wonDeals: 1, wonValue: 9500 });
    expect(rollups.get('c2')).toMatchObject({ leads: 1, openDeals: 0, openValue: 0, wonDeals: 0, wonValue: 0 });
  });
  it('knows when something last happened with the company', () => {
    expect(rollups.get('c1')!.lastActivityAt).toEqual(day(5));
    expect(rollups.get('c2')!.lastActivityAt).toEqual(day(9));
  });
  it('has nothing for a company with no leads, deals or activity', () => {
    expect(rollups.get('c3')).toBeUndefined();
  });
});

describe('filterCompanies and sortCompanies', () => {
  const list = [
    company('Northwind Studio', { website: 'northwind.example', industry: 'Software', city: 'London', type: 'Customer', ownerId: 'u1' }),
    company('Harbour Dental', { industry: 'Healthcare', city: 'Leeds', ownerId: 'u2' }),
    company('Fieldway Logistics', { industry: 'Logistics', city: 'Hull' }),
  ];
  const rollups = companyRollups({
    contacts: [],
    deals: [
      { companyId: 'Harbour Dental', status: 'won', value: 6000, updatedAt: day(8) },
      { companyId: 'Fieldway Logistics', status: 'open', value: 18000, updatedAt: day(6) },
    ],
    activities: [{ companyId: 'Northwind Studio', createdAt: day(7) }],
  });
  const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name);

  it('searches name, domain, industry and city', () => {
    const find = (search: string) => names(filterCompanies(list, rollups, { search, type: 'all', owner: 'all', meId: 'u1' }));
    expect(find('north')).toEqual(['Northwind Studio']);
    expect(find('example')).toEqual(['Northwind Studio']);
    expect(find('health')).toEqual(['Harbour Dental']);
    expect(find('hull')).toEqual(['Fieldway Logistics']);
  });
  it('filters by kind of company, counting the worked-out kind too', () => {
    const of = (type: string) => names(filterCompanies(list, rollups, { search: '', type, owner: 'all', meId: 'u1' }));
    expect(of('Customer')).toEqual(['Northwind Studio', 'Harbour Dental']);
    expect(of('Prospect')).toEqual(['Fieldway Logistics']);
  });
  it('filters by owner: mine, or nobody’s', () => {
    const by = (owner: 'all' | 'mine' | 'none') => names(filterCompanies(list, rollups, { search: '', type: 'all', owner, meId: 'u1' }));
    expect(by('mine')).toEqual(['Northwind Studio']);
    expect(by('none')).toEqual(['Fieldway Logistics']);
  });
  it('sorts by name, by latest activity, or by open pipeline', () => {
    expect(names(sortCompanies(list, rollups, 'name'))).toEqual(['Fieldway Logistics', 'Harbour Dental', 'Northwind Studio']);
    expect(names(sortCompanies(list, rollups, 'activity'))).toEqual(['Harbour Dental', 'Northwind Studio', 'Fieldway Logistics']);
    expect(names(sortCompanies(list, rollups, 'pipeline'))).toEqual(['Fieldway Logistics', 'Harbour Dental', 'Northwind Studio']);
  });
});
