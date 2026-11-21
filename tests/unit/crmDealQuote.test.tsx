// The quote on a deal: its sums, typing the lines, saving them and the page to print.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lineTotal, quoteNumber, quoteTotal, readLines, readNumber, tidyLines, validUntil } from '@/lib/crmQuote';
import type { CrmDeal } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  updates: [] as Array<{ patch: Record<string, unknown>; id: string }>,
  error: null as null | { code?: string; message?: string },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          select: () => ({
            single: async () => {
              h.updates.push({ patch, id });
              return h.error
                ? { data: null, error: h.error }
                : { data: { id, organization_id: 'o', stage_id: 's1', name: 'Northwind website', value: 0, probability: 10, status: 'open', sort_order: 0, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', ...patch }, error: null };
            },
          }),
        }),
      }),
    }),
  },
}));

import { QUOTE_NOT_SET_UP_MESSAGE, saveDealQuote } from '@/services/supabase/crmHub/deals';
import { DealQuote } from '@/components/crmHub/DealQuote';

const DEAL = { id: '3f9a2c1b-0000-4000-8000-000000000001', name: 'Northwind website', value: 0, currency: null, lineItems: [] } as unknown as CrmDeal;
const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

beforeEach(() => {
  h.updates.length = 0;
  h.error = null;
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the sums of a quote', () => {
  it('adds up to the penny', () => {
    expect(lineTotal({ description: 'x', quantity: 3, unitPrice: 19.99 })).toBe(59.97);
    expect(quoteTotal([{ description: 'a', quantity: 1, unitPrice: 0.1 }, { description: 'b', quantity: 1, unitPrice: 0.2 }])).toBe(0.3);
    expect(quoteTotal([{ description: 'a', quantity: 2.5, unitPrice: 80 }, { description: 'b', quantity: 1, unitPrice: 1200.5 }])).toBe(1400.5);
    expect(quoteTotal([])).toBe(0);
  });

  it('reads numbers the way people type them', () => {
    expect(readNumber('1,200.50')).toBe(1200.5);
    expect(readNumber('1200,50')).toBe(1200.5);
    expect(readNumber(' 12 000 ')).toBe(12000);
    expect(readNumber('2')).toBe(2);
    expect(readNumber('')).toBeNull();
    expect(readNumber('ten')).toBeNull();
    expect(readNumber('-5')).toBeNull();
  });

  it('turns typed lines into lines to save, ignoring a row that was left empty', () => {
    expect(readLines([
      { description: ' Website design ', quantity: '1', unitPrice: '4,500' },
      { description: '', quantity: '', unitPrice: '' },
      { description: 'Hosting, per month', quantity: '', unitPrice: '25' },
    ])).toEqual({
      lines: [{ description: 'Website design', quantity: 1, unitPrice: 4500 }, { description: 'Hosting, per month', quantity: 1, unitPrice: 25 }],
      problem: null,
    });
  });

  it('says which line is wrong and why', () => {
    expect(readLines([{ description: '', quantity: '2', unitPrice: '10' }]).problem).toBe('Line 1 needs a description.');
    expect(readLines([{ description: 'a', quantity: '1', unitPrice: '1' }, { description: 'b', quantity: '0', unitPrice: '10' }]).problem).toBe('Line 2: the quantity must be a number above zero.');
    expect(readLines([{ description: 'a', quantity: '1', unitPrice: 'free' }]).problem).toBe('Line 1: the price must be a number.');
  });

  it('keeps only proper lines of what the database holds', () => {
    expect(tidyLines([{ description: 'ok', quantity: 2, unitPrice: 5 }, { description: '', quantity: 1, unitPrice: 1 }, { description: 'bad', quantity: 'x', unitPrice: 1 }, 'text', null])).toEqual([{ description: 'ok', quantity: 2, unitPrice: 5 }]);
    expect(tidyLines(undefined)).toEqual([]);
    expect(tidyLines({})).toEqual([]);
  });

  it('gives the quote a number that never changes, and thirty days', () => {
    expect(quoteNumber('3f9a2c1b-0000-4000-8000-000000000001')).toBe('Q-3F9A2C1B');
    expect(validUntil(new Date(2026, 10, 21)).getTime()).toBe(new Date(2026, 11, 21).getTime());
  });
});

