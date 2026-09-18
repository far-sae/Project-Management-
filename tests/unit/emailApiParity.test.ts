// Why api/_lib duplicates the pure email helpers.
//
// api/ must not import across its own boundary. The repo root's package.json
// declares `"type": "module"`, but a Vercel Node function has to be CommonJS,
// and Node decides a .js file's module format from the NEAREST package.json.
// A route compiled to CommonJS that reached into the browser-side lib would
// therefore require() a file Node insists on treating as ESM: ERR_REQUIRE_ESM
// on Node 20, or a silently empty module namespace on Node 22.12+. So api/_lib
// keeps its own copy of these modules, under api/package.json's
// `"type": "commonjs"`, and the routes import only from there.
//
// A copy that drifts is worse than no copy. Every test below loads BOTH copies
// and asserts they agree, so editing one without the other fails this suite.
// If you change a helper in one place, change it in the other.

import { describe, it, expect } from 'vitest';

import { encryptSecret as srcEncrypt, decryptSecret as srcDecrypt } from '@/lib/email/crypto';
import { encryptSecret as apiEncrypt, decryptSecret as apiDecrypt } from '../../api/_lib/crypto';

import {
  substitutePlaceholders as srcSubstitute,
  escapeHtml as srcEscapeHtml,
} from '@/lib/email/substitute';
import {
  substitutePlaceholders as apiSubstitute,
  escapeHtml as apiEscapeHtml,
} from '../../api/_lib/substitute';

import {
  signUnsubscribeToken as srcSign,
  verifyUnsubscribeToken as srcVerify,
  unsubscribeUrl as srcUnsubscribeUrl,
  ensureUnsubscribeLink as srcEnsureLink,
} from '@/lib/email/unsubscribe';
import {
  signUnsubscribeToken as apiSign,
  verifyUnsubscribeToken as apiVerify,
  unsubscribeUrl as apiUnsubscribeUrl,
  ensureUnsubscribeLink as apiEnsureLink,
} from '../../api/_lib/unsubscribe';

import { buildMessage as srcBuildMessage } from '@/lib/email/message';
import { buildMessage as apiBuildMessage } from '../../api/_lib/message';

import {
  interpretDomainAuth as srcInterpretDomainAuth,
  DKIM_SELECTORS as srcDkimSelectors,
  type RawDnsRecords,
} from '@/lib/email/domainAuth';
import {
  interpretDomainAuth as apiInterpretDomainAuth,
  DKIM_SELECTORS as apiDkimSelectors,
} from '../../api/_lib/domainAuth';

const KEY = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc';
const SECRET = 'unsub-secret';
const MESSAGE_ID = '3f7c1c64-9a6e-4d2a-bb0a-0b6f1f0c2d11';
const SITE = 'https://app.example.com';

describe('crypto parity', () => {
  it('decrypts with the api copy what the src copy encrypted', async () => {
    const packed = await srcEncrypt('hunter2', KEY);
    expect(await apiDecrypt(packed, KEY)).toBe('hunter2');
  });

  it('decrypts with the src copy what the api copy encrypted', async () => {
    const packed = await apiEncrypt('hunter2', KEY);
    expect(await srcDecrypt(packed, KEY)).toBe('hunter2');
  });

  it('agrees that a short key is invalid', async () => {
    await expect(srcEncrypt('x', 'dG9vLXNob3J0')).rejects.toThrow();
    await expect(apiEncrypt('x', 'dG9vLXNob3J0')).rejects.toThrow();
  });
});

