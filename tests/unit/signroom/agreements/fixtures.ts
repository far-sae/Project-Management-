// Sample data for the agreement screen tests. Every name here is made up.
import type { Agreement, AgreementSummary, Client, Field, Participant } from '../../../../api/_signroom/shared/types';

export const person = (
  id: string, name: string, email: string, over: Partial<Participant> = {},
): Participant => ({ id, name, email, role: 'signer', order: 1, progress: 'waiting', version: 0, ...over });

export const field = (over: Partial<Field> = {}): Field => ({
  id: 'f1', participantId: 'p1', kind: 'signature', label: 'Signature', page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.055,
  required: true, ...over,
});

export const agreement = (over: Partial<Agreement> = {}): Agreement => ({
  id: 'a1', workspaceId: 'w', senderId: 'u1', clientId: 'cl1', dealId: null, type: 'NDA', title: 'NDA for Northwind Studio',
  status: 'Draft', revision: 3, content: 'These are the terms.', sourceKind: 'authored', documentHash: 'hash1',
  pages: [{ width: 595, height: 842 }], participants: [person('p1', 'Elena Rossi', 'elena@northwind.example')],
  fields: [field()], sequential: false, deadline: '', reminderDays: 3, subject: '', message: '',
  created: '2026-11-02T10:00:00.000Z', updated: '2026-11-03T10:00:00.000Z', events: [
    { seq: 1, type: 'Draft created', actor: 'sam@example.com', at: '2026-11-02T10:00:00.000Z', detail: {} },
  ], legalHold: false, ...over,
});

export const summaryOf = (a: Agreement): AgreementSummary => {
  const { content: _c, events: _e, branding: _b, frozen: _f, fields: _fl, ...rest } = a;
  return rest;
};

export const clientRow = (over: Partial<Client> = {}): Client => ({
  id: 'cl1', workspaceId: 'w', name: 'Northwind Studio', contactName: 'Elena Rossi', email: 'elena@northwind.example',
  companyNumber: '', notes: '', created: '2026-11-01T10:00:00.000Z', archived: false, crmCompanyId: 'c1', ...over,
});

export const frozenOf = (a: Agreement): NonNullable<Agreement['frozen']> => ({
  sourceHash: a.documentHash ?? 'hash1',
  snapshotHash: 'snap1',
  consent: { version: '2026-11-v1', text: 'I agree to use an electronic signature and intend to sign this agreement.' },
  revision: a.revision,
  participants: a.participants,
  fields: a.fields,
  settings: { sequential: a.sequential, deadline: a.deadline },
});

/** CRM rows in the shape the hooks return; only the fields the agreement screens read. */
export const crmCompanies = [
  { id: 'c1', name: 'Northwind Studio' },
  { id: 'c2', name: 'Harbour Dental' },
];
export const crmDeals = [
  { id: 'd1', name: 'Northwind website', companyId: 'c1', status: 'won' },
  { id: 'd2', name: 'Northwind rebrand', companyId: 'c1', status: 'open' },
  { id: 'd3', name: 'Harbour booking system', companyId: 'c2', status: 'open' },
];

/** jsdom lacks a few things the dropdowns and dialogs call. */
export function polyfillDom(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