describe('saving a quote', () => {
  it('saves the lines, and the deal value with them when asked', async () => {
    const lines = [{ description: 'Website design', quantity: 1, unitPrice: 4500 }];
    const deal = await saveDealQuote('d1', lines, 4500);
    expect(h.updates[0]).toEqual({ id: 'd1', patch: { line_items: lines, value: 4500 } });
    expect(deal.lineItems).toEqual(lines);
    await saveDealQuote('d1', lines);
    expect(h.updates[1].patch).toEqual({ line_items: lines });
  });

  it('says which file to run while quotes are not set up', async () => {
    h.error = { code: 'PGRST204', message: "Could not find the 'line_items' column of 'crm_deals' in the schema cache" };
    await expect(saveDealQuote('d1', [])).rejects.toThrow(QUOTE_NOT_SET_UP_MESSAGE);
    expect(QUOTE_NOT_SET_UP_MESSAGE).toContain('199_crm_deal_quote.sql');
  });
});

describe('Quote on the deal page', () => {
  const show = (deal: CrmDeal = DEAL, onSaved = vi.fn()) => {
    render(<DealQuote deal={deal} format={money} from="Sam Studio" customer="Northwind Studio" onSaved={onSaved} />);
    return onSaved;
  };
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('adds lines, shows each total and the whole, and saves them with the deal value', async () => {
    const onSaved = show();
    expect(screen.getByText(/No quote yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    type('Line 1: what', 'Website design');
    type('Line 1: price each', '4,500');
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    type('Line 2: what', 'Hosting, per month');
    type('Line 2: quantity', '12');
    type('Line 2: price each', '25');
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('£4,500.00')).toBeTruthy();
    expect(within(rows[2]).getByText('£300.00')).toBeTruthy();
    expect(within(rows[3]).getByText('£4,800.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save quote' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quote saved, and the deal value set to its total'));
    expect(h.updates[0].patch).toEqual({
      line_items: [{ description: 'Website design', quantity: 1, unitPrice: 4500 }, { description: 'Hosting, per month', quantity: 12, unitPrice: 25 }],
      value: 4800,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('leaves the deal value alone when told to', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    type('Line 1: what', 'Workshop');
    type('Line 1: price each', '900');
    fireEvent.click(screen.getByLabelText('Set the deal value to this total'));
    fireEvent.click(screen.getByRole('button', { name: 'Save quote' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quote saved'));
    expect(h.updates[0].patch).not.toHaveProperty('value');
  });

  it('does not save a line that is wrong, and says which', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    type('Line 1: what', 'Workshop');
    type('Line 1: price each', 'a lot');
    expect(screen.getByRole('alert').textContent).toBe('Line 1: the price must be a number.');
    expect((screen.getByRole('button', { name: 'Save quote' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a saved quote as a page to print, with who it is from and for', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    show({ ...DEAL, lineItems: [{ description: 'Website design', quantity: 1, unitPrice: 4500 }, { description: 'Hosting', quantity: 12, unitPrice: 25 }] } as unknown as CrmDeal);
    // Nothing changed yet, so there is nothing to save.
    expect((screen.getByRole('button', { name: 'Save quote' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open to print' }));
    const page = await screen.findByRole('dialog');
    expect(within(page).getByText('Sam Studio')).toBeTruthy();
    expect(within(page).getByText('Northwind Studio')).toBeTruthy();
    expect(within(page).getAllByText('Quote Q-3F9A2C1B').length).toBeGreaterThan(0);
    expect(within(page).getByText('£4,800.00')).toBeTruthy();
    expect(page.textContent).toContain('Valid until');
    fireEvent.click(within(page).getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('says why when the quote could not be saved', async () => {
    h.error = { code: 'PGRST204', message: "Could not find the 'line_items' column" };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    type('Line 1: what', 'Workshop');
    type('Line 1: price each', '900');
    fireEvent.click(screen.getByRole('button', { name: 'Save quote' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(QUOTE_NOT_SET_UP_MESSAGE));
  });
});

describe('migration 199', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/199_crm_deal_quote.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('adds one column that leaves every deal as it was, and can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain("alter table public.crm_deals add column if not exists line_items jsonb not null default '[]'::jsonb");
    expect(flat).toContain("if not exists (select 1 from pg_constraint where conname = 'crm_deals_line_items_is_list')");
    expect(flat).toContain("check (jsonb_typeof(line_items) = 'array')");
    expect(flat).not.toMatch(/drop |create table/i);
  });
});
