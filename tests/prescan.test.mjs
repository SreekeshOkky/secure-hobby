import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FIXTURES, ROOT, tempHome, prepare, readJSON } from './helpers.mjs';

const expected = readJSON(path.join(ROOT, 'evals', 'expected.json'));

for (const [fixture, exp] of Object.entries(expected)) {
  if (fixture.startsWith('$')) continue;
  test(`detect + prescan: ${fixture}`, () => {
    const home = tempHome();
    const runDir = prepare(home, path.join(FIXTURES, fixture));
    const inv = readJSON(path.join(runDir, 'inventory.json'));
    assert.deepEqual(inv.providers.map((p) => p.id).sort(), [...exp.packs].sort(), 'detected packs');

    const { leads } = readJSON(path.join(runDir, 'leads.json'));
    for (const e of exp.findings.filter((f) => f.prescan)) {
      assert.ok(leads.some((l) => l.id === e.checkId && l.file.endsWith(e.file)), `missing lead ${e.checkId} in ${e.file}`);
    }
    if (!exp.findings.length) {
      const loud = leads.filter((l) => ['critical', 'high', 'medium'].includes(l.severity));
      assert.deepEqual(loud.map((l) => `${l.id} ${l.file}`), [], 'clean fixture should have no medium+ leads');
    }
    // Secret values never reach disk in clear text.
    const raw = JSON.stringify(leads);
    assert.ok(!raw.includes('FAKEsignatureFAKEsignatureFAKEsig00'), 'JWT signature leaked into leads.json');
    assert.ok(!/sk_live_\w{16,}/.test(raw), 'Stripe-style key leaked into leads.json');
  });
}

test('ledger: briefs, batching and cost estimate', () => {
  const home = tempHome();
  const runDir = prepare(home, path.join(FIXTURES, 'next-supabase-vuln'));
  const ledger = readJSON(path.join(runDir, 'coverage-ledger.json'));
  assert.ok(ledger.batches.length >= 1 && ledger.batches.length <= 6);
  assert.equal(ledger.gate.confirm, false);
  const brief = readJSON(path.join(runDir, 'briefs', 'h1.json'));
  assert.ok(brief.checklists.some((c) => c.endsWith('common/checks.md')));
  assert.ok(brief.units.length > 0 && brief.output.endsWith('candidates/h1.json'));
});

test('quick mode skips hunting and default mode skips low-priority units without leads', () => {
  const home = tempHome();
  const quick = readJSON(path.join(prepare(home, path.join(FIXTURES, 'next-supabase-clean'), ['--offline', '--quick']), 'coverage-ledger.json'));
  assert.equal(quick.batches.length, 0);
  assert.ok(quick.units.every((u) => u.status === 'skipped:quick-mode'));
  const def = readJSON(path.join(prepare(home, path.join(FIXTURES, 'next-supabase-clean')), 'coverage-ledger.json'));
  assert.ok(def.units.some((u) => u.status === 'skipped:low-priority-no-leads'));
});
