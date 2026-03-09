-- Allow users to read their own subscription row so the app can apply the selected plan after checkout.
-- The Stripe webhook updates subscriptions using the service role (bypasses RLS).

alter table if exists public.subscriptions enable row level security;

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id::uuid);

-- Optional: allow users to update their own row (e.g. if you add client-side cancel_at_period_end later)
drop policy if exists "Users can update own subscription" on public.subscriptions;
create policy "Users can update own subscription"
  on public.subscriptions for update
  using (auth.uid() = user_id::uuid);
