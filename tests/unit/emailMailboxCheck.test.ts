// @vitest-environment node
// "Send test" on a mailbox: when the mail server says no, the person is told
// what to do in plain words, and two mistakes nobody should have to find by
// hand are put right for them: the IONOS server of another region, and the
// wrong kind of encryption for the port.
import { describe, expect, it, vi } from 'vitest';
import { checkMailbox, explainFailure, ionosOtherRegion, NO_PASSWORD_MESSAGE, secureFor, type MailboxSettings } from '../../api/_lib/mailboxCheck';

const box: MailboxSettings = { smtpHost: 'smtp.ionos.co.uk', smtpPort: 587, smtpSecure: false, username: 'sam@northwind.test', imapHost: 'imap.ionos.co.uk' };
const refused = () => Object.assign(new Error('Invalid login: 535 Authentication credentials invalid'), { code: 'EAUTH', responseCode: 535 });
const unreachable = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' });

/** A mail server that takes the password on some hosts only. */
function servers(accepts: (s: { host: string; port: number; secure: boolean }) => true | Error) {
  const tried: Array<{ host: string; port: number; secure: boolean; user: string; pass: string }> = [];
  const send = vi.fn(async (s: { host: string; port: number; secure: boolean; user: string; pass: string }) => {
    tried.push(s);
    const out = accepts(s);
    if (out !== true) throw out;
  });
  return { tried, send };
}

describe('the mailbox check: IONOS regions', () => {
  it('knows the server of the other region', () => {
    expect(ionosOtherRegion('smtp.ionos.co.uk')).toBe('smtp.ionos.com');
    expect(ionosOtherRegion('smtp.ionos.de')).toBe('smtp.ionos.com');
    expect(ionosOtherRegion('SMTP.IONOS.COM')).toBe('smtp.ionos.co.uk');
    // Only IONOS's own servers: a password never goes to a host that only looks like one.
    for (const other of ['smtp.gmail.com', 'smtp.ionos.com.evil.test', 'evil-smtp.ionos.com', 'smtp.ionos.', 'ionos.co.uk', '']) expect(ionosOtherRegion(other), other).toBeNull();
  });

  it('tries the other region when IONOS refuses the password, and says which server works', async () => {
    const s = servers(({ host }) => (host === 'smtp.ionos.com' ? true : refused()));
    const out = await checkMailbox(box, 'the-password', s.send);
    expect(out).toEqual({ ok: true, changed: { smtpHost: 'smtp.ionos.com', imapHost: 'imap.ionos.com' } });
    expect(s.tried.map((t) => t.host)).toEqual(['smtp.ionos.co.uk', 'smtp.ionos.com']);
    expect(s.tried.every((t) => t.user === 'sam@northwind.test' && t.pass === 'the-password')).toBe(true);
  });

  it('keeps an inbox server the person set themselves', async () => {
    const s = servers(({ host }) => (host === 'smtp.ionos.com' ? true : refused()));
    const out = await checkMailbox({ ...box, imapHost: 'mail.northwind.test' }, 'p', s.send);
    expect(out).toEqual({ ok: true, changed: { smtpHost: 'smtp.ionos.com' } });
  });

  it('says what to check when both regions refuse', async () => {
    const s = servers(() => refused());
    const out = await checkMailbox(box, 'p', s.send);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain('IONOS did not accept this email address and password');
      expect(out.message).toContain('the password of the mailbox itself');
      expect(out.message).not.toMatch(/535|EAUTH|Invalid login/);
    }
    expect(s.tried).toHaveLength(2);
  });

  it('does not try anywhere else for another provider, or for a fault that is not about the password', async () => {
    const gmail = servers(() => refused());
    await checkMailbox({ ...box, smtpHost: 'smtp.gmail.com', imapHost: 'imap.gmail.com' }, 'p', gmail.send);
    expect(gmail.tried).toHaveLength(1);
    const down = servers(() => unreachable());
    const out = await checkMailbox(box, 'p', down.send);
    expect(down.tried).toHaveLength(1);
    expect(out.ok).toBe(false);
  });
});

describe('the mailbox check: the port and its encryption', () => {
  it('knows which encryption a port needs', () => {
    expect(secureFor(465, false)).toBe(true);
    expect(secureFor(587, true)).toBe(false);
    expect(secureFor(25, true)).toBe(false);
    // A port of their own: what the person chose stands.
    expect(secureFor(2525, true)).toBe(true);
    expect(secureFor(2525, false)).toBe(false);
  });

  it('uses the right one whatever was ticked, and writes it down when it worked', async () => {
    const s = servers(({ port, secure }) => (secure === (port === 465) ? true : unreachable()));
    expect(await checkMailbox({ ...box, smtpPort: 465, smtpSecure: false }, 'p', s.send)).toEqual({ ok: true, changed: { smtpSecure: true } });
    expect(await checkMailbox({ ...box, smtpPort: 587, smtpSecure: true }, 'p', s.send)).toEqual({ ok: true, changed: { smtpSecure: false } });
    expect(s.tried.map((t) => t.secure)).toEqual([true, false]);
    expect(await checkMailbox(box, 'p', s.send)).toEqual({ ok: true, changed: {} });
  });
});

describe('the mailbox check: what the person is told', () => {
  it('says in plain words that the server could not be reached, and what to try', () => {
    const text = explainFailure(unreachable(), 'smtp.ionos.co.uk', 587);
    expect(text).toContain('smtp.ionos.co.uk could not be reached on port 587');
    expect(text).toContain('587 or 465');
    expect(text).not.toMatch(/ETIMEDOUT|timeout$/i);
    expect(explainFailure(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.ionos.cmo'), { code: 'EDNS' }), 'smtp.ionos.cmo', 587)).toContain('There is no mail server with the name smtp.ionos.cmo');
  });

  it('names the provider and its own rule for a refused password', () => {
    expect(explainFailure(refused(), 'smtp.gmail.com', 587)).toContain('Google needs an App Password');
    expect(explainFailure(refused(), 'smtp.zoho.eu', 587)).toContain('app-specific password');
    expect(explainFailure(refused(), 'mail.northwind.test', 587)).toContain('The mail server did not accept this email address and password');
  });

  it('explains a refused sender address and a server that asks to slow down', () => {
    expect(explainFailure(Object.assign(new Error('550 Sender address is not allowed'), { responseCode: 550 }), 'smtp.ionos.co.uk', 587)).toContain('The "from" address must be the mailbox you signed in with');
    expect(explainFailure(Object.assign(new Error('421 too many connections'), { responseCode: 421 }), 'smtp.ionos.co.uk', 587)).toContain('asked to slow down');
  });

  it('never passes on what a mail server or a code library said in its own words', () => {
    for (const raw of ['self-signed certificate in certificate chain', 'read ECONNRESET', 'Unexpected socket close', 'Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to https://support.google.com/mail/?p=BadCredentials', 'Cannot read properties of undefined']) {
      const text = explainFailure(new Error(raw), 'mail.northwind.test', 587);
      expect(text, raw).not.toContain(raw);
      expect(text.length).toBeGreaterThan(30);
    }
    expect(NO_PASSWORD_MESSAGE).toBe('No password is saved for this mailbox yet. Open the mailbox, type its password again and save.');
  });
});
