// Shared helpers for secure-hobby scripts. Zero dependencies, Node >= 18.
// Scripts only ever write under HOME (~/.secure-hobby); see assertWritable().
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = path.resolve(process.env.SECURE_HOBBY_HOME || path.join(os.homedir(), '.secure-hobby'));
export const CACHE = path.join(HOME, 'cache');
export const ACTIVE = path.join(HOME, '.active');

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const sevRank = (s) => (SEVERITIES.includes(s) ? SEVERITIES.indexOf(s) : SEVERITIES.length);
export const VERIFY_SEVERITIES = new Set(['critical', 'high', 'medium']);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.svelte-kit', '.nuxt', '.output', '.turbo', '.cache',
  'dist', 'build', 'out', 'coverage', 'vendor', '.venv', '__pycache__', '.idea', '.vscode',
]);
const IGNORE_PATHS = new Set(['.vercel/output', 'supabase/.temp', 'supabase/.branches']);
export const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|eot|otf|mp4|webm|mov|mp3|wav|ogg|pdf|zip|gz|tgz|bz2|7z|wasm|map|lockb|sqlite|db|jar|class|so|dylib|dll|exe)$/i;

// Lists files under root as sorted posix paths. Never follows symlinks, so a link
// inside the target cannot pull files from elsewhere on disk into the audit.
export function walk(root, { maxFiles = 50000 } = {}) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !IGNORE_PATHS.has(r)) stack.push(r);
        continue;
      }
      if (!e.isFile()) continue;
      let size = 0;
      try { size = fs.statSync(path.join(root, r)).size; } catch { continue; }
      out.push({ path: r, size });
      if (out.length >= maxFiles) return out.sort(byPath);
    }
  }
  return out.sort(byPath);
}
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export const isTextCandidate = (rel, size) =>
  !BINARY_EXT.test(rel) && !LOCKFILES.has(path.posix.basename(rel)) && !/\.min\.(js|css)$/.test(rel) && size <= 512 * 1024;

function globSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(globSource).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return re;
}
const globCache = new Map();
export function globToRegExp(glob) {
  if (!globCache.has(glob)) globCache.set(glob, new RegExp('^' + globSource(glob) + '$'));
  return globCache.get(glob);
}
// Globs without a slash match the basename anywhere (like .gitignore).
export function matchGlob(rel, glob) {
  return globToRegExp(glob).test(glob.includes('/') ? rel : path.posix.basename(rel));
}
export const matchAny = (rel, globs) => [].concat(globs || []).some((g) => matchGlob(rel, g));

export function insideDir(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
export function realpathOrResolve(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch {
    // Not created yet: resolve the nearest existing parent so symlinked parents still count.
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(realpathOrResolve(parent), path.basename(abs));
  }
}
const REAL_HOME = () => realpathOrResolve(HOME);

export function assertWritable(p) {
  const abs = realpathOrResolve(p);
  const home = REAL_HOME();
  if (!insideDir(abs, home) || insideDir(abs, path.join(home, 'cache'))) {
    throw new Error(`refusing to write outside ${HOME}: ${abs}`);
  }
  return abs;
}
export function ensureDir(p) {
  const abs = assertWritable(p);
  fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
  return abs;
}
export function writeFile(p, data) {
  const abs = assertWritable(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  fs.writeFileSync(abs, data, { mode: 0o600 });
  fs.chmodSync(abs, 0o600);
  return abs;
}
export const writeJSON = (p, data) => writeFile(p, JSON.stringify(data, null, 2) + '\n');
export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot read ${p}: ${e.message}`);
  }
}
export function readText(abs, max = 512 * 1024) {
  try {
    if (fs.statSync(abs).size > max) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch { return null; }
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export function fileHash(abs) {
  try { return sha256(fs.readFileSync(abs)); } catch { return 'missing'; }
}
export const fingerprint = (c) => sha256(`${c.checkId}|${c.file || ''}|${Math.floor((c.line || 0) / 10)}`).slice(0, 16);

// Returns a function mapping a string offset to a 1-based line number.
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}
export const lineAt = (text, line) => (text.split('\n')[line - 1] || '').trim().slice(0, 200);

// git with the target's own hooks, fsmonitor and LFS filters disabled.
export function git(target, args, opts = {}) {
  return spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', target, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: opts.timeout || 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_CONFIG_NOSYSTEM: '1' },
  });
}
export const isGitRepo = (target) => fs.existsSync(path.join(target, '.git'));
export function gitInfo(target) {
  if (!isGitRepo(target)) return { tracked: null, ignored: () => false };
  const t = git(target, ['ls-files', '-z']);
  const ig = git(target, ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory']);
  const tracked = t.status === 0 ? new Set(t.stdout.split('\0').filter(Boolean)) : null;
  const ignoredList = ig.status === 0 ? ig.stdout.split('\0').filter(Boolean) : [];
  const ignored = (rel) => ignoredList.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
  return { tracked, ignored };
}

export function loadProviders() {
  const dir = path.join(PLUGIN_ROOT, 'providers');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => ({ ...readJSON(path.join(dir, d.name, 'provider.json')), dir: path.join(dir, d.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const loadRun = (runDir) => readJSON(path.join(runDir, 'run.json'));

export function parseArgs(argv, booleans = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (booleans.includes(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[k] = true;
      else flags[k] = argv[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

export function die(msg, code = 1) {
  process.stderr.write(`secure-hobby: ${msg}\n`);
  process.exit(code);
}

// Compares dotted versions numerically; prerelease tags are ignored.
export function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export const isMain = (url) => !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
