# Eval results

Fixture: `evals/fixtures/next-supabase-vuln`, a Next.js 14 + Supabase + Vercel app with 18 files and **24 planted issues** (listed in `expected.json`). All runs were headless `claude -p` runs with `--offline`, with costs at API list price as reported by Claude Code (`total_cost_usd`).

Scoring (`scripts/eval.mjs`): a hit means a **confirmed** finding with the expected check ID in the expected file. Recall is the share of planted issues confirmed. Precision is the share of confirmed findings that match a planted issue. All rows below were re-scored against the current 24-issue list. An earlier version expected `SUPA-110` on the admin module, which contradicts the `SUPA-006` filing rule added in v0.1.1.

| # | Mode | Session model | Plugin version | Agents | Recall | Precision | Confirmed (crit/high/med/low) | Tokens in / out | Cost | Model time* |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | quick | Opus 5.5 | 0.1.0 | 4 haiku verifiers | 75% | 95% | 19 (4/7/7/1) | not captured | not captured | not captured |
| 2 | quick | Opus 5.5 | 0.1.0 | 4 haiku verifiers | 71% (79% incl. needs-validation) | 94% | 18 (4/7/5/2) | 1.13M / 79k | $0.58 | 7.0 min |
| 3 | default | Opus 5.5 | 0.1.0 | haiku recon, sonnet hunter, 3 sonnet verifiers | 92% | 96% | 23 (6/10/6/1) | 0.92M / 31k | $0.77 | 4.6 min |
| 4 | default | Opus 5.5 † | 0.1.0 | same as #3 | 79% | 90% | 21 (7/8/5/1) | 0.94M / 32k | $0.80 | 4.7 min |
| 5 | default | Sonnet 5.5 | 0.1.0 | same as #3 | 79% | 90% | 21 (6/6/8/1) | 0.91M / 32k | $0.58 | 4.8 min |
| 6 | default | Sonnet 5.5 | 0.1.1 ‡ | same as #3 | 92% | 96% | 23 (5/11/7/0) | 1.56M / 37k (2 runs) | $0.81 (2 runs) | 6.6 min |
| 7 | default | **Sonnet 5.5** | **0.1.1** | same as #3 | **88%** | **100%** | 21 (5/8/7/1) | 0.84M / 33k | **$0.59** | 3.8 min |

\* Summed API time across the orchestrator and all subagents (`duration_api_ms`). Parallel agents make wall-clock time shorter.
† Run 4 tested a `model: sonnet` override in the skill frontmatter. It did not lower cost, because Opus still handled the surrounding turns, so it was reverted. Use `claude --model sonnet` instead.
‡ In run 6 the orchestrator called `ScheduleWakeup` with the audit command as a "heartbeat" while it waited for verifiers. The wake-up re-ran the whole audit as an incremental second run, so the session cost covers both. Since 0.1.1 the guard blocks scheduling tools during an audit. Run 7 is the same configuration with that fix: one run, one cost.

## What changed in 0.1.1
- **Filing rules:** checklist entries can carry a **File as** note. The SUPA-006 / SUPA-110 rule says a client component importing the admin client is `SUPA-006` at the import line, while `SUPA-110` is only for a latent risk with no client importer. The verifier may correct `checkId`, `file` and `line`, and `merge.mjs` now keeps those corrections.
- **The guard blocks `ScheduleWakeup`, `CronCreate` and `RemoteTrigger` during an audit.**
- **Incremental runs carry hardening notes forward**, not just findings.

## Observations
- **The deterministic phase is free.** detect, prescan and ledger produced 36 leads in under a second with zero model tokens. Every quick-mode finding started as one of these leads.
- **About 87–90% of input tokens were prompt-cache reads.**
- **The session model is the biggest cost lever.** On Opus, the orchestrator was about 40% of the cost while doing only dispatch work. A sonnet session found the same issues for about 25% less.
- **Hunters add what regexes can't.** Default mode confirmed the service-role key reaching the browser through a transitive import, middleware matcher gaps, and the `pull_request_target` + PR-head checkout + token exfiltration chain.
- **Variance is real.** Default-mode recall across runs 3–7 ranged from 79% to 92%. Compare runs by ranges, not single numbers.
- **Remaining misses** are mostly merged root causes. `SUPA-007` (missing `search_path`) gets folded into the `SUPA-105` finding for the same function, and `SUPA-011` (service role plus wildcard CORS) into `COMMON-022` (an open email endpoint). The issues are reported, but under one ID.
- **The guard held.** Each run had exactly one denial: the orchestrator tried to chain scripts with `&&`, was blocked, and retried them one at a time. No writes reached the fixture.
