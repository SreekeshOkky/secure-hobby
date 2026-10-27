#!/usr/bin/env node
// Phase 1a: inventory + provider detection. No model tokens.
//   detect.mjs <runDir> [--with vercel,supabase]
// Writes inventory.json (for scripts) and summary.md (short, for the recon agent).
import fs from 'node:fs';
import path from 'node:path';
import { walk, matchAny, matchGlob, loadProviders, loadRun, readJSON, readText, writeJSON, writeFile, parseArgs, die, isTextCandidate, isMain } from './lib.mjs';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|astro|sql|py|go|rb)$/;

export function collectDeps(target, files) {
  const deps = {};
  for (const f of files.filter((x) => path.posix.basename(x.path) === 'package.json')) {
    const pkg = readJSON(path.join(target, f.path), {});
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) Object.assign(deps, pkg[k] || {});
  }
  // Prefer exact versions from the root lockfile when present.
  const lock = readJSON(path.join(target, 'package-lock.json'), null);
  if (lock?.packages) {
    for (const [k, v] of Object.entries(lock.packages)) {
      const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(k);
      if (m && m[1] in deps && v.version) deps[m[1]] = v.version;
    }
  }
  return deps;
}

export function detect(target, providers, forced = []) {
  const files = walk(target);
  const deps = collectDeps(target, files);
  const has = (glob) => files.some((f) => matchGlob(f.path, glob));
  const textCache = new Map();
  const read = (rel) => {
    if (!textCache.has(rel)) textCache.set(rel, readText(path.join(target, rel)));
    return textCache.get(rel);
  };
  const detected = [];
  for (const p of providers) {
    const d = p.detect || {};
    const reasons = [];
    if (d.always) reasons.push('always on');
    for (const f of d.files || []) if (has(f)) reasons.push(`file ${f}`);
    for (const g of d.globs || []) if (has(g)) reasons.push(`files ${g}`);
    for (const dep of d.deps || []) if (dep in deps) reasons.push(`dependency ${dep}`);
    if (forced.includes(p.id)) reasons.push('forced with --with');
    if (reasons.length && (d.unlessDeps || []).some((x) => x in deps) && !forced.includes(p.id)) continue;
    if (reasons.length) detected.push({ p, reasons });
  }
  const hasFramework = detected.some(({ p }) => p.kind === 'framework');
  const out = [];
  for (const { p, reasons } of detected) {
    const surfaces = {};
    for (const [name, s] of Object.entries(p.surfaces || {})) {
      if (s.fallbackOnly && hasFramework) continue;
      const contains = s.contains ? new RegExp(s.contains, 'm') : null;
      const list = files.filter((f) => matchAny(f.path, s.files) && !matchAny(f.path, s.exclude) && isTextCandidate(f.path, f.size)
        && (!contains || contains.test(read(f.path) || '')));
      if (list.length) surfaces[name] = { priority: s.priority || 'high', files: list.map((f) => f.path), bytes: list.reduce((a, f) => a + f.size, 0) };
    }
    out.push({ id: p.id, kind: p.kind, version: p.version || '1', reasons, surfaces });
  }
  return {
    target, generated: new Date().toISOString(),
    fileCount: files.length,
    sourceFileCount: files.filter((f) => SOURCE_EXT.test(f.path)).length,
    files, deps, providers: out,
  };
}

function summary(inv) {
  const lines = [`# Inventory: ${path.basename(inv.target)}`, '', `Files: ${inv.fileCount} (source: ${inv.sourceFileCount})`, ''];
  lines.push('## Detected packs');
  for (const p of inv.providers) {
    lines.push(`- **${p.id}** (${p.kind}): ${p.reasons.join(', ')}`);
    for (const [s, v] of Object.entries(p.surfaces)) lines.push(`  - ${s} [${v.priority}]: ${v.files.length} files, ${Math.round(v.bytes / 1024)} KB`);
  }
  const interesting = Object.keys(inv.deps).filter((d) => /supabase|next|svelte|vite|react|vue|auth|clerk|stripe|openai|anthropic|ai$|prisma|drizzle|firebase|resend|upstash/.test(d));
  lines.push('', '## Notable dependencies', interesting.map((d) => `${d}@${inv.deps[d]}`).join(', ') || '(none)');
  const top = [...new Set(inv.files.map((f) => f.path.split('/')[0]))].slice(0, 40);
  lines.push('', '## Top-level entries', top.join(', '));
  return lines.join('\n') + '\n';
}

if (isMain(import.meta.url)) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const runDir = positional[0] || die('usage: detect.mjs <runDir> [--with a,b]');
  const run = loadRun(runDir);
  if (!fs.existsSync(run.target)) die(`target missing: ${run.target}`);
  const forced = typeof flags.with === 'string' ? flags.with.split(',') : [];
  const inv = detect(run.target, loadProviders(), forced);
  writeJSON(path.join(runDir, 'inventory.json'), inv);
  writeFile(path.join(runDir, 'summary.md'), summary(inv));
  const packs = inv.providers.map((p) => `${p.id}(${Object.values(p.surfaces).reduce((a, s) => a + s.files.length, 0)})`).join(' ');
  console.log(`detected: ${packs} | files ${inv.fileCount}, source ${inv.sourceFileCount}`);
}
