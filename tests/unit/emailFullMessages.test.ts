// The full email on both sides of a conversation: what was sent to a person,
// exactly as they got it, and what they wrote back.
import { describe, expect, it } from 'vitest';
import { matchReplyEnvelopes, pickTextPart, replyText, REPLY_TEXT_MAX, type InboxEnvelope, type MessagePart } from '@/lib/email/inbox';
import { buildReplies } from '@/lib/email/replies';
import { renderSentEmail } from '@/lib/email/sentEmail';

describe('the email that was sent, as the person got it', () => {
  const sent = { kind: 'bulk' as const, subject: 'A quick idea, {{first_name}}', bodyHtml: '<p>Hi {{first_name}},</p><p>We help with {{pain_point}}.</p>', mergeData: { first_name: 'Elena', pain_point: 'missed calls' }, signatureHtml: '<p>Sam, Northwind Studio</p>' };

  it('fills in the person\'s own fields and ends with the mailbox\'s signature', () => {
    const out = renderSentEmail(sent);
    expect(out.subject).toBe('A quick idea, Elena');
    expect(out.html).toContain('<p>Hi Elena,</p><p>We help with missed calls.</p>');
    expect(out.html).toContain('Sam, Northwind Studio');
    expect(out.html).not.toContain('{{');
  });

  it('puts the signature where the email says, and says that an unsubscribe link came with it', () => {
    const out = renderSentEmail({ ...sent, bodyHtml: '<p>Hi</p>{{signature}}<p>PS: one more thing.</p>' });
    expect(out.html.indexOf('Sam, Northwind Studio')).toBeLessThan(out.html.indexOf('PS: one more thing.'));
    expect(out.footnote).toBe('The email also had an unsubscribe link at the end.');
    expect(renderSentEmail({ ...sent, kind: 'single' }).footnote).toBeNull();
  });

  it('never lets a person\'s own name become part of the page', () => {
    const out = renderSentEmail({ ...sent, mergeData: { first_name: '<img src=x onerror=alert(1)>', pain_point: 'x' } });
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;img');
    expect(out.subject).toContain('&lt;img');
  });

  it('writes nothing where a field is empty for this person', () => {
    expect(renderSentEmail({ ...sent, mergeData: { first_name: 'Elena' } }).html).toContain('We help with .');
  });
});

describe('which part of a reply is its text', () => {
  const plain: MessagePart = { type: 'text/plain', part: '1' };
  const html: MessagePart = { type: 'text/html', part: '2' };

  it('is the plain text, also inside the usual nesting, and never an attachment', () => {
    expect(pickTextPart(plain)).toEqual({ part: '1', html: false });
    expect(pickTextPart({ type: 'multipart/alternative', childNodes: [plain, html] })).toEqual({ part: '1', html: false });
    const withFile: MessagePart = { type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', part: '1', childNodes: [{ type: 'text/plain', part: '1.1' }, { type: 'text/html', part: '1.2' }] }, { type: 'text/plain', part: '2', disposition: 'attachment' }] };
    expect(pickTextPart(withFile)).toEqual({ part: '1.1', html: false });
  });

  it('is the HTML when there is no plain text, and nothing when there is neither', () => {
    expect(pickTextPart({ type: 'multipart/alternative', childNodes: [html] })).toEqual({ part: '2', html: true });
    expect(pickTextPart({ type: 'TEXT/HTML' })).toEqual({ part: '1', html: true });
    expect(pickTextPart({ type: 'multipart/mixed', childNodes: [{ type: 'application/pdf', part: '1' }, { type: 'text/plain', part: '2', disposition: 'ATTACHMENT' }] })).toBeNull();
    expect(pickTextPart(null)).toBeNull();
  });
});

describe('the words of a reply, as they are kept', () => {
  it('keeps plain text as it is, without the characters a database refuses', () => {
    expect(replyText('  Hi Sam,\r\n\r\nYes please.\u0000\r\n\r\n> On Monday you wrote:\r\n> Hello  ', false)).toBe('Hi Sam,\n\nYes please.\n\n> On Monday you wrote:\n> Hello');
  });

  it('turns an HTML reply into its words, and never keeps a script or a style', () => {
    const text = replyText('<html><head><style>p{color:red}</style></head><body><p>Hi Sam,</p><div>Yes &amp; thanks.<br>Elena</div><script>alert(1)</script></body></html>', true);
    expect(text).toBe('Hi Sam,\nYes & thanks.\nElena');
  });

  it('cuts a very long reply and says so', () => {
    const text = replyText('x'.repeat(REPLY_TEXT_MAX + 500), false);
    expect(text.length).toBeLessThanOrEqual(REPLY_TEXT_MAX + 60);
    expect(text.endsWith('[The rest of this email was not kept.]')).toBe(true);
  });
});

describe('the envelope of each person\'s reply', () => {
  const at = (time: string) => new Date(`2026-11-27T${time}:00Z`);
  const env = (from: string, time: string, uid?: number): InboxEnvelope => ({ from, subject: `Re: hello from ${from}`, at: at(time), headers: {}, uid });

  it('is the earliest one from each address we wrote to, with where to find it in the mailbox', () => {
    const found = matchReplyEnvelopes([env('Elena@Harbour.test', '10:30', 12), env('elena@harbour.test', '09:10', 7), env('stranger@elsewhere.test', '09:00', 3), env('priya@fieldway.test', '11:00', 20)], ['elena@harbour.test', 'PRIYA@fieldway.test']);
    expect(found.map((e) => [e.address, e.envelope.uid])).toEqual([['elena@harbour.test', 7], ['priya@fieldway.test', 20]]);
  });

  it('is nothing for mail from people we never wrote to', () => {
    expect(matchReplyEnvelopes([env('stranger@elsewhere.test', '09:00', 3)], ['elena@harbour.test'])).toEqual([]);
  });
});

describe('a reply in the list', () => {
  it('knows which sent email it answers, so both can be shown together', () => {
    const rows = buildReplies(
      [{ id: 'ev-1', kind: 'reply', address: 'elena@harbour.test', accountId: 'mbx-1', messageId: 'msg-1', createdAt: new Date('2026-11-27T10:00:00Z') }],
      [{ id: 'msg-1', campaignId: 'c-1', contactId: null, toName: 'Elena Rossi' }],
      [{ id: 'c-1', name: 'November offer', subject: 'A quick idea', kind: 'bulk', workspaceId: 'ws-1' }],
      [{ id: 'mbx-1', label: 'Sales', fromEmail: 'sam@northwind.test' }],
      'ws-1',
    );
    expect(rows[0]).toMatchObject({ id: 'ev-1', messageId: 'msg-1', who: 'Elena Rossi' });
  });
});
