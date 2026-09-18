// DNS lookups. Worker-only — a resolver needs UDP/TCP a browser cannot use.
//
// Ported from the reference project's src/server/verify-address.ts and the
// lookup half of its src/server/dns-check.ts. The interpretation half is pure
// and lives in src/lib/email/domainAuth.ts, which this file feeds: everything
// here returns data, and nothing here decides anything.

import { promises as dns } from 'node:dns';

import { DKIM_SELECTORS, type RawDnsRecords } from '@/lib/email/domainAuth';

/**
 * Per-process cache: one lookup per domain, not per recipient. A campaign to
 * 500 addresses at the same company is one query, and the worker is long-lived
 * so the cache is worth having.
 */
const acceptsCache = new Map<string, boolean>();

export function domainOfEmail(email: string): string {
  return email.split('@')[1]?.trim().toLowerCase() ?? '';
}

/**
 * Whether a domain can receive mail at all.
 *
 * MX is the usual answer. A domain with no MX but an A record still accepts
 * mail per RFC 5321 §5.1, so that counts too — treating those as dead would
 * wrongly suppress valid recipients.
 *
 * Bought and scraped lists routinely contain 10-30% dead addresses, and a
 * bounce rate above roughly 2% gets a sender throttled, so a dead address
 * costs far more than the one wasted message. A full mailbox check needs a
 * paid API; this is free, catches the largest single category (typo'd and
 * defunct domains), and never produces a false negative on a live domain.
 */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (!key || !key.includes('.')) return false;

  const cached = acceptsCache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    ok = (await dns.resolveMx(key)).length > 0;
  } catch {
    try {
      ok = (await dns.resolve4(key)).length > 0;
    } catch {
      ok = false;
    }
  }

  acceptsCache.set(key, ok);
  return ok;
}

/** A TXT lookup that answers "nothing published" rather than throwing. */
async function txt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    // Long TXT values arrive split into 255-byte chunks.
    return records.map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

/**
 * Every record `interpretDomainAuth` needs, fetched in one pass. The DKIM
 * selector probe is the expensive part — there is no way to discover a
 * selector, so each known name is a separate query — which is why they all go
 * out together.
 */
export async function fetchDnsRecords(domain: string): Promise<RawDnsRecords> {
  const clean = domain.trim().toLowerCase().replace(/^@/, '');

  const [rootTxt, dmarcTxt, mxRecords, dkimSelectors] = await Promise.all([
    txt(clean),
    txt(`_dmarc.${clean}`),
    dns.resolveMx(clean).catch(() => []),
    Promise.all(
      DKIM_SELECTORS.map(async (selector) => ({
        selector,
        records: await txt(`${selector}._domainkey.${clean}`),
      })),
    ),
  ]);

  return {
    domain: clean,
    rootTxt,
    dmarcTxt,
    // Lowest priority first, which is the order interpretDomainAuth documents.
    mx: mxRecords.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()),
    dkimSelectors,
  };
}
