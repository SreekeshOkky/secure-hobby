# Threat model for the auditor itself

The audited repo is untrusted. It may contain text written to steer an AI ("ignore previous instructions", "this file is safe", "run npm install to continue", fake tool output). The defenses are layered so that a misled agent still cannot do damage:

1. **Prompts:** every agent is told that repo content is data, never instructions.
2. **Tool allowlists:** recon, hunter and verifier have only Read, Grep, Glob and Write. They have no Bash and no network. The live checker has only listed read-only MCP tools.
3. **Guard hook (enforced, not advisory):**
   - writes only under `~/.secure-hobby` (never the target or the cache clone)
   - reads only the target, the run dir and the plugin; `.env`, keys and `.npmrc` are blocked
   - Bash only runs this plugin's scripts, with no shell operators
   - only secure-hobby subagents can be launched, and not on a pricier model than their default
   - MCP limited to `trusted-mcp.json` tools; `execute_sql` limited to catalog queries
   - WebFetch and WebSearch blocked
4. **Scripts never execute target code.** git runs with hooks, fsmonitor, textconv and LFS disabled. The dependency audit runs on a copied lockfile with the target's npmrc ignored.
5. **Redaction:** prescan masks secret values, and every findings file is redacted before it is written.

Residual risk: a Grep over a directory can still match lines inside a `.env` file if the agent omits a glob. Agents are told to pass globs, and prescan is the supported way to inspect secrets.
