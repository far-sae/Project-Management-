// The "send from your own mailbox" panel on Document settings: its states, the three ways to connect, and every refusal.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { whenText, type EmailConnectionView } from '@/lib/signroom/emailConnection';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));

import { EmailConnectionPanel } from '@/components/signroom/email/EmailConnectionPanel';

/** A refusal as the documents client throws it: the server's sentence and the HTTP status. */
class Refusal extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const CALLBACK = 'https://app.taskcalendar.example/api/signroom/email-connection/callback';
const ADDRESS = 'sam@samstudio.example';
const none: EmailConnectionView = { configured: false, provider: 'smtp', status: 'none', mode: 'platform', smtpKept: false, smtpKeptVerified: false, callbackUri: CALLBACK };
const smtp = (over: Partial<EmailConnectionView> = {}): EmailConnectionView => ({
  configured: true, provider: 'smtp', status: 'verified', mode: 'live', email: ADDRESS, host: 'smtp.gmail.com', port: 465,
  security: 'tls', username: ADDRESS, preset: 'gmail', verifiedAt: '2026-11-18T10:00:00.000Z',
  smtpKept: false, smtpKeptVerified: false, callbackUri: CALLBACK, ...over,
});
const signIn = (provider: 'google' | 'microsoft', over: Partial<EmailConnectionView> = {}): EmailConnectionView => ({
  configured: true, provider, status: 'configured', mode: 'platform', email: ADDRESS, clientId: 'client-123',
  tenant: provider === 'microsoft' ? 'organizations' : '', hasClientSecret: true,
  smtpKept: false, smtpKeptVerified: false, callbackUri: CALLBACK, ...over,
});

type Handler = (body: Record<string, unknown>) => unknown;
let current: EmailConnectionView;
/** A pretend server: `GET email-connection` answers with `current`; each action answers with its handler. */
function serve(view: EmailConnectionView, handlers: Record<string, Handler> = {}) {
  current = view;
  sr.call.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
    if (path === 'email-connection') {
      if (body !== undefined) throw new Error('the view is read with GET');
      return current;
    }
    const handler = handlers[path.replace('email-connection/', '')];
    if (!handler) throw new Error(`unexpected ${path}`);
    return handler(body ?? {});
  });
}