describe('substitutePlaceholders parity', () => {
  // One template covering all three cases the copies must agree on: a known
  // key, an unknown key, and a value that would inject markup if unescaped.
  const TEMPLATE = 'Hi {{first_name}} of {{unknown_key}} — {{bio}}';
  const CTX = { first_name: 'Ada', bio: '<script>alert("x")</script>' };

  it('returns identical output from both copies', () => {
    expect(apiSubstitute(TEMPLATE, CTX)).toBe(srcSubstitute(TEMPLATE, CTX));
  });

  it('still escapes and still blanks the unknown key in both copies', () => {
    // Guards against the two copies regressing together, which parity alone
    // would not catch.
    for (const out of [srcSubstitute(TEMPLATE, CTX), apiSubstitute(TEMPLATE, CTX)]) {
      expect(out).toBe('Hi Ada of  — &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
      expect(out).not.toContain('<script>');
    }
  });

  it('escapes the same five characters in both copies', () => {
    expect(apiEscapeHtml(`<>&"'`)).toBe(srcEscapeHtml(`<>&"'`));
  });
});

describe('unsubscribe token parity', () => {
  it('produces an identical token for the same message id and secret', async () => {
    expect(await apiSign(MESSAGE_ID, SECRET)).toBe(await srcSign(MESSAGE_ID, SECRET));
  });

  it('verifies the other copy token in both directions', async () => {
    expect(await srcVerify(MESSAGE_ID, await apiSign(MESSAGE_ID, SECRET), SECRET)).toBe(true);
    expect(await apiVerify(MESSAGE_ID, await srcSign(MESSAGE_ID, SECRET), SECRET)).toBe(true);
  });

  it('rejects a token for another message id in both copies', async () => {
    const token = await srcSign(MESSAGE_ID, SECRET);
    expect(await srcVerify('some-other-id', token, SECRET)).toBe(false);
    expect(await apiVerify('some-other-id', token, SECRET)).toBe(false);
  });

  it('builds an identical unsubscribe url and link', async () => {
    const token = await srcSign(MESSAGE_ID, SECRET);
    const url = srcUnsubscribeUrl(SITE, MESSAGE_ID, token);
    expect(apiUnsubscribeUrl(SITE, MESSAGE_ID, token)).toBe(url);
    expect(apiEnsureLink('<p>Hi</p>', url)).toBe(srcEnsureLink('<p>Hi</p>', url));
  });
});

describe('buildMessage parity', () => {
  const BASE = {
    subject: 'Hello {{first_name}}',
    bodyHtml: '<p>Hi {{first_name}}, welcome.</p>',
    mergeData: { first_name: 'Ada' },
  };

  it('agrees on a bulk message carrying an unsubscribe url', () => {
    const input = {
      ...BASE,
      kind: 'bulk' as const,
      unsubscribeUrl: `${SITE}/api/email/unsubscribe?m=${MESSAGE_ID}&t=abc`,
    };
    const built = apiBuildMessage(input);
    expect(built).toEqual(srcBuildMessage(input));
    // And the one-click headers really are there, in both copies.
    expect(built.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(srcBuildMessage(input).headers['List-Unsubscribe']).toBe(
      `<${input.unsubscribeUrl}>`,
    );
  });

  it('agrees on a single message with no unsubscribe url', () => {
    const input = { ...BASE, kind: 'single' as const };
    const built = apiBuildMessage(input);
    expect(built).toEqual(srcBuildMessage(input));
    // Transactional mail must not carry the bulk headers, in either copy.
    expect(Object.keys(built.headers)).toEqual([]);
    expect(Object.keys(srcBuildMessage(input).headers)).toEqual([]);
  });
});

describe('interpretDomainAuth parity', () => {
  // The two copies must agree on the selector list too — a divergence there
  // would silently probe different DNS names per copy while the pure
  // interpretation logic below stayed byte-identical.
  it('publishes the same DKIM selector list from both copies', () => {
    expect(apiDkimSelectors).toEqual(srcDkimSelectors);
  });

  const FULLY_CONFIGURED: RawDnsRecords = {
    domain: 'Example.com',
    rootTxt: ['v=spf1 include:_spf.google.com ~all'],
    dmarcTxt: ['v=DMARC1; p=reject; rua=mailto:dmarc@example.com'],
    mx: ['ASPMX.L.GOOGLE.COM'],
    dkimSelectors: [{ selector: 'default', records: ['v=DKIM1; k=rsa; p=ABC123'] }],
  };

  it('returns a deeply equal report for a fully-configured domain', () => {
    const apiReport = apiInterpretDomainAuth(FULLY_CONFIGURED);
    const srcReport = srcInterpretDomainAuth(FULLY_CONFIGURED);
    expect(apiReport).toEqual(srcReport);
    // And the two copies still agree that this domain passes every check —
    // a shared bug that flipped both to `ok: false` would pass a bare
    // toEqual, so this pins the expected shape independently.
    expect(apiReport).toEqual({
      domain: 'example.com',
      spf: { ok: true, value: 'v=spf1 include:_spf.google.com ~all', detail: expect.any(String) },
      dkim: { ok: true, value: 'default', detail: expect.any(String) },
      dmarc: { ok: true, value: FULLY_CONFIGURED.dmarcTxt[0], detail: expect.any(String) },
      mx: ['aspmx.l.google.com'],
    });
  });

  it('agrees on the missing-SPF branch', () => {
    const raw: RawDnsRecords = { ...FULLY_CONFIGURED, rootTxt: [] };
    const apiReport = apiInterpretDomainAuth(raw);
    const srcReport = srcInterpretDomainAuth(raw);
    expect(apiReport).toEqual(srcReport);
    expect(apiReport.spf).toEqual({ ok: false, value: null, detail: expect.any(String) });
  });

  it('agrees on the foreign-DKIM branch', () => {
    // "google" is a foreign selector: a key is published, but it signs mail
    // for Google Workspace, not for this SMTP mailbox.
    const raw: RawDnsRecords = {
      ...FULLY_CONFIGURED,
      dkimSelectors: [{ selector: 'google', records: ['v=DKIM1; k=rsa; p=XYZ789'] }],
    };
    const apiReport = apiInterpretDomainAuth(raw);
    const srcReport = srcInterpretDomainAuth(raw);
    expect(apiReport).toEqual(srcReport);
    expect(apiReport.dkim).toEqual({ ok: false, value: 'google', detail: expect.any(String) });
  });
});
