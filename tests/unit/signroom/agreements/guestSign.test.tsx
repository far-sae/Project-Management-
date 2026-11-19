// The public page an invited person signs on: the code, the signing with consent, the done step, and declining.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { polyfillDom } from './fixtures';

// The real client is used, so these tests also show what reaches the server. Guests never touch the sign-in.
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/config', () => ({ supabase: { auth: { getSession } } }));
vi.mock('@/components/signroom/PdfViewer', () => ({
  default: ({ guest, fields, onSelect }: { guest?: string; fields?: { id: string; label: string }[]; onSelect?: (id: string) => void }) => (
    <div data-testid="pdf">
      {guest}
      {fields?.map((f) => <button key={f.id} type="button" onClick={() => onSelect?.(f.id)}>field on page: {f.label}</button>)}
    </div>
  ),
}));
vi.mock('@/components/signroom/SignaturePad', () => ({
  default: ({ onChange }: { onChange: (image: string) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,AAAA')}>draw a signature</button>
  ),
}));

import { GuestSignPage } from '@/pages/signroom/GuestSign';

type Handler = (body: Record<string, unknown> | undefined) => Response | Promise<Response>;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const CONSENT = 'I agree to use an electronic signature and intend to sign this agreement.';
const doc = (over: Record<string, unknown> = {}) => ({
  id: 'ag1', title: 'Service agreement', status: 'Awaiting signatures', sender: 'Northwind Studio', name: 'Elena Rossi',
  email: 'elena@harbour.example', purpose: 'sign',
  fields: [
    { id: 'f1', participantId: 'p1', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05, label: 'Signature', kind: 'signature', required: true },
    { id: 'f2', participantId: 'p1', page: 1, x: 0.1, y: 0.3, width: 0.2, height: 0.05, label: 'Full name', kind: 'full_name', required: true },
    { id: 'f3', participantId: 'p1', page: 2, x: 0.1, y: 0.5, width: 0.05, height: 0.03, label: 'I have authority to sign', kind: 'checkbox', required: true },
    { id: 'f4', participantId: 'p1', page: 2, x: 0.1, y: 0.6, width: 0.2, height: 0.05, label: 'Date signed', kind: 'date_signed', required: true },
    { id: 'f5', participantId: 'p1', page: 2, x: 0.1, y: 0.7, width: 0.2, height: 0.05, label: 'Purchase order', kind: 'text', required: false },
  ],
  pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }],
  consent: { text: CONSENT, version: '2026-11-v1' },
  content: 'These are the terms.', sourceHash: 'abc123', othersPending: 0, artifacts: [],
  ...over,
});

let routes: Record<string, Handler>;
const calls: { url: string; init?: RequestInit }[] = [];
const posted = (path: string) =>
  calls.filter((c) => c.url === `/api/signroom/${path}`).map((c) => JSON.parse(String(c.init?.body)));

/** Not verified yet: the link is good, but there is no session. */
const entry = (purpose = 'sign') => {
  routes['guest/intro'] = () => json({ ok: true, purpose });
  routes['guest/document'] = () => json({ error: 'Verify your invited email to continue.' }, 401);
};
/** Already verified in this browser: the document opens straight away. */
const verified = (over: Record<string, unknown> = {}) => {
  routes['guest/intro'] = () => json({ ok: true, purpose: over.purpose ?? 'sign' });
  routes['guest/document'] = () => json(doc(over));
};

const open = (hash = '#access=tok') => {
  window.history.replaceState(null, '', `/sign${hash}`);
  return render(<GuestSignPage />);
};
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const currentStep = () => screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')?.textContent;

