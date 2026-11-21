-- Web forms: share the leads between several people, in turn.
--
-- A form gave every lead to one owner, or to nobody. It can now list several
-- people: the first lead goes to the first of them, the next lead to the next,
-- and round again. A person who has left the organisation is passed over.
--
-- Only two columns are added to public.crm_lead_forms. Forms that exist already
-- keep giving their leads to their one owner, as before.
--
-- Safe to run more than once.

alter table public.crm_lead_forms add column if not exists share_with uuid[] not null default '{}';
alter table public.crm_lead_forms add column if not exists share_next integer not null default 0;

comment on column public.crm_lead_forms.share_with is 'The people who take this form''s leads in turn. Empty = every lead goes to owner_id.';
comment on column public.crm_lead_forms.share_next is 'How many leads have been shared out, which says whose turn is next.';

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';
