#!/usr/bin/env node
// Phase 1c: coverage ledger, hunter batching, cost gate and agent briefs. No model tokens.
//   ledger.mjs <runDir> [--max-hunters 6]
// Units are (pack, surface, chunk). A unit whose content hash matches the prior
// run keeps its old verdicts and is not hunted again (incremental re-runs).
// Every agent gets a small JSON brief file; the orchestrator only passes its path.
import fs from 'node:fs';
import path from 'node:path';
import { loadRun, readJSON, writeJSON, fileHash, sha256, parseArgs, die, isMain, PLUGIN_ROOT } from './lib.mjs';

const UNIT_MAX_FILES = 15;
const UNIT_MAX_BYTES = 60 * 1024;
const HUNTER_TARGET_BYTES = 120 * 1024;
const GATE_SOURCE_FILES = 2000;
const GATE_BYTES = 1.5 * 1024 * 1024;

const checklist = (id) => path.join(PLUGIN_ROOT, 'providers', id, 'checks.md');

export function buildLedger(runDir, maxHunters = 6) {
  const run = loadRun(runDir);
  const inv = readJSON(path.join(runDir, 'inventory.json'));
  const { leads } = readJSON(path.join(runDir, 'leads.json'), { leads: [] });
  const sizes = new Map(inv.files.map((f) => [f.path, f.size]));
  const priorLedger = run.prior ? readJSON(path.join(run.prior, 'coverage-ledger.json'), null) : null;
  const priorUnits = new Map((priorLedger?.units || []).map((u) => [u.id, u]));

  const units = [];
  for (const p of inv.providers) {
    for (const [surface, s] of Object.entries(p.surfaces)) {
      let chunk = [];
      let bytes = 0;
      const flush = () => {
        if (!chunk.length) return;
        const id = `${p.id}:${surface}:${units.filter((u) => u.provider === p.id && u.surface === surface).length + 1}`;
        const hash = sha256(`${p.version}|` + chunk.map((f) => `${f}:${fileHash(path.join(run.target, f))}`).join('|'));
        const unitLeads = leads.filter((l) => chunk.includes(l.file)).map((l) => l.leadId);
        units.push({ id, provider: p.id, surface, priority: s.priority, files: chunk, bytes, hash, leads: unitLeads, status: 'pending' });
        chunk = [];
        bytes = 0;
      };
      for (const f of s.files) {
        const size = sizes.get(f) || 0;
        if (chunk.length && (chunk.length >= UNIT_MAX_FILES || bytes + size > UNIT_MAX_BYTES)) flush();
        chunk.push(f);
        bytes += size;
      }
      flush();
    }
  }

  for (const u of units) {
    const prev = priorUnits.get(u.id);
    if (prev && prev.hash === u.hash && ['hunted', 'unchanged'].includes(prev.status)) u.status = 'unchanged';
    else if (run.mode === 'quick') u.status = 'skipped:quick-mode';
    else if (run.mode === 'default' && u.priority === 'low' && !u.leads.length) u.status = 'skipped:low-priority-no-leads';
  }

  // Greedy bin packing of pending units into at most maxHunters batches,
  // keeping a pack's units together where possible so each hunter loads few checklists.
  const pending = units.filter((u) => u.status === 'pending').sort((a, b) => a.provider.localeCompare(b.provider) || b.bytes - a.bytes);
  const pendingBytes = pending.reduce((a, u) => a + u.bytes, 0);
  const wanted = Math.ceil(pendingBytes / HUNTER_TARGET_BYTES);
  const nBatches = Math.min(maxHunters, Math.max(pending.length ? 1 : 0, wanted));
  const batches = Array.from({ length: nBatches }, (_, i) => ({ id: `h${i + 1}`, units: [], providers: new Set(), bytes: 0 }));
  for (const u of pending) {
    const fit = batches.filter((b) => b.bytes + u.bytes <= HUNTER_TARGET_BYTES * 1.25);
    const pool = fit.length ? fit : batches;
    const same = pool.filter((b) => b.providers.has(u.provider));
    const b = (same.length ? same : pool).sort((x, y) => x.bytes - y.bytes)[0];
    b.units.push(u.id);
    b.providers.add(u.provider);
    b.bytes += u.bytes;
  }
  for (const u of pending) u.status = 'hunted';

  const gateReasons = [];
  if (inv.sourceFileCount > GATE_SOURCE_FILES) gateReasons.push(`${inv.sourceFileCount} source files (> ${GATE_SOURCE_FILES})`);
  if (pendingBytes > GATE_BYTES) gateReasons.push(`${Math.round(pendingBytes / 1024)} KB to hunt (> ${GATE_BYTES / 1024} KB)`);
  if (wanted > maxHunters) gateReasons.push(`would need ${wanted} hunters; capped at ${maxHunters}, so each hunter gets more code`);
  const estTokens = Math.round(pendingBytes / 3.5 * 1.4 + nBatches * 15000);

  const ledger = {
    generated: new Date().toISOString(), mode: run.mode,
    units, batches: batches.filter((b) => b.units.length).map((b) => ({ ...b, providers: [...b.providers] })),
    estimate: { hunters: nBatches, huntTokens: estTokens, model: 'sonnet' },
    gate: gateReasons.length ? { confirm: true, reasons: gateReasons } : { confirm: false },
  };
  writeJSON(path.join(runDir, 'coverage-ledger.json'), ledger);
  writeBriefs(runDir, run, inv, leads, ledger);
  return ledger;
}

