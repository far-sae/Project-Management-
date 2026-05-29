-- 102_client_contacts_extra_fields.sql
-- Extend client_contacts to match Zoho's full Create Contact form so the new
-- Contacts module can hold everything reps expect: salutation, lead source,
-- additional phone numbers, secondary email, mailing + other address blocks,
-- social handles, reporting-to graph, etc.

alter table public.client_contacts
  add column if not exists salutation       text,
  add column if not exists lead_source      text,
  add column if not exists date_of_birth    date,
  add column if not exists home_phone       text,
  add column if not exists other_phone      text,
  add column if not exists asst_phone       text,
  add column if not exists fax              text,
  add column if not exists email_opt_out    boolean not null default false,
  add column if not exists skype_id         text,
  add column if not exists secondary_email  text,
  add column if not exists twitter          text,
  add column if not exists linkedin_url     text,
  add column if not exists assistant        text,
  add column if not exists reporting_to     uuid references public.client_contacts(contact_id) on delete set null,
  add column if not exists mailing_street   text,
  add column if not exists mailing_city     text,
  add column if not exists mailing_state    text,
  add column if not exists mailing_zip      text,
  add column if not exists mailing_country  text,
  add column if not exists other_street     text,
  add column if not exists other_city       text,
  add column if not exists other_state      text,
  add column if not exists other_zip        text,
  add column if not exists other_country    text,
  add column if not exists description      text,
  add column if not exists tags             text[] not null default '{}',
  add column if not exists owner_id         uuid,
  add column if not exists owner_name       text,
  add column if not exists photo_url        text;

-- Helpful for the cross-account Contacts list (which needs the parent
-- account name + workspace) and for the "Reporting Contacts" related list.
create index if not exists idx_client_contacts_org_updated
  on public.client_contacts (organization_id, updated_at desc);

create index if not exists idx_client_contacts_reporting_to
  on public.client_contacts (reporting_to)
  where reporting_to is not null;

-- A unique partial index on (organization_id, lower(email)) would mirror
-- what we do on clients, but contacts at small SMBs often share an info@
-- alias across many people; skip uniqueness here so imports don't fail
-- on legitimate duplicates. The dialog warns on collisions instead.
