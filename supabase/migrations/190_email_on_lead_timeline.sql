-- ============================================================================
-- 190: Bulk email shows on the lead's timeline.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor, after
-- the email migrations (152 to 168). If those have not been run, this file
-- does nothing and can be run again later.
--
-- What it adds, in plain words:
--   * One trigger on email_messages (the outbox of the Email area). When a
--     campaign or sequence email to a lead is SENT, when the lead REPLIES, or
--     when the email BOUNCES, one line is written on that lead's timeline
--     (crm_activities, type "email"):
--         Sent “<subject>”
--         Replied to “<subject>”
--         The email “<subject>” bounced
--     A sent email also stamps the lead's "last contacted" date. A reply also
--     moves a lead that was still New (or only "attempted") to Contacted.
--   * Nothing else: no new table and no new column.
--
-- Until now the Email area and the CRM kept two separate histories: the lead's
-- page showed nothing of what the lead had been sent, or that it had answered.
--
-- It can never make an email fail: everything the trigger does is inside one
-- block that catches every error, and it only writes when the message belongs
-- to a lead (email_messages.contact_id) that is in a workspace.
--
-- The automation: a "Sent" or "bounced" line is marked as written by the
-- system, so the AI agents do not mistake it for the lead getting in touch. A
-- "Replied" line is not marked, so they do see a real reply.
-- ============================================================================

create or replace function public.email_note_on_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_org uuid;
  v_workspace uuid;
  v_subject text;
  v_sent boolean;
  v_replied boolean;
  v_bounced boolean;
begin
  begin
    if new.contact_id is null then
      return null;
    end if;

    -- Read through jsonb, so a database that has not added the reply and
    -- bounce columns yet (migration 157) still records what was sent.
    v_sent := (v_new ->> 'status') = 'sent' and coalesce(v_old ->> 'status', '') <> 'sent';
    v_replied := (v_new ->> 'replied_at') is not null and (v_old ->> 'replied_at') is null;
    v_bounced := (v_new ->> 'bounced_at') is not null and (v_old ->> 'bounced_at') is null;
    if not (v_sent or v_replied or v_bounced) then
      return null;
    end if;

    select c.organization_id, c.workspace_id into v_org, v_workspace
    from public.crm_contacts c
    where c.id = new.contact_id;
    -- A timeline line needs the lead's workspace.
    if v_org is null or v_workspace is null then
      return null;
    end if;

    select left(regexp_replace(coalesce(c.subject, ''), '\{\{[^}]*\}\}', '…', 'g'), 200) into v_subject
    from public.email_campaigns c
    where c.id = new.campaign_id;
    v_subject := coalesce(nullif(btrim(v_subject), ''), 'an email');

    if v_sent then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'Sent “' || v_subject || '”', new.contact_id,
        jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'out', 'emailMessageId', new.id::text)
      );
      update public.crm_contacts set last_contacted_at = now() where id = new.contact_id;
    end if;

    if v_replied then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'Replied to “' || v_subject || '”', new.contact_id,
        jsonb_build_object('source', 'email', 'direction', 'in', 'emailMessageId', new.id::text)
      );
      update public.crm_contacts
      set lead_status = 'connected'
      where id = new.contact_id and lead_status in ('new', 'open', 'attempted_to_contact');
    end if;

    if v_bounced then
      insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
      values (
        v_org, v_workspace, null, 'email', 'The email “' || v_subject || '” bounced', new.contact_id,
        jsonb_build_object('automation', 'true', 'source', 'email', 'direction', 'bounce', 'emailMessageId', new.id::text)
      );
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function public.email_note_on_lead() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.email_messages') is not null and to_regclass('public.crm_activities') is not null then
    drop trigger if exists trg_email_messages_lead_timeline on public.email_messages;
    create trigger trg_email_messages_lead_timeline
      after insert or update on public.email_messages
      for each row execute function public.email_note_on_lead();
  end if;
end $$;
