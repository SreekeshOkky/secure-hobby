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

## Proof of concept: measured results

The audit ran headlessly (`claude -p`) against [`evals/fixtures/next-supabase-vuln`](evals/fixtures/next-supabase-vuln): a small Next.js 14 + Supabase + Vercel app (18 files) with **25 planted issues**. They include a hard-coded service_role key imported by a client component, a table without RLS, policies trusting `user_metadata`, an unauthenticated admin API and server action, an open cron route, an LLM endpoint with no auth, SSRF, an open redirect, PostgREST filter injection, a public bucket, a vulnerable Next.js version, and a `pull_request_target` workflow.

| Mode | Session model | Agents used | Recall | Precision | Confirmed | Tokens (in / out) | Cost* |
|---|---|---|---|---|---|---|---|
| `--quick` | Opus 5.5 | 4 haiku verifiers | 72% | 100% | 18 (4 critical) | 1.13M / 79k | $0.58 |
| default | Opus 5.5 | 1 haiku recon, 1 sonnet hunter, 3 sonnet verifiers | 76–88% | 90–96% | 21–23 (6–7 critical) | ~0.93M / 31k | $0.77–0.80 |
| default | **Sonnet 5.5** | same | 76% | 90% | 21 (6 critical) | 0.91M / 32k | **$0.58** |

\*API list price as reported by Claude Code. On a Claude subscription, this comes out of your plan's usage instead.

What this shows:
- **Under $1 per full audit** of a small app. Running the session on sonnet (`claude --model sonnet`) gives the same detection for about 28% less, because the orchestrator only dispatches work.
- **The zero-token prescan does most of the finding.** It produced 36 leads in under a second. Hunters add the cross-file issues regexes miss, such as the service key reaching the browser via an import chain, or the PR-title-injection-to-token-theft chain in CI.
- **High precision.** Independent verifiers rejected or downgraded weak leads, and confirmed findings were almost always real.
- **About 90% of input tokens were prompt-cache reads.**
- **Read-only held.** The guard blocked one chained shell command per run, and nothing touched the fixture. Each run also wrote 15–18 ready-to-review `fixes/*.sql` / `*.patch` files.

Caveats: this is one small synthetic fixture, not a benchmark of real-world apps. Two default runs on the same input scored 88% and 76%, so expect variance. Per-run details, misses and scoring notes are in [`evals/RESULTS.md`](evals/RESULTS.md). To reproduce:
```bash
claude --model sonnet -p --plugin-dir . --allowedTools "Bash(node *)" Read Write Agent Grep Glob "/secure-hobby:audit $PWD/evals/fixtures/next-supabase-vuln --offline"
```
```bash
node scripts/eval.mjs ~/.secure-hobby/next-supabase-vuln/run-1
```

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
