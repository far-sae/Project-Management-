// A campaign sent from "all mailboxes". Before 216 it went from ONE mailbox,
// chosen by the database when it started (migration 168); from 216 on it is
// shared out over every working mailbox of the workspace. The screens must
// say what really happens on the database they are talking to.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { campaignSender, likelyPooledMailbox, pooledSendingSentence } from '@/lib/email/mailboxPool';
import type { MailboxHealth } from '@/lib/email/types';

const box = (id: string, lastSent: string | null, over: Partial<MailboxHealth> = {}): MailboxHealth => ({
  id, label: id, fromEmail: `${id}@northwind.example`, isActive: true, pausedReason: null, status: 'active',
  consecutiveFailures: 0, lastSentAt: lastSent ? new Date(lastSent) : null, effectiveLimit: 40, sentToday: 0, ...over,
});

describe('the mailbox an "any mailbox" campaign gets', () => {
  it('is the one used least recently', () => {
    const pool = [box('a', '2026-11-20T10:00:00Z'), box('b', '2026-11-18T10:00:00Z'), box('c', '2026-11-19T10:00:00Z')];
    expect(likelyPooledMailbox(pool)?.id).toBe('b');
  });

  it('is one that has never sent, before any that has', () => {
    expect(likelyPooledMailbox([box('a', '2026-11-01T10:00:00Z'), box('b', null)])?.id).toBe('b');
  });

  it('is never one that is switched off or whose sign-in failed', () => {
    const pool = [box('a', null, { isActive: false }), box('b', null, { status: 'error' }), box('c', '2026-11-20T10:00:00Z')];
    expect(likelyPooledMailbox(pool)?.id).toBe('c');
    expect(likelyPooledMailbox(pool.slice(0, 2))).toBeNull();
    expect(likelyPooledMailbox([])).toBeNull();
  });

  it('follows the rule the database really uses', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/168_email_workspace_isolation.sql'), 'utf8').replace(/\s+/g, ' ');
    // One mailbox is written onto the campaign when it starts...
    expect(sql).toContain('select a.id into new.account_id from public.email_accounts a');
    // ...from those that are active, least recently used first.
    expect(sql).toContain("and a.status = 'active' and coalesce(a.is_active, true) order by coalesce(a.last_sent_at, '-infinity'::timestamptz), a.created_at limit 1");
  });
});

describe('what the screens say about it', () => {
  const compose = readFileSync(resolve(process.cwd(), 'src/components/email/ComposeTab.tsx'), 'utf8');
  const review = readFileSync(resolve(process.cwd(), 'src/components/email/LaunchReview.tsx'), 'utf8');

  it('no longer promises that a campaign rotates across every mailbox', () => {
    expect(compose).not.toContain('rotate across every mailbox');
    expect(compose).not.toMatch(/mailbox\$\{[^}]*\} in rotation, least recently used first/);
    expect(review).not.toMatch(/,\s*rotating\./);
    expect(compose).toContain('Any mailbox (the one used least recently)');
  });
});

describe('what "all mailboxes" means, in the words of the compose screen', () => {
  const pool = [box('a', '2026-11-20T10:00:00Z', { effectiveLimit: 40 }), box('b', null, { effectiveLimit: 25 }), box('c', null, { effectiveLimit: 10, isActive: false })];

  it('says every working mailbox takes a turn, and how many emails a day that is together', () => {
    expect(pooledSendingSentence(pool, true)).toBe('Goes out through your 2 working mailboxes in turn: up to 65 emails a day together. Each one keeps its own daily limit.');
  });

  it('says so when there is only one, and how to send more', () => {
    expect(pooledSendingSentence([pool[0]], true)).toBe('You have one working mailbox (a), so it sends the whole campaign: up to 40 emails a day. Add more mailboxes on the Accounts tab to send more.');
  });

  it('still says "one mailbox" on a database where they do not take turns yet', () => {
    expect(pooledSendingSentence(pool, false)).toBe('The whole campaign goes from one mailbox: the one used least recently when it starts. Right now that is b (b@northwind.example).');
  });

  it('says nothing when no mailbox can send (the screen has its own words for that)', () => {
    expect(pooledSendingSentence([pool[2]], true)).toBe('');
    expect(pooledSendingSentence([], false)).toBe('');
  });

  it('the database really shares a campaign out from 216 on', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/216_email_mailboxes_take_turns.sql'), 'utf8').replace(/\s+/g, ' ');
    // The check at the start no longer writes a mailbox onto the campaign...
    expect(sql).not.toContain('into new.account_id');
    // ...and the emails of a campaign with no mailbox are handed to the mailboxes of its own workspace only.
    expect(sql).toContain('or (c.account_id is null and (c.workspace_id is null or a.workspace_id is not distinct from c.workspace_id))');
  });
});

describe('one sender name and one reply address for a campaign', () => {
  it('takes a name and an address, tidied', () => {
    expect(campaignSender({ senderName: '  Northwind   Studio ', replyTo: ' Hello@Northwind.test ' })).toEqual({ senderName: 'Northwind Studio', replyTo: 'hello@northwind.test', problem: null });
  });

  it('means "each mailbox\'s own" when left empty', () => {
    expect(campaignSender({ senderName: '', replyTo: '   ' })).toEqual({ senderName: null, replyTo: null, problem: null });
  });

  it('refuses a reply address that is not one, and a name that would break the email\'s header', () => {
    expect(campaignSender({ senderName: 'Sam', replyTo: 'hello@' }).problem).toBe('The reply address is not an email address.');
    expect(campaignSender({ senderName: 'Sam', replyTo: 'a@b.test, c@d.test' }).problem).toBe('The reply address is not an email address.');
    expect(campaignSender({ senderName: 'Sam\r\nBcc: x@y.test', replyTo: '' })).toEqual({ senderName: 'Sam Bcc: x@y.test', replyTo: null, problem: null });
    expect(campaignSender({ senderName: 'x'.repeat(200), replyTo: '' }).senderName).toHaveLength(120);
  });
});
