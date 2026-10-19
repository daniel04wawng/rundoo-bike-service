import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiResearch, allowedSource } from '../server/modules/ai_research.js';
import { matchFixture } from '../server/adapters/research_llm.js';

const job = { id: 'WO-T', configuration: { version: 1, components: {} }, constraints: { goalType: 'brake_service' }, request: { extraction: {} } };

test('only https manufacturer domains count as sources', () => {
  assert.equal(allowedSource('https://productinfo.shimano.com/en/compatibility/C-201'), true);
  assert.equal(allowedSource('https://koolstop.com/products/dura-2'), true);
  assert.equal(allowedSource('http://productinfo.shimano.com/x'), false);
  assert.equal(allowedSource('https://shimano.com.evil.example/x'), false);
  assert.equal(allowedSource('https://some-retailer.com/r55c4'), false);
});

test('a part backed only by a retailer page is uncited and its alternative is dropped', () => {
  const raw = {
    status: 'ready',
    requirements: [{
      id: 'brake_pads', slot: 'brake_pads', title: 'Brake pads', kind: 'required',
      part: { brand: 'Shimano', name: 'R55C4', variant: 'R55C4', mpn: 'R55C4' },
      reason: 'x', fit_checks: [{ detail: 'fits', source_ids: ['r1'] }], source_ids: ['r1'],
      alternatives: [{ part: { brand: 'X', name: 'Y', variant: 'Y', mpn: 'Y1' }, reason: 'y', source_ids: ['r1'] }],
    }],
    sources: [{ id: 'r1', title: 'Retailer', url: 'https://some-retailer.com/r55c4', claim: 'fits' }],
  };
  const { result } = normalizeAiResearch({ job, run: { mode: 'replay', raw }, catalog: {} });
  const req = result.requirements_ai[0];
  assert.equal(req.citation, 'uncited');
  assert.deepEqual(req.alternatives, []);
  assert.equal(result.evidence.length, 0);
});

test('missing research result becomes Not found, never a guess', () => {
  const { result } = normalizeAiResearch({ job, run: { mode: 'replay', raw: null, error: 'No recorded research' }, catalog: {} });
  assert.equal(result.status, 'not_found');
  assert.equal(result.not_found.kind, 'no_research');
});

test('replay matcher prefers the most specific fixture', () => {
  const base = { goal_type: 'brake_service', components: {} };
  assert.equal(matchFixture(base).id, 'brake-pads-needs-info');
  const answered = { goal_type: 'brake_service', components: { brake_caliper: { label: 'BR-R7000', status: 'confirmed' }, rim_material: { label: 'Aluminum', status: 'confirmed' } } };
  assert.equal(matchFixture(answered).id, 'brake-pads-br-r7000-aluminum');
  const carbon = { goal_type: 'brake_service', components: { brake_caliper: { label: 'BR-R7000', status: 'confirmed' }, rim_material: { label: 'Carbon', status: 'confirmed' } } };
  assert.equal(matchFixture(carbon), null);
});

test('aliases resolve exact part numbers only (R55C4 never matches R55C4-A)', async () => {
  const { resolveAlias } = await import('../server/modules/ai_research.js');
  const aliases = { 'AI-R55C4': ['R55C4', 'Y8L298060', 'R55C4 cartridge inserts (pair)'] };
  assert.equal(resolveAlias({ mpn: 'Y8L298060', variant: 'R55C4 cartridge inserts (pair)' }, aliases), 'AI-R55C4');
  assert.equal(resolveAlias({ mpn: 'y8l-298060' }, aliases), 'AI-R55C4');
  assert.equal(resolveAlias({ mpn: 'Y8PP98060', variant: 'R55C4-A for carbon rim' }, aliases), null);
  assert.equal(resolveAlias({ variant: 'R55C4 (for carbon rims)' }, aliases), null);
});

test('an alternative of a different part type is dropped', () => {
  const raw = {
    status: 'ready',
    requirements: [{
      id: 'cassette', slot: 'cassette', title: 'Cassette', kind: 'required',
      part: { brand: 'Shimano', name: '9-speed cassette', variant: 'CS-HG400-9 11-32T' },
      reason: 'x', fit_checks: [{ detail: 'fits', source_ids: ['s1'] }], source_ids: ['s1'],
      alternatives: [
        { part: { brand: 'Shimano', name: 'Rear derailleur', variant: 'RD-R3000-GS' }, reason: 'for 11-34', source_ids: ['s1'] },
        { part: { brand: 'Shimano', name: '9-speed cassette', variant: 'CS-HG50-9 11-30T' }, reason: 'smaller', source_ids: ['s1'] },
      ],
    }],
    sources: [{ id: 's1', title: 'C-454', url: 'https://productinfo.shimano.com/en/compatibility/C-454', claim: 'x' }],
  };
  const { result } = normalizeAiResearch({ job, run: { mode: 'live', raw }, catalog: {} });
  assert.deepEqual(result.requirements_ai[0].alternatives, ['AI-SHIMANO-CS-HG50-9-11-30T']);
});
