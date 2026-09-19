// worker/lib/dns.ts — what counts as "this domain cannot receive mail".
//
// The answer feeds the engine's pre-send check, and a `false` there becomes a
// hard bounce plus a permanent `email_suppressions` row for the whole
// organisation, enforced by claim_email_batch() against every future campaign
// and undone only by deleting rows by hand. So the only failures allowed to
// produce `false` are the two that are genuinely an ANSWER — NXDOMAIN and "no
// record of that type". A timeout, a SERVFAIL, a REFUSED or a resolver that is
// simply down must throw, because the engine's catch sends the message and
// suppresses nobody.
//
// `node:dns` is stubbed rather than reached: a real lookup here would be a
// network call, and the failure modes under test cannot be produced on demand.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dns = vi.hoisted(() => ({
  resolveMx: vi.fn<(name: string) => Promise<Array<{ exchange: string; priority: number }>>>(),
  resolve4: vi.fn<(name: string) => Promise<string[]>>(),
  resolveTxt: vi.fn<(name: string) => Promise<string[][]>>(),
}));

// `default` as well as the named export: esModuleInterop means the builtin is
// consumed through its default binding, and a mock without one fails to load.
vi.mock('node:dns', () => ({ promises: dns, default: { promises: dns } }));

const { domainAcceptsMail, domainOfEmail } = await import('../../worker/lib/dns');

/** A resolver rejection as `node:dns` produces one: an Error carrying a `code`. */
const dnsError = (code: string): Error => Object.assign(new Error(`queryMx ${code}`), { code });

// The per-process cache is module state and there is no way to clear it, so
// every test uses a domain name of its own.
beforeEach(() => {
  dns.resolveMx.mockReset();
  dns.resolve4.mockReset();
  dns.resolveTxt.mockReset();
});

describe('domainOfEmail', () => {
  it('lower-cases and trims the part after the @', () => {
    expect(domainOfEmail('Ada@ Example.COM ')).toBe('example.com');
  });

  it('is empty for something that is not an address', () => {
    expect(domainOfEmail('not-an-address')).toBe('');
  });
});

describe('domainAcceptsMail — an answer', () => {
  it('is true when the domain publishes MX', async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: 'mx.mx-answer.test', priority: 10 }]);

    expect(await domainAcceptsMail('mx-answer.test')).toBe(true);
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it('falls back to A when there is no MX, because RFC 5321 §5.1 says that still accepts mail', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENODATA'));
    dns.resolve4.mockResolvedValue(['203.0.113.7']);

    expect(await domainAcceptsMail('a-only.test')).toBe(true);
  });

  it('is false, once, when neither record exists', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENOTFOUND'));
    dns.resolve4.mockRejectedValue(dnsError('ENOTFOUND'));

    expect(await domainAcceptsMail('dead.test')).toBe(false);
    // Cached: a campaign to 500 addresses at one company is one query.
    expect(await domainAcceptsMail('dead.test')).toBe(false);
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  });

  it('is false without asking the resolver at all for something that is not a domain', async () => {
    expect(await domainAcceptsMail('')).toBe(false);
    expect(await domainAcceptsMail('localhost')).toBe(false);
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });
});

describe('domainAcceptsMail — a resolver that is itself broken', () => {
  it.each(['ETIMEOUT', 'ESERVFAIL', 'EREFUSED', 'ECONNREFUSED'])(
    'rethrows %s from the MX lookup instead of answering "dead"',
    async (code) => {
      dns.resolveMx.mockRejectedValue(dnsError(code));

      await expect(domainAcceptsMail(`${code.toLowerCase()}.test`)).rejects.toThrow(code);
      // Never the A fallback: the MX query never got an answer to fall back from.
      expect(dns.resolve4).not.toHaveBeenCalled();
    },
  );

  it('rethrows a failure of the A fallback too', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENODATA'));
    dns.resolve4.mockRejectedValue(dnsError('ESERVFAIL'));

    await expect(domainAcceptsMail('a-broken.test')).rejects.toThrow('ESERVFAIL');
  });

  it('rethrows an error carrying no code at all', async () => {
    dns.resolveMx.mockRejectedValue(new Error('the resolver went away'));

    await expect(domainAcceptsMail('no-code.test')).rejects.toThrow('the resolver went away');
  });

  it('caches nothing on a failure, so recovery needs no restart', async () => {
    dns.resolveMx.mockRejectedValueOnce(dnsError('ETIMEOUT'));
    await expect(domainAcceptsMail('blip.test')).rejects.toThrow('ETIMEOUT');

    // The outage passes. A cached `false` would outlive it — nothing clears
    // that map short of restarting the worker.
    dns.resolveMx.mockResolvedValue([{ exchange: 'mx.blip.test', priority: 10 }]);
    expect(await domainAcceptsMail('blip.test')).toBe(true);
  });
});
