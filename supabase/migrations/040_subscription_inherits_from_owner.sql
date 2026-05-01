-- Subscription sharing across an organization
--
-- Without this, every signed-in user has only their OWN subscription row to
-- read, so invited team members each get charged for their own plan after the
-- 28-day trial expires. The intent is: the OWNER pays once, and every member
-- of that organization rides on the owner's subscription.
--
-- Server-side: we add a SELECT policy that lets an authenticated member of
-- any org read the owner of that org's subscription row.
-- Client-side (separate change): SubscriptionContext now fetches the OWNER's
-- subscription when the current user isn't the owner, so the trial / plan /
-- expiry derive from the owner alone.

drop policy if exists "Org members can read owner subscription"
  on public.subscriptions;

create policy "Org members can read owner subscription"
  on public.subscriptions for select
  to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.owner_id = subscriptions.user_id
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1
            from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
            where (m->>'userId')::uuid = auth.uid()
          )
        )
    )
  );
