import { describe, expect, it } from 'vitest';

import {
  placeholdersIntact,
  placeholdersUsed,
  plainTextToHtml,
  sanitizePastedHtml,
} from '@/lib/email/richText';
import { templateStats, replyRate, EMPTY_TEMPLATE_STATS } from '@/lib/email/templateStats';
import type { EmailCampaign } from '@/lib/email/types';

describe('placeholdersIntact', () => {
  it('accepts a whole placeholder', () => {
    expect(placeholdersIntact('<p>Hi {{first_name}}</p>')).toBe(true);
  });

  it('rejects one the browser split across a tag', () => {
    // The failure this exists to catch, and it is silent: substitution matches
    // literal text, so a split placeholder is never substituted and the
    // recipient is greeted as "{{first_name}}".
    expect(placeholdersIntact('<p>Hi {{first<b>_name}}</b></p>')).toBe(false);
  });

  it('is not confused by ordinary markup between two placeholders', () => {
    expect(placeholdersIntact('<p>{{first_name}}</p><p><b>{{company}}</b></p>')).toBe(true);
  });

  it('accepts a body with no placeholders at all', () => {
    expect(placeholdersIntact('<p>Hello there</p>')).toBe(true);
  });
});

describe('placeholdersUsed', () => {
  it('lists each name once, lower-cased', () => {
    expect(
      placeholdersUsed('{{First_Name}} {{company}} {{first_name}}').sort(),
    ).toEqual(['company', 'first_name']);
  });

  it('tolerates spacing inside the braces', () => {
    expect(placeholdersUsed('{{ pain_point }}')).toEqual(['pain_point']);
  });

  it('returns nothing for a body with none', () => {
    expect(placeholdersUsed('<p>Hello</p>')).toEqual([]);
  });
});

describe('sanitizePastedHtml', () => {
  it('keeps the structure a person meant to paste', () => {
    const out = sanitizePastedHtml('<p>Hi <b>there</b></p><ul><li>one</li></ul>');
    expect(out).toContain('<b>there</b>');
    expect(out).toContain('<li>one</li>');
  });

  it('strips what Word brings with it', () => {
    const word =
      '<!--[if gte mso 9]><xml>junk</xml><![endif]-->' +
      '<style>p.MsoNormal { mso-style-parent: ""; }</style>' +
      '<p class="MsoNormal" style="mso-margin-top-alt:auto"><o:p>Hello</o:p></p>';
    const out = sanitizePastedHtml(word);

    expect(out).not.toMatch(/mso-/i);
    expect(out).not.toContain('MsoNormal');
    // A <style> block has its CONTENTS dropped, not unwrapped — unwrapping
    // would paste the CSS in as visible text.
    expect(out).not.toContain('style-parent');
    expect(out).toContain('Hello');
  });

  it('keeps a real link and drops a dangerous one', () => {
    expect(sanitizePastedHtml('<a href="https://example.com">x</a>')).toContain(
      '<a href="https://example.com">',
    );
    const bad = sanitizePastedHtml('<a href="javascript:alert(1)">x</a>');
    expect(bad).not.toContain('javascript');
    expect(bad).toContain('x');
  });

  it('escapes the href it emits, so a pasted link cannot inject an attribute', () => {
    // Ordinary-looking markup on a web page: the href is single-quoted, so it
    // may contain a double quote. Written into a double-quoted attribute raw,
    // it closed the attribute and hung an event handler on the anchor — which
    // then ran in the session of the next colleague to open that template.
    const out = sanitizePastedHtml(
      `<a href='https://x/?a=" onmouseover="alert(1)'>click</a>`,
    );
    // The text `onmouseover=` survives harmlessly INSIDE the escaped URL, so
    // asserting on its absence would be asserting the wrong thing. What must
    // be true is that no raw double quote escapes the attribute: exactly two
    // remain in the output, the pair that delimits href itself.
    expect(out.split('"')).toHaveLength(3);
    expect(out).toContain('&quot;');
    expect(out).toContain('click');
  });

  it('rejects a javascript: URL however it is dressed up', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)']) {
      const out = sanitizePastedHtml(`<a href="${url}">x</a>`);
      expect(out.toLowerCase()).not.toContain('javascript');
    }
  });

  it('rejoins a Word paste that split a merge field across runs', () => {
    // Word emits a separate <span> run at every spell-check and language-tag
    // boundary, so a placeholder routinely arrives in two pieces. An
    // attribute-less span carries no formatting — its only effect is to split
    // text — so unwrapping it repairs the placeholder rather than losing it.
    const word = '<span style="mso-x">Hi {{first_</span><span lang="EN">name}},</span>';
    const out = sanitizePastedHtml(word);
    expect(out).toContain('{{first_name}}');
    expect(placeholdersIntact(out)).toBe(true);
  });

  it('drops a style block that is unclosed or spelled with a space', () => {
    // Both are what a partial selection from a web page produces, and both
    // used to leave the CSS in the message as visible text.
    expect(sanitizePastedHtml('<style>p{color:red}</style >Hi')).toBe('Hi');
    expect(sanitizePastedHtml('<style>p{color:red}')).toBe('');
  });

  it('does not spill an attribute containing a bracket into the body', () => {
    // Copying a table cell from a page with title="Sales > 100" used to put
    // `100">Sales` into the email.
    const out = sanitizePastedHtml('<p title="1 > 2">Hello</p>');
    expect(out).toBe('<p>Hello</p>');
  });

  it('leaves a placeholder alone', () => {
    // The whole point: a paste must not be the thing that breaks a merge
    // field.
    const out = sanitizePastedHtml('<p class="x">Hi {{first_name}}</p>');
    expect(out).toContain('{{first_name}}');
    expect(placeholdersIntact(out)).toBe(true);
  });

  it('unwraps a tag it does not keep rather than deleting its text', () => {
    expect(sanitizePastedHtml('<table><tr><td>kept</td></tr></table>')).toContain('kept');
  });
});