beforeAll(() => {
  polyfillDom();
  URL.createObjectURL = vi.fn(() => 'blob:sample');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
beforeEach(() => {
  calls.length = 0;
  routes = {};
  getSession.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    if (!String(input).startsWith('/api/signroom/')) return new Response('pdf');
    const path = String(input).replace('/api/signroom/', '');
    const handler = routes[path] ?? routes[path.split('?')[0]];
    if (!handler) return json({ error: 'No route.' }, 404);
    return handler(init?.body ? JSON.parse(String(init.body)) : undefined);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('opening the link', () => {
  it('takes the token out of the address bar and never asks for a sign-in', async () => {
    entry();
    open('#access=tok');
    expect(await screen.findByRole('heading', { name: 'You’re invited to sign' })).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/sign');
    expect(posted('guest/intro')).toEqual([{ access: 'tok' }]);
    // The guest session is a cookie on the same origin: no token, no workspace.
    expect(calls[0].init?.credentials).toBe('same-origin');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('says the link is incomplete when there is no token, and calls nothing', () => {
    open('');
    expect(screen.getByRole('alert').textContent).toBe('This link is incomplete. Please open the link from your email again.');
    expect(calls).toEqual([]);
  });

  it('shows the server sentence and a way to recover when the link no longer works', async () => {
    const gone = 'This link is expired or has been replaced. Ask the sender to resend it, or recover completion access.';
    routes['guest/intro'] = () => json({ error: gone }, 410);
    routes['guest/recover'] = () => json({ ok: true, message: 'If this address is authorised, a new completion invitation will be emailed to it.' });
    open();
    expect(await screen.findByRole('heading', { name: 'This link is unavailable' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(gone);
    expect(screen.getByText('Ask the sender for a fresh invitation. Completed agreements also support email-bound access recovery.')).toBeTruthy();

    fireEvent.click(screen.getByText('Recover completed documents'));
    fireEvent.change(screen.getByLabelText('Agreement ID'), { target: { value: 'ag1' } });
    fireEvent.change(screen.getByLabelText('Originally invited email'), { target: { value: 'elena@harbour.example' } });
    fireEvent.click(button(/Request new access/));
    expect(await screen.findByText('If this address is authorised, a new completion invitation will be emailed to it.')).toBeTruthy();
    expect(posted('guest/recover')).toEqual([{ agreementId: 'ag1', email: 'elena@harbour.example' }]);
  });
});

describe('the code step', () => {
  it('sends a code, then verifies it and opens the document', async () => {
    entry();
    routes['guest/code'] = () => json({ ok: true });
    routes['guest/verify'] = () => {
      routes['guest/document'] = () => json(doc());
      return json({ ok: true });
    };
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Send verification code/ }));
    expect(await screen.findByRole('heading', { name: 'Enter the code we emailed you' })).toBeTruthy();
    expect(screen.getByText('Enter the six-digit code sent to the originally invited email address.')).toBeTruthy();
    expect(currentStep()).toContain('Confirm your email');
    // The honest claim about what the code proves.
    expect(screen.getByText('We verify access to your invited email with a one-time code. This does not verify legal identity.')).toBeTruthy();

    const verify = button(/Verify and open agreement/);
    expect(verify.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    expect(verify.disabled).toBe(false);
    fireEvent.click(verify);
    expect(await screen.findByRole('heading', { name: 'Service agreement' })).toBeTruthy();
    expect(posted('guest/code')).toEqual([{ access: 'tok' }]);
    expect(posted('guest/verify')).toEqual([{ access: 'tok', code: '123456' }]);
    expect(currentStep()).toContain('Review and sign');
  });

  it('shows a wrong code’s sentence and stays on the code step', async () => {
    entry();
    routes['guest/code'] = () => json({ ok: true });
    routes['guest/verify'] = () => json({ error: 'That verification code is incorrect.' }, 403);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Send verification code/ }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '000000' } });
    fireEvent.click(button(/Verify and open agreement/));
    expect((await screen.findByRole('alert')).textContent).toBe('That verification code is incorrect.');
    expect(screen.getByRole('heading', { name: 'Enter the code we emailed you' })).toBeTruthy();
    expect(button('Send a new code')).toBeTruthy();
  });

  it('shows the server sentence when a code cannot be sent yet', async () => {
    entry();
    routes['guest/code'] = () => json({ error: 'Please wait one minute before requesting another code.' }, 429);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Send verification code/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Please wait one minute before requesting another code.');
    expect(screen.getByRole('heading', { name: 'You’re invited to sign' })).toBeTruthy();
  });
});

describe('the signing step', () => {
  it('shows who sent it, the document and the honest notes', async () => {
    verified();
    open();
    expect(await screen.findByRole('heading', { name: 'Service agreement' })).toBeTruthy();
    expect(screen.getByText('Sent by').parentElement?.textContent).toContain('Northwind Studio');
    expect(screen.getByText('Prepared for Elena Rossi. Read the document, complete your fields and give explicit consent.')).toBeTruthy();
    expect(screen.getByTestId('pdf').textContent).toContain('source');
    expect(screen.getByText(/IP addresses and location are not collected\./).textContent).toBe(
      'The sender can see verification, document views, your accepted field values, signature, consent and any decline reason. IP addresses and location are not collected.',
    );
    expect(screen.getByText('Consent version 2026-11-v1. Signing date is recorded in UTC by the server.')).toBeTruthy();
    expect(screen.getByText('These are the terms.')).toBeTruthy();
  });

  it('can be signed only when every required field is filled and consent is given, then posts it', async () => {
    verified();
    routes['guest/sign'] = () => json({ ok: true, pending: 0 });
    open();
    const sign = await screen.findByRole('button', { name: /Sign agreement/ }) as HTMLButtonElement;
    // The full name is filled in from the invitation; the date is the server's.
    expect((screen.getByLabelText(/2\. Full name/) as HTMLInputElement).value).toBe('Elena Rossi');
    expect(screen.getByText('2/4 complete')).toBeTruthy();
    expect(sign.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/1\. Signature/), { target: { value: 'Elena Rossi' } });
    expect(screen.getByLabelText('Signature preview').textContent).toBe('Elena Rossi');
    expect(sign.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I have authority to sign/ }));
    expect(screen.getByText('4/4 complete')).toBeTruthy();
    // Every field is filled, but nothing is signed without the consent tick.
    expect(sign.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    expect(sign.disabled).toBe(false);

    fireEvent.click(sign);
    expect(await screen.findByRole('heading', { name: 'You’ve signed' })).toBeTruthy();
    expect(posted('guest/sign')).toEqual([{
      access: 'tok', sourceHash: 'abc123', consentVersion: '2026-11-v1', consent: true, signature: 'Elena Rossi', drawing: '',
      values: { f2: 'Elena Rossi', f3: true },
    }]);
    expect(screen.getByText('All signatures are collected. We are preparing the final PDF and completion record. You will receive an email with the completed files.')).toBeTruthy();
    expect(currentStep()).toContain('Done');
  });

  it('sends a drawn signature along with the typed one, and says how many others are still to sign', async () => {
    verified();
    routes['guest/sign'] = () => json({ ok: true, pending: 2 });
    open();
    fireEvent.change(await screen.findByLabelText(/1\. Signature/), { target: { value: 'Elena Rossi' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I have authority to sign/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    fireEvent.click(button('draw a signature'));
    fireEvent.click(button(/Sign agreement/));
    expect(await screen.findByText('Your signature has been recorded. 2 other signers are still expected.')).toBeTruthy();
    expect(posted('guest/sign')[0].drawing).toBe('data:image/png;base64,AAAA');
  });

  it('shows the server sentence when the signature is refused and stays on the document', async () => {
    verified();
    routes['guest/sign'] = () => json({ error: 'Review the current document and give explicit consent.' }, 400);
    open();
    fireEvent.change(await screen.findByLabelText(/1\. Signature/), { target: { value: 'Elena Rossi' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I have authority to sign/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    fireEvent.click(button(/Sign agreement/));
    expect((await screen.findByRole('alert')).textContent).toBe('Review the current document and give explicit consent.');
    expect(screen.getByRole('heading', { name: 'Service agreement' })).toBeTruthy();
  });

  it('counts the required fields and jumps to the next empty one', async () => {
    verified();
    open();
    await screen.findByRole('heading', { name: 'Service agreement' });
    expect(screen.getByText('2 of 4 required fields complete')).toBeTruthy();
    fireEvent.click(button(/Next required field/));
    expect(document.activeElement).toBe(screen.getByLabelText(/1\. Signature/));
    // Choosing a field on the page takes the person to its input.
    fireEvent.click(button('field on page: Purchase order'));
    expect(document.activeElement).toBe(screen.getByLabelText(/5\. Purchase order/));
  });

  it('downloads the exact PDF through a signed link', async () => {
    verified();
    routes['guest/artifact-url'] = () => json({ url: 'https://storage.example/source', filename: 'source.pdf' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Download the exact PDF to be signed/ }));
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('https://storage.example/source'));
    expect(calls.map((c) => c.url)).toContain('/api/signroom/guest/artifact-url?kind=source&download=1');
    expect(calls.find((c) => c.url === 'https://storage.example/source')?.init?.credentials).toBe('omit');
  });
});

describe('declining', () => {
  it('asks first, then declines with the reason given', async () => {
    verified();
    routes['guest/decline'] = () => json({ ok: true });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline to sign' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The agreement will stop for everyone. The sender can see your reason.')).toBeTruthy();
    expect(posted('guest/decline')).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'The fee is wrong' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm decline/ }));
    expect(await screen.findByRole('heading', { name: 'Agreement declined' })).toBeTruthy();
    expect(posted('guest/decline')).toEqual([{ access: 'tok', reason: 'The fee is wrong' }]);
    expect(screen.getByText('The sender will see that you declined, along with the reason you chose to share.')).toBeTruthy();
  });

  it('goes back to the document when the person keeps reviewing', async () => {
    verified();
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline to sign' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep reviewing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted('guest/decline')).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Service agreement' })).toBeTruthy();
  });
});

