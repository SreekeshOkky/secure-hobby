// Known-vulnerable dependency scan. Never installs anything and never runs the
// target's scripts: the lockfile is copied into the run dir and audited there,
// so the target's .npmrc (registry, tokens) is not read.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir } from './lib.mjs';

const NPM_SEV = { critical: 'high', high: 'medium', moderate: 'low' };
const has = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;

export function scanDeps(target, runDir) {
  const work = ensureDir(path.join(runDir, 'deps'));
  const lock = path.join(target, 'package-lock.json');
  const leads = [];
  const notes = [];
  if (has('osv-scanner')) {
    for (const lf of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']) {
      if (!fs.existsSync(path.join(target, lf))) continue;
      const copy = path.join(work, lf);
      fs.copyFileSync(path.join(target, lf), copy);
      let r = spawnSync('osv-scanner', ['scan', '--lockfile', copy, '--format', 'json'], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
      if (!r.stdout?.trim().startsWith('{')) r = spawnSync('osv-scanner', [`--lockfile=${copy}`, '--json'], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
      try {
        for (const res of JSON.parse(r.stdout).results || []) {
          for (const pkg of res.packages || []) {
            const ids = (pkg.vulnerabilities || []).map((v) => v.id);
            if (!ids.length) continue;
            const sev = (pkg.groups || []).map((g) => parseFloat(g.max_severity) || 0).reduce((a, b) => Math.max(a, b), 0);
            leads.push(lead(lf, pkg.package.name, pkg.package.version, ids.slice(0, 3).join(', '), sev >= 9 ? 'high' : sev >= 7 ? 'medium' : 'low'));
          }
        }
        notes.push(`osv-scanner: ${lf}`);
      } catch { notes.push(`osv-scanner failed on ${lf}`); }
    }
  } else if (fs.existsSync(lock) && has('npm')) {
    fs.copyFileSync(lock, path.join(work, 'package-lock.json'));
    fs.copyFileSync(path.join(target, 'package.json'), path.join(work, 'package.json'));
    const r = spawnSync('npm', ['audit', '--package-lock-only', '--json', '--registry=https://registry.npmjs.org/'], {
      cwd: work, encoding: 'utf8', timeout: 90000, maxBuffer: 64 << 20,
      env: { ...process.env, npm_config_userconfig: '/dev/null', npm_config_globalconfig: '/dev/null', npm_config_ignore_scripts: 'true' },
    });
    try {
      const report = JSON.parse(r.stdout);
      for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
        const sev = NPM_SEV[v.severity];
        if (!sev || !v.isDirect) continue;
        const titles = (v.via || []).filter((x) => typeof x === 'object').map((x) => x.title).slice(0, 2).join('; ');
        leads.push(lead('package-lock.json', name, v.range, titles || 'see npm audit', sev, v.fixAvailable));
      }
      notes.push('npm audit (lockfile only)');
    } catch { notes.push('npm audit unavailable (offline?)'); }
  } else notes.push('no osv-scanner and no package-lock.json: dependency scan skipped');
  return { leads: leads.slice(0, 25), notes };
}

function lead(file, name, version, what, severity, fix) {
  return {
    id: 'COMMON-030', title: `Vulnerable dependency ${name}`, severity, file, line: null,
    snippet: `${name}@${version}: ${what}`, note: `Confirm the vulnerable code path is used.${fix ? ' A fixed version is available.' : ''}`,
  };
}
