-- Add a `country` column to organizations so the owner can pick where the
-- business is based, and the app can default new expenses / contracts /
-- payslips to that country's currency.
--
-- This is phase 1 of the multi-currency story:
--   * `organizations.country`         — ISO-3166 alpha-2 code (e.g. "GB").
--   * `organizations.settings.currency` — already existed; takes precedence
--     when explicitly set, otherwise the country implies it.
-- Date/number locale per country comes in a follow-up migration; this one
-- is just the data shape.

alter table public.organizations
  add column if not exists country text;

comment on column public.organizations.country is
  'ISO-3166-1 alpha-2 country code. Implies the default currency for new entries when settings->>currency is not explicitly set.';
