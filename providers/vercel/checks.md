# Vercel checks

Key facts:
- Every route under `/api`, every cron path and every **preview deployment** URL is public on the internet unless Deployment Protection is on.
- Env vars are scoped per environment (Production / Preview / Development). Preview deployments run on any branch push, often by dependabot or contributors.
- Hobby-plan usage limits make denial-of-wallet less likely to bill you, but an abused endpoint can still suspend your project.

### VERCEL-001 · Cron route without CRON_SECRET · high
Cron paths (from `vercel.json` `crons` or `/api/cron/*`) are ordinary public URLs. Without
`if (req.headers.get('authorization') !== \`Bearer ${process.env.CRON_SECRET}\`) return new Response('Unauthorized', { status: 401 })`
anyone can trigger the job: mass emails, data deletion, paid API calls.
Fix: set `CRON_SECRET` in Vercel and check it as above.

### VERCEL-002 · Missing security headers · low (hardening)
No CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` or `X-Content-Type-Options`. Vercel adds HSTS on its domains by default.
Fix: add a `headers` block in `vercel.json` or `next.config.js`.

### VERCEL-003 · .vercel/ committed · low
Usually only project IDs. If `.vercel/.env.*` files were pulled into it, treat them as COMMON-003.

### VERCEL-004 · Preview deployments use production data · medium
Previews built from any branch use the same Supabase project and keys as production, so a PR branch with a bug, or a malicious contributor's code, runs against real user data. Signs in code: a hard-coded prod URL, or no separate preview env. Live: the same env var names scoped to both Preview and Production with a service key.
Fix: a separate Supabase project (or branch) for Preview, and Production-only scope for secrets.

### VERCEL-005 · Preview deployments are public · medium (live)
With Deployment Protection off, anyone who finds a preview URL (from GitHub PR comments or a search engine) can use unreleased features and debug endpoints.
Fix: Settings → Deployment Protection → Vercel Authentication on for Previews (free on Hobby).

### VERCEL-006 · Open proxy rewrite · medium
`rewrites` with an external `destination` that forwards attacker-controlled paths or parameters. It can proxy to internal APIs under your domain, or bypass the CORS and auth assumptions of the upstream.

### VERCEL-007 · Long-running public functions · low
A high `maxDuration` on unauthenticated routes multiplies the cost of abuse.

### VERCEL-008 · Vercel storage token in the browser · high
`BLOB_READ_WRITE_TOKEN`, KV REST tokens or Postgres URLs behind a public prefix let anyone read, write or delete your storage. Fix: rotate the token, and use client uploads via `handleUpload` with server-side `onBeforeGenerateToken` auth.
