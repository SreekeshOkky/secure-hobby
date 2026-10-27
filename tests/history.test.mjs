// Git-aware checks: secrets removed from HEAD but still in history, committed .env files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome, prepare, readJSON } from './helpers.mjs';

// Built at runtime so no Stripe-shaped literal sits in the source (GitHub push protection).
const fakeKey = (tag) => ['sk', 'live', `51${tag}fixture0not0real`.padEnd(30, '0')].join('_');
const HIST = fakeKey('HISTORY');
const ENV = fakeKey('ENV');
const LOCAL = fakeKey('LOCAL');

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

test('secret in git history and committed .env are reported, values masked', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-repo-')));
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"hist","dependencies":{"@supabase/supabase-js":"2.45.0"}}');
  fs.writeFileSync(path.join(repo, 'config.js'), `export const key = '${HIST}';\n`);
  fs.writeFileSync(path.join(repo, '.env'), `STRIPE_SECRET_KEY=${ENV}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'config.js'), 'export const key = process.env.STRIPE_KEY;\n');
  git(repo, 'commit', '-qam', 'remove key');

  const home = tempHome();
  const runDir = prepare(home, repo);
  const { leads } = readJSON(path.join(runDir, 'leads.json'));
  assert.ok(leads.some((l) => l.id === 'COMMON-002' && l.file === 'config.js'), 'history secret');
  assert.ok(leads.some((l) => l.id === 'COMMON-003' && l.file === '.env'), 'committed .env');
  assert.ok(leads.some((l) => l.id === 'COMMON-001' && l.file === '.env'), 'secret inside committed .env');
  const raw = fs.readFileSync(path.join(runDir, 'leads.json'), 'utf8');
  assert.ok(!raw.includes(HIST) && !raw.includes(ENV));
});

test('git-ignored local .env is not reported', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-repo-')));
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env*\n!.env.example\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"ign"}');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, '.env.local'), `STRIPE_SECRET_KEY=${LOCAL}\n`);
  const { leads } = readJSON(path.join(prepare(tempHome(), repo), 'leads.json'));
  assert.deepEqual(leads.filter((l) => l.file === '.env.local'), []);
});