function writeBriefs(runDir, run, inv, leads, ledger) {
  const byId = new Map(ledger.units.map((u) => [u.id, u]));
  const leadsById = new Map(leads.map((l) => [l.leadId, l]));
  const arch = path.join(runDir, 'architecture.md');
  writeJSON(path.join(runDir, 'briefs', 'recon.json'), {
    role: 'recon', target: run.target, read: [path.join(runDir, 'summary.md'), path.join(runDir, 'leads.md')],
    packs: inv.providers.map((p) => p.id), output: arch,
  });
  for (const b of ledger.batches) {
    const units = b.units.map((id) => byId.get(id));
    writeJSON(path.join(runDir, 'briefs', `${b.id}.json`), {
      role: 'hunter', batch: b.id, target: run.target, architecture: arch,
      checklists: [...new Set(['common', ...b.providers])].map(checklist),
      units: units.map((u) => ({ id: u.id, pack: u.provider, surface: u.surface, files: u.files })),
      leads: units.flatMap((u) => u.leads).map((id) => leadsById.get(id)),
      output: path.join(runDir, 'candidates', `${b.id}.json`),
    });
  }
  if (run.live) {
    const live = inv.providers.map((p) => readJSON(path.join(PLUGIN_ROOT, 'providers', p.id, 'provider.json'))).filter((p) => p.live);
    writeJSON(path.join(runDir, 'briefs', 'live.json'), {
      role: 'live', target: run.target,
      providers: live.map((p) => ({ id: p.id, mcp: p.live.mcp, checks: path.join(PLUGIN_ROOT, 'providers', p.id, p.live.checks) })),
      output: path.join(runDir, 'live', 'findings.json'),
    });
  }
  fs.mkdirSync(path.join(runDir, 'candidates'), { recursive: true, mode: 0o700 });
}

if (isMain(import.meta.url)) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const runDir = positional[0] || die('usage: ledger.mjs <runDir> [--max-hunters N]');
  const l = buildLedger(runDir, Number(flags['max-hunters']) || 6);
  const count = (s) => l.units.filter((u) => u.status.startsWith(s)).length;
  console.log(JSON.stringify({
    units: l.units.length, hunt: count('hunted'), unchanged: count('unchanged'), skipped: count('skipped'),
    hunters: l.batches.map((b) => `${b.id}: ${path.join(runDir, 'briefs', `${b.id}.json`)}`),
    estimate: l.estimate, gate: l.gate,
  }));
}
