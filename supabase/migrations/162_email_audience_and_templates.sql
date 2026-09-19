-- 162_email_audience_and_templates.sql
--
-- Phase 5: the writing half of the outreach tool -- who you are writing to,
-- and what you are writing.
--
-- Phases 1 to 4 built the sending half and none of this. Compared with the
-- reference implementation (far-sae/outreach-pilot-dash) what was missing was
-- prospects, groups, templates, an editor and a chart -- which is to say,
-- everything a person touches daily. This migration is the schema for the
-- first three.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- ── a. email_groups ─────────────────────────────────────────────────
--
-- A named segment, and an ANGLE: a sentence describing how this segment is
-- approached. The angle is the useful half. A group called "Agencies" says
-- nothing; "Agencies -- lead with the white-label workflow" is the thing a
-- person needs in front of them while writing, and it is available as
-- {{angle}} in a template so one template can serve several groups.
create table if not exists public.email_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  name text not null,
  angle text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_groups enable row level security;

-- Grants, which RLS does not replace: a policy filters rows for a role that
-- already reaches the table, and without the grant `authenticated` gets a
-- permission error before any policy is consulted.
grant select, insert, update, delete on public.email_groups to authenticated;
grant all on public.email_groups to service_role;

drop policy if exists email_groups_read on public.email_groups;
create policy email_groups_read on public.email_groups
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists email_groups_write on public.email_groups;
create policy email_groups_write on public.email_groups
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists email_groups_org on public.email_groups (organization_id);

-- ── b. email_templates ──────────────────────────────────────────────
--
-- Reusable wording. A campaign COPIES from a template rather than pointing at
-- it for its text: editing a template must not silently rewrite mail that has
-- already gone out, or been scheduled, or been half-reviewed by somebody.
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  subject text not null default '',
  body_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;

grant select, insert, update, delete on public.email_templates to authenticated;
grant all on public.email_templates to service_role;

drop policy if exists email_templates_read on public.email_templates;
create policy email_templates_read on public.email_templates
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists email_templates_write on public.email_templates;
create policy email_templates_write on public.email_templates
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists email_templates_org on public.email_templates (organization_id);

-- ── c. a campaign remembers where its wording came from ─────────────
--
-- Nullable, and ON DELETE SET NULL: a campaign outlives the template it was
-- written from, and deleting a template must not take the record of what was
-- sent with it.
--
-- Stamped when the campaign is created and never updated. A template's stats
-- are the sum over the campaigns that carry its id, so nothing is attributed
-- retroactively and editing a template does not rewrite its own history.
alter table public.email_campaigns
  add column if not exists template_id uuid
    references public.email_templates(id) on delete set null;

-- The stats read: every campaign of one template.
create index if not exists email_campaigns_template
  on public.email_campaigns (template_id)
  where template_id is not null;

-- ── d. prospects are the contacts that are already there ────────────
--
-- crm_contacts already carries organization_id, first_name, last_name, email,
-- phone, job_title, company_id, source, notes and last_contacted_at -- a
-- superset of the reference's `prospects` table but for the two columns added
-- below. email_messages.contact_id already references it and RecipientPicker
-- already reads it.
--
-- What it does not have is a screen: the CRM hub was removed in migration 143
-- and took the contact management UI with it, leaving these rows in place and
-- unreachable. So phase 5 gives them one rather than creating a second contact
-- table, which would mean two places to fix somebody's email address and two
-- answers to "who did we write to".
--
-- The merge field that makes a cold email land, and the reason the reference
-- has it as a first-class column rather than a note.
alter table public.crm_contacts
  add column if not exists pain_point text;

-- At most one group per contact. Many-to-many was considered and dropped: it
-- doubles the interface, and a prospect in two segments with two conflicting
-- angles is not a case anybody sending cold email needs.
--
-- ON DELETE SET NULL so removing a group releases its contacts rather than
-- deleting people.
alter table public.crm_contacts
  add column if not exists group_id uuid
    references public.email_groups(id) on delete set null;

create index if not exists crm_contacts_group
  on public.crm_contacts (group_id)
  where group_id is not null;

-- There is deliberately NO status column here.
--
-- The reference stores `active | unsubscribed` on the prospect. Here
-- email_suppressions already decides who may be mailed: claim_email_batch()
-- enforces it on every send, the unsubscribe endpoint writes it, a hard bounce
-- adds to it, and claim_sequence_enrollments() stops an enrollment over it.
-- A second flag on the contact would be a second source of truth for the one
-- question the law cares about, and the two would disagree inside a week --
-- always in the direction of mailing somebody who asked not to be.
--
-- The Prospects screen reads suppression state from that table and says which
-- of its reasons applied.

notify pgrst, 'reload schema';
