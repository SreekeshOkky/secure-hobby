#!/usr/bin/env node
// Scores a run against evals/expected.json.
//   eval.mjs <runDir> [--fixture name] [--append]
// Prescan-only recall is checked deterministically by tests/prescan.test.mjs.
// A finding matches an expected entry when checkId is equal and the file ends with the expected path.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, parseArgs, die, isMain, PLUGIN_ROOT } from './lib.mjs';

export const EXPECTED = () => readJSON(path.join(PLUGIN_ROOT, 'evals', 'expected.json'));
const matches = (f, e) => f.checkId === e.checkId && (!e.file || String(f.file || '').endsWith(e.file));

export function score(reported, expected) {
  const hit = expected.filter((e) => reported.some((f) => matches(f, e)));
  const tp = reported.filter((f) => expected.some((e) => matches(f, e)));
  return {
    expected: expected.length, reported: reported.length, found: hit.length,
    recall: expected.length ? hit.length / expected.length : 1,
    precision: reported.length ? tp.length / reported.length : 1,
    missed: expected.filter((e) => !hit.includes(e)).map((e) => `${e.checkId} ${e.file || ''}`.trim()),
    unexpected: reported.filter((f) => !tp.includes(f)).map((f) => `${f.checkId} ${f.file || ''}`.trim()),
  };
}

if (isMain(import.meta.url)) {
  const { positional, flags } = parseArgs(process.argv.slice(2), ['append']);
  const runDir = positional[0] || die('usage: eval.mjs <runDir> [--fixture name] [--append]');
  const run = readJSON(path.join(runDir, 'run.json'));
  const fixture = flags.fixture || path.basename(run.target);
  const exp = EXPECTED()[fixture];
  if (!exp) die(`no expected entries for fixture "${fixture}"`);
  const doc = readJSON(path.join(runDir, 'findings.json'));
  const confirmed = doc.findings.filter((f) => f.verdict === 'confirmed');
  const s = score(confirmed, exp.findings);
  const anyVerdict = score(doc.findings, exp.findings);
  const ledger = readJSON(path.join(runDir, 'coverage-ledger.json'), { batches: [] });
  const queue = readJSON(path.join(runDir, 'queue.json'), { batches: [] });
  const models = queue.batches.reduce((a, b) => ({ ...a, [b.model]: (a[b.model] || 0) + 1 }), {});
  const row = {
    fixture, mode: run.mode, recall: +s.recall.toFixed(2), recallInclNeedsValidation: +anyVerdict.recall.toFixed(2), precision: +s.precision.toFixed(2),
    hunters: ledger.batches.length, verifiers: models, missed: s.missed, unexpected: s.unexpected,
  };
  console.log(JSON.stringify(row, null, 2));
  if (flags.append) {
    const file = path.join(PLUGIN_ROOT, 'evals', 'RESULTS.md');
    if (!fs.existsSync(file)) fs.writeFileSync(file, '| date | fixture | mode | recall | recall incl. needs_validation | precision | hunters | verifiers |\n|---|---|---|---|---|---|---|---|\n');
    fs.appendFileSync(file, `| ${new Date().toISOString().slice(0, 10)} | ${fixture} | ${run.mode} | ${row.recall} | ${row.recallInclNeedsValidation} | ${row.precision} | ${row.hunters} | ${Object.entries(models).map(([m, n]) => `${n}×${m}`).join(' ') || '0'} |\n`);
  }
}
