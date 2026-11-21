-- Privacy: erasing one person.
--
-- When somebody asks for their data to be removed, deleting the lead is not
-- enough: the emails sent to them, the replies and bounces seen from them,
-- their follow-ups and their calls stay behind with their address or number.
-- public.crm_erase_person(lead) removes all of it in one step, or nothing.
--
-- What it removes
--   * the lead itself, and with it the notes, timeline, tags and automation
--     history that belong to it (the database removes those with the lead);
--   * the follow-ups about the lead;
--   * every email sent to the lead or to the same address in the organisation,
--     the record of replies and bounces from that address, and the lead's place
--     in any sequence;
--   * the calls made to the lead.
--
-- What it keeps
--   * deals, agreements and invoices: they are business records. They only lose
--     their link to the lead;
--   * the email address on the do-not-email list (it is added when not there),
--     so the person is never emailed again by a later import or campaign.
--
-- Who may run it: the organisation's owner only.
--
-- Call recordings live at the phone provider, where the database cannot reach.
-- The app deletes them first (DELETE /api/voice/contacts/<id>/calls). If a
-- recording is still on record here, this function stops and changes nothing.
--
-- Safe to run more than once.

create or replace function public.crm_erase_person(p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c public.crm_contacts%rowtype;
  v_email text;
  n integer;
  v_done jsonb := '{}'::jsonb;
begin
  if p_contact is null then
    raise exception 'Choose a lead.' using errcode = '22023';
  end if;

  select * into c from public.crm_contacts where id = p_contact for update;
  if not found then
    raise exception 'This lead was not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.organizations o
    where o.organization_id = c.organization_id and o.owner_id = auth.uid()
  ) then
    raise exception 'Only the owner can erase a person.' using errcode = '42501';
  end if;

  v_email := nullif(lower(btrim(coalesce(c.email, ''))), '');

  -- Nothing of this person goes to the recycle bin (migration 197): erased means no copy is kept.
  perform set_config('crm.skip_trash', 'on', true);

  -- Calls. Tables from later migrations are touched only where they exist.
  if to_regclass('public.crm_calls') is not null then
    execute 'select count(*) from public.crm_calls where contact_id = $1 and recording_sid is not null' into n using p_contact;
    if n > 0 then
      raise exception 'This person still has call recordings. Delete the recordings first, then erase the person.' using errcode = '23503';
    end if;
    execute 'delete from public.crm_calls where contact_id = $1' using p_contact;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('calls', n);
  end if;

  delete from public.crm_tasks where contact_id = p_contact;
  get diagnostics n = row_count;
  v_done := v_done || jsonb_build_object('followUps', n);

  if to_regclass('public.email_sequence_enrollments') is not null then
    execute 'delete from public.email_sequence_enrollments where contact_id = $1 or (organization_id = $2 and $3::text is not null and lower(to_email) = $3)'
      using p_contact, c.organization_id, v_email;
  end if;

  if to_regclass('public.email_messages') is not null then
    execute 'delete from public.email_messages where contact_id = $1 or (organization_id = $2 and $3::text is not null and lower(to_email) = $3)'
      using p_contact, c.organization_id, v_email;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('emails', n);
  end if;

  if v_email is not null and to_regclass('public.email_inbox_events') is not null then
    execute 'delete from public.email_inbox_events where organization_id = $1 and lower(address) = $2' using c.organization_id, v_email;
  end if;

  -- Kept on purpose: the address alone, so nothing is ever sent to it again.
  if v_email is not null and to_regclass('public.email_suppressions') is not null then
    execute 'insert into public.email_suppressions (organization_id, email, reason) values ($1, $2, ''manual'') on conflict (organization_id, email) do nothing'
      using c.organization_id, v_email;
  end if;

  -- The change log and the recycle bin (migration 197) hold this person's details too.
  if to_regclass('public.crm_changes') is not null then
    execute 'delete from public.crm_changes where record_id = $1' using p_contact;
  end if;
  if to_regclass('public.crm_trash') is not null then
    execute 'delete from public.crm_trash where record_id = $1' using p_contact;
  end if;

  -- Last: the lead. Its notes, timeline, tags and automation history go with it.
  delete from public.crm_contacts where id = p_contact;

  return v_done || jsonb_build_object('keptOnDoNotEmailList', v_email is not null);
end;
$$;

revoke all on function public.crm_erase_person(uuid) from public, anon;
grant execute on function public.crm_erase_person(uuid) to authenticated, service_role;

comment on function public.crm_erase_person(uuid) is
  'Erases one person: the lead, its follow-ups, emails, replies, sequence places and calls. Owner only. Keeps deals and the address on the do-not-email list.';

-- Tell the API about the new function straight away.
notify pgrst, 'reload schema';
