// DNS lookups for POST /api/email/domain-auth.
//
// Copy of the lookup half of worker/lib/dns.ts — see
// tests/unit/emailApiParity.test.ts for why api/ may not import across its
// own boundary (worker/ is ESM; api/ is CommonJS). Keep this in step with
// worker/lib/dns.ts's fetchDnsRecords: same records, same purpose, fed to the
// same interpretDomainAuth. There is no live resolver to pin the lookup half
// against in a test, so the discipline is manual — if you change one, change
// the other.

import { promises as dns } from 'node:dns';

import { DKIM_SELECTORS, type RawDnsRecords } from './domainAuth';

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
