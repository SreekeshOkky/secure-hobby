#!/usr/bin/env node
// Validates findings.json against the rules in schemas/findings.schema.json.
//   validate-findings.mjs <runDir|findings.json>
// Exit 0 when valid, 1 with one error per line otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, SEVERITIES, die, isMain } from './lib.mjs';

const CHECK_ID = /^[A-Z][A-Z0-9]*-\d{3}$/;
const VERDICTS = ['confirmed', 'needs_validation'];

export function validateFindings(doc) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(doc && doc.schemaVersion === 1, 'schemaVersion must be 1');
  need(Array.isArray(doc?.findings), 'findings must be an array');
  need(Array.isArray(doc?.hardening), 'hardening must be an array');
  need(Array.isArray(doc?.rejected), 'rejected must be an array');
  need(doc?.coverage && typeof doc.coverage.units === 'number', 'coverage.units must be a number');
  const ids = new Set();
  for (const [i, f] of (doc?.findings || []).entries()) {
    const at = `findings[${i}]${f?.id ? ` (${f.id})` : ''}`;
    need(/^F-\d{3,}$/.test(f.id || ''), `${at}: id must look like F-001`);
    need(!ids.has(f.id), `${at}: duplicate id`);
    ids.add(f.id);
    need(VERDICTS.includes(f.verdict), `${at}: verdict must be one of ${VERDICTS.join(', ')}`);
    need(CHECK_ID.test(f.checkId || ''), `${at}: checkId must look like SUPA-001`);
    need(typeof f.title === 'string' && f.title.length > 3, `${at}: title required`);
    need(typeof f.fingerprint === 'string' && f.fingerprint.length >= 8, `${at}: fingerprint required`);
    need(f.file === null || typeof f.file === 'string', `${at}: file must be a string or null`);
    need(f.line === null || f.line === undefined || Number.isInteger(f.line), `${at}: line must be an integer or null`);
    if (f.verdict === 'confirmed') {
      need(SEVERITIES.includes(f.severity), `${at}: confirmed findings need a severity`);
      need(typeof f.evidence === 'string' && f.evidence.length > 0, `${at}: confirmed findings need evidence`);
      need(f.fix && typeof f.fix.summary === 'string' && f.fix.summary.length > 0, `${at}: confirmed findings need fix.summary`);
      if (f.fix?.patch) need(/^(---|diff --git) /m.test(f.fix.patch), `${at}: fix.patch must be a unified diff`);
    } else if (f.verdict === 'needs_validation') {
      need(f.severity === null, `${at}: needs_validation findings must have severity null`);
      need(typeof f.needs === 'string' && f.needs.length > 0, `${at}: needs_validation findings must state the unresolved fact in "needs"`);
    }
  }
  for (const [i, h] of (doc?.hardening || []).entries()) need(CHECK_ID.test(h.checkId || ''), `hardening[${i}]: checkId must look like SUPA-001`);
  return errs;
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2] || die('usage: validate-findings.mjs <runDir|findings.json>');
  const file = fs.statSync(arg).isDirectory() ? path.join(arg, 'findings.json') : arg;
  const errs = validateFindings(readJSON(file));
  if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
  console.log('findings.json is valid');
}
