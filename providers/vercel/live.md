# Vercel live checks (official Vercel MCP, read-only tools only)

1. `list_teams`, then `list_projects`: find the project matching the repo name or the `name` in `package.json`. If unsure, list the candidates and stop: never guess.
2. `get_project`: inspect what the response includes:
   - Deployment protection for previews (`ssoProtection`, `passwordProtection` or similar fields). Missing or null → VERCEL-005, confirmed.
   - If env var **names and targets** are included: a secret-looking name (SERVICE_ROLE, SECRET, TOKEN) scoped to `preview` as well as `production` → VERCEL-004, needs_validation. **Never request or record env var values.**
   - Framework and Node version, for context only.
3. `list_deployments` (limit 5): note whether preview deployments exist (production-only projects reduce VERCEL-004/005 impact).

If a field you need is not in the tool response, report a needs_validation finding that names the dashboard setting to check, instead of guessing.
