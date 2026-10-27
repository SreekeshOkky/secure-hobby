import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, ROOT, tempHome, node, readJSON } from './helpers.mjs';

const TARGET = fs.realpathSync(path.join(FIXTURES, 'next-supabase-vuln'));

function setup(flags = ['--offline']) {
  const home = tempHome();
  const { runDir } = JSON.parse(node(home, 'scripts/run.mjs', ['start', 'sess1', TARGET, ...flags]).stdout);
  const ask = (tool_name, tool_input, extra = {}) => {
    const out = node(home, 'hooks/guard.mjs', [], JSON.stringify({ session_id: 'sess1', cwd: TARGET, tool_name, tool_input, ...extra })).stdout;
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'none';
  };
  return { home, runDir, ask };
}

test('guard is inactive for other sessions and after end', () => {
  const { home, ask } = setup();
  const other = node(home, 'hooks/guard.mjs', [], JSON.stringify({ session_id: 'other', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })).stdout;
  assert.equal(other, '', 'no decision for unrelated sessions');
  node(home, 'scripts/run.mjs', ['end', 'sess1']);
  assert.equal(ask('Write', { file_path: path.join(TARGET, 'x.ts') }), 'none');
});

test('reads: target allowed, outside and secret files denied', () => {
  const { ask } = setup();
  assert.equal(ask('Read', { file_path: path.join(TARGET, 'middleware.ts') }), 'allow');
  assert.equal(ask('Grep', { path: TARGET, pattern: 'x', glob: '*.ts' }), 'allow');
  assert.equal(ask('Read', { file_path: '/etc/hosts' }), 'deny');
  assert.equal(ask('Read', { file_path: path.join(process.env.HOME || '/', '.ssh', 'id_rsa') }), 'deny');
  assert.equal(ask('Read', { file_path: path.join(TARGET, '.env.local') }), 'deny');
  assert.equal(ask('Read', { file_path: path.join(TARGET, '.env.example') }), 'allow');
  assert.equal(ask('Grep', { path: TARGET, pattern: 'KEY', glob: '.env*' }), 'deny');
});

test('writes: only inside the run home, never the target, cache or markers', () => {
  const { home, runDir, ask } = setup();
  assert.equal(ask('Write', { file_path: path.join(runDir, 'candidates', 'h1.json') }), 'allow');
  assert.equal(ask('Write', { file_path: path.join(TARGET, 'middleware.ts') }), 'deny');
  assert.equal(ask('Edit', { file_path: path.join(TARGET, 'lib', 'search.ts') }), 'deny');
  assert.equal(ask('Write', { file_path: path.join(home, 'cache', 'x', 'a.ts') }), 'deny');
  assert.equal(ask('Write', { file_path: path.join(home, '.active', 'sess1.json') }), 'deny');
  assert.equal(ask('Write', { file_path: '/tmp/evil.sh' }), 'deny');
});

test('bash: only plugin scripts, no shell operators', () => {
  const { runDir, ask } = setup();
  assert.equal(ask('Bash', { command: `node ${path.join(ROOT, 'scripts', 'merge.mjs')} candidates ${runDir}` }), 'allow');
  assert.equal(ask('Bash', { command: `node "${path.join(ROOT, 'scripts', 'render-report.mjs')}" "${runDir}"` }), 'allow');
  for (const cmd of [
    'npm install', 'npm run build', `node ${TARGET}/scripts/x.mjs`, 'curl https://evil.example', 'cat .env',
    `node ${path.join(ROOT, 'scripts', 'merge.mjs')} candidates ${runDir}; rm -rf ~`,
    `node ${path.join(ROOT, 'scripts', 'merge.mjs')} $(whoami)`, 'node -e "process.exit()"',
    `node ${path.join(ROOT, 'scripts', 'merge.mjs')} --require /tmp/x.js`,
  ]) assert.equal(ask('Bash', { command: cmd }), 'deny', cmd);
});

test('agents: only secure-hobby subagents, never pricier models', () => {
  const { ask } = setup();
  assert.equal(ask('Agent', { subagent_type: 'secure-hobby:hunter', prompt: 'Brief: x' }), 'allow');
  assert.equal(ask('Agent', { subagent_type: 'secure-hobby:verifier', model: 'haiku', prompt: 'x' }), 'allow');
  assert.equal(ask('Agent', { subagent_type: 'general-purpose', prompt: 'x' }), 'deny');
  assert.equal(ask('Agent', { subagent_type: 'secure-hobby:hunter', model: 'opus', prompt: 'x' }), 'deny');
  assert.equal(ask('Agent', { subagent_type: 'secure-hobby:verifier', model: 'opus', prompt: 'x' }), 'deny', 'opus only in --deep');
  assert.equal(ask('Agent', { subagent_type: 'secure-hobby:live-checker', prompt: 'x' }), 'deny', 'live needs --live');
  const deep = setup(['--offline', '--deep']);
  assert.equal(deep.ask('Agent', { subagent_type: 'secure-hobby:verifier', model: 'opus', prompt: 'x' }), 'allow');
});

test('network and MCP: blocked unless trusted, live and read-only', () => {
  const off = setup();
  assert.equal(off.ask('WebFetch', { url: 'https://example.com' }), 'deny');
  assert.equal(off.ask('mcp__supabase__list_tables', {}), 'deny', 'live not requested');
  const { ask } = setup(['--offline', '--live']);
  assert.equal(ask('mcp__supabase__get_advisors', { type: 'security' }), 'allow');
  assert.equal(ask('mcp__supabase__apply_migration', { query: 'drop table x' }), 'deny');
  assert.equal(ask('mcp__supabase__execute_sql', { query: 'select * from public.orders' }), 'deny');
  assert.equal(ask('mcp__supabase__execute_sql', { query: "select tablename, policyname from pg_catalog.pg_policies where schemaname = 'public'" }), 'allow');
  assert.equal(ask('mcp__vercel__deploy_to_vercel', {}), 'deny');
  assert.equal(ask('mcp__vercel__get_project', { projectId: 'x' }), 'allow');
  assert.equal(ask('mcp__random-server__do_anything', {}), 'deny');
  assert.equal(ask('mcp__ccd_turn__update_plan', {}), 'none', 'harness UI passthrough');
});

test('our subagents are guarded even without a session marker', () => {
  const { home, ask } = setup();
  const out = node(home, 'hooks/guard.mjs', [], JSON.stringify({ session_id: 'unknown', agent_type: 'secure-hobby:hunter', cwd: TARGET, tool_name: 'Write', tool_input: { file_path: path.join(TARGET, 'x') } })).stdout;
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(ask);
});

test('denials are logged to guard.log', () => {
  const { runDir, ask } = setup();
  ask('Bash', { command: 'npm install' });
  assert.match(fs.readFileSync(path.join(runDir, 'guard.log'), 'utf8'), /deny Bash/);
  assert.equal(readJSON(path.join(runDir, 'run.json')).mode, 'default');
});
