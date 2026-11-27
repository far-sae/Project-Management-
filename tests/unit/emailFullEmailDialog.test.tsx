// The window that shows a whole email: what was sent to a person, and (from
// the Replies list) what they wrote back.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ sent: vi.fn(), reply: vi.fn(), list: vi.fn() }));

vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('@/services/supabase/emailReplies', () => ({ loadSentEmail: h.sent, loadReplyText: h.reply, listReplies: h.list }));

import { FullEmailDialog } from '@/components/email/FullEmailDialog';
import { RepliesTab } from '@/components/email/RepliesTab';

const sentEmail = {
  to: 'elena@harbour.test', toName: 'Elena Rossi', fromName: 'Sam', fromEmail: 'sam@northwind.test',
  sentAt: new Date('2026-11-26T09:15:00Z'), status: 'sent', campaignName: 'November offer',
  view: { subject: 'A quick idea, Elena', html: '<p>Hi Elena,</p><p>We help with missed calls.</p><p>Sam, Northwind Studio</p>', text: 'Hi Elena,', footnote: 'The email also had an unsubscribe link at the end.' },
};
const reply = { who: 'Elena Rossi', address: 'elena@harbour.test', at: new Date('2026-11-27T10:00:00Z'), mailbox: 'Sales (sam@northwind.test)' };

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => {
  h.sent.mockReset().mockResolvedValue(sentEmail);
  h.reply.mockReset().mockResolvedValue({ subject: 'Re: A quick idea, Elena', body: 'Hi Sam,\n\nYes please. Can we talk on Monday?\n\nElena' });
  h.list.mockReset();
});
afterEach(cleanup);

describe('the whole email', () => {
  it('shows the email that was sent as the person got it: who, when, the subject and the full text', async () => {
    render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" />);
    const sent = await screen.findByRole('region', { name: 'The email you sent' });
    expect(within(sent).getByText('A quick idea, Elena')).toBeTruthy();
    expect(within(sent).getByText('We help with missed calls.')).toBeTruthy();
    expect(within(sent).getByText('Sam, Northwind Studio')).toBeTruthy();
    expect(within(sent).getByText(/Sam <sam@northwind\.test>/)).toBeTruthy();
    expect(within(sent).getByText(/Elena Rossi <elena@harbour\.test>/)).toBeTruthy();
    expect(within(sent).getByText('The email also had an unsubscribe link at the end.')).toBeTruthy();
    expect(h.sent).toHaveBeenCalledWith('msg-1');
    // Opened from a campaign: there is no reply to ask for.
    expect(h.reply).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Their reply' })).toBeNull();
  });

  it('shows the reply in full above it, as plain words', async () => {
    render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" replyEventId="ev-1" reply={reply} />);
    const theirs = await screen.findByRole('region', { name: 'Their reply' });
    expect(within(theirs).getByText('Re: A quick idea, Elena')).toBeTruthy();
    expect(within(theirs).getByText(/Yes please\. Can we talk on Monday\?/).textContent).toBe('Hi Sam,\n\nYes please. Can we talk on Monday?\n\nElena');
    expect(within(theirs).getByText(/Elena Rossi <elena@harbour\.test>/)).toBeTruthy();
    expect(h.reply).toHaveBeenCalledWith('ev-1');
    expect(await screen.findByRole('region', { name: 'The email you sent' })).toBeTruthy();
  });

  it('never runs anything a reply brought with it', async () => {
    h.reply.mockResolvedValue({ subject: '<b>hi</b>', body: '<img src=x onerror=alert(1)> <script>alert(1)</script>' });
    const { container } = render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" replyEventId="ev-1" reply={reply} />);
    const theirs = await screen.findByRole('region', { name: 'Their reply' });
    expect(within(theirs).getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(theirs.querySelector('img')).toBeNull();
    expect(theirs.querySelector('script')).toBeNull();
    expect(container.ownerDocument.querySelector('script')).toBeNull();
  });

  it('says where to read a reply whose words were not kept', async () => {
    h.reply.mockResolvedValue(null);
    render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" replyEventId="ev-1" reply={reply} />);
    expect(await screen.findByText('The words of this reply were not kept. You can read it in Sales (sam@northwind.test).')).toBeTruthy();
  });

  it('says so in plain words when the email cannot be loaded, and when it was not sent yet', async () => {
    h.sent.mockRejectedValue(new Error('relation "email_messages" does not exist'));
    const first = render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" />);
    expect((await screen.findByRole('alert')).textContent).toBe('This email could not be loaded. Please try again.');
    first.unmount();
    h.sent.mockResolvedValue({ ...sentEmail, sentAt: null, status: 'queued' });
    render(<FullEmailDialog open onOpenChange={() => undefined} messageId="msg-1" />);
    expect(await screen.findByText('Not sent yet: this is how it will go out.')).toBeTruthy();
  });

  it('asks for nothing while it is closed', () => {
    render(<FullEmailDialog open={false} onOpenChange={() => undefined} messageId="msg-1" replyEventId="ev-1" reply={reply} />);
    expect(h.sent).not.toHaveBeenCalled();
    expect(h.reply).not.toHaveBeenCalled();
  });
});

describe('the Replies list', () => {
  it('opens the whole reply and the email it answers', async () => {
    h.list.mockResolvedValue([{ id: 'ev-1', messageId: 'msg-1', who: 'Elena Rossi', address: 'elena@harbour.test', automatic: false, answered: 'November offer', subject: 'A quick idea', mailbox: 'Sales (sam@northwind.test)', contactId: null, at: new Date('2026-11-27T10:00:00Z') }]);
    render(<MemoryRouter><RepliesTab orgId="org-1" workspaceId="ws-1" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Read the reply from Elena Rossi' }));
    expect(await screen.findByRole('region', { name: 'Their reply' })).toBeTruthy();
    await waitFor(() => expect(h.reply).toHaveBeenCalledWith('ev-1'));
    expect(h.sent).toHaveBeenCalledWith('msg-1');
    expect(screen.getByText(/open one to read what they wrote/)).toBeTruthy();
  });
});
