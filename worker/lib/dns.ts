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
 *
 * Only answers are cached. A negative produced by a broken resolver would
 * otherwise outlive the outage, because nothing clears this map short of a
 * restart.
 */
const acceptsCache = new Map<string, boolean>();

/**
 * The two resolver codes that are an ANSWER rather than a failure: the name
 * does not exist (`ENOTFOUND`, NXDOMAIN), or it exists with no record of the
 * type asked for (`ENODATA`). Everything else — `ETIMEOUT`, `ESERVFAIL`,
 * `EREFUSED`, a socket error, a resolver that is simply down — says nothing
 * at all about the domain, and must not be read as "it cannot receive mail".
 */
const NO_SUCH_RECORD = new Set(['ENOTFOUND', 'ENODATA']);

function isNoSuchRecord(err: unknown): boolean {
  return NO_SUCH_RECORD.has(String((err as { code?: string } | null)?.code ?? ''));
}

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
 *
 * THROWS when the resolver itself failed. `false` means "this domain answered,
 * and it publishes neither MX nor A" — which the engine turns into a hard
 * bounce and a permanent `email_suppressions` row for the whole organisation.
 * Swallowing a timeout into `false` would suppress every recipient domain in
 * the batch on one DNS blip, enforce it against every future campaign, and
 * need the suppression rows deleted by hand to undo. The engine already
 * catches a throw from here and sends the message anyway; that is the safe
 * direction, and it is only reachable if this function actually throws.
 */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  if (!key || !key.includes('.')) return false;

  const cached = acceptsCache.get(key);
  if (cached !== undefined) return cached;

  let ok: boolean;
  try {
    ok = (await dns.resolveMx(key)).length > 0;
  } catch (mxError) {
    if (!isNoSuchRecord(mxError)) throw mxError;
    // No MX. A domain with an A record still accepts mail (RFC 5321 §5.1).
    try {
      ok = (await dns.resolve4(key)).length > 0;
    } catch (aError) {
      if (!isNoSuchRecord(aError)) throw aError;
      ok = false;
    }
  }

  // Reached only on an answer: every other path above has thrown.
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
