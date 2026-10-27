#!/usr/bin/env node
// Phases 4–5 glue. No model tokens.
//   merge.mjs candidates <runDir>   dedupe hunter candidates + un-hunted leads, drop accepted
//                                   risks, split into verifier batches and hardening notes
//   merge.mjs findings <runDir>     combine verdicts, live results and carried findings
//                                   into findings.json (redacted)
import fs from 'node:fs';
import path from 'node:path';
import {
  loadRun, readJSON, writeJSON, fingerprint, sevRank, VERIFY_SEVERITIES, die, isMain, PLUGIN_ROOT, SEVERITIES, loadProviders,
} from './lib.mjs';
import { redactDeep } from './redact.mjs';

const VERIFY_BATCH = 8;
const readDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : []);
function readArray(file) {
  const data = readJSON(file, []);
  return Array.isArray(data) ? data : data.candidates || data.verdicts || data.findings || [];
}

export function mergeCandidates(runDir) {
  const run = loadRun(runDir);
  const ledger = readJSON(path.join(runDir, 'coverage-ledger.json'));
  const { leads } = readJSON(path.join(runDir, 'leads.json'), { leads: [] });
  const hunted = new Set(ledger.units.filter((u) => u.status === 'hunted').flatMap((u) => u.files));
  const unchanged = new Set(ledger.units.filter((u) => u.status === 'unchanged').flatMap((u) => u.files));

  const all = [];
  for (const file of readDir(path.join(runDir, 'candidates'))) {
    for (const c of readArray(file)) all.push({ ...c, source: 'hunter', batch: path.basename(file, '.json') });
  }
  // Leads in files no hunter looked at would otherwise be lost: promote them.
  for (const l of leads) {
    if (hunted.has(l.file) || unchanged.has(l.file)) continue;
    all.push({
      checkId: l.id, title: l.title, severity: l.severity, file: l.file, line: l.line, evidence: l.snippet,
      reasoning: `Prescan rule ${l.id}. ${l.note || ''}`.trim(), confidence: 'medium', source: 'prescan', leadId: l.leadId,
    });
  }

  const accepted = new Set(readJSON(path.join(run.repoDir, 'accepted.json'), []).map((a) => a.fingerprint));
  const byFp = new Map();
  let acceptedCount = 0;
  for (const c of all) {
    if (!SEVERITIES.includes(c.severity)) c.severity = 'medium';
    c.fingerprint = fingerprint(c);
    if (accepted.has(c.fingerprint)) { acceptedCount++; continue; }
    const prev = byFp.get(c.fingerprint);
    if (!prev || sevRank(c.severity) < sevRank(prev.severity) || (prev.source === 'prescan' && c.source === 'hunter')) byFp.set(c.fingerprint, c);
  }
  const unique = [...byFp.values()].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const verify = unique.filter((c) => VERIFY_SEVERITIES.has(c.severity));
  const hardening = unique.filter((c) => !VERIFY_SEVERITIES.has(c.severity));

  const batches = [];
  const push = (list, model) => {
    for (let i = 0; i < list.length; i += VERIFY_BATCH) batches.push({ id: `v${batches.length + 1}`, model, candidates: list.slice(i, i + VERIFY_BATCH) });
  };
  if (run.mode === 'deep') {
    push(verify.filter((c) => c.severity === 'critical'), 'opus');
    push(verify.filter((c) => c.severity !== 'critical'), 'sonnet');
  } else push(verify, run.mode === 'quick' ? 'haiku' : 'sonnet');

  writeJSON(path.join(runDir, 'queue.json'), { verify, hardening, accepted: acceptedCount, batches: batches.map((b) => ({ id: b.id, model: b.model, n: b.candidates.length })) });
  for (const b of batches) {
    writeJSON(path.join(runDir, 'briefs', `${b.id}.json`), {
      role: 'verifier', batch: b.id, target: run.target, model: b.model,
      architecture: path.join(runDir, 'architecture.md'),
      severityGuide: path.join(PLUGIN_ROOT, 'skills', 'audit', 'references', 'SEVERITY.md'),
      checklists: [...new Set(b.candidates.map((c) => (c.checkId || '').split('-')[0]))].map(packFor).filter(Boolean),
      candidates: b.candidates,
      output: path.join(runDir, 'verdicts', `${b.id}.json`),
    });
  }
  return { total: all.length, unique: unique.length, accepted: acceptedCount, hardening: hardening.length, batches };
}

// Maps a check ID prefix (SUPA, NEXT, ...) to its pack's checklist via provider.json checkPrefix.
function packFor(prefix) {
  const p = loadProviders().find((x) => x.checkPrefix === prefix);
  return p ? path.join(p.dir, p.checks || 'checks.md') : null;
}

