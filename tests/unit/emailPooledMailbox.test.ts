// A campaign sent from "any mailbox" goes from ONE mailbox, chosen by the
// database when it starts (migration 168). The screens must say that, and say
// which one it will probably be.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { likelyPooledMailbox } from '@/lib/email/mailboxPool';
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
