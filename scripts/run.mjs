#!/usr/bin/env node
// Run lifecycle.
//   start <sessionId> <path|https-git-url> [--quick|--deep] [--live] [--history N] [--offline]
//   end <sessionId>
//   accept <runDir> <F-id> <reason...>   record an accepted risk so later runs skip it
// "start" resolves the target (shallow-cloning a URL into the cache), creates
// ~/.secure-hobby/<repo>/run-N/ and the session marker that turns the guard on.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, CACHE, ACTIVE, ensureDir, writeJSON, readJSON, parseArgs, die, assertWritable } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2), ['quick', 'deep', 'live', 'offline']);
const [cmd, ...rest] = positional;

const GIT_URL = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const markerPath = (sid) => path.join(ACTIVE, `${sid && sid !== '${CLAUDE_SESSION_ID}' ? sid.replace(/[^\w-]/g, '') : '_global'}.json`);

function cloneTarget(url, history) {
  const m = GIT_URL.exec(url);
  if (!m) die('only https URLs on github.com, gitlab.com or bitbucket.org are supported');
  const repoName = `${m[2]}__${m[3]}`.replace(/[^\w.-]/g, '_');
  const dest = path.join(CACHE, repoName);
  fs.mkdirSync(CACHE, { recursive: true, mode: 0o700 });
  fs.rmSync(dest, { recursive: true, force: true });
  const depth = String(Math.max(1, Number(history) || 1));
  const r = spawnSync('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=never',
    '-c', 'protocol.ext.allow=never', 'clone', '--depth', depth, '--no-recurse-submodules', '--single-branch', '--', url, dest,
  ], { encoding: 'utf8', timeout: 300000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } });
  if (r.status !== 0) die(`git clone failed: ${(r.stderr || '').trim().split('\n').pop()}`);
  return { target: dest, repoName, source: url };
}

function start() {
  const [sessionId, targetArg] = rest;
  if (!targetArg) die('usage: run.mjs start <sessionId> <path|https-git-url> [--quick|--deep] [--live] [--history N]');
  const mode = flags.quick ? 'quick' : flags.deep ? 'deep' : 'default';
  const history = flags.history !== undefined ? Number(flags.history) : 100;
  let t;
  if (/^https:\/\//.test(targetArg)) t = cloneTarget(targetArg, history);
  else {
    let abs;
    try { abs = fs.realpathSync(path.resolve(targetArg.replace(/^~(?=$|\/)/, process.env.HOME || '~'))); } catch { die(`target not found: ${targetArg}`); }
    if (!fs.statSync(abs).isDirectory()) die(`target is not a directory: ${abs}`);
    if (abs.startsWith(HOME + path.sep) && !abs.startsWith(CACHE + path.sep)) die('target cannot be inside ~/.secure-hobby');
    t = { target: abs, repoName: path.basename(abs).replace(/[^\w.-]/g, '_'), source: abs };
  }
  const repoDir = ensureDir(path.join(HOME, t.repoName));
  const runs = fs.readdirSync(repoDir).map((d) => /^run-(\d+)$/.exec(d)).filter(Boolean).map((m) => Number(m[1]));
  const n = runs.length ? Math.max(...runs) + 1 : 1;
  const prior = runs.sort((a, b) => b - a).map((k) => path.join(repoDir, `run-${k}`)).find((d) => fs.existsSync(path.join(d, 'findings.json'))) || null;
  const runDir = ensureDir(path.join(repoDir, `run-${n}`));
  const run = {
    sessionId: sessionId || null, target: t.target, source: t.source, repoName: t.repoName, repoDir, runDir,
    mode, live: !!flags.live, history, offline: !!flags.offline, prior, started: new Date().toISOString(),
  };
  writeJSON(path.join(runDir, 'run.json'), run);
  ensureDir(ACTIVE);
  writeJSON(markerPath(sessionId), { runDir, target: t.target, started: run.started });
  console.log(JSON.stringify({ runDir, target: t.target, mode, live: run.live, prior }));
}

function end() {
  const p = markerPath(rest[0]);
  fs.rmSync(p, { force: true });
  console.log(`guard off for this session (${path.basename(p)})`);
}

function accept() {
  const [runDir, id, ...why] = rest;
  if (!runDir || !id) die('usage: run.mjs accept <runDir> <F-id> <reason>');
  const run = readJSON(path.join(runDir, 'run.json'));
  const f = readJSON(path.join(runDir, 'findings.json')).findings.find((x) => x.id === id);
  if (!f) die(`no finding ${id} in ${runDir}`);
  const file = assertWritable(path.join(run.repoDir, 'accepted.json'));
  const list = readJSON(file, []);
  list.push({ fingerprint: f.fingerprint, checkId: f.checkId, file: f.file, reason: why.join(' ') || 'accepted', date: new Date().toISOString() });
  writeJSON(file, list);
  console.log(`accepted ${id} (${f.checkId}); later runs will skip it`);
}

({ start, end, accept }[cmd] || (() => die('usage: run.mjs start|end|accept ...')))();
