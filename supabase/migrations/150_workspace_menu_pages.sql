-- Per-workspace Quick Menu. NULL = every item enabled (the default, and what
-- every existing row gets). A JSON array of PageKey strings = only those items.
-- See docs/superpowers/specs/2026-09-18-workspace-scoping-design.md.
alter table public.workspaces
  add column if not exists menu_pages jsonb;

comment on column public.workspaces.menu_pages is
  'Quick Menu PageKeys enabled in this workspace; NULL means all.';

notify pgrst, 'reload schema';
