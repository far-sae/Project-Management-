import { describe, expect, it } from 'vitest';

import { followUpSubject, threadHeaders } from '@/lib/email/sequence';
import { isAutoReply } from '@/lib/email/inbox';

describe('threadHeaders', () => {
  it('returns nothing for the first step, which starts the thread', () => {
    expect(threadHeaders([], 'acme.com')).toEqual({});
  });

  it('points a follow-up at the message before it', () => {
    const headers = threadHeaders(['aaa-111'], 'acme.com');
    expect(headers['In-Reply-To']).toBe('<aaa-111@acme.com>');
    expect(headers['References']).toBe('<aaa-111@acme.com>');
  });

  it('accumulates the whole chain in References, oldest first', () => {
    const headers = threadHeaders(['one', 'two', 'three'], 'acme.com');
    expect(headers['In-Reply-To']).toBe('<three@acme.com>');
    expect(headers['References']).toBe('<one@acme.com> <two@acme.com> <three@acme.com>');
  });

  it('returns nothing when the sender domain is unknown', () => {
    // A malformed In-Reply-To breaks threading more thoroughly than its
    // absence does.
    expect(threadHeaders(['one'], '')).toEqual({});
  });
});

describe('followUpSubject', () => {
  it('uses the step own subject when it has one', () => {
    expect(followUpSubject('A different angle', 'Quick question')).toBe('A different angle');
  });

  it('inherits the first subject, prefixed, when the step leaves it blank', () => {
    expect(followUpSubject('   ', 'Quick question')).toBe('Re: Quick question');
  });

  it('does not prefix a subject that is already a reply', () => {
    expect(followUpSubject('', 'Re: Quick question')).toBe('Re: Quick question');
    expect(followUpSubject('', 're: quick question')).toBe('re: quick question');
  });
});

describe('isAutoReply', () => {
  it('recognises each header that declares one', () => {
    expect(isAutoReply({ 'auto-submitted': 'auto-replied' })).toBe(true);
    expect(isAutoReply({ 'x-autoreply': 'yes' })).toBe(true);
    expect(isAutoReply({ 'x-autorespond': 'anything' })).toBe(true);
    expect(isAutoReply({ precedence: 'auto_reply' })).toBe(true);
  });

  it('reads header names case-insensitively, as a mail server writes them', () => {
    expect(isAutoReply({ 'Auto-Submitted': 'auto-generated' })).toBe(true);
  });

  it('treats Auto-Submitted: no as ordinary mail, which is what it means', () => {
    // RFC 3834: an ORDINARY message may carry `Auto-Submitted: no`, and some
    // clients put it on everything. Matching on the header's presence would
    // classify real replies as auto-replies, and a real reply that fails to
    // stop a sequence is the exact failure this phase exists to prevent.
    expect(isAutoReply({ 'auto-submitted': 'no' })).toBe(false);
  });

  it('does not guess from wording', () => {
    // "Out of office until Monday" is a sentence a person can type. Phase 2's
    // own subject-matching mistake -- suppressing a human who replied to a
    // forwarded bounce -- is this same mistake in a different place.
    expect(isAutoReply({ subject: 'Out of office until Monday' })).toBe(false);
    expect(isAutoReply({})).toBe(false);
  });
});