export function mergeFindings(runDir) {
  const run = loadRun(runDir);
  const queue = readJSON(path.join(runDir, 'queue.json'), { verify: [], hardening: [] });
  const ledger = readJSON(path.join(runDir, 'coverage-ledger.json'));
  const verdicts = new Map();
  for (const file of readDir(path.join(runDir, 'verdicts'))) for (const v of readArray(file)) if (v.fingerprint) verdicts.set(v.fingerprint, v);

  const findings = [];
  const rejected = [];
  for (const c of queue.verify) {
    const v = verdicts.get(c.fingerprint);
    if (!v) {
      findings.push({ ...base(c), verdict: 'needs_validation', severity: null, needs: 'The verifier returned no verdict for this candidate; check it by hand.' });
      continue;
    }
    if (v.verdict === 'rejected') { rejected.push({ fingerprint: c.fingerprint, checkId: c.checkId, file: c.file, line: c.line, title: c.title, disproof: v.disproof || v.reasoning || '' }); continue; }
    const f = { ...base(c), ...pick(v), verdict: v.verdict === 'confirmed' ? 'confirmed' : 'needs_validation' };
    if (f.verdict === 'needs_validation') { f.severity = null; f.needs = v.needs || 'Unresolved fact not stated by verifier.'; }
    findings.push(f);
  }
  for (const file of readDir(path.join(runDir, 'live'))) {
    for (const l of readArray(file)) {
      const f = { ...base({ ...l, source: 'live' }), ...pick(l), verdict: l.verdict === 'confirmed' ? 'confirmed' : 'needs_validation' };
      if (f.verdict === 'needs_validation') { f.severity = null; f.needs = l.needs || 'Confirm in the provider dashboard.'; }
      findings.push(f);
    }
  }
  // Carry verdicts for units whose code has not changed since the prior run.
  let carried = 0;
  const hardening = queue.hardening.map((c) => ({ fingerprint: c.fingerprint, checkId: c.checkId, title: c.title, severity: c.severity, file: c.file, line: c.line ?? null, note: c.reasoning || c.fixHint || '' }));
  if (run.prior) {
    const prior = readJSON(path.join(run.prior, 'findings.json'), { findings: [], hardening: [] });
    const unchangedFiles = new Set(ledger.units.filter((u) => u.status === 'unchanged').flatMap((u) => u.files));
    const accepted = new Set(readJSON(path.join(run.repoDir, 'accepted.json'), []).map((a) => a.fingerprint));
    const have = new Set(findings.map((f) => f.fingerprint));
    for (const f of prior.findings) {
      if (f.source === 'live' || !unchangedFiles.has(f.file) || have.has(f.fingerprint) || accepted.has(f.fingerprint)) continue;
      findings.push({ ...f, source: 'carried', carriedFrom: path.basename(run.prior) });
      carried++;
    }
    const haveH = new Set(hardening.map((h) => h.fingerprint));
    for (const h of prior.hardening || []) {
      if (unchangedFiles.has(h.file) && !haveH.has(h.fingerprint) && !accepted.has(h.fingerprint)) hardening.push(h);
    }
  }

  const order = (f) => (f.verdict === 'confirmed' ? sevRank(f.severity) : 10);
  findings.sort((a, b) => order(a) - order(b) || String(a.file).localeCompare(String(b.file)));
  findings.forEach((f, i) => { f.id = `F-${String(i + 1).padStart(3, '0')}`; });

  const count = (s) => ledger.units.filter((u) => u.status.startsWith(s)).length;
  const out = redactDeep({
    schemaVersion: 1,
    run: { target: run.source, mode: run.mode, live: run.live, runDir, generated: new Date().toISOString(), prior: run.prior },
    findings,
    hardening,
    rejected,
    coverage: { units: ledger.units.length, hunted: count('hunted'), unchanged: count('unchanged'), skipped: count('skipped'), carried, accepted: queue.accepted || 0 },
  });
  writeJSON(path.join(runDir, 'findings.json'), out);
  return out;
}

const base = (c) => ({
  fingerprint: c.fingerprint || fingerprint(c), checkId: c.checkId, title: c.title, severity: c.severity, file: c.file ?? null, line: c.line ?? null,
  evidence: c.evidence || '', reasoning: c.reasoning || '', exploit: c.exploit || '', source: c.source || 'hunter',
});
const pick = (v) => Object.fromEntries(Object.entries({
  checkId: v.checkId, title: v.title, severity: v.severity, file: v.file, line: v.line, evidence: v.evidence, reasoning: v.reasoning,
  exploit: v.exploit, impact: v.impact, fix: v.fix, needs: v.needs,
}).filter(([, x]) => x !== undefined && x !== null && x !== ''));

if (isMain(import.meta.url)) {
  const [cmd, runDir] = process.argv.slice(2);
  if (!runDir) die('usage: merge.mjs candidates|findings <runDir>');
  if (cmd === 'candidates') {
    const r = mergeCandidates(runDir);
    console.log(JSON.stringify({ ...r, batches: r.batches.map((b) => `${b.id} model=${b.model} n=${b.candidates.length}: ${path.join(runDir, 'briefs', `${b.id}.json`)}`) }));
  } else if (cmd === 'findings') {
    const r = mergeFindings(runDir);
    const c = (v) => r.findings.filter((f) => f.verdict === v).length;
    console.log(JSON.stringify({ confirmed: c('confirmed'), needs_validation: c('needs_validation'), rejected: r.rejected.length, hardening: r.hardening.length, coverage: r.coverage }));
  } else die('usage: merge.mjs candidates|findings <runDir>');
}
