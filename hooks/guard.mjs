#!/usr/bin/env node
// PreToolUse guard. Enforces the read-only contract while an audit is running.
// It is active only when ~/.secure-hobby/.active/<session>.json exists (written by
// run.mjs start) or when the caller is one of this plugin's subagents, so normal
// Claude Code use is untouched.
//
//   Read/Grep/Glob   only inside the target, ~/.secure-hobby or the plugin; never secret files
//   Write/Edit       only inside ~/.secure-hobby (not the cache clone, not markers)
//   Bash             only `node <plugin>/scripts/<x>.mjs ...`, no shell operators
//   Agent/Task       only secure-hobby subagents, never a pricier model than the agent's default
//   mcp__*           only servers/tools in trusted-mcp.json, only with --live, SQL catalog-only
//   WebFetch/Search  blocked
// Fails closed: any guard error while active denies the call.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ACTIVE, PLUGIN_ROOT, readJSON, insideDir, realpathOrResolve, isMain } from '../scripts/lib.mjs';
import { catalogOnlyViolation } from '../scripts/sql.mjs';

const STALE_MS = 6 * 3600 * 1000;
const SECRET_FILE = /(^|\/)(\.env(\.(?!(?:example|sample|template|dist|defaults)$)[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|id_(?:rsa|ed25519|ecdsa|dsa)|credentials(?:\.json)?|service[-_]?account[\w.-]*\.json|[\w.-]+\.(?:pem|key|p12|pfx|keystore|jks))$/i;
const READ_TOOLS = { Read: 'file_path', Grep: 'path', Glob: 'path', LS: 'path' };
const WRITE_TOOLS = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);
const AGENT_DEFAULT_MODEL = { recon: 'haiku', hunter: 'sonnet', verifier: 'sonnet', 'live-checker': 'haiku' };
const MODEL_COST = { haiku: 1, sonnet: 2, opus: 3 };

const allow = (reason) => ({ decision: 'allow', reason });
const deny = (reason) => ({ decision: 'deny', reason: `secure-hobby guard: ${reason}` });

function readMarker(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - Date.parse(m.started) > STALE_MS) { fs.rmSync(file, { force: true }); return null; }
    return m;
  } catch { return null; }
}
function newestMarker() {
  try {
    return fs.readdirSync(ACTIVE).map((f) => readMarker(path.join(ACTIVE, f))).filter(Boolean)
      .sort((a, b) => Date.parse(b.started) - Date.parse(a.started))[0] || null;
  } catch { return null; }
}

export function loadContext(input) {
  const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
  let marker = (sid && readMarker(path.join(ACTIVE, `${sid}.json`))) || readMarker(path.join(ACTIVE, '_global.json'));
  const ours = /^secure-hobby:/.test(String(input.agent_type || ''));
  if (!marker && ours) marker = newestMarker() || { runDir: null, target: null };
  if (!marker) return null;
  return {
    marker, ours,
    run: marker.runDir ? readJSON(path.join(marker.runDir, 'run.json'), {}) : {},
    target: marker.target ? realpathOrResolve(marker.target) : null,
    home: realpathOrResolve(HOME),
    plugin: realpathOrResolve(PLUGIN_ROOT),
    cwd: input.cwd || process.cwd(),
  };
}

