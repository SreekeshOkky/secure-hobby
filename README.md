# secure-hobby

A Claude Code plugin that checks whether your hobby or POC app on free tiers is safe to share: **Vercel + Supabase** today, with Next.js, Vite SPAs and SvelteKit, and more platforms through drop-in provider packs.

It reads your code and **never changes it**. A hook enforces this, not just prompts.

```
/secure-hobby:audit ./my-app                 # default
/secure-hobby:audit https://github.com/me/app --quick
/secure-hobby:audit ./my-app --deep --live   # + read-only checks of the live Supabase/Vercel config
```

The output lands in `~/.secure-hobby/<repo>/run-N/REPORT.md`, with ready-to-review `fixes/*.sql` and `fixes/*.patch`. Nothing is applied for you.

## Install

```bash
claude plugin marketplace add <owner>/secure-hobby
```
```bash
claude plugin install secure-hobby@secure-hobby
```
For local development, use `claude --plugin-dir /path/to/secure-hobby`. It needs Node 18 or newer and has no npm dependencies.

## What it finds (examples)

| Area | Checks |
|---|---|
| Supabase | tables without RLS, `using (true)` write policies, `user_metadata`-based admin, service_role key in the browser, SECURITY DEFINER without `search_path` / exposed via RPC, views bypassing RLS, public buckets, `verify_jwt = false`, `getSession()` trusted on the server, wildcard redirect URLs |
| Vercel | cron routes without `CRON_SECRET`, preview deployments on prod data, public previews (live), storage tokens behind `NEXT_PUBLIC_`, missing headers |
| Next.js / SvelteKit / Vite | routes, server actions and form actions without auth, secrets behind `NEXT_PUBLIC_`/`PUBLIC_`/`VITE_`, middleware bypass (CVE-2025-29927), client-only admin gates, source maps |
| Everywhere | committed secrets and secrets in **git history** (masked, with "rotate it"), `.env` committed, XSS, SSRF, open redirect, PostgREST `.or()` filter injection, **denial-of-wallet** (open LLM endpoints, AI keys in the client), GitHub Actions `pull_request_target` / script injection, vulnerable dependencies |

The Supabase anon key and the Firebase web config are treated as **public by design**. The report focuses on what the backend lets those keys do.

## How it works

```
 run.mjs start ─► detect.mjs ─► prescan.mjs ─► ledger.mjs        (scripts: 0 model tokens)
                                    │              │
                                    ▼              ▼
                              leads.json     coverage-ledger + briefs
                                                   │
          recon (haiku) ─► hunters ×≤6 (sonnet, parallel) ─► [live-checker (haiku, --live)]
                                                   │
                     merge.mjs candidates ─► verifiers (sonnet; opus for criticals in --deep)
                                                   │
              merge.mjs findings ─► validate ─► render-report.mjs   (scripts: 0 model tokens)
```

**Token and cost controls**
- Deterministic first: inventory, provider detection, regex and SQL analysis, secrets, git history and dependency audit all run as scripts. Models only see the **leads** and the **units** that matter.
- Only detected packs load. A Next + Supabase repo never reads the SvelteKit checklist.
- Surfaces have priorities. `low` surfaces (all pages, all client components) are hunted only if a lead points there, or with `--deep`.
- Thin orchestrator: each agent gets a brief **file path**, not pasted code, and returns a one-line `DONE`.
- Independent verification runs only for medium+ candidates. Low and info go straight to hardening notes.
- Incremental: unchanged units (by content hash) are not re-hunted, and their verdicts carry over. Accepted risks are never re-verified.
- Cost gate: on big repos (more than 2k source files or 1.5 MB to hunt) it shows an estimate and asks first.
- The guard rejects attempts to run a subagent on a pricier model than its default. Only `--deep` verifiers may use opus.

| Mode | Agents | Typical use |
|---|---|---|
| `--quick` | haiku verifiers on prescan leads only | before every deploy |
| default | 1 haiku recon + 1–6 sonnet hunters + sonnet verifiers | first audit, after big changes |
| `--deep` | as default, plus all low-priority surfaces, plus opus for criticals | before launch / going public |

## Guardrails

`hooks/guard.mjs` runs on every tool call, but is active **only while an audit runs** in that session (or when the caller is one of this plugin's subagents):

| Tool | Allowed during an audit |
|---|---|
| Read / Grep / Glob | target, run dir and plugin only. `.env*`, keys, `.npmrc` and credentials are denied (prescan reads them and masks values). |
| Write / Edit | `~/.secure-hobby/` only. Never the target, the cache clone or the guard markers. |
| Bash | `node <plugin>/scripts/*.mjs` only. No `;`, `|`, `&&`, `$()` or redirects. Target code is never executed. |
| Agent | `secure-hobby:*` subagents only, at or below their default model |
| MCP | servers and tools listed in `trusted-mcp.json` only, only with `--live`. Mutating tools are always denied, and `execute_sql` is limited to catalog queries. |
| WebFetch / WebSearch | denied |

The scripts are equally careful. git runs with hooks, fsmonitor, textconv and LFS disabled, and cloning uses `--depth` with no submodules. `npm audit` runs on a copied lockfile with the target's `.npmrc` ignored. Every findings file is redacted before it is written. The run dir is `0700` and its files `0600`. Denials go to `guard.log`.

## Live checks (optional)

`/secure-hobby:connect` prints the commands to add the **official** Supabase MCP (hosted, `read_only=true`, scoped to one project) and the **official** Vercel MCP. You run them; nothing is installed automatically. With `--live`, a haiku agent runs Supabase's own security advisors, lists RLS status, buckets and policies (catalog SQL only), and checks Vercel preview protection. Differences from the code are reported as **drift**.

## Adding a platform (Firebase, Netlify, Cloudflare Pages, …)

```
/secure-hobby:new-provider firebase FIRE --kind platform
```
A pack is a folder in `providers/` with `provider.json` (detect + surfaces), `checks.md`, `prescan.json`, an optional `analyzers.mjs` and an optional `live.md`. The core discovers it with no other edits. See `providers/_template/README.md`.

## Accepting a risk

```bash
node <plugin>/scripts/run.mjs accept ~/.secure-hobby/<repo>/run-N F-003 "bucket is intentionally public"
```

## Development

```bash
npm test
```
`npm test` covers the guard, prescan recall on the fixtures, catalog-only SQL, the full pipeline with simulated agents, the incremental re-run, and git history. To score a real run against `evals/expected.json`:
```bash
node scripts/eval.mjs ~/.secure-hobby/next-supabase-vuln/run-1 --append
```

## Limits

This is automated review. It cannot see dashboard-only settings without `--live`, it does not run your app, and it can miss logic bugs. Treat a clean report as a floor, not a guarantee. Credit: the phase structure and "the agent that found it never verifies it" rule are inspired by [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill).
