import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedState } from '../server/seed.js';
import { checkCombo, research, capacityNeeded } from '../server/modules/research.js';
import { availability, bestSource, landed } from '../server/modules/sourcing.js';
import { computeTotals } from '../server/modules/estimate.js';
import { rulesExtract } from '../server/modules/extraction.js';

const s = buildSeedState();
const c = s.catalog;
const ev = (p) => p.evidenceIds || [];
const combo = (rd, cs, fh = 'FH-HG-L') =>
  checkCombo({ crank: c['FC-R7000-5034'], rd: c[rd], cassette: c[cs], shifters: c['ST-R7000'], freehub: c[fh] }, ev);

test('RD-R7000-SS: 11-30 fits at the 35T capacity limit; 11-32 does not fit', () => {
  assert.equal(capacityNeeded(c['FC-R7000-5034'], c['CS-R7000-1130']), 35);
  assert.equal(combo('RD-R7000-SS', 'CS-R7000-1130').compatible, true);
  const r = combo('RD-R7000-SS', 'CS-R7000-1132');
  assert.equal(r.compatible, false);
  assert.equal(r.checks.find((x) => x.rule === 'max_low_sprocket').pass, false);
});

test('RD-R7000-GS runs 11-34 (39T of 39T) and needs the 1.85 mm spacer on HG spline L', () => {
  const r = combo('RD-R7000-GS', 'CS-HG800-1134');
  assert.equal(r.compatible, true);
  assert.equal(r.spacerPartId, 'SPACER-185');
  assert.equal(combo('RD-R7000-GS', 'CS-HG800-1134', 'FH-HG-M').spacerPartId, null);
});

test('every verified part cites at least one evidence record that exists', () => {
  for (const p of Object.values(c)) {
    if (!p || !p.slot || p.unverified) continue;
    assert.ok(p.evidenceIds?.length, `${p.id} has no evidence`);
    for (const id of p.evidenceIds) assert.ok(s.evidence[id], `${p.id} cites missing ${id}`);
  }
});

test('research asks for the missing derailleur cage instead of guessing', () => {
  const job = structuredClone(s.jobs['WO-1042']);
  job.constraints = { goalType: 'easier_gearing' };
  for (const k of Object.keys(job.configuration.components)) if (job.configuration.components[k].partId) job.configuration.components[k].status = 'confirmed';
  const r = research({ job, catalog: c, evidence: s.evidence });
  assert.equal(r.status, 'needs_info');
  assert.deepEqual(r.questions.map((q) => q.slot), ['rear_derailleur']);
  assert.deepEqual(r.questions[0].options.map((o) => o.value), ['RD-R7000-SS', 'RD-R7000-GS', 'OTHER-rear_derailleur']);
});

test('available stock excludes committed units; stock search does not reserve', () => {
  const before = JSON.stringify(s.inventory);
  assert.equal(availability(s.inventory, 'CS-R7000-1132', 'LOC-VAN').available, 0);
  bestSource({ part: c['CS-R7000-1132'], inventory: s.inventory, offers: s.offers, locationId: 'LOC-VAN' });
  assert.equal(JSON.stringify(s.inventory), before);
});

test('offers below a supplier order minimum are ineligible; shipping is added', () => {
  const north = s.offers.find((o) => o.id === 'OF-2');
  assert.equal(landed(north).eligible, false);
  const coastal = s.offers.find((o) => o.id === 'OF-1');
  assert.equal(landed(coastal).landed_cents, 5200 + 900);
});

test('totals are deterministic integer cents with the demo tax rate', () => {
  const t = computeTotals([{ type: 'part', amount_cents: 6999 }, { type: 'labor', amount_cents: 7500 }], s.shop);
  assert.equal(t.subtotal_cents, 14499);
  assert.equal(t.tax_cents, 1740);
  assert.equal(t.total_cents, 16239);
});

test('extraction pulls budget, deadline and bike value; never invents conditions', () => {
  const x = rulesExtract('Easier climbing gears for a tour in 3 weeks. Budget around $250. Bike is worth about $300.');
  assert.equal(x.goal.type, 'easier_gearing');
  assert.equal(x.budget, 250);
  assert.equal(x.deadline.days, 15);
  assert.equal(x.bike_value, 300);
  assert.deepEqual(x.observed_conditions, []);
});
