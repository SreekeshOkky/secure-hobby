# Supabase live checks (read-only MCP)

Use only these calls. The guard blocks everything else. Never select from user tables: you need metadata, not data.

1. `get_advisors` with `type: "security"`. This is Supabase's own linter (RLS disabled, security definer views, mutable search_path, leaked password protection, and more). Each lint becomes one finding: `verdict: "confirmed"`, severity mapped from the lint level (ERROR→high, WARN→medium, INFO→low). Map the check ID: rls_disabled_in_public→SUPA-001, policy_exists_rls_disabled→SUPA-002, security_definer_view→SUPA-008, function_search_path_mutable→SUPA-007, auth_users_exposed→SUPA-008, auth_leaked_password_protection→SUPA-109, otherwise SUPA-099.
2. `list_tables` with `schemas: ["public"]`: note any table with `rls_enabled: false` that the advisor did not already report.
3. `list_storage_buckets`: a bucket with `public: true` → SUPA-009, needs_validation (whether its contents are private is a product question).
4. `execute_sql` for policies that allow everything (only this exact query shape passes the guard):
   ```sql
   select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_catalog.pg_policies where schemaname = 'public'
   ```
   `qual = 'true'` or `with_check = 'true'` on INSERT/UPDATE/DELETE/ALL → SUPA-003, confirmed. Mention of `user_metadata` → SUPA-005.
5. `execute_sql` for definer functions callable by anon:
   ```sql
   select n.nspname, p.proname, p.prosecdef, p.proconfig::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
   ```
   → SUPA-105 needs_validation, listing the function names.
6. `list_edge_functions`: functions with `verify_jwt: false` → SUPA-010 needs_validation.

Compare with the code. A table that has RLS in the migrations but not live is **drift**: report it with `reasoning` starting "Drift:", because someone changed it in the dashboard.
