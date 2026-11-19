// One agreement's page: what the sender can do in each status, the files, retention, and signing first.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { agreement, clientRow, crmDeals, field, frozenOf, person, polyfillDom } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const state = { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }));
const session = vi.hoisted(() => ({ role: 'Owner' }));
const crm = vi.hoisted(() => ({
  companies: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
  deals: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
}));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crm.companies, useCrmDeals: () => crm.deals }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/signroom/PdfViewer', () => ({
  default: ({ agreement: a }: { agreement?: { id: string; kind: string; version?: string } }) => (
    <div data-testid="pdf">{a?.kind}:{a?.version}</div>
  ),
}));

import { AgreementDetailPage } from '@/pages/signroom/AgreementDetail';
import { SignroomError } from '@/services/signroom/client';

let stored: Agreement;
const serve = (overrides: Record<string, (body: Record<string, unknown>) => unknown> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (overrides[path]) return overrides[path](body ?? {});
    if (path === 'clients') return [clientRow()];
    if (path === 'session') return { user: { id: 'u1', email: 'sam@example.com' }, role: session.role };
    if (path === `agreements/${stored.id}`) return stored;
    throw new SignroomError('Not found.', 404);
  });
};

const awaiting = (over: Partial<Agreement> = {}): Agreement => {
  const base = agreement({
    status: 'Awaiting signatures', sentAt: '2026-11-04T09:00:00.000Z', dealId: 'd2',
    participants: [
      person('p1', 'Elena Rossi', 'elena@northwind.example', { progress: 'signed', signedAt: '2026-11-05T09:30:00.000Z' }),
      person('p2', 'Priya Nair', 'priya@example.com', { order: 2, progress: 'invited' }),
      person('p3', 'Accounts', 'accounts@northwind.example', { order: 3, role: 'copy' }),
    ],
    fields: [field(), field({ id: 'f2', participantId: 'p2' })],
    deliveries: [{ id: 'dl1', participantId: 'p2', state: 'failed', at: '2026-11-04T09:00:05.000Z' }],
  });
  return { ...base, frozen: frozenOf(base), ...over };
};
const completed = (over: Partial<Agreement> = {}): Agreement => ({
  ...awaiting(), status: 'Completed', completedAt: '2026-11-06T09:00:00.000Z',
  artifacts: { final: 'h-final', completion: 'h-comp', export: 'h-zip' }, ...over,
});

const Editor = () => <div>editor for {useParams().id}</div>;
const renderPage = () => render(
  <MemoryRouter initialEntries={['/crm/agreements/a1']}>
    <Routes>
      <Route path="/crm/agreements/:id" element={<AgreementDetailPage />} />
      <Route path="/crm/agreements/:id/edit" element={<Editor />} />
    </Routes>
  </MemoryRouter>,
);
const posted = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const opened = () => screen.findByRole('heading', { level: 1, name: 'NDA for Northwind Studio' });

