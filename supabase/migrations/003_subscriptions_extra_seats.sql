-- Add extra_seats for Advanced plan: each paid extra seat allows one more team member beyond 10.
alter table if exists public.subscriptions
  add column if not exists extra_seats integer not null default 0;

comment on column public.subscriptions.extra_seats is 'Paid extra team seats (Advanced plan: 10 + extra_seats allowed)';
