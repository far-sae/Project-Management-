import { describe, expect, it } from 'vitest';

import {
  MAIL_PROVIDERS,
  providerById,
  providerForEmail,
  providerForHost,
  settingsFor,
} from '@/lib/email/providers';
import { friendlySmtpError, providerOf } from '@/lib/email/smtpErrors';

describe('providerForEmail', () => {
  it('recognises the consumer domains', () => {
    expect(providerForEmail('ada@gmail.com')?.id).toBe('google');
    expect(providerForEmail('ada@outlook.com')?.id).toBe('outlook');
    expect(providerForEmail('ada@yahoo.co.uk')?.id).toBe('yahoo');
    expect(providerForEmail('ada@icloud.com')?.id).toBe('icloud');
  });

  it('ignores case and surrounding space', () => {
    expect(providerForEmail('Ada@GMAIL.com ')?.id).toBe('google');
  });

  it('takes the LAST @, so a quoted local part cannot mislead it', () => {
    expect(providerForEmail('"a@b"@gmail.com')?.id).toBe('google');
  });

  it('suggests nothing for a company domain', () => {
    // Most business addresses land here, including every Google Workspace and
    // Microsoft 365 tenant, which is why the picker is not merely a fallback
    // for the guess.
    expect(providerForEmail('ada@acme.com')).toBeNull();
  });

  it('suggests nothing for something that is not an address', () => {
    expect(providerForEmail('ada')).toBeNull();
    expect(providerForEmail('ada@')).toBeNull();
    expect(providerForEmail('')).toBeNull();
  });

  it('never guesses Microsoft 365, which has no domain of its own', () => {
    // A tenant uses the customer's own domain, so there is nothing to match
    // on. Guessing it from anything would be guessing.
    expect(MAIL_PROVIDERS.find((p) => p.id === 'microsoft365')?.domains).toEqual([]);
  });
});

describe('providerForHost', () => {
  it('names the provider a saved mailbox is already using', () => {
    // Read back from the host rather than stored as a field, so the picker
    // tells the truth about a mailbox saved before it existed.
    expect(providerForHost('smtp.gmail.com')).toBe('google');
    expect(providerForHost('SMTP.ZOHO.COM')).toBe('zoho');
  });

  it('says "other" for a host nobody here recognises', () => {
    expect(providerForHost('mail.acme.com')).toBe('other');
    expect(providerForHost('')).toBe('other');
  });
});

describe('settingsFor', () => {
  it('fills IMAP as well as SMTP', () => {
    // IMAP is optional, but leaving it blank when the answer is known means
    // replies and bounces go undetected for a mailbox that could have had both
    // for free, with nothing on screen saying that is why.
    expect(settingsFor('google')).toEqual({
      smtpHost: 'smtp.gmail.com',
      smtpPort: '587',
      smtpSecure: false,
      imapHost: 'imap.gmail.com',
      imapPort: '993',
      imapSecure: true,
    });
  });

  it('pairs 465 with TLS-on-connect and 587 without', () => {
    // Both are encrypted and they differ in WHEN. The wrong pairing produces a
    // connection that hangs rather than an error that says so, which is the
    // sort of thing a preset exists to prevent.
    for (const provider of MAIL_PROVIDERS) {
      if (provider.smtpPort === 465) expect(provider.smtpSecure).toBe(true);
      if (provider.smtpPort === 587) expect(provider.smtpSecure).toBe(false);
    }
  });

  it('gives every provider a real IMAP port', () => {
    for (const provider of MAIL_PROVIDERS) {
      expect(provider.imapPort).toBe(993);
      expect(provider.imapSecure).toBe(true);
    }
  });

  it('has nothing to fill in for a provider that does not exist', () => {
    expect(settingsFor('other')).toBeNull();
    expect(providerById('other')).toBeNull();
  });
});

describe('what each provider tells the person before they press Verify', () => {
  it('says something actionable for every entry', () => {
    // The reason this module earns its place: almost none of these accept an
    // account password any more, and the failure otherwise arrives as an SMTP
    // code after the person has already typed the wrong thing.
    for (const provider of MAIL_PROVIDERS) {
      expect(provider.setup.length).toBeGreaterThan(30);
      expect(provider.name).not.toBe('');
    }
  });

  it('warns rather than advises where a password may not work at all', () => {
    const m365 = providerById('microsoft365');
    expect(m365?.warning).toMatch(/SMTP AUTH/i);
    expect(m365?.warning).toMatch(/OAuth/i);
  });

  it('mentions an app password for each provider that requires one', () => {
    for (const id of ['google', 'outlook', 'yahoo', 'zoho', 'icloud', 'fastmail'] as const) {
      expect(providerById(id)?.setup).toMatch(/app[- ]specific password|app password/i);
    }
  });
});

describe('the presets agree with the failure advice already in the product', () => {
  it('classifies a rejected login on a preset host with that provider’s guidance', () => {
    // smtpErrors.ts recognises a provider FROM the host to explain a failure;
    // this module fills that host in. If the two disagreed, a person would be
    // handed a preset and then told nothing useful when it failed.
    const refused = Object.assign(new Error('Invalid login'), { responseCode: 535 });

    expect(friendlySmtpError(refused, 'smtp.gmail.com')).toMatch(/app password/i);
    expect(friendlySmtpError(refused, 'smtp.zoho.com')).toMatch(/app[- ]specific password/i);

    // And the host each preset fills in is one that same module recognises —
    // a preset pointing at a host the diagnostics call 'other' would hand
    // somebody a setting and then explain nothing when it failed.
    for (const id of ['google', 'zoho', 'ionos'] as const) {
      const provider = providerById(id);
      expect(providerOf(provider?.smtpHost ?? '')).not.toBe('other');
    }
  });
});
