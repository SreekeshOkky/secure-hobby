# Severity and verdict rules (verifiers read this)

**Severity = likelihood × impact for this app**, not checklist deviation. Hobby apps usually hold real user emails, and often payment or AI-billing exposure, so do not downgrade just because the app is small.

| Severity | Meaning | Examples |
|---|---|---|
| critical | Anyone on the internet, unauthenticated, can read or modify other users' private data, or take over the backend | service_role key in the bundle; table with PII and no RLS; RCE |
| high | Unauthenticated abuse with real impact, or any logged-in user reaching other users' data | open cron that deletes data; IDOR on orders; user_metadata-based admin; committed live Stripe key |
| medium | Needs a precondition (a victim click, a specific config, being logged in) or the impact is bounded | open redirect; XSS needing a crafted record; LLM route abuse on a capped key; public bucket of semi-private files |
| low | Small impact, or defense in depth | missing headers; source maps; unpinned actions; captcha off |
| info | Worth knowing, no risk by itself | Firebase web apiKey; anon key in client |

**Public by design (never a finding by itself):** the Supabase anon / publishable key, the Firebase web config `apiKey`, Vercel project IDs, and `NEXT_PUBLIC_SUPABASE_URL`. A finding arises only when the backend fails to restrict what that key can do.

**Verdicts**
- `confirmed`: you traced source → sink in the code and found no mitigation (RLS, a later migration, middleware plus a handler check, a sanitizer). State the attacker steps in `exploit`.
- `needs_validation`: one specific fact you could not establish from the repo blocks a decision. Write it as a checkable question in `needs` (for example "Is RLS enabled on public.orders in the hosted project? The table was created outside migrations."). Leave severity null.
- `rejected`: you found the mitigation or the reason it is safe. Put it in `disproof` with file:line.

Defense-in-depth gaps without an exploit path are `low` at most. Never invent impact you did not trace.
