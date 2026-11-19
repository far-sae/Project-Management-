// The rules behind the "send from your own mailbox" panel: presets, checks, request bodies, and what state to show.
import { describe, expect, it } from 'vitest';
import {
  MESSAGES, PORTS, PRESETS, SMTP_PROVIDERS, WAYS,
  appBody, appFormOf, appProblem, arrivalOf, cleanCode, connectionOf, disconnectQuestion, disconnectedSentence,
  isCode, keepsClientSecret, keepsPassword, keptMailboxSentence, lastCheckOf, needsReconnect, safeSignInUrl,
  securityForPort, smtpBody, smtpDirty, smtpFormOf, smtpProblem, stageOf, stepOf, summaryOf,
  type AppForm, type EmailConnectionView, type SmtpForm,
} from '@/lib/signroom/emailConnection';

const none: EmailConnectionView = { configured: false, provider: 'smtp', status: 'none', mode: 'platform', callbackUri: 'https://app.example/cb' };
const smtp = (over: Partial<EmailConnectionView> = {}): EmailConnectionView => ({
  configured: true, provider: 'smtp', status: 'verified', mode: 'live', email: 'sam@samstudio.example',
  host: 'smtp.gmail.com', port: 465, security: 'tls', username: 'sam@samstudio.example', preset: 'gmail',
  verifiedAt: '2026-11-18T10:00:00.000Z', smtpKept: false, smtpKeptVerified: false, callbackUri: 'https://app.example/cb', ...over,
});
const google = (over: Partial<EmailConnectionView> = {}): EmailConnectionView => ({
  configured: true, provider: 'google', status: 'configured', mode: 'platform', email: 'sam@samstudio.example',
  clientId: 'abc.apps.example', tenant: '', hasClientSecret: true, smtpKept: false, smtpKeptVerified: false,
  callbackUri: 'https://app.example/cb', ...over,
});
const form = (over: Partial<SmtpForm> = {}): SmtpForm => ({
  provider: 'gmail', email: 'sam@samstudio.example', host: '', port: 587, security: 'starttls', username: '', password: 'app-pass', ...over,
});
const app = (over: Partial<AppForm> = {}): AppForm => ({
  provider: 'google', email: 'sam@samstudio.example', clientId: 'abc.apps.example', clientSecret: '', tenant: 'organizations', ...over,
});

describe('provider presets', () => {
  it('lists password first, then the two sign-ins, each with one line', () => {
    expect(WAYS.map((w) => w.id)).toEqual(['smtp', 'google', 'microsoft']);
    for (const way of WAYS) expect(way.line.length).toBeGreaterThan(20);
  });

  it('knows the server, port and security of every named provider', () => {
    expect(SMTP_PROVIDERS.map((p) => p.id)).toEqual(['gmail', 'outlook', 'ionos', 'yahoo', 'zoho', 'godaddy', 'hostinger', 'custom']);
    expect(PRESETS.gmail).toEqual({ host: 'smtp.gmail.com', port: 465, security: 'tls' });
    expect(PRESETS.outlook).toEqual({ host: 'smtp.office365.com', port: 587, security: 'starttls' });
    expect(PRESETS.ionos.host).toBe('smtp.ionos.co.uk');
    expect(PRESETS.yahoo.host).toBe('smtp.mail.yahoo.com');
    expect(PRESETS.zoho.host).toBe('smtp.zoho.eu');
    expect(PRESETS.godaddy.host).toBe('smtpout.secureserver.net');
    expect(PRESETS.hostinger.host).toBe('smtp.hostinger.com');
    expect(PORTS).toEqual([465, 587, 2525]);
  });

  it('forces a preset over whatever was typed, and tidies a custom server name', () => {
    expect(connectionOf(form({ provider: 'outlook', host: 'evil.example', port: 465, security: 'tls' })))
      .toEqual({ host: 'smtp.office365.com', port: 587, security: 'starttls' });
    expect(connectionOf(form({ provider: 'custom', host: '  Mail.SamStudio.Example. ', port: 2525, security: 'starttls' })))
      .toEqual({ host: 'mail.samstudio.example', port: 2525, security: 'starttls' });
    expect(securityForPort(465)).toBe('tls');
    expect(securityForPort(587)).toBe('starttls');
    expect(securityForPort(2525)).toBe('starttls');
  });
});

