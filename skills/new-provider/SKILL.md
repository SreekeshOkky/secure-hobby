---
name: new-provider
description: Scaffold a new secure-hobby provider pack (for example firebase, netlify, cloudflare-pages, astro) from the template, then fill in detection, surfaces, checks and prescan rules for it.
argument-hint: <id> <PREFIX> [--kind platform|framework]
disable-model-invocation: true
---

# Add a provider pack

1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.mjs $ARGUMENTS` (for example `firebase FIRE --kind platform`).
2. Read `${CLAUDE_PLUGIN_ROOT}/providers/_template/README.md` for the contract, and one existing pack (`providers/supabase/`) as a reference.
3. Fill in the new pack:
   - `provider.json`: `detect` (config files, deps), and `surfaces` with `priority`. Mark broad surfaces `low` so default runs stay cheap.
   - `checks.md`: 5–15 checks, each with look for / confirm / not a finding / fix. Start with what is public by design on this platform.
   - `prescan.json`: regex rules for the checks a pattern can catch.
   - `analyzers.mjs` only if a rule needs parsing (for example Firestore rules).
   - `live.md` plus a `trusted-mcp.json` entry only for an **official**, read-only MCP server, with an explicit tool allowlist.
4. Add `evals/fixtures/<id>-vuln` and `<id>-clean`, list the planted check IDs in `evals/expected.json`, and run `npm test` from the plugin root.

No other file needs changing: detection, prescan, ledger and verification discover packs automatically.
