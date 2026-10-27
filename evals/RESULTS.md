# Eval results

Fixture: `evals/fixtures/next-supabase-vuln`, a Next.js 14 + Supabase + Vercel app with 18 files and **25 planted issues** (listed in `expected.json`). All runs were headless `claude -p` runs with `--offline`, with costs at API list price as reported by Claude Code (`total_cost_usd`).

Scoring (`scripts/eval.mjs`): a hit means a **confirmed** finding with the expected check ID in the expected file. Recall is the share of planted issues confirmed. Precision is the share of confirmed findings that match a planted issue.

| # | Date | Mode | Session model | Agents | Recall | Precision | Confirmed (crit/high/med/low) | Tokens in / out | Cost | Model time* |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-27 | quick | Opus 5.5 | 4 haiku verifiers | 73% | 84% | 19 (4/7/7/1) | not captured | not captured | not captured |
| 2 | 2026-10-27 | quick | Opus 5.5 | 4 haiku verifiers | 72% (80% incl. needs-validation) | 100% | 18 (4/7/5/2) | 1.13M / 79k | $0.58 | 7.0 min |
| 3 | 2026-10-27 | default | Opus 5.5 | haiku recon, sonnet hunter, 3 sonnet verifiers | **88%** | **96%** | 23 (6/10/6/1) | 0.92M / 31k | $0.77 | 4.6 min |
| 4 | 2026-10-27 | default | Opus 5.5 † | same as #3 | 76% | 90% | 21 (7/8/5/1) | 0.94M / 32k | $0.80 | 4.7 min |
| 5 | 2026-10-27 | default | **Sonnet 5.5** | same as #3 | 76% | 90% | 21 (6/6/8/1) | 0.91M / 32k | **$0.58** | 4.8 min |

\* Summed API time across the orchestrator and all subagents (`duration_api_ms`). Parallel agents make wall-clock time shorter.
† Run 4 tested a `model: sonnet` override in the skill frontmatter. It did not lower cost, because Opus still handled the surrounding turns, so the override was reverted. Use `claude --model sonnet` instead (run 5).

## Observations
- **The deterministic phase is free.** detect, prescan and ledger produced 36 leads in under a second with zero model tokens. Every quick-mode finding started as one of these leads.
- **About 90% of input tokens were prompt-cache reads.** Briefs and checklists are re-read cheaply.
- **The session model is the biggest cost lever.** In runs 3–4, the Opus orchestrator was about 40% of the cost while doing only dispatch work. A sonnet session gave the same detection for 28% less.
- **Hunters add what regexes can't.** Default mode confirmed a service-role key reaching the browser through a transitive import, middleware matcher gaps, and the `pull_request_target` + PR-head checkout + token exfiltration chain.
- **Variance is real.** Two default runs on the same input scored 88% and 76% recall. Compare runs by ranges, not single numbers.
- **Known scoring gaps.** The hunter repeatedly filed the "client component imports the admin client" issue as `SUPA-110` (on the component) instead of `SUPA-006`. It found the issue but used the wrong ID, which counts as both a miss and an unexpected finding. It also sometimes merged related migration issues (`SUPA-007` into `SUPA-105`) into one root-cause finding.
- **The guard held.** Each run had exactly one denial: the orchestrator tried to chain scripts with `&&`, was blocked, and retried them one at a time. No writes reached the fixture.
