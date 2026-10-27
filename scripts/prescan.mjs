#!/usr/bin/env node
// Phase 1b: deterministic lead generation. No model tokens.
//   prescan.mjs <runDir>
// Runs each detected pack's prescan.json rules and analyzers.mjs, plus the core
// builtins (secrets, git history, env files, dependency versions). Secret values
// are masked before anything is written. Writes leads.json and leads.md.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadRun, readJSON, readText, writeJSON, writeFile, matchAny, matchGlob, lineIndex, lineAt, git, gitInfo,
  isTextCandidate, sevRank, cmpVersion, die, isMain, PLUGIN_ROOT,
} from './lib.mjs';
import { findSecrets, mask, redactText } from './redact.mjs';
import * as sql from './sql.mjs';
import { scanDeps } from './deps.mjs';

const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;
const ENV_EXAMPLE = /\.(example|sample|template|dist|defaults)$/;

export async function prescan(runDir) {
  const run = loadRun(runDir);
  const inv = readJSON(path.join(runDir, 'inventory.json'));
  const target = run.target;
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) cache.set(rel, readText(path.join(target, rel)));
    return cache.get(rel);
  };
  const { tracked, ignored } = gitInfo(target);
  const leads = [];
  const seen = new Set();
  const lead = (l) => {
    const key = `${l.id}|${l.file}|${l.line}|${l.snippet || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    leads.push({ provider: l.provider || 'common', line: null, note: '', ...l, snippet: l.snippet ? redactText(l.snippet).slice(0, 200) : '' });
  };
  const textFiles = inv.files.filter((f) => isTextCandidate(f.path, f.size));
  const notes = [];

  const builtins = {
    secrets(rule) {
      for (const f of textFiles) {
        const isEnv = ENV_FILE.test(f.path) && !ENV_EXAMPLE.test(f.path);
        const local = tracked ? !tracked.has(f.path) && ignored(f.path) : false;
        if (isEnv && (local || !tracked)) continue; // local, git-ignored env files are expected
        if (local) continue;
        const text = read(f.path);
        if (!text) continue;
        const lineOf = lineIndex(text);
        for (const s of findSecrets(text)) {
          const line = lineOf(s.index);
          lead({
            id: rule.id, title: s.title, severity: s.severity, file: f.path, line, snippet: lineAt(text, line),
            note: `${tracked ? (tracked.has(f.path) ? 'Committed to git.' : 'Untracked: will be committed unless ignored.') : 'No git metadata: confirm whether this file is published.'} Rotate the key; deleting it is not enough.`,
            value: mask(s.value),
          });
        }
      }
    },
    'git-history'(rule) {
      if (!tracked || !run.history) return;
      const current = new Set();
      for (const f of textFiles) for (const s of findSecrets(read(f.path) || '')) current.add(s.value);
      const r = git(target, ['log', '-p', '--no-color', '--no-ext-diff', '--no-textconv', '-U0', '-n', String(run.history), '--format=@@commit %h']);
      if (r.status !== 0) return notes.push('git history scan failed');
      let commit = '';
      let file = '';
      for (const ln of r.stdout.split('\n')) {
        if (ln.startsWith('@@commit ')) { commit = ln.slice(9); continue; }
        if (ln.startsWith('+++ ')) { file = ln.replace(/^\+\+\+ (b\/)?/, ''); continue; }
        if (!ln.startsWith('+')) continue;
        for (const s of findSecrets(ln)) {
          if (current.has(s.value)) continue;
          lead({
            id: rule.id, title: `${s.title} in git history`, severity: s.severity, file, line: null,
            snippet: ln.slice(1).trim(), note: `Removed from the code but still in commit ${commit}. Anyone with the repo can read it: rotate the key.`, value: mask(s.value),
          });
        }
      }
    },
    'env-files'(rule) {
      for (const f of inv.files.filter((x) => ENV_FILE.test(x.path) && !ENV_EXAMPLE.test(x.path))) {
        if (tracked?.has(f.path)) {
          lead({ id: rule.id, title: 'Environment file committed to git', severity: 'high', file: f.path, line: null, note: 'Add it to .gitignore, remove it with `git rm --cached`, and rotate every value in it.' });
        }
      }
    },
    'dep-version'(rule, provider) {
      const v = inv.deps[rule.package];
      if (!v || (rule.requiresFile && !inv.files.some((f) => matchGlob(f.path, rule.requiresFile)))) return;
      const ver = String(v).replace(/^[^\d]*/, '');
      if (!/^\d/.test(ver)) return;
      const hit = rule.ranges.find(([lo, hi]) => cmpVersion(ver, lo) >= 0 && cmpVersion(ver, hi) < 0);
      if (hit) lead({ id: rule.id, provider, title: rule.title, severity: rule.severity, file: 'package.json', snippet: `${rule.package}@${v}`, note: `${rule.note || ''} Fixed in ${hit[1]}.`.trim() });
    },
  };

  const runRegex = (rule, provider, files) => {
    const flags = rule.flags || '';
    const contains = rule.contains ? new RegExp(rule.contains, `m${flags}`) : null;
    const absent = rule.absent ? new RegExp(rule.absent, `m${flags}`) : null;
    const pattern = rule.pattern ? new RegExp(rule.pattern, `gm${flags}`) : null;
    for (const rel of files) {
      if (matchAny(rel, rule.exclude)) continue;
      const text = read(rel);
      if (!text || (contains && !contains.test(text)) || (absent && absent.test(text))) continue;
      const lineOf = lineIndex(text);
      if (!pattern) { lead({ id: rule.id, provider, title: rule.title, severity: rule.severity, file: rel, line: 1, snippet: lineAt(text, 1), note: rule.note }); continue; }
      let m;
      let count = 0;
      while ((m = pattern.exec(text)) && count < (rule.scope === 'file' ? 1 : 5)) {
        if (m[0] === '') { pattern.lastIndex++; continue; }
        const line = lineOf(m.index);
        lead({ id: rule.id, provider, title: rule.title, severity: rule.severity, file: rel, line, snippet: lineAt(text, line), note: rule.note });
        count++;
      }
    }
  };

  for (const p of inv.providers) {
    const dir = path.join(PLUGIN_ROOT, 'providers', p.id);
    const conf = readJSON(path.join(dir, 'provider.json'));
    const rules = conf.prescan ? readJSON(path.join(dir, conf.prescan), { rules: [] }).rules : [];
    for (const rule of rules) {
      const type = rule.type || 'regex';
      if (type === 'regex') {
        const files = rule.surface
          ? (p.surfaces[rule.surface]?.files || [])
          : textFiles.filter((f) => matchAny(f.path, rule.files)).map((f) => f.path);
        runRegex(rule, p.id, files);
      } else if (builtins[type]) builtins[type](rule, p.id);
      else notes.push(`unknown rule type ${type} in ${p.id}`);
    }
    for (const mod of conf.analyzers || []) {
      const { default: analyze } = await import(pathToFileURL(path.join(dir, mod)).href);
      await analyze({
        target, run, inventory: inv, provider: p, files: textFiles, read, tracked, ignored, sql, matchAny, matchGlob, lineIndex, lineAt,
        lead: (l) => lead({ provider: p.id, ...l }),
      });
    }
  }

  if (!run.offline) {
    const d = scanDeps(target, runDir);
    d.leads.forEach((l) => lead(l));
    notes.push(...d.notes);
  }

  leads.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0));
  leads.forEach((l, i) => { l.leadId = `L-${String(i + 1).padStart(3, '0')}`; });
  return { leads, notes };
}

if (isMain(import.meta.url)) {
  const runDir = process.argv[2] || die('usage: prescan.mjs <runDir>');
  const { leads, notes } = await prescan(runDir);
  writeJSON(path.join(runDir, 'leads.json'), { leads, notes });
  const md = ['# Prescan leads', '', '| lead | check | sev | location | title |', '|---|---|---|---|---|',
    ...leads.slice(0, 120).map((l) => `| ${l.leadId} | ${l.id} | ${l.severity} | ${l.file}${l.line ? `:${l.line}` : ''} | ${l.title} |`)];
  if (leads.length > 120) md.push('', `(${leads.length - 120} more in leads.json)`);
  if (notes.length) md.push('', '## Notes', ...notes.map((n) => `- ${n}`));
  writeFile(path.join(runDir, 'leads.md'), md.join('\n') + '\n');
  const counts = leads.reduce((a, l) => ({ ...a, [l.severity]: (a[l.severity] || 0) + 1 }), {});
  console.log(`leads: ${leads.length} ${JSON.stringify(counts)}${notes.length ? ` | ${notes.join('; ')}` : ''}`);
}
