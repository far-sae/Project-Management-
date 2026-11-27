// "Send test to me": the test email is the email being written, not a fixed line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_BODY_LIMIT, TEST_SUBJECT_LIMIT, buildTestEmail, readTestDraft } from '../../api/_lib/testEmail';
import { testDraftFor } from '@/lib/email/testDraft';

const h = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/services/supabase/config', () => ({ supabase: { auth: { getSession: h.getSession } } }));

import { CHECK_FAILED_MESSAGE, verifyAccount } from '@/components/email/verifyAccount';
import { setInternalsVisible } from '@/lib/publicError';

describe('the draft the browser sends', () => {
  const me = { name: 'Sam Carter', email: 'sam@example.com' };

  it('is the subject and body as written, with the mailbox’s signature', () => {
    const draft = testDraftFor({ subject: 'Hi {{first_name}}', bodyHtml: '<p>Hello</p>' }, '<p>Sam, Northwind Studio</p>', null, me);
    expect(draft).toEqual({
      subject: 'Hi {{first_name}}',
      bodyHtml: '<p>Hello</p><br><br><p>Sam, Northwind Studio</p>',
      mergeData: { first_name: 'Sam', last_name: 'Carter', full_name: 'Sam Carter', email: 'sam@example.com' },
    });
  });

  it('fills the fields from the first person on the list, so the test reads as they will read it', () => {
    const first = { first_name: 'Priya', last_name: 'Nair', full_name: 'Priya Nair', email: 'priya@harbour.example', company: 'Harbour Dental' };
    const draft = testDraftFor({ subject: 'Hi {{first_name}}', bodyHtml: '<p>About {{company}}</p>' }, '', first, me);
    expect(draft?.mergeData).toEqual(first);
  });

  it('is nothing while there is no subject and no body: the plain test still checks the mailbox', () => {
    expect(testDraftFor({ subject: '  ', bodyHtml: '' }, '<p>Sam</p>', null, me)).toBeNull();
    expect(testDraftFor({ subject: '', bodyHtml: '<p><br></p>' }, '', null, me)).toBeNull();
    expect(testDraftFor({ subject: 'Only a subject', bodyHtml: '' }, '', null, me)?.subject).toBe('Only a subject');
  });

  it('uses the part before the @ when the person has no name', () => {
    expect(testDraftFor({ subject: 'x', bodyHtml: '' }, '', null, { name: '', email: 'sam@example.com' })?.mergeData)
      .toEqual({ first_name: 'sam', last_name: '', full_name: 'sam', email: 'sam@example.com' });
  });
});

describe('what the server accepts as a draft', () => {
  it('takes a subject, a body and simple fields', () => {
    expect(readTestDraft({ accountId: 'a', draft: { subject: ' Hi ', bodyHtml: '<p>x</p>', mergeData: { first_name: 'Priya', seats: 12 } } }))
      .toEqual({ subject: 'Hi', bodyHtml: '<p>x</p>', mergeData: { first_name: 'Priya', seats: '12' } });
  });

  it('is nothing when no draft was sent, or it holds nothing to send', () => {
    expect(readTestDraft({ accountId: 'a' })).toBeNull();
    expect(readTestDraft(null)).toBeNull();
    expect(readTestDraft({ draft: 'hello' })).toBeNull();
    expect(readTestDraft({ draft: { subject: '', bodyHtml: '   ' } })).toBeNull();
    expect(readTestDraft({ draft: { subject: 5, bodyHtml: ['x'] } })).toBeNull();
  });

  it('cuts what is too long and drops fields that are not plain values', () => {
    const draft = readTestDraft({
      draft: {
        subject: 's'.repeat(TEST_SUBJECT_LIMIT + 50),
        bodyHtml: 'b'.repeat(TEST_BODY_LIMIT + 50),
        mergeData: { ok: 'yes', nested: { a: 1 }, list: [1], nothing: null, 'bad key!': 'x', long: 'v'.repeat(900) },
      },
    });
    expect(draft?.subject).toHaveLength(TEST_SUBJECT_LIMIT);
    expect(draft?.bodyHtml).toHaveLength(TEST_BODY_LIMIT);
    expect(Object.keys(draft?.mergeData ?? {})).toEqual(['ok', 'long']);
    expect(draft?.mergeData.long).toHaveLength(500);
  });

  it('keeps at most fifty fields', () => {
    const mergeData = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, 'x']));
    expect(Object.keys(readTestDraft({ draft: { subject: 'x', bodyHtml: '', mergeData } })?.mergeData ?? {})).toHaveLength(50);
  });
});

