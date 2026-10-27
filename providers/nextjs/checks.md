# Next.js checks

Key facts:
- Anything referenced as `process.env.NEXT_PUBLIC_*` is inlined into the browser bundle at build time.
- Route handlers (`app/**/route.ts`, `pages/api/**`) and **server actions** (`'use server'` exports) are public HTTP endpoints. Server actions are callable with a POST even if no UI renders the form.
- Middleware is not a security boundary on its own (CVE-2025-29927, matcher gaps). Re-check auth where the data is accessed.
- A `'use client'` file, and everything it imports, ships to the browser.

### NEXT-001 · Secret in NEXT_PUBLIC_ variable · high/critical
A name like `NEXT_PUBLIC_*SECRET*`, `*SERVICE_ROLE*` or `*PRIVATE*`. Severity follows what the key grants. Mapbox or analytics public tokens are fine.
Fix: rename without the prefix, use it only on the server, and rotate the key.

### NEXT-002 · Route handler without authentication / authorization · medium/high
The handler reads or changes data (especially with the service-role client) without `supabase.auth.getUser()` or an equivalent. Also flag **IDOR**: an auth check exists, but the handler uses a request-supplied `id`/`userId` without checking ownership.
Not a finding: public read-only data, health checks, webhooks that verify a signature (Stripe `constructEvent`).

### NEXT-003 · Server action without auth · medium/high
Every exported async function in a `'use server'` file is an endpoint. Check that each one verifies the user **inside the action** and authorizes the specific row. A check on the page that renders the form does not protect the action.

### NEXT-004 · Middleware-only auth / bypass · high
Auth enforced only in `middleware.ts` while Next.js is below 14.2.25 / 15.2.3 (header bypass), or the `matcher` misses routes (for example `/api` is excluded, or there is no trailing `/:path*`), or `getSession()` is used. Confirm the protected data has no second check.

### NEXT-005 · Production source maps · low
The original source is downloadable. Not a vulnerability on its own, but it makes finding others easier.

### NEXT-006 · Server-only code imported into the client · high
A `'use client'` component imports a module that reads private env vars or creates an admin client. Next.js inlines only `NEXT_PUBLIC_` values, so the code usually breaks rather than leaks. But a hard-coded key, or a value passed down as a prop, does leak. Fix: `import 'server-only'` in sensitive modules.

### NEXT-007 · Over-fetching into client props · medium
Server components, `getServerSideProps` or `generateMetadata` pass whole rows (emails, tokens, internal flags) to client components. Everything serialized as props is visible in the page source.

### NEXT-008 · Wildcard image remotePatterns · low
`/_next/image` becomes a free image proxy for any host (denial of wallet on image optimization quotas).

### NEXT-009 · Unvalidated input to dangerous sinks · medium
`redirect()` or `NextResponse.redirect()` with query input (see COMMON-012), `revalidatePath` with user input, `cookies().set` of request data without validation.

### NEXT-010 · Next.js / React Server Components RCE · critical
Next.js 15.x / 16.x before the patched releases is affected by CVE-2025-55182 (App Router). Fix: upgrade to the latest patch release for your minor version.
