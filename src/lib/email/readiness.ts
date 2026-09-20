// Is this organization actually able to send, and to hear back?
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// The screens grew one tab at a time and the order they ended up in is the
// order they were built, not the order somebody does the work: Accounts — the
// thing without which nothing sends at all — sits near the end, and Compose
// will happily take a campaign from an organization that has no mailbox.
//
// Two distinctions run through this file, and both exist because the product
// used to blur them:
//
//   * SENDING and INBOX are separate permissions, at every provider. Google
//     and Zoho both issue app passwords with IMAP left off. A mailbox that
//     sends perfectly may be unable to read a single reply — and a sequence
//     whose whole promise is "we stop when they answer" cannot keep that
//     promise on a mailbox like that.
//   * CONFIGURED and WORKING are not the same. A host typed into a form is
//     not a verified login, and a checklist that counts the first as done is
//     a checklist that lies.

import type { EmailAccount, MailboxHealth } from './types';

export type StepState = 'done' | 'todo' | 'warning';

export interface ReadinessStep {
  id: 'mailbox' | 'verified' | 'inbox' | 'signature';
  title: string;
  state: StepState;
  /** One sentence: what is true now, or what to do about it. */
  detail: string;
}

export interface Readiness {
  steps: ReadinessStep[];
  /** True once mail can actually leave. Nothing else matters until this is. */
  canSend: boolean;
  /**
   * True when at least one mailbox can be READ.
   *
   * Not part of `canSend` on purpose: a campaign sends fine without it. It is
   * what a SEQUENCE needs, because stop-on-reply is not a feature you can
   * half-have — without inbox access the follow-ups keep going to somebody who
   * already answered, which is the single worst thing this product can do.
   */
  canDetectReplies: boolean;
  /** Mailboxes that can send but cannot be read, by address. */
  sendOnlyMailboxes: string[];
  /** Mailboxes that can send but have no signature, by address. */
  unsignedMailboxes: string[];
}

/** Whether this mailbox's credentials have actually been proven. */
export function sendingConnected(account: EmailAccount): boolean {
  return account.status === 'active';
}

/**
 * Whether this mailbox's inbox can be read.
 *
 * 'unconfigured' is the ordinary state of a mailbox nobody has given a host,
 * and it means no — not "unknown". 'incomplete' means the mailbox WAS read and
 * the recording failed, so the connection itself is fine and this is true.
 */
export function inboxConnected(account: EmailAccount): boolean {
  if (!account.imapHost || account.imapHost.trim() === '') return false;
  return account.imapStatus === 'active' || account.imapStatus === 'incomplete';
}

/**
 * Where this organization has got to, as a short list of steps.
 *
 * `health` is the pool view, which knows whether a mailbox is paused or has
 * spent its allowance — things `accounts` alone cannot say.
 */
export function readiness(accounts: EmailAccount[], health: MailboxHealth[]): Readiness {
  const steps: ReadinessStep[] = [];

  const hasMailbox = accounts.length > 0;
  const verified = accounts.filter(sendingConnected);
  const sendable = health.filter((m) => m.isActive && m.status !== 'error');
  const withInbox = verified.filter(inboxConnected);
  const unsigned = verified.filter((a) => a.signatureHtml.trim() === '');

  steps.push({
    id: 'mailbox',
    title: 'Connect a sending mailbox',
    state: hasMailbox ? 'done' : 'todo',
    detail: hasMailbox
      ? `${accounts.length} mailbox${accounts.length === 1 ? '' : 'es'} connected.`
      : 'Nothing can be sent until at least one mailbox is added, under Accounts.',
  });

  steps.push({
    id: 'verified',
    title: 'Verify it can send',
    state: verified.length > 0 ? 'done' : hasMailbox ? 'todo' : 'todo',
    detail:
      verified.length > 0
        ? `${verified.length} verified and ready.`
        : hasMailbox
          ? 'The mailbox is saved but its login has not been proven. Use Send test on it.'
          : 'A saved host is not a working login — this is proven by a test send.',
  });

  // A warning rather than a todo: this is the step people skip, and skipping it
  // is allowed. What is not acceptable is skipping it without being told what
  // it costs.
  steps.push({
    id: 'inbox',
    title: 'Connect the inbox',
    state: withInbox.length > 0 ? 'done' : verified.length > 0 ? 'warning' : 'todo',
    detail:
      withInbox.length > 0
        ? `${withInbox.length} of ${verified.length} can be read for replies and bounces.`
        : 'Without this, replies and bounces are never seen — so sequences cannot stop when somebody answers.',
  });

  steps.push({
    id: 'signature',
    title: 'Add a signature',
    state: verified.length === 0 ? 'todo' : unsigned.length === 0 ? 'done' : 'warning',
    detail:
      verified.length === 0
        ? 'Each mailbox signs its own mail, so this comes after a mailbox exists.'
        : unsigned.length === 0
          ? 'Every sending mailbox has one.'
          : `${unsigned.length} mailbox${unsigned.length === 1 ? '' : 'es'} will send unsigned.`,
  });

  return {
    steps,
    // Verified AND in rotation: a mailbox paused at its third strike is
    // verified and still sends nothing.
    canSend: verified.length > 0 && sendable.length > 0,
    canDetectReplies: withInbox.length > 0,
    sendOnlyMailboxes: verified.filter((a) => !inboxConnected(a)).map((a) => a.fromEmail),
    unsignedMailboxes: unsigned.map((a) => a.fromEmail),
  };
}