beforeAll(() => {
  polyfillDom();
  // jsdom neither makes blob links nor follows a download link.
  URL.createObjectURL = vi.fn(() => 'blob:sample');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
beforeEach(() => {
  stored = awaiting();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  session.role = 'Owner';
  auth.user = { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' };
  crm.deals.items = crmDeals;
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AgreementDetailPage', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderPage();
    expect(screen.getByText('Pick a workspace in the sidebar to open this agreement.')).toBeTruthy();
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('shows the server sentence when the agreement cannot be opened', async () => {
    serve({ 'agreements/a1': () => { throw new SignroomError('Agreement not found.', 404); } });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Agreement not found.');
    expect(screen.getByRole('link', { name: /Back to agreements/ }).getAttribute('href')).toBe('/crm/agreements');
  });

  it('heads the page with status, company, deal and deadline', async () => {
    stored = awaiting({ deadline: '2026-12-01' });
    renderPage();
    await opened();
    expect(screen.getByText('Awaiting signatures').getAttribute('data-tone')).toBe('warning');
    expect((await screen.findByRole('link', { name: 'Northwind Studio' })).getAttribute('href')).toBe('/crm/companies/c1');
    expect(screen.getByRole('link', { name: /Deal: Northwind rebrand/ }).getAttribute('href')).toBe('/crm/deals/d2');
    expect(screen.getByText(/Created 2 Nov 2026 · Deadline 1 Dec 2026/)).toBeTruthy();
  });

  it('shows each person’s progress, the last delivery and when they signed', async () => {
    renderPage();
    await opened();
    expect(screen.getByText('1 of 2 signed · Any signing order')).toBeTruthy();
    const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
    expect(within(row('Elena Rossi')).getByText('Signed').getAttribute('data-tone')).toBe('success');
    expect(within(row('Elena Rossi')).getByText('05/11/2026, 09:30:00 UTC')).toBeTruthy();
    expect(within(row('Priya Nair')).getByText('Invited')).toBeTruthy();
    expect(within(row('Priya Nair')).getByText('Delivery: failed')).toBeTruthy();
    expect(within(row('Accounts')).getByText('Completion copy')).toBeTruthy();
  });

  it('shows the frozen source and the append-only activity', async () => {
    stored = awaiting({
      events: [
        { seq: 1, type: 'Draft created', actor: 'sam@example.com', at: '2026-11-02T10:00:00.000Z', detail: {} },
        { seq: 2, type: 'Agreement cancelled', actor: 'sam@example.com', at: '2026-11-03T10:00:00.000Z', detail: { reason: 'Wrong version' } },
      ],
    });
    renderPage();
    await opened();
    expect(screen.getByText('Frozen source SHA-256').nextElementSibling?.textContent).toBe('hash1');
    expect(screen.getByText('Consent 2026-11-v1 · Server UTC timestamps · Email access verified')).toBeTruthy();
    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(within(activity).getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent)).toEqual(['Agreement cancelled', 'Draft created']);
    expect(within(activity).getByText('Wrong version')).toBeTruthy();
  });

  it('shows the exact PDF on request: the source while signing, the final once completed', async () => {
    renderPage();
    await opened();
    expect(screen.queryByTestId('pdf')).toBeNull();
    fireEvent.click(button(/Show exact PDF/));
    expect(screen.getByTestId('pdf').textContent).toBe('source:hash1');
    fireEvent.click(button(/Hide preview/));
    expect(screen.queryByTestId('pdf')).toBeNull();
  });

  describe('while awaiting signatures', () => {
    it('offers resend and cancel, and no retention controls', async () => {
      renderPage();
      await opened();
      expect(button(/Resend invitations/)).toBeTruthy();
      expect(button('Cancel agreement')).toBeTruthy();
      expect(button(/Duplicate as draft/)).toBeTruthy();
      expect(screen.queryByRole('link', { name: /Continue editing/ })).toBeNull();
      expect(screen.queryByText('Retention and legal hold')).toBeNull();
      expect(screen.queryByRole('button', { name: /Signed PDF/ })).toBeNull();
    });

    it('resends and shows the status the server returns, not an assumed one', async () => {
      serve({ 'agreements/a1/resend': () => ({ ...stored, status: 'Expired' }) });
      renderPage();
      await opened();
      fireEvent.click(button(/Resend invitations/));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Fresh invitations sent. Old links and signing sessions are revoked.'));
      expect(posted('agreements/a1/resend')).toEqual([{}]);
      expect(screen.getByText('Expired').getAttribute('data-tone')).toBe('danger');
      expect(screen.queryByRole('button', { name: /Resend invitations/ })).toBeNull();
    });

    it('cancels only with a reason', async () => {
      serve({ 'agreements/a1/cancel': () => ({ ...stored, status: 'Cancelled' }) });
      renderPage();
      await opened();
      fireEvent.click(button('Cancel agreement'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Cancel and revoke signing access? Give a reason.')).toBeTruthy();
      const confirm = within(dialog).getByRole('button', { name: 'Cancel agreement' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Sent the wrong version' } });
      fireEvent.click(confirm);
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Agreement cancelled. All signing access has been revoked.'));
      expect(posted('agreements/a1/cancel')).toEqual([{ reason: 'Sent the wrong version' }]);
      expect(screen.getByText('Cancelled')).toBeTruthy();
    });

    it('shows the server sentence when an action is refused', async () => {
      const sentence = 'Use the sign-first workflow and explicitly release the document before sending invitations.';
      serve({ 'agreements/a1/resend': () => { throw new SignroomError(sentence, 409); } });
      renderPage();
      await opened();
      fireEvent.click(button(/Resend invitations/));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sentence));
    });

    it('keeps checking for progress', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      renderPage();
      await opened();
      const before = sr.call.mock.calls.filter((c) => c[0] === 'agreements/a1').length;
      stored = completed();
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(sr.call.mock.calls.filter((c) => c[0] === 'agreements/a1').length).toBe(before + 1);
      expect(await screen.findByRole('button', { name: /Signed PDF/ })).toBeTruthy();
    });

    it('duplicates into a new draft and opens it in the editor', async () => {
      serve({ 'agreements/a1/duplicate': () => agreement({ id: 'copy1' }) });
      renderPage();
      await opened();
      fireEvent.click(button(/Duplicate as draft/));
      expect(await screen.findByText('editor for copy1')).toBeTruthy();
      expect(toast.success).toHaveBeenCalledWith('A new draft is ready with fresh recipients and consent.');
    });
  });

  describe('once completed', () => {
    beforeEach(() => { stored = completed(); });

    it('offers the signed PDF, the completion record and the evidence export', async () => {
      const fetched: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(url); return new Response('pdf'); }));
      serve({
        'agreements/a1/artifact-url?kind=final&download=1': () => ({ url: 'https://storage.example/final', filename: 'final.pdf' }),
        'agreements/a1/artifact-url?kind=completion&download=1': () => ({ url: 'https://storage.example/completion', filename: 'completion-record.pdf' }),
        'agreements/a1/export': () => ({ url: 'https://storage.example/zip', filename: 'evidence.zip', agreement: { ...stored, exportedAt: '2026-11-19T10:00:00.000Z' } }),
      });
      renderPage();
      await opened();
      expect(screen.getByText('The final files are immutable and shared with authorised recipients through verified download invitations.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Resend invitations/ })).toBeNull();

      fireEvent.click(button(/Signed PDF/));
      await waitFor(() => expect(fetched).toEqual(['https://storage.example/final']));
      fireEvent.click(button('Completion record'));
      await waitFor(() => expect(fetched).toEqual(['https://storage.example/final', 'https://storage.example/completion']));
      // The file comes straight from storage with no sign-in attached.
      expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'omit' });

      fireEvent.click(button(/Export evidence/));
      await waitFor(() => expect(posted('agreements/a1/export')).toEqual([{}]));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows the signed PDF as the exact PDF', async () => {
      renderPage();
      await opened();
      fireEvent.click(button(/Show exact PDF/));
      expect(screen.getByTestId('pdf').textContent).toBe('final:hash1');
    });

    it('shows the server sentence when the export fails', async () => {
      serve({ 'agreements/a1/export': () => { throw new SignroomError('Evidence export becomes available after completion.', 409); } });
      renderPage();
      await opened();
      fireEvent.click(button(/Export evidence/));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Evidence export becomes available after completion.'));
    });

    it('lets the owner apply a legal hold with a reason', async () => {
      serve({ 'agreements/a1/hold': (body) => ({ ...stored, legalHold: Boolean(body.hold) }) });
      renderPage();
      await opened();
      fireEvent.click(await screen.findByRole('button', { name: /Apply legal hold/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Reason for applying a legal hold'), { target: { value: 'Dispute open' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply legal hold' }));
      await waitFor(() => expect(posted('agreements/a1/hold')).toEqual([{ hold: true, reason: 'Dispute open' }]));
      expect(await screen.findByText('Legal hold active. Scheduled deletion is paused.')).toBeTruthy();
      expect(button(/Release legal hold/)).toBeTruthy();
      expect(button(/Schedule retention deletion/).disabled).toBe(true);
    });

    it('schedules retention deletion only after confirming, and says when it becomes eligible', async () => {
      serve({ 'agreements/a1/delete': () => ({ ...stored, deletionAt: '2027-11-06T09:00:00.000Z' }) });
      renderPage();
      await opened();
      fireEvent.click(await screen.findByRole('button', { name: /Schedule retention deletion/ }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Schedule controlled deletion after the retention period? Export the evidence first.')).toBeTruthy();
      expect(posted('agreements/a1/delete')).toEqual([]);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule deletion' }));
      await waitFor(() => expect(posted('agreements/a1/delete')).toEqual([{}]));
      expect(await screen.findByText('Deletion eligible on 6 Nov 2027.')).toBeTruthy();
    });

    it('offers no retention controls to someone who is not the owner', async () => {
      session.role = 'Member';
      renderPage();
      await opened();
      await waitFor(() => expect(sr.call).toHaveBeenCalledWith('session'));
      expect(screen.queryByText('Retention and legal hold')).toBeNull();
    });
  });

  describe('a draft', () => {
    it('continues in the editor', async () => {
      stored = agreement();
      renderPage();
      await opened();
      expect(screen.getByRole('link', { name: /Continue editing/ }).getAttribute('href')).toBe('/crm/agreements/a1/edit');
      expect(screen.queryByRole('button', { name: /Duplicate as draft/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Resend invitations/ })).toBeNull();
    });

    it('in Trash cannot be edited or held, and can be restored', async () => {
      stored = agreement({ trashedAt: '2026-11-07T09:00:00.000Z' });
      serve({ 'agreements/a1/restore': () => agreement() });
      renderPage();
      await opened();
      expect(screen.getByText('This document is in Trash. Restore it before editing or sending it.')).toBeTruthy();
      expect(button(/Continue editing/).disabled).toBe(true);
      expect(screen.queryByText('Retention and legal hold')).toBeNull();
      fireEvent.click(button('Restore'));
      expect(await screen.findByRole('link', { name: /Continue editing/ })).toBeTruthy();
      expect(posted('agreements/a1/restore')).toEqual([{}]);
    });

    it('says when it is archived', async () => {
      stored = agreement({ archivedAt: '2026-11-07T09:00:00.000Z' });
      renderPage();
      await opened();
      expect(screen.getByText('This document is archived. Its signing status and recipient access are unchanged.')).toBeTruthy();
    });
  });

  it('says the final files are being made while finalising', async () => {
    stored = awaiting({ status: 'Finalising' });
    renderPage();
    await opened();
    expect(screen.getByRole('status').textContent).toContain(
      'All signatures are accepted. We are generating the final PDF, completion record and signed evidence manifest.',
    );
  });

  describe('signing first as the sender', () => {
    const waitingForMe = (over: Partial<Agreement> = {}): Agreement => {
      const base = agreement({
        status: 'Awaiting signatures', senderFirst: true, senderReleasePending: true, sequential: true,
        participants: [person('m', 'Sam', 'sam@example.com'), person('p1', 'Elena Rossi', 'elena@northwind.example', { order: 2 })],
        fields: [
          field({ id: 'f0', participantId: 'm' }),
          field({ id: 'f1', participantId: 'm', kind: 'title', label: 'Job title' }),
          field({ id: 'f2', participantId: 'p1' }),
        ],
      });
      return { ...base, frozen: frozenOf(base), ...over };
    };

    it('signs with consent, the consent version and the frozen source', async () => {
      stored = waitingForMe();
      serve({
        'agreements/a1/sign-first': () => ({
          ...stored, senderSignedHash: 'signed1',
          participants: stored.participants.map((p) => (p.id === 'm' ? { ...p, progress: 'signed' } : p)),
        }),
        'agreements/a1/release-first': () => ({ ...stored, senderReleasePending: false }),
      });
      renderPage();
      await opened();
      const panel = screen.getByRole('region', { name: 'Sign first, then send' });
      expect(within(panel).getByText(/You are signing the frozen PDF as Sam\./)).toBeTruthy();
      const sign = within(panel).getByRole('button', { name: /Sign my part first/ }) as HTMLButtonElement;
      expect(sign.disabled).toBe(true);
      fireEvent.change(within(panel).getByLabelText('Your typed signature'), { target: { value: 'Sam Example' } });
      fireEvent.change(within(panel).getByLabelText('Job title'), { target: { value: 'Director' } });
      fireEvent.click(within(panel).getByRole('checkbox', { name: 'I agree to use an electronic signature and intend to sign this agreement.' }));
      expect(sign.disabled).toBe(false);
      fireEvent.click(sign);
      await waitFor(() => expect(posted('agreements/a1/sign-first')).toEqual([{
        signature: 'Sam Example', values: { f1: 'Director' }, consent: true, consentVersion: '2026-11-v1', sourceHash: 'hash1',
      }]));
      expect(toast.success).toHaveBeenCalledWith('Your signature is recorded. Review the signed PDF, then send it to the other company.');

      const done = await screen.findByRole('region', { name: 'Your signature is recorded' });
      fireEvent.click(within(done).getByRole('button', { name: /Send to other company for signature/ }));
      await waitFor(() => expect(posted('agreements/a1/release-first')).toEqual([{}]));
      expect(toast.success).toHaveBeenCalledWith('The sender-signed document was sent to the next signer.');
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Your signature is recorded' })).toBeNull());
    });

    it('is not offered to anyone but the person who sent it', async () => {
      stored = waitingForMe({ senderId: 'someone-else' });
      renderPage();
      await opened();
      expect(screen.queryByRole('region', { name: 'Sign first, then send' })).toBeNull();
    });
  });
});
