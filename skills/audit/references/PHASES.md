# Phases and artifacts

All files live in `~/.secure-hobby/<repo>/run-N/` (dir 0700, files 0600).

| Phase | Who | Model | Reads | Writes |
|---|---|---|---|---|
| 0 start | run.mjs | none | args | run.json, `~/.secure-hobby/.active/<session>.json` |
| 1a detect | detect.mjs | none | target tree, package.json | inventory.json, summary.md |
| 1b prescan | prescan.mjs | none | pack rules + analyzers, git log, lockfile | leads.json, leads.md, deps/ |
| 1c ledger | ledger.mjs | none | inventory, leads, prior run | coverage-ledger.json, briefs/recon.json, briefs/h*.json, briefs/live.json |
| 2 recon | recon agent | haiku | summary.md, leads.md, a few entry files | architecture.md |
| 3 hunt | hunter agents (≤ 6, parallel) | sonnet | brief, checklists, unit files | candidates/h*.json |
| 4 live | live-checker | haiku | live.md, trusted MCP tools | live/findings.json |
| 5a queue | merge.mjs candidates | none | candidates, leads not covered by hunters, accepted.json | queue.json, briefs/v*.json |
| 5b verify | verifier agents | sonnet (opus for critical with --deep, haiku with --quick) | brief, cited files | verdicts/v*.json |
| 6 findings | merge.mjs findings + validate | none | verdicts, live, prior findings | findings.json |
| 7 report | render-report.mjs | none | findings.json | REPORT.md, fixes/*.patch, fixes/*.sql |

Modes:
- `--quick`: no recon or hunters. Prescan leads go straight to haiku verifiers.
- default: high-priority surfaces, plus low-priority units that have a lead.
- `--deep`: every surface, plus opus verifiers for critical candidates.

Incremental: units whose hash (file contents + pack version) matches the prior run are `unchanged`. They are not hunted, and their findings are carried forward.

Guard log: every deny, and every Bash or MCP allow, is appended to `guard.log`.
