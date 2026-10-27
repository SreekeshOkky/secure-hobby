// End-to-end pipeline with simulated agent output (no model calls):
// candidates -> queue -> verdicts -> findings -> validate -> report -> incremental re-run -> accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FIXTURES, tempHome, node, prepare, readJSON } from './helpers.mjs';

const SERVICE_JWT = fs.readFileSync(path.join(FIXTURES, 'next-supabase-vuln', 'lib', 'supabaseAdmin.ts'), 'utf8').match(/eyJ[\w.-]+/)[0];

function simulateAgents(runDir) {
  fs.mkdirSync(path.join(runDir, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'candidates', 'h1.json'), JSON.stringify([
    { checkId: 'SUPA-001', title: 'notes table has no RLS', severity: 'high', file: 'supabase/migrations/20240101000000_init.sql', line: 11, evidence: 'create table public.notes (', reasoning: 'no enable rls', confidence: 'high' },
    { checkId: 'SUPA-006', title: 'service role key reaches the browser', severity: 'critical', file: 'components/AdminPanel.tsx', line: 2, evidence: `import { supabaseAdmin } ... key ${SERVICE_JWT}`, reasoning: 'use client imports admin client', confidence: 'high' },
    { checkId: 'COMMON-012', title: 'open redirect', severity: 'medium', file: 'app/auth/callback/route.ts', line: 7, evidence: 'NextResponse.redirect(next)', reasoning: 'next from query', confidence: 'medium' },
    { checkId: 'VERCEL-002', title: 'no headers', severity: 'low', file: 'vercel.json', line: null, evidence: '', reasoning: 'hardening', confidence: 'high' },
  ]));
  const merged = JSON.parse(node(process.env.SH_HOME, 'scripts/merge.mjs', ['candidates', runDir]).stdout);
  const queue = readJSON(path.join(runDir, 'queue.json'));
  fs.mkdirSync(path.join(runDir, 'verdicts'), { recursive: true });
  const verdicts = queue.verify.map((c) => {
    if (c.checkId === 'SUPA-001') return { fingerprint: c.fingerprint, verdict: 'confirmed', checkId: c.checkId, title: 'notes readable by anyone', severity: 'critical', evidence: c.evidence, reasoning: 'traced', exploit: 'curl rest/v1/notes', impact: 'read all notes', fix: { summary: 'Enable RLS', sql: 'alter table public.notes enable row level security;' } };
    if (c.checkId === 'SUPA-006') return { fingerprint: c.fingerprint, verdict: 'confirmed', checkId: c.checkId, title: c.title, severity: 'critical', evidence: c.evidence, reasoning: 'bundle', fix: { summary: 'Rotate key', patch: '--- a/components/AdminPanel.tsx\n+++ b/components/AdminPanel.tsx\n@@ -1,2 +1,1 @@\n-\'use client\';\n import { supabaseAdmin } from \'../lib/supabaseAdmin\';\n' } };
    if (c.checkId === 'COMMON-012') return { fingerprint: c.fingerprint, verdict: 'rejected', disproof: 'test' };
    return { fingerprint: c.fingerprint, verdict: 'needs_validation', needs: 'Is this route deployed?' };
  });
  fs.writeFileSync(path.join(runDir, 'verdicts', 'v1.json'), JSON.stringify(verdicts));
  return merged;
}

test('full pipeline produces a valid, redacted report and never touches the target', () => {
  const home = tempHome();
  process.env.SH_HOME = home;
  const target = path.join(FIXTURES, 'next-supabase-vuln');
  const before = spawnSync('find', [target, '-type', 'f', '-newer', path.join(target, 'package.json')], { encoding: 'utf8' }).stdout;
  const runDir = prepare(home, target);
  const merged = simulateAgents(runDir);
  assert.ok(merged.hardening >= 1, 'low candidates go to hardening');
  assert.ok(merged.batches.length >= 1);

  node(home, 'scripts/merge.mjs', ['findings', runDir]);
  assert.match(node(home, 'scripts/validate-findings.mjs', [runDir]).stdout, /valid/);
  node(home, 'scripts/render-report.mjs', [runDir]);

  const findings = readJSON(path.join(runDir, 'findings.json'));
  const confirmed = findings.findings.filter((f) => f.verdict === 'confirmed');
  assert.ok(confirmed.some((f) => f.checkId === 'SUPA-001' && f.severity === 'critical'));
  assert.ok(findings.rejected.some((r) => r.checkId === 'COMMON-012'));
  assert.ok(findings.findings.filter((f) => f.verdict === 'needs_validation').every((f) => f.severity === null && f.needs));

  const report = fs.readFileSync(path.join(runDir, 'REPORT.md'), 'utf8');
  assert.match(report, /Fix these first/);
  assert.ok(!report.includes(SERVICE_JWT) && !JSON.stringify(findings).includes(SERVICE_JWT), 'secret redacted');
  const sqlFix = fs.readdirSync(path.join(runDir, 'fixes')).find((f) => f.endsWith('.sql'));
  assert.ok(sqlFix, 'sql fix written');
  assert.equal(fs.statSync(path.join(runDir, 'REPORT.md')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(runDir).mode & 0o777, 0o700);

  const after = spawnSync('find', [target, '-type', 'f', '-newer', path.join(target, 'package.json')], { encoding: 'utf8' }).stdout;
  assert.equal(after, before, 'target unchanged');

  // Incremental re-run: nothing changed -> nothing to hunt, confirmed findings carried.
  const run2 = prepare(home, target);
  const ledger2 = readJSON(path.join(run2, 'coverage-ledger.json'));
  assert.equal(ledger2.batches.length, 0);
  assert.ok(ledger2.units.every((u) => u.status === 'unchanged'));
  node(home, 'scripts/merge.mjs', ['candidates', run2]);
  node(home, 'scripts/merge.mjs', ['findings', run2]);
  const f2 = readJSON(path.join(run2, 'findings.json'));
  assert.ok(f2.findings.some((f) => f.source === 'carried' && f.checkId === 'SUPA-001'));

  // Accepting a risk removes it from later runs.
  const id = confirmed.find((f) => f.checkId === 'SUPA-001').id;
  node(home, 'scripts/run.mjs', ['accept', runDir, id, 'intentionally public']);
  const run3 = prepare(home, target);
  node(home, 'scripts/merge.mjs', ['candidates', run3]);
  node(home, 'scripts/merge.mjs', ['findings', run3]);
  assert.ok(!readJSON(path.join(run3, 'findings.json')).findings.some((f) => f.checkId === 'SUPA-001'));
});

test('validator rejects malformed findings', () => {
  const home = tempHome();
  const file = path.join(home, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, findings: [{ id: 'F-001', verdict: 'confirmed', checkId: 'bad', title: 'x', fingerprint: 'abcdefgh', file: null }], hardening: [], rejected: [], coverage: { units: 0 } }));
  const r = spawnSync(process.execPath, [path.join(FIXTURES, '..', '..', 'scripts', 'validate-findings.mjs'), file], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /checkId/);
  assert.match(r.stdout, /fix.summary/);
});
