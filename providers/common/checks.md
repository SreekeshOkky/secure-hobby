# Common checks (every hunter loads these)

Report only issues with a concrete attacker path. Use the check ID that fits best. Use `COMMON-099` for a real issue with no matching ID.

### COMMON-001 · Committed secret · critical/high
Look for API keys, private keys, database URLs with passwords, or service tokens in tracked files. The prescan has already found them with values masked: **do not open .env files**, use the lead.
Confirm: the file is committed, or deployed in a bundle. Severity follows what the key can do. A Supabase anon key or a Firebase web config is public by design: not a finding.
Fix: rotate the key at the provider first, then move it to an environment variable. Deleting the line does not un-leak it.

### COMMON-002 · Secret in git history · critical/high
Same as COMMON-001, but the value only survives in an old commit. Fix: rotate. Optionally rewrite history with `git filter-repo`, but rotation is what matters.

### COMMON-003 · .env file committed · high
Fix: `git rm --cached <file>`, add it to `.gitignore`, rotate every value in it.

### COMMON-010 · XSS through raw HTML · medium/high
`dangerouslySetInnerHTML`, `{@html}`, `v-html`, `innerHTML` fed with user-controlled data (comments, profile fields, markdown) without DOMPurify or an equivalent sanitizer.
Not a finding: static strings, or content only the site owner can write.

### COMMON-011 · SSRF · medium/high
A server-side fetch whose URL comes from the request. High when it can reach cloud metadata (`169.254.169.254`) or internal services, or when it forwards auth headers.
Fix: allowlist hosts, reject private IP ranges, never forward credentials.

### COMMON-012 · Open redirect · medium
`redirect(next)` where `next` comes from the query, common in auth callbacks. Lets attackers send users to phishing pages that look like they came from your domain.
Fix: accept only relative paths (`next.startsWith('/') && !next.startsWith('//')`).

### COMMON-013 · Wildcard CORS · low/medium
`*` is fine for public, unauthenticated, read-only data. It is a finding when combined with credentials or cookie auth, or when the endpoint performs privileged actions with a server key.

### COMMON-014 · Injection via string-built queries · high
Raw SQL with `${}` interpolation, `$queryRawUnsafe`, or a **PostgREST filter injection**: `supabase.from(t).select().or(\`name.ilike.%${q}%\`)`. User input can add filters such as `,owner_id.neq.x` and widen the query. Severity depends on RLS: with good RLS, impact is limited to the user's own rows.
Fix: parameterized queries, or escape and validate before building `.or()` strings. Prefer `.ilike('name', \`%${q}%\`)`.

### COMMON-015 · Dynamic code / shell execution · medium/critical
`eval`, `new Function` or `child_process` reachable with request data. Critical if user input reaches it.

### COMMON-016 · Unrestricted file upload · medium
An upload with no size or type limit, written to a public bucket or served from your domain (stored XSS through HTML or SVG uploads).

### COMMON-020 · Denial of wallet: LLM / paid API endpoint · medium/high
A public route that calls OpenAI, Anthropic or another paid API with your key, with no auth and no rate limit. Anyone can script it and run up your bill. This is high on pay-as-you-go keys.
Fix: require auth, add per-user rate limiting (Upstash Ratelimit or a Supabase table), cap `max_tokens`, set provider spend limits.

### COMMON-021 · AI key shipped to the browser · high
`NEXT_PUBLIC_*OPENAI*`, `VITE_*`, `PUBLIC_*`, or `dangerouslyAllowBrowser: true`. The key ends up in the JS bundle. Fix: proxy through a server route with auth, and rotate the key.

### COMMON-022 · Abuse of email/SMS/paid side effects · medium
A public endpoint that sends email or SMS, or triggers other paid work, with no auth, captcha or rate limit. It can be used to spam people from your domain and burn your quota.

### COMMON-030 · Vulnerable dependency · varies
From npm audit / osv-scanner. Confirm the vulnerable feature is used. Example: a Next.js middleware bypass matters only if auth lives in middleware. Fix: upgrade to the fixed version.

### COMMON-040 · pull_request_target workflow · medium/high
High if the job checks out `github.event.pull_request.head.sha/ref` and runs it with secrets or a write token.

### COMMON-041 · Workflow script injection · medium/high
`${{ github.event.pull_request.title }}` (or body, branch name and similar) used inside `run:`. A malicious PR title becomes shell code. Fix: pass it through `env:` and quote `"$TITLE"`.

### COMMON-042 · Unpinned third-party action · low (hardening)
Pin to a full commit SHA.

### COMMON-050 · Sensitive data in logs · low
Tokens, passwords or full user records sent to `console.log` in server code. Vercel and Supabase logs are visible to every project member.
