# Organization owner vs app owner

## Two different kinds of "owner"

| Who | Meaning | Full access? |
|-----|--------|--------------|
| **App / product owner** | **You** — the people who **built** TaskCalendar (the project). | Yes. You get full access everywhere. Set your user IDs in `VITE_APP_OWNER_USER_IDS` (see below). |
| **Organization owner** | A **customer** who created or owns a **workspace** (organization). They are "owner" of that workspace, not of the app. | Yes, but only **for that organization**. No subscription required for them inside that org. |

So: **organization owner** = customer who owns a workspace. **App owner** = you (the builders) who made the product and should always have full access.

---

## Organization owner (customers)

### In simple terms

- **Organization** = a workspace (projects, team, files all belong to one organization).
- **Organization owner** = the person who “owns” that workspace. There is **one owner per organization**.
- The organization owner has **full access for that org**: no subscription required, no project/workspace/task/team limits **within that organization**.

### How do you become the organization owner?

**You are already the organization owner if you created the account and the workspace.**

When you **signed up** (first time):

1. The app created an **organization** for you.
2. It set **you** as the owner of that organization (`owner_id` = your user id).
3. So the first person who signs up and gets an org is the organization owner of that org.

So:

- If **you** signed up and use the app alone → **you are the organization owner** of your organization. You get full access without subscription (for that org).
- If someone **invited you** to their workspace → you are a **member** of their organization. The **person who invited you** (or who created that org) is the organization owner. You are not the owner unless they change it (see below).

### How to check who is the organization owner (in Supabase)

1. Open **Supabase Dashboard** → your project → **Table Editor**.
2. Open the **`organizations`** table.
3. Find your organization row (by name or `organization_id`).
4. Look at the **`owner_id`** column.  
   That value is the **user id** of the organization owner (same as in **`user_profiles`** or **`auth.users`**).

So: **whoever's user id is in `owner_id` is the organization owner.**

### How to set or change the organization owner

#### Option A: You are the only user (you signed up first)

- You are already the organization owner. No change needed.
- Your `user_profiles.id` (or auth user id) should match `organizations.owner_id` for your org.

#### Option B: Change owner to someone else (e.g. transfer to another user)

You have to update the database:

1. Go to **Supabase** → **Table Editor** → **`organizations`**.
2. Open the row for your organization.
3. Set **`owner_id`** to the **user id** of the new owner (the same id as in **`user_profiles`** or **Auth**).
4. Optionally update **`members`** so the new owner has `role: "owner"` and the old one has another role.
5. Save.

After that, the app will treat the new user as the org owner (full access for that org, no subscription checks).

#### Option C: Make sure your account is the organization owner

1. In Supabase, open **`user_profiles`** and find your row. Copy your **`id`** (your user id).
2. Open **`organizations`** and find the organization you use.
3. Set that row's **`owner_id`** to the id you copied.
4. Save.

Then refresh the app; you should be the organization owner and have full access for that org.

---

## App / product owner (you — the builders)

If **you built TaskCalendar** and want your own accounts to always have full access (no subscription, no limits), use **app owner** user IDs.

1. In your **`.env`** (or Vercel/host env), add:
   ```env
   VITE_APP_OWNER_USER_IDS=your-user-id-here,another-user-id
   ```
   Use the **Supabase auth user id** (same as in `user_profiles.id` or `organizations.owner_id`). Comma-separated for multiple people.

2. Rebuild and redeploy so the env is available at build time.

3. Any user whose id is in that list gets **full access everywhere** (all features, no limits), regardless of organization or subscription. That way the people who made the project always have full access; customers who are “organization owners” only get full access for their own org.

---

## Summary

| Question | Answer |
|----------|--------|
| Who is the **organization** owner? | The user whose id is in `organizations.owner_id` for that org. |
| Who is the **app** owner? | Users whose ids are listed in `VITE_APP_OWNER_USER_IDS` (the people who built the product). |
| What does the **organization** owner get? | Full access for **that organization** only; no subscription or limit checks there. |
| What does the **app** owner get? | Full access **everywhere**; no subscription or limit checks in any org. |
| Where is org owner set? | **`organizations`** table, column **`owner_id`** (Supabase Table Editor or SQL). |
| Where is app owner set? | Env var **`VITE_APP_OWNER_USER_IDS`** (comma-separated user ids). |