describe('plainTextToHtml', () => {
  it('turns newlines into breaks so paragraphs do not collapse', () => {
    expect(plainTextToHtml('one\ntwo')).toBe('one<br>two');
  });

  it('escapes markup so pasted text stays text', () => {
    expect(plainTextToHtml('<b>not bold</b>')).toBe('&lt;b&gt;not bold&lt;/b&gt;');
  });
});

/* ------------------------------------------------------------ template stats */

function campaign(over: Partial<EmailCampaign> = {}): EmailCampaign {
  return {
    id: 'c1',
    organizationId: 'org-1',
    workspaceId: null,
    createdBy: null,
    accountId: null,
    templateId: 'tpl-1',
    kind: 'bulk',
    name: 'A campaign',
    subject: 'Hi',
    bodyHtml: '<p>Hi</p>',
    status: 'sent',
    scheduledAt: null,
    ratePerHour: 60,
    queuedCount: 0,
    sentCount: 10,
    failedCount: 1,
    suppressedCount: 0,
    repliedCount: 2,
    bouncedCount: 1,
    openedCount: 4,
    openedPrefetchCount: 3,
    createdAt: new Date('2026-09-19T09:00:00Z'),
    updatedAt: new Date('2026-09-19T09:00:00Z'),
    ...over,
  } as EmailCampaign;
}

describe('templateStats', () => {
  it('sums the campaigns of one template', () => {
    const stats = templateStats([campaign(), campaign({ id: 'c2' })]);
    expect(stats['tpl-1']).toEqual({
      campaigns: 2,
      sent: 20,
      failed: 2,
      opened: 8,
      openedAutomatically: 6,
      replied: 4,
      bounced: 2,
    });
  });

  it('keeps the automatic opens out of the opened figure', () => {
    // Phase 4's rule, carried here: Apple Mail pre-fetches every image in
    // every message, so merging them would report a template as read by people
    // who never saw it.
    const stats = templateStats([campaign({ openedCount: 1, openedPrefetchCount: 9 })]);
    expect(stats['tpl-1'].opened).toBe(1);
    expect(stats['tpl-1'].openedAutomatically).toBe(9);
  });

  it('ignores a campaign written from no template', () => {
    // Counting it under a placeholder key would make some template look better
    // than it is.
    const stats = templateStats([campaign({ templateId: null })]);
    expect(stats).toEqual({});
  });

  it('separates two templates', () => {
    const stats = templateStats([campaign(), campaign({ id: 'c2', templateId: 'tpl-2' })]);
    expect(stats['tpl-1'].campaigns).toBe(1);
    expect(stats['tpl-2'].campaigns).toBe(1);
  });
});

describe('replyRate', () => {
  it('is replies over messages sent', () => {
    expect(replyRate({ ...EMPTY_TEMPLATE_STATS, sent: 50, replied: 5 })).toBeCloseTo(0.1);
  });

  it('is null rather than zero when nothing has been sent', () => {
    // A template nobody has used yet showing "0%" reads as one that does not
    // work.
    expect(replyRate(EMPTY_TEMPLATE_STATS)).toBeNull();
  });
});
