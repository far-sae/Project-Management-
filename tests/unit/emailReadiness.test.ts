import { describe, expect, it } from 'vitest';

import { inboxConnected, readiness, sendingConnected } from '@/lib/email/readiness';
import type { EmailAccount, MailboxHealth } from '@/lib/email/types';

function account(over: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    workspaceId: null,
    userId: null,
    signatureHtml: '<div>Ada</div>',
    label: 'Sales',
    fromName: 'Ada',
    fromEmail: 'ada@acme.com',
    replyTo: null,
    smtpHost: 'smtp.acme.com',
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: 'ada@acme.com',
    dailyLimit: 40,
    hourlyLimit: 60,
    status: 'active',
    lastError: null,
    lastVerifiedAt: null,
    createdAt: new Date(),
    imapHost: 'imap.acme.com',
    imapPort: 993,
    imapSecure: true,
    imapStatus: 'active',
    imapLastError: null,
    inboxLastScanAt: null,
    sentFolderEnabled: true,
    ...over,
  } as EmailAccount;
}

function health(over: Partial<MailboxHealth> = {}): MailboxHealth {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    label: 'Sales',
    fromEmail: 'ada@acme.com',
    status: 'active',
    isActive: true,
    pausedReason: null,
    consecutiveFailures: 0,
    lastSentAt: null,
    dailyLimit: 40,
    warmupEnabled: false,
    warmupStartedOn: null,
    warmupStartVolume: 5,
    warmupIncrement: 3,
    effectiveLimit: 40,
    sentToday: 0,
    ...over,
  } as MailboxHealth;
}

describe('sendingConnected and inboxConnected are different questions', () => {
  it('treats a verified mailbox with no IMAP host as send-only', () => {
    // Google and Zoho both issue app passwords with IMAP left off, so this is
    // the ordinary case rather than an edge one.
    const a = account({ imapHost: '', imapStatus: 'unconfigured' });
    expect(sendingConnected(a)).toBe(true);
    expect(inboxConnected(a)).toBe(false);
  });

  it('counts "incomplete" as connected, because the mailbox WAS read', () => {
    // 'incomplete' means the read worked and the recording did not. Nothing is
    // wrong with the connection, and telling somebody to go and fix their
    // password would send them after the wrong thing.
    expect(inboxConnected(account({ imapStatus: 'incomplete' }))).toBe(true);
  });

  it('does not count an unverified mailbox as able to send', () => {
    expect(sendingConnected(account({ status: 'unverified' }))).toBe(false);
  });

  it('does not count a host that was typed but never worked', () => {
    expect(inboxConnected(account({ imapStatus: 'error' }))).toBe(false);
  });
});

describe('readiness', () => {
  it('says nothing is ready with no mailbox at all', () => {
    const r = readiness([], []);
    expect(r.canSend).toBe(false);
    expect(r.canDetectReplies).toBe(false);
    expect(r.steps[0].state).toBe('todo');
  });

  it('is not sendable on a saved mailbox that was never verified', () => {
    // A host typed into a form is not a working login, and a checklist that
    // counts the first as done is a checklist that lies.
    const r = readiness([account({ status: 'unverified' })], [health({ status: 'unverified' })]);
    expect(r.canSend).toBe(false);
    expect(r.steps.find((s) => s.id === 'verified')?.state).toBe('todo');
  });

  it('is not sendable when every mailbox is paused out of rotation', () => {
    // Verified and still sends nothing: a mailbox paused at its third strike.
    const r = readiness([account()], [health({ isActive: false })]);
    expect(r.canSend).toBe(false);
  });

  it('is sendable, but warns, when nothing can be read', () => {
    const r = readiness(
      [account({ imapHost: '', imapStatus: 'unconfigured' })],
      [health()],
    );
    expect(r.canSend).toBe(true);
    expect(r.canDetectReplies).toBe(false);
    // A warning rather than a todo: skipping this is allowed, doing it
    // silently is not.
    expect(r.steps.find((s) => s.id === 'inbox')?.state).toBe('warning');
    expect(r.sendOnlyMailboxes).toEqual(['ada@acme.com']);
  });

  it('names the mailboxes that would send unsigned', () => {
    const r = readiness(
      [account({ signatureHtml: '' }), account({ id: 'b', fromEmail: 'b@acme.com' })],
      [health(), health({ id: 'b', fromEmail: 'b@acme.com' })],
    );
    expect(r.unsignedMailboxes).toEqual(['ada@acme.com']);
    expect(r.steps.find((s) => s.id === 'signature')?.state).toBe('warning');
  });

  it('is fully ready when everything is connected', () => {
    const r = readiness([account()], [health()]);
    expect(r.canSend).toBe(true);
    expect(r.canDetectReplies).toBe(true);
    expect(r.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('counts whitespace as no signature', () => {
    const r = readiness([account({ signatureHtml: '   ' })], [health()]);
    expect(r.unsignedMailboxes).toEqual(['ada@acme.com']);
  });
});
