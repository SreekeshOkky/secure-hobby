# Writing a provider pack

A pack is a folder under `providers/`. The core discovers it automatically. Nothing else needs editing.

| File | Purpose |
|---|---|
| `provider.json` | `detect` (files, globs, deps, unlessDeps), `surfaces` (what hunters read), `checkPrefix`, optional `analyzers` and `live` |
| `checks.md` | One section per check ID: look for / confirm / not a finding / fix. This is the only text hunters and verifiers load for your pack, so keep it tight. |
| `prescan.json` | Zero-token regex rules: `files` or `surface`, `pattern`, optional `contains` (file must match), `absent` (file must not match), `scope: "file"`, `exclude`. Also `type: "dep-version"` with `package` and `ranges`. |
| `analyzers.mjs` (optional) | `export default function analyze(ctx)` for logic regex can't express. `ctx` gives `read(rel)`, `files`, `provider.surfaces`, `sql`, `tracked`, `lead({...})`. Read-only: never write or spawn. |
| `live.md` (optional) | Read-only MCP calls for the live checker. Add the server to `trusted-mcp.json` with an explicit tool allowlist. |

Surface `priority`: `high` is always hunted, while `low` is hunted only in `--deep` or when a prescan lead lands in it. Most of the cost-tuning happens here.

Example: Firebase
- detect: `firebase.json`, `firestore.rules`, deps `firebase`, `firebase-admin`
- surfaces: `rules` (`firestore.rules`, `storage.rules`, `database.rules.json`), `functions` (`functions/src/**`)
- prescan: `allow read, write: if true;`, `allow write: if request.auth != null;` without an owner check
- note in checks.md: the web `apiKey` is public by design. Security is in the rules.

Add an eval fixture under `evals/fixtures/<name>-vuln` and `<name>-clean`, and list the planted check IDs in `evals/expected.json`.
