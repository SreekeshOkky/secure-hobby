# SvelteKit checks

Key facts:
- `$env/static/public` and `$env/dynamic/public` (`PUBLIC_*`) ship to the browser. `$env/*/private` and `$lib/server` are server-only, and the build enforces that.
- `+server.ts` exports and `+page.server.ts` `actions` are public HTTP endpoints. A layout `load` check does **not** protect actions or endpoints.
- With `@supabase/ssr`, `hooks.server.ts` should expose `safeGetSession()` (which calls `getUser()`). A bare `getSession()` is SUPA-101.

### SVELTE-001 · Secret behind PUBLIC_ · high/critical
Fix: rename it to a private variable, import it from `$env/static/private` in server code only, and rotate the key.

### SVELTE-002 · Endpoint without auth · medium/high
A `+server.ts` handler returns or changes data, especially with a service-role client, without checking `locals.safeGetSession()` or `locals.user`. Check ownership of any `params.id` (IDOR).

### SVELTE-003 · Form actions without auth · medium/high
Each named action in `export const actions` must check the user itself. Layout guards do not run for direct POSTs to `?/actionName`.

### SVELTE-004 · Path guard gaps in hooks.server · medium
`if (event.url.pathname === '/admin')` misses `/admin/users`. `startsWith('/admin')` also matches `/administrator`, which is usually harmless. Check that every protected route is covered, or better, check in each `load`/action.

### SVELTE-005 · Over-returning from server load · medium
`+page.server.ts` `load` returns whole rows (emails, tokens, internal fields). Everything returned is serialized into the page.

### SVELTE-006 · CSRF protection disabled · medium
`kit.csrf.checkOrigin: false` re-enables cross-site form posts against cookie-authenticated actions.
