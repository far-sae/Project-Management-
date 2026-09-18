// Copy of the browser-side pure module under lib/email/domainAuth.ts — see
// tests/unit/emailApiParity.test.ts for why api/ may not import across its
// own boundary. Pure: no lookups, so this runs unmodified under CommonJS.
// worker/lib/dns.ts and api/_lib/dns.ts do the actual DNS lookups and hand
// the results in as RawDnsRecords.
//
// If you change a helper in one place, change it in the other — the parity
// test loads both copies and fails if they disagree.

export interface AuthCheck {
  ok: boolean;
  value: string | null;
  detail: string;
}

export interface DomainAuthReport {
  domain: string;
  spf: AuthCheck;
  dkim: AuthCheck;
  dmarc: AuthCheck;
  mx: string[];
}

export interface RawDnsRecords {
  domain: string;
  rootTxt: string[];
  dmarcTxt: string[];
  mx: string[]; // hostnames, lowest priority first
  dkimSelectors: Array<{ selector: string; records: string[] }>;
}

/**
 * Selectors published by the common hosts. DKIM keys live at
 * `<selector>._domainkey.<domain>`, and the selector is chosen by whoever
 * signs the mail, so there is no way to find one except to try the known
 * names.
 */
export const DKIM_SELECTORS: string[] = [
  // Zoho
  'zmail',
  'zoho',
  'zohomail',
  // IONOS / 1&1
  's1',
  's2',
  's3',
  'ionos1',
  'ionos2',
  'ionos',
  // Fastmail
  'fm1',
  'fm2',
  'fm3',
  // Migadu
  'key1',
  'key2',
  // Mailgun / SendGrid / Postmark
  'mailo',
  'smtp',
  'pm',
  // Generic
  'default',
  'dkim',
  'mail',
  'k1',
  'selector1',
  'selector2',
  'google',
];

/** Selectors that sign mail for someone else's platform, not this mailbox. */
const FOREIGN_SELECTORS = new Set(['google', 'selector1', 'selector2', 'k1']);

/**
 * Interprets already-fetched DNS records into a report on SPF, DKIM, DMARC
 * and MX. Pure: no lookups, so callers (and tests) supply `RawDnsRecords`
 * however they like.
 */
export function interpretDomainAuth(raw: RawDnsRecords): DomainAuthReport {
  const domain = raw.domain.trim().toLowerCase().replace(/^@/, '');
  const mx = raw.mx.map((m) => m.toLowerCase());

  const provider = mx.some((h) => h.includes('ionos') || h.includes('1and1'))
    ? 'ionos'
    : mx.some((h) => h.includes('google'))
      ? 'google'
      : 'other';

  /* ------------------------------------------------------------------ SPF -- */
  const spfValue = raw.rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1')) ?? null;
  let spf: AuthCheck;
  if (!spfValue) {
    spf = { ok: false, value: null, detail: 'No SPF record. Receivers cannot verify your sender.' };
  } else if (provider === 'ionos' && !/ionos|1and1/i.test(spfValue)) {
    spf = {
      ok: false,
      value: spfValue,
      detail: 'SPF exists but does not authorise IONOS. Add include:_spf-eu.ionos.com.',
    };
  } else {
    spf = { ok: true, value: spfValue, detail: 'Your sending host is authorised.' };
  }

  /* ----------------------------------------------------------------- DKIM -- */
  const found = raw.dkimSelectors.filter((h) => h.records.some((r) => /v=DKIM1/i.test(r)));
  const ownSelectors = found.filter((h) => !FOREIGN_SELECTORS.has(h.selector));

  let dkim: AuthCheck;
  if (found.length === 0) {
    dkim = {
      ok: false,
      value: null,
      detail: 'No DKIM key found. Your mail is unsigned, which Gmail treats as a strong negative.',
    };
  } else if (ownSelectors.length === 0) {
    // The dangerous case: a key exists, so it looks configured, but it
    // belongs to a different platform and does not sign anything sent
    // through SMTP here.
    const names = found.map((f) => f.selector).join(', ');
    dkim = {
      ok: false,
      value: names,
      detail:
        `The only DKIM key here (${names}) belongs to another provider and does not sign ` +
        `mail sent through your ${provider === 'ionos' ? 'IONOS' : 'SMTP'} mailbox. ` +
        `Enable DKIM for this domain with your mail host.`,
    };
  } else {
    dkim = {
      ok: true,
      value: ownSelectors.map((s) => s.selector).join(', '),
      detail: 'A DKIM key is published for this domain.',
    };
  }

  /* ---------------------------------------------------------------- DMARC -- */
  const dmarcValue = raw.dmarcTxt.find((r) => /v=DMARC1/i.test(r)) ?? null;
  const dmarc: AuthCheck = dmarcValue
    ? { ok: true, value: dmarcValue, detail: 'DMARC policy published.' }
    : {
        ok: false,
        value: null,
        detail: 'No DMARC record. Gmail has required one from bulk senders since February 2024.',
      };

  return { domain, spf, dkim, dmarc, mx };
}
