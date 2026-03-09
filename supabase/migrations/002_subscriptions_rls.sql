-- Allow users to read their own subscription row so the app can apply the selected plan after checkout.
-- The Stripe webhook updates subscriptions using the service role (bypasses RLS).

alter table if exists public.subscriptions enable row level security;

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id::uuid);

drop policy if exists "Users can insert own subscription" on public.subscriptions;
create policy "Users can insert own subscription"
  on public.subscriptions for insert
  with check (auth.uid() = user_id::uuid);

drop policy if exists "Users can update own subscription" on public.subscriptions;
create policy "Users can update own subscription"
  on public.subscriptions for update
  using (auth.uid() = user_id::uuid);
