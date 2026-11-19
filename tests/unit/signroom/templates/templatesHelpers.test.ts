// The small rules behind the templates list: the search, the order, older versions, and the roles summary.
import { describe, expect, it } from 'vitest';
import { filterTemplates, isOlderVersion, roleSummaries } from '@/lib/signroom/templates';
import { templateRows } from './fixtures';

describe('filterTemplates', () => {
  it('orders by name, newest version first', () => {
    expect(filterTemplates(templateRows, '').map((t) => `${t.name} v${t.version}`)).toEqual([
      'Retainer v1', 'Standard NDA v2', 'Standard NDA v1',
    ]);
  });

  it('searches the name and the type, ignoring case and outer spaces', () => {
    expect(filterTemplates(templateRows, '  retain ').map((t) => t.id)).toEqual(['t3']);
    expect(filterTemplates(templateRows, 'nda').map((t) => t.id)).toEqual(['t2', 't1']);
    expect(filterTemplates(templateRows, 'service').map((t) => t.id)).toEqual(['t3']);
    expect(filterTemplates(templateRows, 'lease')).toEqual([]);
  });
});

describe('isOlderVersion', () => {
  it('is true only when a newer version has the same name', () => {
    expect(isOlderVersion(templateRows[0], templateRows)).toBe(true);
    expect(isOlderVersion(templateRows[1], templateRows)).toBe(false);
    expect(isOlderVersion(templateRows[2], templateRows)).toBe(false);
  });
});

describe('roleSummaries', () => {
  it('lists each signer role with the fields it fills in, counted by kind', () => {
    expect(roleSummaries({
      roles: ['Client', 'Company representative', 'Signer 3'],
      fields: [
        { roleIndex: 0, kind: 'signature' }, { roleIndex: 0, kind: 'date_signed' }, { roleIndex: 0, kind: 'date_signed' },
        { roleIndex: 1, kind: 'full_name' }, { roleIndex: 1, kind: 'signature' },
      ],
    })).toEqual([
      { role: 'Client', fields: ['Signature', 'Date signed × 2'] },
      { role: 'Company representative', fields: ['Signature', 'Full name'] },
      { role: 'Signer 3', fields: [] },
    ]);
  });

  it('is empty for a template without signer roles', () => {
    expect(roleSummaries({ roles: [], fields: [] })).toEqual([]);
  });
});
