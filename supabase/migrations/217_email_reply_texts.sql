-- Email: the full text of a reply is kept and shown.
--
-- Until now a reply was only counted: the list said who answered and when,
-- and "read it in your mailbox". The owner asked to read the answer where the
-- campaign is. So when the inbox scan finds a reply to an email we sent, the
-- worker now goes back for the words of that one message and keeps them here.
--
-- What is kept, and what is not:
--   * only replies from addresses this organisation sent an email to. The
--     rest of an inbox (the person's own correspondence) is still never read;
--   * the subject and the words, as plain text. No attachments, no pictures,
--     no HTML, and at most 50,000 characters of one reply;
--   * automatic answers (out of office) and bounces are not kept.
--
--   email_reply_texts   one row for a reply (email_inbox_events) whose words
--                       were read: its subject and its text
--   save_reply_text()   how the worker writes one. It finds the newest reply
--                       of that address in that mailbox that has no text yet
--
-- Who can read it: the people who can use Email in the workspace the answered
-- campaign belongs to (the same rule as the campaigns themselves). Nobody
-- writes to it from a browser.
--
-- It goes when the reply's own record goes: erasing a person
-- (crm_erase_person, 195) removes their replies and so these texts too.
--
-- Safe to run more than once. It changes nothing when the email tables have
-- not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.email_inbox_events') is null or to_regclass('public.email_campaigns') is null then
    raise notice 'The email tables are not there yet: run the email files (152 to 168) first, then this file again.';
    return;
  end if;

  execute $q$
    create table if not exists public.email_reply_texts (
      event_id uuid primary key references public.email_inbox_events(id) on delete cascade,
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      -- The workspace of the campaign that was answered: it decides who may read the text.
      workspace_id uuid,
      subject text not null default '' check (char_length(subject) <= 500),
      body_text text not null default '' check (char_length(body_text) <= 60000),
      created_at timestamptz not null default now()
    )
  $q$;
  execute 'create index if not exists idx_email_reply_texts_org on public.email_reply_texts(organization_id, created_at desc)';

  execute 'alter table public.email_reply_texts enable row level security';
  execute 'revoke all on public.email_reply_texts from public, anon, authenticated';
  execute 'grant select on public.email_reply_texts to authenticated';
  execute 'grant all on public.email_reply_texts to service_role';

  execute 'drop policy if exists email_reply_texts_read on public.email_reply_texts';
  execute $q$
    create policy email_reply_texts_read on public.email_reply_texts for select to authenticated
      using (public.can_access_email_scope(organization_id, workspace_id))
  $q$;
end
$do$;

-- Keeps the words of one reply. True when they were kept; false when there is
-- no reply of that address in that mailbox waiting for its text (it was kept
-- before, or the reply was never recorded). Never raises for that.
create or replace function public.save_reply_text(p_account uuid, p_address text, p_subject text, p_body text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_event uuid;
  v_org uuid;
  v_message uuid;
  v_workspace uuid;
begin
  if p_account is null or nullif(btrim(coalesce(p_address, '')), '') is null then
    return false;
  end if;

  select e.id, e.organization_id, e.message_id into v_event, v_org, v_message
    from public.email_inbox_events e
   where e.account_id = p_account
     and e.kind = 'reply'
     and lower(e.address) = lower(btrim(p_address))
     -- Only a reply that was matched to an email we sent: that is what makes it ours to read.
     and e.message_id is not null
     and e.created_at > now() - interval '2 days'
     and not exists (select 1 from public.email_reply_texts t where t.event_id = e.id)
   order by e.created_at desc
   limit 1;
  if v_event is null then
    return false;
  end if;

  select c.workspace_id into v_workspace
    from public.email_messages m
    join public.email_campaigns c on c.id = m.campaign_id
   where m.id = v_message;

  insert into public.email_reply_texts (event_id, organization_id, workspace_id, subject, body_text)
  values (v_event, v_org, v_workspace, left(coalesce(p_subject, ''), 500), left(coalesce(p_body, ''), 60000))
  on conflict (event_id) do nothing;
  return true;
end;
$$;

revoke all on function public.save_reply_text(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_reply_text(uuid, text, text, text) to service_role;

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
