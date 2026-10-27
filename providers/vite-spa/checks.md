# Vite SPA checks

Key fact: **an SPA has no server.** Every line in `src/` and every `VITE_*` variable ships to the browser. The only security boundary is the backend: Supabase RLS, storage policies, and edge functions. A route guard in React or Vue is UX, not security.

### VITE-001 · Secret behind VITE_ · high/critical
`import.meta.env.VITE_*SECRET*` and similar names are inlined into the bundle. Fix: move the call behind an edge function, and rotate the key.

### VITE-002 · Privileged key or admin API in the SPA · critical
A service role key, `sb_secret_`, or `supabase.auth.admin.*` in frontend code. Anyone gets full database access. Fix: rotate the key, move admin work to a Supabase edge function that checks the caller's JWT.

### VITE-003 · Client-side-only authorization · high
An admin page or feature gated by `if (user.email === ...)`, `role === 'admin'`, `<ProtectedRoute>` or a router `beforeEach`, while the data it uses (`supabase.from('orders').select()`, `.update()`, `.rpc()`) is not restricted by RLS or a policy for that role. Trace each data call in the guarded view to its table, then check that table's policies in the migrations. If RLS would let any authenticated user, or anon, perform the call: confirmed. If the migrations are not in the repo: needs_validation.
Fix: enforce in RLS, for example `using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')`. Never use user_metadata for this (SUPA-005).

### VITE-004 · Secrets injected with `define` · medium/high
`define: { 'process.env.X': JSON.stringify(process.env.X) }` puts build-time secrets into the bundle.

### VITE-005 · Production source maps · low (hardening)

### VITE-006 · Tokens in localStorage + XSS · medium
supabase-js stores the session in localStorage by default. That is acceptable, but any XSS (COMMON-010) then means account takeover. Raise XSS findings by one level in SPAs.