describe('checking the password form', () => {
  it('passes a filled-in preset form', () => {
    expect(smtpProblem(form(), none)).toBeNull();
  });

  it('says what is wrong, one thing at a time', () => {
    expect(smtpProblem(form({ provider: '' }), none)).toBe(MESSAGES.provider);
    expect(smtpProblem(form({ email: 'sam@' }), none)).toBe(MESSAGES.email);
    expect(smtpProblem(form({ email: 'a@b.example, c@d.example' }), none)).toBe(MESSAGES.email);
    expect(smtpProblem(form({ username: 'x'.repeat(255) }), none)).toBe(MESSAGES.username);
    expect(smtpProblem(form({ provider: 'custom', host: 'localhost' }), none)).toBe(MESSAGES.host);
    expect(smtpProblem(form({ provider: 'custom', host: '10.0.0.1' }), none)).toBe(MESSAGES.host);
    expect(smtpProblem(form({ provider: 'custom', host: 'mail.corp' }), none)).toBe(MESSAGES.host);
    expect(smtpProblem(form({ provider: 'custom', host: 'smtp.samstudio.co.uk', port: 25 as never }), none)).toBe(MESSAGES.port);
    expect(smtpProblem(form({ provider: 'custom', host: 'smtp.samstudio.co.uk', security: 'none' as never }), none)).toBe(MESSAGES.security);
    expect(smtpProblem(form({ password: '' }), none)).toBe(MESSAGES.password);
    expect(smtpProblem(form({ password: 'x'.repeat(257) }), none)).toBe(MESSAGES.passwordLong);
    expect(smtpProblem(form({ password: 'a\nb' }), none)).toBe(MESSAGES.passwordLineBreak);
  });

  it('uses the same sentences as the server', () => {
    expect(MESSAGES.provider).toBe('Choose your email provider.');
    expect(MESSAGES.email).toBe('Enter a valid email address.');
    expect(MESSAGES.username).toBe('Enter your username (254 characters at most).');
    expect(MESSAGES.password).toBe('Enter your password.');
    expect(MESSAGES.passwordLong).toBe('That password is too long.');
    expect(MESSAGES.passwordLineBreak).toBe("A password can't contain line breaks.");
    expect(MESSAGES.host).toBe("Enter your provider's SMTP server, like smtp.example.com.");
    expect(MESSAGES.port).toBe('Choose port 465, 587 or 2525.');
    expect(MESSAGES.security).toBe('Choose SSL/TLS or STARTTLS.');
    expect(MESSAGES.tenant).toBe('Enter a valid Microsoft tenant ID or domain.');
  });

  it('keeps the saved password only for the same server and username', () => {
    const saved = smtp();
    expect(keepsPassword(form({ password: '' }), saved)).toBe(true);
    expect(smtpProblem(form({ password: '' }), saved)).toBeNull();
    // Another address with no username typed signs in as someone else.
    expect(keepsPassword(form({ password: '', email: 'ana@samstudio.example' }), saved)).toBe(false);
    expect(keepsPassword(form({ password: '', email: 'ana@samstudio.example', username: 'sam@samstudio.example' }), saved)).toBe(true);
    expect(keepsPassword(form({ password: '', provider: 'outlook' }), saved)).toBe(false);
    expect(smtpProblem(form({ password: '', provider: 'outlook' }), saved)).toBe(MESSAGES.password);
    expect(keepsPassword(form({ password: '' }), google())).toBe(false);
    expect(keepsPassword(form({ password: '' }), none)).toBe(false);
  });

  it('builds the save request as the server reads it', () => {
    expect(smtpBody(form({ email: ' sam@samstudio.example ', username: ' sam ' }))).toEqual({
      provider: 'gmail', email: 'sam@samstudio.example', host: 'smtp.gmail.com', port: 465, security: 'tls', username: 'sam', password: 'app-pass',
    });
    expect(smtpBody(form({ provider: 'custom', host: 'Smtp.SamStudio.example', port: 587, security: 'starttls', password: '' }))).toEqual({
      provider: 'custom', email: 'sam@samstudio.example', host: 'smtp.samstudio.example', port: 587, security: 'starttls', username: '', password: '',
    });
  });

  it('fills the form from what is saved, never with a password', () => {
    expect(smtpFormOf(none)).toEqual({ provider: '', email: '', host: '', port: 587, security: 'starttls', username: '', password: '' });
    expect(smtpFormOf(smtp())).toEqual({
      provider: 'gmail', email: 'sam@samstudio.example', host: 'smtp.gmail.com', port: 465, security: 'tls', username: '', password: '',
    });
    expect(smtpFormOf(smtp({ preset: 'custom', host: 'mail.samstudio.example', port: 2525, security: 'starttls', username: 'sam' })))
      .toMatchObject({ provider: 'custom', host: 'mail.samstudio.example', port: 2525, security: 'starttls', username: 'sam' });
    // A Google or Microsoft connection has no password details to show.
    expect(smtpFormOf(google())).toMatchObject({ provider: '', email: 'sam@samstudio.example', host: '' });
  });

  it('knows when the form differs from what is saved', () => {
    const saved = smtp();
    expect(smtpDirty(smtpFormOf(saved), saved)).toBe(false);
    expect(smtpDirty({ ...smtpFormOf(saved), password: 'new' }, saved)).toBe(true);
    expect(smtpDirty({ ...smtpFormOf(saved), email: 'ana@samstudio.example' }, saved)).toBe(true);
    expect(smtpDirty({ ...smtpFormOf(saved), provider: 'yahoo' }, saved)).toBe(true);
    expect(smtpDirty(form(), none)).toBe(false);
  });
});

