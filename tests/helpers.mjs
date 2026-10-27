// Test helpers: every test gets its own SECURE_HOBBY_HOME so nothing touches ~/.secure-hobby.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'evals', 'fixtures');

export function tempHome() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-home-')));
}

export function node(home, script, args, input) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    encoding: 'utf8', input, env: { ...process.env, SECURE_HOBBY_HOME: home },
  });
  if (r.status !== 0 && !script.includes('guard')) throw new Error(`${script} ${args.join(' ')} failed:\n${r.stderr}${r.stdout}`);
  return r;
}

// start + detect + prescan + ledger, returns runDir
export function prepare(home, target, flags = ['--offline'], sid = 'test') {
  const { runDir } = JSON.parse(node(home, 'scripts/run.mjs', ['start', sid, target, ...flags]).stdout);
  node(home, 'scripts/detect.mjs', [runDir]);
  node(home, 'scripts/prescan.mjs', [runDir]);
  node(home, 'scripts/ledger.mjs', [runDir]);
  return runDir;
}

export const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
