-- 163_mailbox_signature.sql
--
-- A signature, per sending mailbox.
--
-- On the MAILBOX and not on the campaign, the template or the user, and that
-- is the whole design decision. A campaign sends from a pool: which mailbox
-- takes a given message is decided by claim_email_batch() at send time, from
-- least-recently-used order and whatever allowance each mailbox has left. So
-- the identity at the bottom of the message is only correct if it travels with
-- the mailbox that actually sends it.
--
-- A signature stored anywhere else would be right for whichever mailbox the
-- author had in mind and wrong for the rest — signing mail from sales@ with
-- the name on hello@, to a stranger, as the first impression of the company.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- HTML, because that is what the body is and what the editor produces. Empty
-- by default, which means "no signature" — a mailbox that has not been given
-- one sends exactly what it sends today.
alter table public.email_accounts
  add column if not exists signature_html text not null default '';

notify pgrst, 'reload schema';
