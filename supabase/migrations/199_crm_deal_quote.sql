-- Deals: a quote with lines.
--
-- A deal had one number, its value. It can now hold the lines of a quote: what
-- is offered, how many, at what price each. The deal page adds them up, can set
-- the deal value to the total, and opens the quote as a page to print or save
-- as a PDF.
--
-- One column is added to public.crm_deals. Deals that exist already simply have
-- no lines.
--
-- Safe to run more than once.

alter table public.crm_deals add column if not exists line_items jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_deals_line_items_is_list') then
    alter table public.crm_deals
      add constraint crm_deals_line_items_is_list check (jsonb_typeof(line_items) = 'array');
  end if;
end $$;

comment on column public.crm_deals.line_items is 'The lines of the deal''s quote: [{description, quantity, unitPrice}]. Empty = no quote.';

-- Tell the API about the new column straight away.
notify pgrst, 'reload schema';
