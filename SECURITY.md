# Security policy

## Supply chain
- No npm dependencies and no install or postinstall scripts. Everything is plain Node standard library.
- MCP servers are never auto-installed. `trusted-mcp.json` pins the local Supabase MCP to an exact version (`0.13.0`) and prefers the providers' hosted, OAuth-based official endpoints.
- Changes to `hooks/guard.mjs`, `trusted-mcp.json` or `scripts/sql.mjs` are security-sensitive. Review them like auth code, and add a test in `tests/guard.test.mjs` or `tests/sql.test.mjs` for every new allow rule.

## Reporting a vulnerability in secure-hobby
If you find a way to make an audit write to the target, execute target code, reach the network, leak a secret value into a report, or call a non-allowlisted MCP tool, please report it privately (GitHub Security Advisories on this repo) rather than in a public issue.

## Reports are sensitive
`REPORT.md` lists exploitable weaknesses in the audited app. Run directories are created `0700` with `0600` files. Do not commit them or share them before the fixes are deployed.