describe('checking the sign-in app details', () => {
  it('passes Google and Microsoft details', () => {
    expect(appProblem(app())).toBeNull();
    expect(appProblem(app({ provider: 'microsoft', tenant: 'samstudio.example' }))).toBeNull();
    expect(appProblem(app({ provider: 'microsoft', tenant: '' }))).toBeNull();
  });

  it('says what is wrong', () => {
    expect(appProblem(app({ email: 'sam' }))).toBe(MESSAGES.email);
    expect(appProblem(app({ clientId: '  ' }))).toBe(MESSAGES.clientId);
    expect(appProblem(app({ provider: 'microsoft', tenant: '../common' }))).toBe(MESSAGES.tenant);
    expect(appProblem(app({ provider: 'microsoft', tenant: 'a b' }))).toBe(MESSAGES.tenant);
    expect(appProblem(app({ provider: 'microsoft', tenant: 'x'.repeat(101) }))).toBe(MESSAGES.tenant);
    expect(appProblem(app({ clientSecret: 'x'.repeat(4097) }))).toBe(MESSAGES.secretLong);
    // Google has no tenant, so a stray one is not checked.
    expect(appProblem(app({ tenant: '../x' }))).toBeNull();
  });

  it('builds the save request', () => {
    expect(appBody(app({ email: ' Sam@SamStudio.example ', clientId: ' abc ', clientSecret: 's3cret' }))).toEqual({
      provider: 'google', email: 'Sam@SamStudio.example', clientId: 'abc', clientSecret: 's3cret', tenant: '',
    });
    expect(appBody(app({ provider: 'microsoft', tenant: ' ' }))).toMatchObject({ provider: 'microsoft', tenant: 'organizations', clientSecret: '' });
  });

  it('fills the form from the saved app of the same provider only', () => {
    expect(appFormOf(google(), 'google')).toEqual({
      provider: 'google', email: 'sam@samstudio.example', clientId: 'abc.apps.example', clientSecret: '', tenant: 'organizations',
    });
    expect(appFormOf(google(), 'microsoft')).toEqual({
      provider: 'microsoft', email: 'sam@samstudio.example', clientId: '', clientSecret: '', tenant: 'organizations',
    });
    expect(appFormOf(google({ provider: 'microsoft', tenant: 'samstudio.example' }), 'microsoft').tenant).toBe('samstudio.example');
  });

  it('keeps the saved client secret only for the very same app', () => {
    expect(keepsClientSecret(app(), google())).toBe(true);
    expect(keepsClientSecret(app({ clientId: 'other' }), google())).toBe(false);
    expect(keepsClientSecret(app({ email: 'ana@samstudio.example' }), google())).toBe(false);
    expect(keepsClientSecret(app(), google({ hasClientSecret: false }))).toBe(false);
    expect(keepsClientSecret(app({ provider: 'microsoft' }), google())).toBe(false);
    const ms = google({ provider: 'microsoft', tenant: 'organizations' });
    expect(keepsClientSecret(app({ provider: 'microsoft' }), ms)).toBe(true);
    expect(keepsClientSecret(app({ provider: 'microsoft', tenant: 'samstudio.example' }), ms)).toBe(false);
  });

  it('accepts a six-digit code and nothing else', () => {
    expect(cleanCode(' 12a3-456789 ')).toBe('123456');
    expect(isCode('123456')).toBe(true);
    expect(isCode('12345')).toBe(false);
  });
});

