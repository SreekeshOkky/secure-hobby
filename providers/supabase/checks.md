# Supabase checks

Key facts:
- The **anon / publishable key is public**: it ships in every browser bundle. Security comes from RLS, not from hiding that key.
- The **service_role / secret key bypasses RLS entirely**. It must exist only in server code (route handlers, server actions, edge functions).
- Every table and view in an exposed schema (`public` by default, or as set by `[api] schemas` in `config.toml`) is reachable at `https://<ref>.supabase.co/rest/v1/<table>` with the anon key.
- `supabase/config.toml` is the **local** config. The hosted project can differ, so auth-setting findings need validation unless live checks confirm them.

### SUPA-001 · Table without RLS · high/critical
Surface: migrations. A `create table` in an exposed schema with no `enable row level security` in any migration.
Confirm: no later migration enables it, and the table is in an exposed schema. Critical if it holds PII, payments or auth-related data.
Not a finding: private schemas not listed in `[api] schemas`. If the repo has no migrations for the table (created in the dashboard), report needs_validation, not confirmed.
Fix (sql): `alter table public.<t> enable row level security;` plus owner policies such as
`create policy "owner can read" on public.<t> for select to authenticated using ((select auth.uid()) = user_id);`

### SUPA-002 · RLS disabled explicitly · high
`alter table ... disable row level security`. Same impact as SUPA-001.

### SUPA-003 · Permissive policy `using (true)` / `with check (true)` · medium/high
On select: fine only for genuinely public data. On insert, update, delete or all: anyone in the role can write any row (high when `to anon` or `to public`).
Fix: scope it to the owner with `(select auth.uid()) = user_id`.

### SUPA-004 · Ownership checks wrong or missing · high
Policies that compare the wrong column, use `auth.uid() is not null` (any logged-in user) when the data is per-user, or UPDATE policies without `with check`. Without `with check`, a user can set `user_id` to someone else or move rows between tenants.

### SUPA-005 · Authorization from user_metadata · high
`auth.jwt() -> 'user_metadata'` or `raw_user_meta_data` is **editable by the user** (`supabase.auth.updateUser({ data: { role: 'admin' } })`). Use `app_metadata`, which only the service role can set, or a roles table.

### SUPA-006 · Service role key reachable from the browser · critical
The key appears in a `'use client'` file, in a `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` variable, or in a module imported by client code. Anyone can read it from the JS bundle and gets full database access.
Fix: rotate the key in the dashboard, move admin calls to server-only code, and add `import 'server-only'` to the admin client module.

### SUPA-007 · SECURITY DEFINER without search_path · medium
A definer function without `set search_path = ''` can be hijacked through objects created in a schema earlier on the path. Fix: `alter function f(...) set search_path = '';` and fully qualify table names.

### SUPA-008 · View bypasses RLS · medium/high
Views run as their owner (postgres) unless `with (security_invoker = true)` is set (Postgres 15+), so they expose underlying rows regardless of RLS. High if the view selects from `auth.users` (leaks emails).

### SUPA-009 · Public bucket / broad storage policies · medium/high
`public = true` buckets serve every object to anyone who has the URL. Policies on `storage.objects` with `using (true)` let anyone list or overwrite files. High for private documents, low for avatars.
Fix: make the bucket private and use signed URLs, with owner policies such as `(storage.foldername(name))[1] = (select auth.uid())::text`.

### SUPA-010 · Edge function without JWT verification · medium/high
`verify_jwt = false` with no signature or secret check inside the function. Anyone can invoke it. High if it uses the service role or sends email.

### SUPA-011 · Edge function: service role + wildcard CORS · medium
Any website can call it from a victim's browser. Check what the function lets the caller do with admin rights.

### SUPA-101 · Server trusts getSession() · medium/high
`supabase.auth.getSession()` on the server reads the cookie **without verifying it**, and a forged cookie passes. Use `auth.getUser()` (or `getClaims()`) for authorization decisions in middleware, route handlers, server actions and `hooks.server`.

### SUPA-102 · Authorization only in the UI · high
Admin pages hidden by a client-side check, while the underlying table, RPC or route has no RLS or server check. Confirm by tracing the data call: if the anon key plus the user's JWT can perform it directly, it is a finding.

### SUPA-103 · Wildcard redirect URLs · medium
`additional_redirect_urls = ["https://*.vercel.app/**"]` lets any Vercel deployment, including an attacker's, receive auth tokens. Fix: list your exact domains, and use a preview wildcard only scoped to your team slug.

### SUPA-104 · Email confirmation off · low
Users can sign up with addresses they don't own. A higher risk if the app trusts the email for authorization.

### SUPA-105 · RPC exposed to anon / privileged functions · medium/high
Functions in exposed schemas are callable via `/rest/v1/rpc/<fn>`. A definer function that does not check `auth.uid()` lets anyone run it with owner rights. Fix: `revoke execute on function f from anon, public;` plus auth checks inside.

### SUPA-106 · pg_graphql exposure · low (hardening)
pg_graphql mirrors exposed tables. It only matters if RLS is missing, and it widens the discovery surface. Disable it if unused.

### SUPA-107 · Realtime leaks · medium
Tables added to `supabase_realtime` without RLS broadcast every change. Broadcast or presence channels without `private: true` and realtime.messages policies are open to anyone.

### SUPA-108 · No captcha / rate limits on auth · low (denial-of-wallet)
Signup, OTP and magic-link endpoints can be scripted. Consider enabling captcha (hCaptcha / Turnstile) and checking `[auth.rate_limit]`.

### SUPA-109 · Weak password policy · low

### SUPA-110 · Admin client module not server-only · medium
A shared `lib/supabase-admin.ts` without `import 'server-only'`. A future client import leaks the key. Confirm current importers. If any client file imports it, that is SUPA-006.