describe('a completed agreement', () => {
  it('names the completion link on the entry step', async () => {
    entry('complete');
    open();
    expect(await screen.findByRole('heading', { name: 'Your completed agreement is ready' })).toBeTruthy();
  });

  it('offers the three files and nothing to sign', async () => {
    verified({ purpose: 'complete', fields: [], status: 'Completed', artifacts: ['final', 'completion', 'export'] });
    routes['guest/artifact-url'] = () => json({ url: 'https://storage.example/file', filename: 'final.pdf' });
    routes['guest/export'] = () => json({ url: 'https://storage.example/zip', filename: 'evidence.zip' });
    open();
    expect(await screen.findByText('Completed and ready to download.')).toBeTruthy();
    expect(screen.getByText('Your downloads are the same immutable files available to the sender.')).toBeTruthy();
    expect(screen.getByText('Application-level evidence export. All timestamps UTC. No qualification or certification claim is made.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign agreement/ })).toBeNull();
    expect(screen.queryByTestId('pdf')).toBeNull();

    fireEvent.click(button(/Signed agreement/));
    fireEvent.click(button(/Completion record/));
    fireEvent.click(button(/Evidence export/));
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/signroom/guest/export'));
    const asked = calls.map((c) => c.url);
    expect(asked).toContain('/api/signroom/guest/artifact-url?kind=final&download=1');
    expect(asked).toContain('/api/signroom/guest/artifact-url?kind=completion&download=1');
  });

  it('shows the server sentence when a download is refused', async () => {
    verified({ purpose: 'complete', fields: [], status: 'Completed' });
    routes['guest/export'] = () => json({ error: 'Evidence export becomes available after completion.' }, 409);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Evidence export/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Evidence export becomes available after completion.');
  });
});