function tokenize(cmd) {
  return [...cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

export function decide(tool, ti, ctx) {
  if (READ_TOOLS[tool]) {
    const abs = realpathOrResolve(path.resolve(ctx.cwd, ti[READ_TOOLS[tool]] || '.'));
    const inScope = [ctx.target, ctx.home, ctx.plugin].some((root) => root && insideDir(abs, root));
    if (!inScope) return deny(`${tool} outside the audit target (${abs}). Pass an explicit path inside ${ctx.target || 'the target'}.`);
    if (tool !== 'Glob' && SECRET_FILE.test(abs)) return deny('secret files are only read by prescan.mjs, which masks their values. Use leads.json.');
    if (tool === 'Grep' && SECRET_FILE.test(String(ti.glob || '').replace(/[*{}]/g, ''))) return deny('grepping secret files is blocked; use leads.json');
    return allow('read inside audit scope');
  }
  if (WRITE_TOOLS[tool]) {
    const abs = realpathOrResolve(path.resolve(ctx.cwd, ti[WRITE_TOOLS[tool]] || ''));
    if (!insideDir(abs, ctx.home)) return deny(`writes are limited to ${HOME}; the audited project is never modified (${abs})`);
    if (insideDir(abs, path.join(ctx.home, 'cache'))) return deny('the cloned target in the cache is read-only');
    if (insideDir(abs, path.join(ctx.home, '.active'))) return deny('guard markers cannot be edited');
    if (ctx.target && insideDir(abs, ctx.target)) return deny('the audited project is never modified');
    return allow('write inside run directory');
  }
  if (tool === 'Bash') {
    const cmd = String(ti.command || '').trim();
    if (/[;&|<>`$\\\n\r]/.test(cmd)) return deny('shell operators, substitutions and redirects are blocked during an audit');
    const [bin, script, ...rest] = tokenize(cmd);
    const scriptAbs = script ? realpathOrResolve(path.resolve(ctx.cwd, script)) : '';
    if (path.basename(bin || '') === 'node' && script && !script.startsWith('-') && scriptAbs.endsWith('.mjs')
      && insideDir(scriptAbs, path.join(ctx.plugin, 'scripts')) && rest.every((a) => !/^--(require|import|eval|loader)/.test(a))) {
      return allow('plugin script');
    }
    return deny(`only \`node "${path.join(PLUGIN_ROOT, 'scripts')}/<script>.mjs" ...\` may run during an audit. Target code is never executed.`);
  }
  if (tool === 'Agent' || tool === 'Task') {
    const type = String(ti.subagent_type || '');
    const m = /^secure-hobby:(recon|hunter|verifier|live-checker)$/.exec(type);
    if (!m) return deny('during an audit only secure-hobby subagents (recon, hunter, verifier, live-checker) may be launched');
    if (m[1] === 'live-checker' && !ctx.run.live) return deny('live checks were not requested (start the run with --live)');
    if (ti.model) {
      const want = MODEL_COST[ti.model];
      const base = MODEL_COST[AGENT_DEFAULT_MODEL[m[1]]];
      const deepOpus = ti.model === 'opus' && m[1] === 'verifier' && ctx.run.mode === 'deep';
      if (!want || (want > base && !deepOpus)) return deny(`model "${ti.model}" is more expensive than ${type}'s default; only --deep verifiers may use opus`);
    }
    return allow('secure-hobby subagent');
  }
  if (NETWORK_TOOLS.has(tool)) return deny('network tools are blocked during an audit; the code is the source of truth');
  if (tool.startsWith('mcp__')) {
    const trusted = readJSON(path.join(PLUGIN_ROOT, 'trusted-mcp.json'));
    if ((trusted.passthroughPrefixes || []).some((p) => tool.startsWith(p))) return {};
    const [, server, ...rest] = tool.split('__');
    const name = rest.join('__');
    const entry = Object.entries(trusted.servers).find(([id, s]) => (s.names || [id]).includes(server));
    if (!entry) return deny(`MCP server "${server}" is not in trusted-mcp.json`);
    if (!ctx.run.live) return deny('live checks were not requested (start the run with --live)');
    if (new RegExp(trusted.alwaysDeny).test(name)) return deny(`"${name}" can change your project, so it is always blocked`);
    const [, conf] = entry;
    if (!conf.allow.includes(name)) return deny(`"${name}" is not on the ${entry[0]} allowlist in trusted-mcp.json`);
    if (conf.sqlGuard && name === conf.sqlGuard.tool) {
      const why = catalogOnlyViolation(ti[conf.sqlGuard.arg || 'query']);
      if (why) return deny(`${name} blocked: ${why}`);
    }
    return allow('trusted read-only MCP tool');
  }
  return {};
}

function log(ctx, tool, res) {
  if (!ctx.marker.runDir || !res.decision || (res.decision === 'allow' && tool !== 'Bash' && !tool.startsWith('mcp__'))) return;
  try { fs.appendFileSync(path.join(ctx.marker.runDir, 'guard.log'), `${new Date().toISOString()} ${res.decision} ${tool} ${res.reason}\n`, { mode: 0o600 }); } catch {}
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  const ctx = loadContext(input);
  if (!ctx) process.exit(0);
  let res;
  try { res = decide(String(input.tool_name || ''), input.tool_input || {}, ctx); } catch (e) { res = deny(`guard error (${e.message}); failing closed`); }
  log(ctx, String(input.tool_name || ''), res);
  if (res.decision) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: res.decision, permissionDecisionReason: res.reason } }));
  }
  process.exit(0);
}

if (isMain(import.meta.url)) main();