describe('the test email', () => {
  it('is the old plain line when there is no draft', () => {
    expect(buildTestEmail(null)).toEqual({
      subject: 'TaskCalendar test email',
      text: 'This is a test message. Your sending account works.',
    });
  });

  it('is the email as written, with the fields filled in and marked as a test', () => {
    const mail = buildTestEmail({ subject: 'Hi {{first_name}}', bodyHtml: '<p>About {{company}} &amp; you</p>', mergeData: { first_name: 'Priya', company: 'Harbour <Dental>' } });
    expect(mail.subject).toBe('[Test] Hi Priya');
    expect(mail.html).toContain('<p>About Harbour &lt;Dental&gt; &amp; you</p>');
    expect(mail.text).toContain('About Harbour <Dental> & you');
    // No working unsubscribe link in a test, but it says where the real one goes.
    expect(mail.html).toContain('This is a test. The real email also has an unsubscribe link here.');
    expect(mail.text).toContain('This is a test. The real email also has an unsubscribe link here.');
    expect(mail.html).not.toContain('{{');
  });

  it('says so when the subject is still empty', () => {
    expect(buildTestEmail({ subject: '', bodyHtml: '<p>x</p>', mergeData: {} }).subject).toBe('[Test] (no subject yet)');
  });
});

describe('asking the server for the test', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the draft with the mailbox', async () => {
    const draft = { subject: 'Hi', bodyHtml: '<p>x</p>', mergeData: { first_name: 'Priya' } };
    expect(await verifyAccount('acc-1', draft)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/email/verify');
    expect(JSON.parse(init.body)).toEqual({ accountId: 'acc-1', draft });
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  it('sends only the mailbox when there is no draft', async () => {
    await verifyAccount('acc-1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accountId: 'acc-1' });
    await verifyAccount('acc-1', null);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ accountId: 'acc-1' });
  });

  it('passes on the server\'s plain sentence when the mailbox could not send', async () => {
    const sentence = 'IONOS did not accept this email address and password. Check three things.';
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, error: sentence }) });
    expect(await verifyAccount('acc-1')).toEqual({ ok: false, error: sentence });
  });

  it('says which server the check found, when it was not the one saved', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, server: 'smtp.ionos.com' }) });
    expect(await verifyAccount('acc-1')).toEqual({ ok: true, server: 'smtp.ionos.com' });
  });

  it('keeps how the site is set up, and anything a machine wrote, away from everybody but the people who run it', async () => {
    const setUp = "Mailbox passwords cannot be read: INTEGRATION_TOKEN_KEY is missing or was changed in Vercel's environment variables.";
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ ok: false, error: setUp }) });
    setInternalsVisible(false);
    expect((await verifyAccount('acc-1')).error).toBe('This is not switched on yet. Please contact support.');
    setInternalsVisible(true);
    expect((await verifyAccount('acc-1')).error).toBe(setUp);
    setInternalsVisible(false);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect((await verifyAccount('acc-1')).error).toBe(CHECK_FAILED_MESSAGE);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'TypeError: Cannot read properties of undefined' }) });
    expect((await verifyAccount('acc-1')).error).toBe(CHECK_FAILED_MESSAGE);
  });
});
