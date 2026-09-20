import { describe, expect, it } from 'vitest';

import {
  applySignature,
  buildSignatureHtml,
  EMPTY_SIGNATURE_FIELDS,
  SIGNATURE_PLACEHOLDER,
} from '@/lib/email/signature';
import { substitutePlaceholders } from '@/lib/email/substitute';

describe('applySignature', () => {
  it('appends when the body does not say where', () => {
    const out = applySignature('<p>Hello</p>', '<div>Ada</div>');
    expect(out).toBe('<p>Hello</p><br><br><div>Ada</div>');
  });

  it('puts it where the body says, so anything can follow it', () => {
    // A postscript, a legal footer, a line that reads oddly above a name.
    const out = applySignature(
      `<p>Hello</p>${SIGNATURE_PLACEHOLDER}<p>P.S. one more thing</p>`,
      '<div>Ada</div>',
    );
    expect(out).toBe('<p>Hello</p><div>Ada</div><p>P.S. one more thing</p>');
  });

  it('removes the placeholder when the mailbox has no signature', () => {
    // The case somebody hits by configuring the pool later than they wrote
    // the campaign: a body naming {{signature}} must not arrive with the
    // braces showing.
    expect(applySignature(`<p>Hi</p>${SIGNATURE_PLACEHOLDER}`, '')).toBe('<p>Hi</p>');
    expect(applySignature(`<p>Hi</p>${SIGNATURE_PLACEHOLDER}`, '   ')).toBe('<p>Hi</p>');
  });

  it('changes nothing when there is no signature and no placeholder', () => {
    expect(applySignature('<p>Hi</p>', '')).toBe('<p>Hi</p>');
  });

  it('tolerates the spacing and casing a person might type', () => {
    expect(applySignature('<p>Hi</p>{{ Signature }}', '<div>Ada</div>')).toBe(
      '<p>Hi</p><div>Ada</div>',
    );
  });

  it('replaces every occurrence, not just the first', () => {
    // A module-level /g regex keeps `lastIndex` between calls; this is the
    // test that catches it if the reset is ever removed.
    const out = applySignature(`${SIGNATURE_PLACEHOLDER}x${SIGNATURE_PLACEHOLDER}`, '<i>s</i>');
    expect(out).toBe('<i>s</i>x<i>s</i>');
  });

  it('is stable across repeated calls', () => {
    // Same regex object, two calls: the second must behave like the first.
    const body = `<p>Hi</p>${SIGNATURE_PLACEHOLDER}`;
    expect(applySignature(body, '<i>s</i>')).toBe(applySignature(body, '<i>s</i>'));
  });

  it('leaves merge fields in the signature for substitution to resolve', () => {
    // Applied BEFORE substitution, so a signature may greet by name and a
    // placeholder never survives into a sent message.
    const withSignature = applySignature('<p>Hi {{first_name}}</p>', '<div>— {{first_name}}</div>');
    const sent = substitutePlaceholders(withSignature, { first_name: 'Ada' });
    expect(sent).toContain('Hi Ada');
    expect(sent).toContain('— Ada');
    expect(sent).not.toContain('{{');
  });
});

describe('buildSignatureHtml', () => {
  it('builds nothing from nothing', () => {
    // Rather than an empty shell with a stray separator in it.
    expect(buildSignatureHtml(EMPTY_SIGNATURE_FIELDS)).toBe('');
  });

  it('includes what was given and omits what was not', () => {
    const html = buildSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      name: 'Ada Lovelace',
      company: 'Acme',
    });
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Acme');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('<img');
  });

  it('does not leave a dangling separator when only one of role/company is set', () => {
    const html = buildSignatureHtml({ ...EMPTY_SIGNATURE_FIELDS, company: 'Acme' });
    expect(html).toContain('Acme');
    expect(html).not.toContain(', Acme');
    expect(html).not.toContain('Acme,');
  });

  it('makes a bare domain into a real link', () => {
    const html = buildSignatureHtml({ ...EMPTY_SIGNATURE_FIELDS, website: 'acme.com' });
    expect(html).toContain('href="https://acme.com"');
    // ...while showing what was typed, not the scheme nobody wanted to see.
    expect(html).toContain('>acme.com<');
  });

  it('leaves an absolute URL alone', () => {
    const html = buildSignatureHtml({ ...EMPTY_SIGNATURE_FIELDS, website: 'http://acme.com' });
    expect(html).toContain('href="http://acme.com"');
    expect(html).not.toContain('https://http://');
  });

  it('refuses a logo that is not http(s)', () => {
    // A mail client will not load a data: or javascript: source anyway, so one
    // here is either a mistake or an attempt; no image beats a broken one.
    const html = buildSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      name: 'Ada',
      logoUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('Ada');
  });

  it('caps a logo’s height so an enormous upload cannot break the message', () => {
    const html = buildSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      logoUrl: 'https://cdn.acme.com/logo.png',
    });
    expect(html).toContain('height:40px');
    expect(html).toContain('width:auto');
  });

  it('escapes every field, because these reach a stranger’s mail client', () => {
    const html = buildSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      name: 'Ada "Al" <Lovelace>',
      company: "O'Reilly & Co",
      logoUrl: 'https://x/logo.png" onerror="alert(1)',
    });
    expect(html).not.toContain('<Lovelace>');
    expect(html).toContain('&lt;Lovelace&gt;');
    expect(html).toContain('&amp;');
    // The text `onerror=` survives harmlessly INSIDE an escaped value, so
    // asserting on its absence would assert the wrong thing. What must hold is
    // that no raw quote escapes an attribute: every `"` in the output is one
    // this builder wrote as a delimiter, and they come in pairs.
    expect(html.split('"').length % 2).toBe(1);
    expect(html).toContain('&quot;');
  });

  it('strips punctuation out of a tel: link but not out of the visible number', () => {
    const html = buildSignatureHtml({ ...EMPTY_SIGNATURE_FIELDS, phone: '+44 (0)20 7946 0000' });
    expect(html).toContain('href="tel:+44020794 60000"'.replace(' ', ''));
    expect(html).toContain('+44 (0)20 7946 0000');
  });
});