const Where: React.FC = () => <span data-testid="search">{useLocation().search}</span>;
const mount = (readOnly = false, url = '/crm/document-settings') => render(
  <MemoryRouter initialEntries={[url]}><EmailConnectionPanel readOnly={readOnly} /><Where /></MemoryRouter>,
);
const open = async (readOnly = false, url?: string) => {
  mount(readOnly, url);
  await screen.findByText('Emails are sent from');
};
const posts = () => sr.call.mock.calls.filter((c) => c[0] !== 'email-connection');
const bodyOf = (action: string) => sr.call.mock.calls.find((c) => c[0] === `email-connection/${action}`)?.[1];
const gets = () => sr.call.mock.calls.filter((c) => c[0] === 'email-connection').length;
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const valueOf = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const pick = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('combobox', { name: label }).textContent).toContain(option));
};
const sender = () => within(screen.getByRole('group', { name: 'Who your emails come from' }));
const alertText = async () => (await screen.findByRole('alert')).textContent;
const expectProductNameOnly = () => expect(document.body.textContent).not.toMatch(/signroom|securovix/i);

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  class Observer { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observer;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the state, in one glance', () => {
  it('says what the owner still has to set up when the server cannot keep a mailbox yet', async () => {
    serve({ ...none, available: false });
    await open();
    expect(screen.getByRole('status', { name: 'Not set up yet' }).textContent).toContain('SIGNROOM_MAIL_KEY');
    expect(screen.queryByRole('button', { name: /Email password/ })).toBeNull();
  });

  it('says nothing about setup when the server can keep a mailbox', async () => {
    serve({ ...none, available: true });
    await open();
    expect(screen.queryByRole('status', { name: 'Not set up yet' })).toBeNull();
  });

  it('says TaskCalendar sends the emails, and offers the three ways with the password first', async () => {
    serve(none);
    await open();
    expect(sender().getByText('TaskCalendar')).toBeTruthy();
    expect(sender().getByText('Default')).toBeTruthy();
    expect(sender().queryByText(/Last checked/)).toBeNull();
    const ways = within(screen.getByRole('group', { name: 'Choose how to connect' })).getAllByRole('button');
    expect(ways.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Email password'), expect.stringContaining('Google sign-in'), expect.stringContaining('Microsoft 365 sign-in'),
    ]);
    expect(screen.getByText('Step 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(posts()).toEqual([]);
    expectProductNameOnly();
  });

  it('shows the connected address as verified, with the last check', async () => {
    serve(smtp());
    await open();
    expect(sender().getByText(ADDRESS)).toBeTruthy();
    expect(sender().getByText('Verified')).toBeTruthy();
    expect(sender().getByText(`Last checked ${whenText('2026-11-18T10:00:00.000Z')}`)).toBeTruthy();
    expect(button('Send a test email')).toBeTruthy();
    expect(button('Check connection')).toBeTruthy();
    expect(button('Disconnect')).toBeTruthy();
    expect(screen.queryByText(/^Step/)).toBeNull();
    expectProductNameOnly();
  });

  it('shows a saved mailbox that failed its check, with the last error and the form to fix it', async () => {
    serve(smtp({ status: 'configured', mode: 'platform', verifiedAt: undefined, lastError: 'Your mailbox refused the password.' }));
    await open();
    expect(sender().getByText('TaskCalendar')).toBeTruthy();
    expect(sender().getByText('Not verified')).toBeTruthy();
    expect(sender().getByText(/Your mailbox refused the password\./)).toBeTruthy();
    expect(valueOf('Email address')).toBe(ADDRESS);
    expect(screen.getByRole('combobox', { name: 'Email provider' }).textContent).toContain('Gmail or Google Workspace');
    expect(button('Check again').disabled).toBe(false);
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
  });

  it('shows a saved Google app waiting for sign-in', async () => {
    serve(signIn('google'));
    await open();
    expect(sender().getByText('Not verified')).toBeTruthy();
    expect(sender().getByText(`${ADDRESS} is saved. Sign in with Google to continue.`)).toBeTruthy();
    expect(button('Sign in with Google')).toBeTruthy();
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();
  });

  it('shows a signed-in Microsoft mailbox waiting for its test email', async () => {
    serve(signIn('microsoft', { status: 'authenticated' }));
    await open();
    expect(sender().getByText(`${ADDRESS} is signed in. Send a test email and enter its code to finish.`)).toBeTruthy();
    expect(button('Send test email')).toBeTruthy();
    expect(screen.getByText('Step 4 of 5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in with/ })).toBeNull();
  });

  it('shows a verified Microsoft sign-in', async () => {
    serve(signIn('microsoft', { status: 'verified', mode: 'live', verifiedAt: '2026-11-18T10:00:00.000Z', lastTestAt: '2026-11-18T09:58:00.000Z' }));
    await open();
    expect(sender().getByText(ADDRESS)).toBeTruthy();
    expect(sender().getByText('Verified')).toBeTruthy();
    expect(sender().getByText(/connected with Microsoft 365 sign-in/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check connection' })).toBeNull();
    expect(screen.getByText(/If Microsoft ever needs you to sign in again/)).toBeTruthy();
  });

  it('warns that a lapsed sign-in needs reconnecting', async () => {
    serve(signIn('google', {
      verifiedAt: '2026-11-01T10:00:00.000Z', lastError: 'Email authorisation expired or was revoked. Reconnect the provider.',
    }));
    await open();
    expect(sender().getByText(ADDRESS)).toBeTruthy();
    expect(sender().getByText('Reconnect needed')).toBeTruthy();
    expect(sender().getByText(/Email authorisation expired or was revoked\. Reconnect the provider\./)).toBeTruthy();
    expect(sender().getByText(/Until you do, emails cannot be sent from this address\./)).toBeTruthy();
    expect(button('Sign in with Google')).toBeTruthy();
  });

  it('says what happens to the mailbox kept behind a sign-in', async () => {
    serve(signIn('google', { smtpKept: true, smtpKeptVerified: true }));
    await open();
    expect(sender().getByText('Your mailbox')).toBeTruthy();
    expect(sender().getByText('Until this sign-in is verified, emails keep going through the mailbox you connected with a password.')).toBeTruthy();
  });

  it('holds its place while loading, then shows the server sentence when the view cannot be read', async () => {
    let fail = true;
    sr.call.mockImplementation(async () => {
      if (fail) throw new Refusal('We could not check your settings just now. Please try again in a few minutes.', 503);
      return none;
    });
    mount();
    expect(screen.getByText('Checking how your emails are sent')).toBeTruthy();
    expect(await alertText()).toBe('We could not check your settings just now. Please try again in a few minutes.');
    expect(screen.queryByRole('group', { name: 'Choose how to connect' })).toBeNull();
    fail = false;
    click('Try again');
    expect(await screen.findByText('Emails are sent from')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing, and calls nothing, until a workspace is picked', async () => {
    sr.state.workspaceId = null;
    serve(none);
    const { container } = render(<MemoryRouter><EmailConnectionPanel readOnly={false} /></MemoryRouter>);
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
    expect(sr.call).not.toHaveBeenCalled();
  });
});

describe('connecting with a password', () => {
  const startForm = async () => {
    serve(none, { save: (body) => { current = smtp({ email: String(body.email) }); return { verified: true, verifiedAt: current.verifiedAt, view: current }; } });
    await open();
    click(/Email password/);
    await screen.findByLabelText('Email address');
  };

  it('fills in the server details of a named provider, and lets a custom one be typed', async () => {
    await startForm();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.queryByLabelText('Server name')).toBeNull();
    await pick('Email provider', 'Gmail or Google Workspace');
    expect(screen.queryByLabelText('Server name')).toBeNull();
    click('Advanced');
    expect(valueOf('Server name')).toBe('smtp.gmail.com');
    expect((screen.getByLabelText('Server name') as HTMLInputElement).readOnly).toBe(true);
    expect(valueOf('Port')).toBe('465');
    expect(valueOf('Security')).toBe('SSL/TLS');
    expect(screen.getByLabelText('Username')).toBeTruthy();

    await pick('Email provider', 'Outlook or Microsoft 365');
    expect(valueOf('Server name')).toBe('smtp.office365.com');
    expect(valueOf('Port')).toBe('587');
    expect(valueOf('Security')).toBe('STARTTLS');

    click('Advanced');
    await pick('Email provider', 'Another provider');
    const host = screen.getByLabelText('Server name') as HTMLInputElement;
    expect(host.readOnly).toBe(false);
    expect(host.value).toBe('');
    expect(screen.getByRole('combobox', { name: 'Port' }).textContent).toContain('587');
    expect(screen.getByRole('combobox', { name: 'Security' }).textContent).toContain('STARTTLS');
    await pick('Port', '465');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Security' }).textContent).toContain('SSL/TLS'));
  });

  it('says what is missing before anything is sent', async () => {
    await startForm();
    click('Save and connect');
    expect(await alertText()).toBe('Choose your email provider.');
    await pick('Email provider', 'Another provider');
    type('Email address', 'sam@');
    click('Save and connect');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.'));
    type('Email address', ADDRESS);
    click('Save and connect');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Enter your provider's SMTP server, like smtp.example.com."));
    type('Server name', 'mail.samstudio.co.uk');
    click('Save and connect');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter your password.'));
    expect(posts()).toEqual([]);
  });

  it('saves, connects, and never shows the password again', async () => {
    await startForm();
    await pick('Email provider', 'Gmail or Google Workspace');
    type('Email address', ADDRESS);
    type('Password or app password', 'hunter2-app-password');
    click('Save and connect');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Connected. Emails are sent from ${ADDRESS}.`));
    expect(bodyOf('save')).toEqual({
      provider: 'gmail', email: ADDRESS, host: 'smtp.gmail.com', port: 465, security: 'tls', username: '', password: 'hunter2-app-password',
    });
    expect(sender().getByText('Verified')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(`Connected. Emails are sent from ${ADDRESS}.`);
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
    expect(document.body.innerHTML).not.toContain('hunter2-app-password');
    click('Change details');
    expect(valueOf('Password or app password')).toBe('');
    expect((screen.getByLabelText('Password or app password') as HTMLInputElement).placeholder).toBe('Saved. Leave empty to keep it.');
    expect(document.body.innerHTML).not.toContain('hunter2-app-password');
  });

  it('sends a custom server as typed', async () => {
    await startForm();
    await pick('Email provider', 'Another provider');
    type('Email address', ADDRESS);
    type('Server name', 'Mail.SamStudio.co.uk');
    await pick('Port', '2525');
    click('Advanced');
    type('Username', 'sam');
    type('Password or app password', 'pw');
    click('Save and connect');
    await waitFor(() => expect(bodyOf('save')).toEqual({
      provider: 'custom', email: ADDRESS, host: 'mail.samstudio.co.uk', port: 2525, security: 'starttls', username: 'sam', password: 'pw',
    }));
  });

  it('stays on the form with the mailbox own answer when the check fails, the password cleared', async () => {
    serve(none, {
      save: (body) => {
        current = smtp({ email: String(body.email), status: 'configured', mode: 'platform', verifiedAt: undefined, lastError: 'Your mailbox refused the password.' });
        return { verified: false, error: 'Your mailbox refused the password.', view: current };
      },
    });
    await open();
    click(/Email password/);
    await pick('Email provider', 'Gmail or Google Workspace');
    type('Email address', ADDRESS);
    type('Password or app password', 'wrong-password');
    click('Save and connect');
    expect(await alertText()).toBe('Your mailbox refused the password.');
    expect(toast.error).toHaveBeenCalledWith('Your mailbox refused the password.');
    expect(valueOf('Password or app password')).toBe('');
    expect(valueOf('Email address')).toBe(ADDRESS);
    expect(sender().getByText('Not verified')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('wrong-password');
  });

  it('keeps the stored password when the field is left empty', async () => {
    serve(smtp(), { save: () => ({ verified: true, verifiedAt: current.verifiedAt, view: current }) });
    await open();
    click('Change details');
    expect(screen.getByText(/Saving resets verification/)).toBeTruthy();
    click('Save and connect');
    await waitFor(() => expect(bodyOf('save')).toMatchObject({ provider: 'gmail', email: ADDRESS, password: '' }));
  });

  it('asks for the password again once the server or username changes', async () => {
    serve(smtp(), { save: () => ({ verified: true, view: current }) });
    await open();
    click('Change details');
    await pick('Email provider', 'Yahoo Mail');
    expect(screen.getByText('You changed the server or username, so enter the password again.')).toBeTruthy();
    click('Save and connect');
    expect(await alertText()).toBe('Enter your password.');
    expect(posts()).toEqual([]);
    click('Back');
    expect(button('Check connection')).toBeTruthy();
  });

  it('checks the connection again', async () => {
    serve(smtp(), { verify: () => ({ verified: true, verifiedAt: '2026-11-19T12:00:00.000Z' }) });
    await open();
    click('Check connection');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Checked. Your mailbox is working.'));
    expect(bodyOf('verify')).toEqual({});
    expect(gets()).toBe(2);
  });

  it('shows why a check failed and goes back to the details', async () => {
    serve(smtp(), {
      verify: () => {
        current = smtp({ status: 'configured', mode: 'platform', verifiedAt: undefined, lastError: 'Enter your mailbox password again.' });
        return { verified: false, error: 'Enter your mailbox password again.' };
      },
    });
    await open();
    click('Check connection');
    expect(await alertText()).toBe('Enter your mailbox password again.');
    await waitFor(() => expect(sender().getByText('Not verified')).toBeTruthy());
    expect(screen.getByLabelText('Password or app password')).toBeTruthy();
  });

  it('will not check edited details until they are saved', async () => {
    serve(smtp({ status: 'configured', mode: 'platform', verifiedAt: undefined }), { verify: () => ({ verified: true }) });
    await open();
    type('Email address', 'ana@samstudio.example');
    expect(button('Check again').disabled).toBe(true);
    expect(screen.getByText('Save your changes before checking. Saving resets verification.')).toBeTruthy();
    type('Email address', ADDRESS);
    expect(button('Check again').disabled).toBe(false);
    click('Check again');
    await waitFor(() => expect(bodyOf('verify')).toEqual({}));
  });

  it('sends a test email to the mailbox itself', async () => {
    serve(smtp(), { test: () => ({ ok: true }) });
    await open();
    click('Send a test email');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`A test email was sent to ${ADDRESS}.`));
    expect(bodyOf('test')).toEqual({});
  });
});

describe('connecting with Google sign-in', () => {
  it('saves the app details, then sends the browser to Google', async () => {
    serve(none, {
      save: (body) => { current = signIn('google', { email: String(body.email), clientId: String(body.clientId) }); return { verified: false, view: current }; },
      authorize: () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc' }),
    });
    await open();
    click(/Google sign-in/);
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    expect(valueOf('Redirect address to register')).toBe(CALLBACK);
    expect((screen.getByLabelText('Redirect address to register') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByLabelText('Microsoft tenant ID or domain')).toBeNull();
    expect(screen.getByText(/Gmail API/)).toBeTruthy();

    type('Work email address', ADDRESS);
    click('Save app details');
    expect(await alertText()).toBe('Enter the client ID from your provider.');
    expect(posts()).toEqual([]);

    type('Client ID', 'client-123');
    type(/^Client secret/, 'top-secret-value');
    click('Save app details');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('App details saved. Next: sign in with Google.'));
    expect(bodyOf('save')).toEqual({ provider: 'google', email: ADDRESS, clientId: 'client-123', clientSecret: 'top-secret-value', tenant: '' });
    expect(document.body.innerHTML).not.toContain('top-secret-value');
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();

    click('Sign in with Google');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=abc'));
    expect(bodyOf('authorize')).toEqual({});
    expectProductNameOnly();
  });

  it('sends the test email, then confirms the code from it', async () => {
    serve(signIn('google', { status: 'authenticated' }), {
      test: () => { current = { ...current, lastTestAt: '2026-11-19T12:00:00.000Z' }; return { ok: true, message: 'A real verification email was submitted to your saved work address. Enter its code here.' }; },
      confirm: () => { current = signIn('google', { status: 'verified', mode: 'live', verifiedAt: '2026-11-19T12:01:00.000Z' }); return current; },
    });
    await open();
    expect(screen.getByText(/without a document or signing link/)).toBeTruthy();
    click('Send test email');
    await screen.findByLabelText('Code from the test email');
    expect(bodyOf('test')).toEqual({});
    expect(toast.success).toHaveBeenCalledWith(`A test email with a code was sent to ${ADDRESS}. Enter the code below.`);
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
    expect(button('Confirm code').disabled).toBe(true);
    type('Code from the test email', '12 34-56x');
    expect(valueOf('Code from the test email')).toBe('123456');
    click('Confirm code');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Connected. Emails are sent from ${ADDRESS}.`));
    expect(bodyOf('confirm')).toEqual({ code: '123456' });
    expect(sender().getByText('Verified')).toBeTruthy();
    expect(screen.queryByLabelText('Code from the test email')).toBeNull();
  });

  it('says so when the code is wrong or has expired, and can send a new one', async () => {
    const answers = [new Refusal('Incorrect verification code.', 400), new Refusal('Verification code expired. Send a new test.', 400)];
    const test = vi.fn(() => ({ ok: true }));
    serve(signIn('google', { status: 'authenticated', lastTestAt: '2026-11-19T12:00:00.000Z' }), {
      test, confirm: () => { throw answers.shift(); },
    });
    await open();
    click('I already have a code');
    type('Code from the test email', '111111');
    click('Confirm code');
    expect(await alertText()).toBe('Incorrect verification code.');
    expect(screen.getByLabelText('Code from the test email')).toBeTruthy();
    type('Code from the test email', '222222');
    click('Confirm code');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Verification code expired. Send a new test.'));
    click('Send a new code');
    await waitFor(() => expect(test).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(valueOf('Code from the test email')).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the saved client secret when the field is left empty, and never shows it', async () => {
    serve(signIn('google', { status: 'verified', mode: 'live', verifiedAt: '2026-11-18T10:00:00.000Z' }), {
      save: () => { current = signIn('google'); return { verified: false, view: current }; },
    });
    await open();
    click('Change details');
    expect(valueOf('Client ID')).toBe('client-123');
    expect(valueOf(/^Client secret/)).toBe('');
    expect((screen.getByLabelText(/^Client secret/) as HTMLInputElement).placeholder).toBe('Saved. Leave empty to keep it.');
    expect(screen.getByText(/Saving resets verification/)).toBeTruthy();
    type('Client ID', 'client-456');
    expect(screen.getByText(/the saved client secret is not kept/)).toBeTruthy();
    type('Client ID', 'client-123');
    click('Save app details');
    await waitFor(() => expect(bodyOf('save')).toEqual({ provider: 'google', email: ADDRESS, clientId: 'client-123', clientSecret: '', tenant: '' }));
  });

  it('does not follow a sign-in address that is not a secure web address', async () => {
    serve(signIn('google'), { authorize: () => ({ url: 'javascript:alert(1)' }) });
    await open();
    click('Sign in with Google');
    expect(await alertText()).toBe('The sign-in page could not be opened. Please try again.');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('connecting with Microsoft 365 sign-in', () => {
  it('asks for the tenant too, saves, and sends the browser to Microsoft', async () => {
    serve(none, {
      save: (body) => { current = signIn('microsoft', { tenant: String(body.tenant) }); return { verified: false, view: current }; },
      authorize: () => ({ url: 'https://login.microsoftonline.com/samstudio.example/oauth2/v2.0/authorize?state=abc' }),
    });
    await open();
    click(/Microsoft 365 sign-in/);
    expect(valueOf('Microsoft tenant ID or domain')).toBe('organizations');
    expect(screen.getByText(/Mail\.Send and User\.Read/)).toBeTruthy();
    type('Work email address', ADDRESS);
    type('Client ID', 'client-123');
    type('Microsoft tenant ID or domain', '../common');
    click('Save app details');
    expect(await alertText()).toBe('Enter a valid Microsoft tenant ID or domain.');
    expect(posts()).toEqual([]);
    type('Microsoft tenant ID or domain', 'samstudio.example');
    click('Save app details');
    await waitFor(() => expect(bodyOf('save')).toEqual({
      provider: 'microsoft', email: ADDRESS, clientId: 'client-123', clientSecret: '', tenant: 'samstudio.example',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/samstudio.example/oauth2/v2.0/authorize?state=abc'));
  });

  it('goes back to sign-in when the test finds the sign-in has lapsed', async () => {
    serve(signIn('microsoft', { status: 'authenticated' }), {
      test: () => {
        current = signIn('microsoft', { verifiedAt: '2026-11-01T10:00:00.000Z', lastError: 'Email authorisation expired or was revoked. Reconnect the provider.' });
        throw new Refusal('Email authorisation expired or was revoked. Reconnect the provider.', 409);
      },
    });
    await open();
    click('Send test email');
    expect(await alertText()).toBe('Email authorisation expired or was revoked. Reconnect the provider.');
    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).toBeTruthy();
    expect(sender().getByText('Reconnect needed')).toBeTruthy();
  });
});

describe('changing and disconnecting', () => {
  it('disconnects only after the owner confirms', async () => {
    serve(smtp(), { disconnect: () => { current = none; return { ok: true }; } });
    await open();
    click('Disconnect');
    let dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(`Disconnect ${ADDRESS}?`)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(posts()).toEqual([]);

    click('Disconnect');
    dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mailbox disconnected. Emails are sent by TaskCalendar again, with your reply-to address.'));
    expect(bodyOf('disconnect')).toEqual({});
    await waitFor(() => expect(sender().getByText('TaskCalendar')).toBeTruthy());
    expect(screen.getByRole('group', { name: 'Choose how to connect' })).toBeTruthy();
  });

  it('lets the owner pick a different way, or cancel', async () => {
    serve(smtp());
    await open();
    click('Use a different way');
    const ways = within(screen.getByRole('group', { name: 'Choose how to connect' }));
    expect(ways.getByText('Current')).toBeTruthy();
    click('Cancel');
    expect(button('Check connection')).toBeTruthy();
    click('Use a different way');
    click(/Microsoft 365 sign-in/);
    expect(valueOf('Work email address')).toBe(ADDRESS);
    expect(valueOf('Client ID')).toBe('');
    expect(posts()).toEqual([]);
  });
});

describe('someone who is not an owner', () => {
  it('sees the state and one sentence, and can change nothing', async () => {
    serve(smtp());
    await open(true);
    expect(sender().getByText(ADDRESS)).toBeTruthy();
    expect(sender().getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Only a workspace owner or admin can change how emails are sent.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(sr.call.mock.calls).toEqual([['email-connection']]);
  });

  it('is not offered the ways to connect when nothing is connected', async () => {
    serve(none);
    await open(true);
    expect(sender().getByText('TaskCalendar')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Choose how to connect' })).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('gets the one sentence, not an error, when the server keeps the state to owners', async () => {
    sr.call.mockRejectedValue(new Refusal('Only a workspace owner can manage the email connection.', 403));
    mount(true);
    expect(await screen.findByText('Only a workspace owner or admin can see or change how emails are sent.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('coming back from the provider', () => {
  it('says the sign-in worked, takes the flag out of the address, and shows the next step', async () => {
    serve(signIn('google', { status: 'authenticated' }));
    await open(false, '/crm/document-settings?tab=email&emailConnection=connected');
    expect(screen.getByRole('status').textContent).toBe('You are signed in. One step left: send a test email and enter the code from it.');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?tab=email'));
    expect(button('Send test email')).toBeTruthy();
    expect(gets()).toBeGreaterThan(0);
    expect(posts()).toEqual([]);
  });

  it('says the sign-in failed, and offers it again', async () => {
    serve(signIn('google'));
    await open(false, '/crm/document-settings?emailConnection=error');
    expect(await alertText()).toMatch(/^The sign-in was not completed\./);
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(button('Sign in with Google')).toBeTruthy();
  });

  it('ignores any other value, but still tidies the address', async () => {
    serve(none);
    await open(false, '/crm/document-settings?emailConnection=maybe');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('refusals from the server', () => {
  it.each([
    [403, 'Only the person who created this workspace can change its email connection.'],
    [409, 'Your email settings changed while we were checking them. Please try again.'],
    [429, "You've checked your email settings 10 times this hour. Try again in 42 minutes."],
    [502, "We couldn't reach your mailbox's server. Please try again in a few minutes."],
    [503, 'Email connections are not set up yet: SIGNROOM_MAIL_KEY is missing.'],
  ])('shows the sentence that comes with a %i as it is', async (status, sentence) => {
    serve(smtp(), { verify: () => { throw new Refusal(sentence, status); } });
    await open();
    click('Check connection');
    expect(await alertText()).toBe(sentence);
    expect(toast.error).toHaveBeenCalledWith(sentence);
    expect(button('Check connection').disabled).toBe(false);
  });

  it('shows a refused save and keeps what was typed', async () => {
    serve(none, { save: () => { throw new Refusal('Enter a valid email address.', 400); } });
    await open();
    click(/Email password/);
    await pick('Email provider', 'IONOS');
    type('Email address', ADDRESS);
    type('Password or app password', 'pw');
    click('Save and connect');
    expect(await alertText()).toBe('Enter a valid email address.');
    expect(valueOf('Email address')).toBe(ADDRESS);
  });

  it('shows a refused disconnect', async () => {
    serve(smtp(), { disconnect: () => { throw new Refusal('We could not check your settings just now. Please try again in a few minutes.', 503); } });
    await open();
    click('Disconnect');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    expect(await alertText()).toBe('We could not check your settings just now. Please try again in a few minutes.');
    expect(sender().getByText('Verified')).toBeTruthy();
  });
});
