// Telling when a lead is already in the CRM: same email address, nothing else.
import { describe, expect, it } from 'vitest';
import { emailKey, findLeadByEmail, splitDuplicateLeads } from '@/lib/crmDuplicates';

const row = (email: string | null, name = 'x') => ({ record: { first_name: name, email } });

describe('duplicate leads', () => {
  it('compares email addresses without capitals or spaces around them', () => {
    expect(emailKey('  Elena@Northwind.Example ')).toBe('elena@northwind.example');
    expect(emailKey(null)).toBe('');
    expect(emailKey(42)).toBe('');
  });

  it('finds the lead that already has an email address', () => {
    const leads = [{ id: 'a', email: 'elena@northwind.example' }, { id: 'b', email: null }];
    expect(findLeadByEmail(leads, ' ELENA@northwind.example')?.id).toBe('a');
    expect(findLeadByEmail(leads, 'tom@harbour.example')).toBeNull();
    // No email, nothing to compare: never a duplicate, even of another lead without one.
    expect(findLeadByEmail(leads, '')).toBeNull();
    expect(findLeadByEmail(leads, null)).toBeNull();
  });

  it('leaves out rows already in the CRM and rows repeated in the file, keeping the first', () => {
    const rows = [row('elena@northwind.example', 'first'), row('tom@harbour.example'), row('ELENA@northwind.example', 'again'), row('priya@fieldway.example')];
    const out = splitDuplicateLeads(rows, ['Tom@Harbour.example']);
    expect(out.fresh.map((r) => r.record.first_name + ':' + r.record.email)).toEqual(['first:elena@northwind.example', 'x:priya@fieldway.example']);
    expect(out.duplicates).toHaveLength(2);
  });

  it('never calls a row without an email a duplicate', () => {
    const out = splitDuplicateLeads([row(null), row(null), row('')], ['', 'someone@example.com']);
    expect(out.fresh).toHaveLength(3);
    expect(out.duplicates).toEqual([]);
  });
});