describe('what the panel shows', () => {
  it('says TaskCalendar sends the emails until a mailbox is connected', () => {
    const s = summaryOf(none);
    expect(s).toMatchObject({ state: 'platform', sender: 'TaskCalendar', pill: { tone: 'neutral', label: 'Default' } });
    expect(s.detail).toContain('TaskCalendar sends');
  });

  it('shows the connected address as verified', () => {
    expect(summaryOf(smtp())).toMatchObject({ state: 'live', sender: 'sam@samstudio.example', pill: { tone: 'success', label: 'Verified' } });
    expect(summaryOf(google({ status: 'verified', mode: 'live', verifiedAt: '2026-11-18T10:00:00.000Z' })).detail).toContain('Google sign-in');
  });

  it('shows a saved but unverified mailbox as not verified, still sent by TaskCalendar', () => {
    const s = summaryOf(smtp({ status: 'configured', mode: 'platform', verifiedAt: undefined, lastError: 'Your mailbox refused the password.' }));
    expect(s).toMatchObject({ state: 'pending', sender: 'TaskCalendar', pill: { tone: 'warning', label: 'Not verified' } });
    expect(summaryOf(google()).state).toBe('pending');
    expect(summaryOf(google({ status: 'authenticated' })).detail).toContain('test email');
  });

  it('asks to reconnect when a verified sign-in has lapsed', () => {
    const lapsed = google({ verifiedAt: '2026-11-01T10:00:00.000Z', lastError: 'Email authorisation expired or was revoked. Reconnect the provider.' });
    expect(needsReconnect(lapsed)).toBe(true);
    expect(summaryOf(lapsed)).toMatchObject({ state: 'reconnect', sender: 'sam@samstudio.example', pill: { tone: 'warning', label: 'Reconnect needed' } });
    expect(needsReconnect(google())).toBe(false);
    expect(needsReconnect(smtp({ status: 'configured' }))).toBe(false);
    expect(needsReconnect(google({ status: 'reconnect' as never }))).toBe(true);
  });

  it('names the mailbox kept behind a sign-in', () => {
    expect(keptMailboxSentence(smtp())).toBeNull();
    expect(keptMailboxSentence(google())).toBeNull();
    expect(keptMailboxSentence(google({ smtpKept: true, smtpKeptVerified: true })))
      .toBe('Until this sign-in is verified, emails keep going through the mailbox you connected with a password.');
    expect(keptMailboxSentence(google({ smtpKept: true, smtpKeptVerified: false })))
      .toBe('The mailbox you connected with a password is kept but not verified, so emails are sent by TaskCalendar until a connection is verified.');
    const live = google({ status: 'verified', mode: 'live', verifiedAt: '2026-11-18T10:00:00.000Z', smtpKept: true });
    expect(keptMailboxSentence({ ...live, smtpKeptVerified: true }))
      .toBe('The mailbox you connected with a password is kept, and is used again if you disconnect this sign-in.');
    expect(keptMailboxSentence({ ...live, smtpKeptVerified: false }))
      .toBe('The mailbox you connected with a password is kept but not verified, so it is not used if you disconnect this sign-in.');
    expect(summaryOf(google({ smtpKept: true, smtpKeptVerified: true })).sender).toBe('Your mailbox');
  });

  it('takes the latest of the checks as the last check', () => {
    expect(lastCheckOf(none)).toBeNull();
    expect(lastCheckOf(smtp())).toBe('2026-11-18T10:00:00.000Z');
    expect(lastCheckOf(google({ lastTestAt: '2026-11-19T08:00:00.000Z', verifiedAt: '2026-11-18T10:00:00.000Z' }))).toBe('2026-11-19T08:00:00.000Z');
  });

  it('picks the one step to show', () => {
    expect(stageOf(none, null, false)).toBe('choose');
    expect(stageOf(none, 'smtp', false)).toBe('smtp');
    expect(stageOf(none, 'microsoft', false)).toBe('app');
    expect(stageOf(smtp(), null, false)).toBe('done');
    expect(stageOf(smtp(), 'choose', false)).toBe('choose');
    expect(stageOf(smtp({ status: 'configured' }), null, false)).toBe('smtp');
    expect(stageOf(google(), null, false)).toBe('signin');
    expect(stageOf(google({ status: 'authenticated' }), null, false)).toBe('test');
    expect(stageOf(google({ status: 'authenticated' }), null, true)).toBe('code');
    expect(stageOf(google({ status: 'verified' }), null, true)).toBe('done');
    expect(stageOf(google({ status: 'verified' }), 'google', false)).toBe('app');
  });

  it('numbers the steps of each way', () => {
    expect(stepOf('choose', null)).toEqual({ n: 1, of: null });
    expect(stepOf('smtp', 'smtp')).toEqual({ n: 2, of: 2 });
    expect(stepOf('app', 'google')).toEqual({ n: 2, of: 5 });
    expect(stepOf('signin', 'google')).toEqual({ n: 3, of: 5 });
    expect(stepOf('test', 'microsoft')).toEqual({ n: 4, of: 5 });
    expect(stepOf('code', 'microsoft')).toEqual({ n: 5, of: 5 });
  });

  it('words the disconnect question and its outcome by what is left behind', () => {
    expect(disconnectQuestion(smtp()).description).toContain('TaskCalendar');
    expect(disconnectedSentence(smtp())).toBe('Mailbox disconnected. Emails are sent by TaskCalendar again, with your reply-to address.');
    expect(disconnectedSentence(google({ smtpKept: true, smtpKeptVerified: true })))
      .toBe('Sign-in removed. Emails go through the mailbox you connected with a password again.');
    expect(disconnectedSentence(google({ smtpKept: true, smtpKeptVerified: false })))
      .toBe('Sign-in removed. Emails are sent by TaskCalendar until the mailbox you connected with a password is verified.');
    expect(disconnectQuestion(google({ smtpKept: true, smtpKeptVerified: true })).description).toContain('connected with a password');
  });

  it('reads the arrival flag and only follows a secure sign-in address', () => {
    expect(arrivalOf('connected')).toBe('connected');
    expect(arrivalOf('error')).toBe('error');
    expect(arrivalOf('nope')).toBeNull();
    expect(arrivalOf(null)).toBeNull();
    expect(safeSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(safeSignInUrl('javascript:alert(1)')).toBeNull();
    expect(safeSignInUrl('http://accounts.google.com/')).toBeNull();
    expect(safeSignInUrl('')).toBeNull();
    expect(safeSignInUrl(undefined)).toBeNull();
  });

  it('never names the old product', () => {
    const views = [none, smtp(), smtp({ status: 'configured' }), google(), google({ status: 'authenticated' }), google({ smtpKept: true })];
    const words = [
      ...views.flatMap((v) => [summaryOf(v).detail, keptMailboxSentence(v) ?? '', disconnectedSentence(v), disconnectQuestion(v).description]),
      ...Object.values(MESSAGES), ...WAYS.map((w) => w.line),
    ].join(' ');
    expect(words).not.toMatch(/signroom|securovix/i);
  });
});
