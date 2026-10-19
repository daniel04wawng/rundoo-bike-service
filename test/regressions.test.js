// Regression checks from code review (C-1, P1-1..3).
// Each test drives the orchestrator tools against a throwaway run directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rundoo-regress-'));
process.env.EVAL_RUN_ID = 'regressions';
process.env.EXTRACTION_MODE = 'replay';
process.env.RESEARCH_MODE = 'replay';

const store = await import('../server/store.js');
const t = await import('../server/orchestrator.js');

const GEARING = 'Customer wants easier climbing gears for a hilly tour in 3 weeks. Budget around $250.';
const R7000 = { crankset: { partId: 'FC-R7000-5034' }, cassette: { partId: 'CS-R7000-1128' }, shifters: { partId: 'ST-R7000' }, freehub: { partId: 'FH-HG-L' } };

// Rules job ready to quote: 11-30 cassette selected, chain skipped.
async function readyGearingJob() {
  store.reset();
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: GEARING });
  const v = await t.updateConfirmedComponents(id, { ...R7000, rear_derailleur: { partId: 'RD-R7000-SS' } });
  const cfg = v.job.configuration.version;
  t.savePartSelection(id, { requirementId: 'cassette', partId: 'CS-R7000-1130' }, cfg);
  t.savePartSelection(id, { requirementId: 'chain', status: 'excluded' }, cfg);
  return id;
}

const expectError = (fn, code) => assert.throws(fn, (err) => err.code === code);

test('C-1: a draft that no longer matches the work order cannot be sent or approved', async () => {
  const id = await readyGearingJob();
  const { estimate } = t.createOrUpdateDraftEstimate(id);
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 2 }]);
  expectError(() => t.sendApprovalRequest(estimate.id, 'Hi, quote attached.'), 'stale_draft');
  assert.equal(t.getJobContext(id).estimates[0].status, 'draft');

  // A refreshed draft can be sent; if the job then changes, approval is refused.
  const fresh = t.createOrUpdateDraftEstimate(id).estimate;
  t.sendApprovalRequest(fresh.id, 'Hi, quote attached.');
  store.mutate((s) => { s.jobs[id].labor.find((l) => l.id === 'labor-cassette').hours = 3; });
  expectError(() => t.recordCustomerResponse(fresh.id, fresh.version, 'approve'), 'not_open');
  const after = t.getJobContext(id);
  assert.notEqual(after.job.status, 'approved');
  assert.equal(after.job.approval, null);
});

test('P1-1: stock only counts when it covers the whole quantity', async () => {
  store.reset();
  store.mutate((s) => { s.inventory.find((i) => i.partId === 'AI-R55C4').onHand = 1; });
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: 'Brakes squeal and the pads look worn. Replace pads.' });
  await t.updateConfirmedComponents(id, { brake_caliper: { label: 'BR-R7000' } });
  const v = await t.updateConfirmedComponents(id, { rim_material: { label: 'Aluminum' } });
  const req = v.job.requirements[0];
  assert.equal(req.qty, 2);
  assert.equal(req.sourcing.stock.available, 1);
  assert.notEqual(req.sourcing.recommended.type, 'stock');
  const sel = t.savePartSelection(id, { requirementId: req.id }, v.job.configuration.version);
  assert.notEqual(sel.job.selections[req.id].sourcing.type, 'stock');
});

test('P1-2: custom labor hours are bounded; a bad entry changes nothing', async () => {
  const id = await readyGearingJob();
  const before = t.getJobContext(id).preview.totals.total_cents;
  expectError(() => t.updateLabor(id, [{ label: 'Negative', hours: -3 }]), 'bad_hours');
  expectError(() => t.updateLabor(id, [{ label: 'Huge', hours: 5000 }]), 'bad_hours');
  expectError(() => t.updateLabor(id, [{ id: 'labor-cassette', hours: 1 }, { label: 'Bad', hours: 'x' }]), 'bad_hours');
  const ctx = t.getJobContext(id);
  assert.equal(ctx.preview.totals.total_cents, before);
  assert.equal(ctx.job.labor.find((l) => l.id === 'labor-cassette').hours, 0.25);
  assert.ok(ctx.job.labor.every((l) => l.hours > 0));
  // Default hours still work when none are given.
  const added = t.updateLabor(id, [{ label: 'Toe-in and brake adjust' }]);
  assert.equal(added.job.labor.find((l) => l.label === 'Toe-in and brake adjust').hours, 0.25);
});

test('P1-3: a skipped item stays skipped when research passes through needs_info', async () => {
  const id = await readyGearingJob();
  const mid = await t.updateConfirmedComponents(id, { crankset: { status: 'needs_inspection' } });
  assert.equal(mid.job.research.status, 'needs_info');
  assert.equal(mid.preview.lines.filter((l) => l.type === 'part').length, 0);
  const v = await t.updateConfirmedComponents(id, { crankset: { partId: 'FC-R7000-5034' } });
  assert.equal(v.job.research.status, 'ready');
  assert.equal(v.job.selections.chain?.status, 'excluded');
  assert.ok(!v.preview.lines.some((l) => l.requirementId === 'chain'));
});

// ---- Minor issues from the same review (P2) ----

const BRAKES = 'Brakes squeal and the pads look worn. Replace pads.';

test('P2-2: replay research returns with the hand-checked source marks already set', async () => {
  store.reset();
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: BRAKES }, { wait: false });
  await t.updateConfirmedComponents(id, { brake_caliper: { label: 'BR-R7000' } }, null, { wait: false });
  const v = await t.updateConfirmedComponents(id, { rim_material: { label: 'Aluminum' } }, null, { wait: false });
  const partId = v.job.requirements[0].current_part_id;
  assert.equal(v.job.research.verification?.items?.[partId]?.status, 'confirmed_by_hand');
});

test('P2-3: supplier question includes components the mechanic typed in', async () => {
  store.reset();
  const id = t.createJob({ customerId: 'C-2', bikeId: 'B-2' }).job.id;
  await t.describeJob(id, { text: 'Wants easier gears on an older road bike, not sure what is on it. Bike is worth about $300.' });
  await t.updateConfirmedComponents(id, { rear_derailleur: { label: 'Campagnolo Veloce 10-speed' }, cassette: { label: '13-26' } });
  const v = t.draftSupplierInquiry(id, {});
  const text = v.job.inquiries.at(-1).text;
  assert.match(text, /Rear derailleur Campagnolo Veloce 10-speed/);
  assert.match(text, /Cassette 13-26/);
  assert.doesNotMatch(text, /not yet identified/);
});

test('P2-4: approving a declined quote says it was declined, not updated', async () => {
  const id = await readyGearingJob();
  const sent = t.sendQuote(id, {});
  const est = sent.active_estimate;
  t.recordCustomerResponse(est.id, est.version, 'decline');
  assert.throws(() => t.recordCustomerResponse(est.id, est.version, 'approve'), (err) => err.code === 'not_open' && /declined/i.test(err.message));
});

test('P2-5: an idempotency key reused on another job does not return that job\'s result', async () => {
  const a = await readyGearingJob();
  const first = t.sendQuote(a, { idempotency_key: 'same-key' });
  const b = t.createJob({}).job.id;
  await t.describeJob(b, { text: GEARING });
  const v = await t.updateConfirmedComponents(b, { ...R7000, rear_derailleur: { partId: 'RD-R7000-SS' } });
  t.savePartSelection(b, { requirementId: 'cassette', partId: 'CS-R7000-1130' }, v.job.configuration.version);
  t.savePartSelection(b, { requirementId: 'chain', status: 'excluded' }, v.job.configuration.version);
  const second = t.sendQuote(b, { idempotency_key: 'same-key' });
  assert.equal(first.job.id, a);
  assert.equal(second.job.id, b);
  assert.equal(second.job.status, 'quote_sent');
  // Retrying on the same job still replays.
  assert.deepEqual(t.sendQuote(b, { idempotency_key: 'same-key' }), second);
});

test('P2-7: new work on an existing work order keeps its title', async () => {
  store.reset();
  const v = await t.describeJob('WO-1044', { text: BRAKES });
  assert.equal(v.job.title, 'Tune-up, in progress');
  assert.match(v.job.summary, /^Tune-up, in progress \+ /);
  assert.match(t.listJobs().jobs.find((j) => j.id === 'WO-1044').summary, /^Tune-up/);
});

test('Revise with no changes goes back to tracking; approval while revising does too', async () => {
  const id = await readyGearingJob();
  const sent = t.sendQuote(id, {});
  const est = sent.active_estimate;
  t.recordCustomerResponse(est.id, est.version, 'approve');
  t.setStage(id, 'review');
  t.setStage(id, 'quote');
  const again = t.sendQuote(id, {});
  assert.equal(again.result.already_sent, true);
  assert.equal(again.job.stage, 'track');
  assert.equal(again.job.status, 'approved');
  assert.equal(again.estimates.length, 1);

  // Sent v2, mechanic opens it to change, customer approves meanwhile.
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 0.5 }]);
  const v2 = t.sendQuote(id, {}).active_estimate;
  t.setStage(id, 'review');
  t.recordCustomerResponse(v2.id, v2.version, 'approve');
  const after = t.getJobContext(id);
  assert.equal(after.job.status, 'approved');
  assert.equal(after.job.stage, 'track');
});

// ---- Second review pass ----

// Rules job with the recommended 11-34 plan and every row selected.
async function fullPlanJob() {
  store.reset();
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: GEARING });
  const v = await t.updateConfirmedComponents(id, { ...R7000, rear_derailleur: { partId: 'RD-R7000-SS' } });
  const cfg = v.job.configuration.version;
  for (const r of v.job.requirements) t.savePartSelection(id, { requirementId: r.id }, cfg);
  return { id, cfg };
}

test('S-1: labor the mechanic excluded stays excluded; labor for a removed part goes', async () => {
  const { id, cfg } = await fullPlanJob();
  t.updateLabor(id, [{ id: 'labor-drivetrain_adjust', included: false }]);
  t.savePartSelection(id, { requirementId: 'chain', partId: 'KMC-X11' }, cfg);
  assert.equal(t.getJobContext(id).job.labor.find((l) => l.id === 'labor-drivetrain_adjust').included, false);

  t.updateLabor(id, [{ id: 'labor-rear_derailleur', hours: 0.75 }]);
  const v = t.savePartSelection(id, { requirementId: 'cassette', partId: 'CS-R7000-1130' }, cfg);
  assert.ok(v.result.dependency_changes.some((d) => d.requirementId === 'rear_derailleur'));
  assert.ok(!v.job.labor.some((l) => l.id === 'labor-rear_derailleur'));
  assert.ok(!v.preview.lines.some((l) => l.id === 'labor-rear_derailleur'));
});

test('S-2: a carbon-rim result never resolves to the aluminum product', async () => {
  const { normalizeAiResearch, resolveAlias } = await import('../server/modules/ai_research.js');
  const s = store.load();
  const carbon = { brand: 'Shimano', name: 'R55C4 inserts', variant: 'R55C4 (carbon rims)', mpn: 'R55C4' };
  assert.equal(resolveAlias(carbon, s.aliases), null);
  assert.equal(resolveAlias({ mpn: 'Y8L298060', variant: 'R55C4 cartridge inserts (pair)' }, s.aliases), 'AI-R55C4');
  const raw = {
    status: 'ready',
    requirements: [{ id: 'brake_pads', slot: 'brake_pads', title: 'Brake pads', kind: 'required', qty: 2, part: { ...carbon, shop_part_id: 'AI-R55C4' }, reason: 'carbon', fit_checks: [{ detail: 'fits', source_ids: ['s1'] }], source_ids: ['s1'] }],
    sources: [{ id: 's1', url: 'https://productinfo.shimano.com/en/compatibility/C-201', claim: 'R55C4 for carbon rim' }],
  };
  const catalog = { ...s.catalog, 'AI-R55C4': { id: 'AI-R55C4', slot: 'brake_pads', variant: 'R55C4 (aluminum rims)', aiSourced: true } };
  const job = { id: 'WO-T', configuration: { version: 1, components: {} }, constraints: {}, request: { extraction: {} } };
  const { result, parts } = normalizeAiResearch({ job, run: { mode: 'live', raw }, catalog, aliases: s.aliases, shopIds: new Set(Object.keys(s.priceList)) });
  const pid = result.requirements_ai[0].partId;
  assert.notEqual(pid, 'AI-R55C4');
  assert.equal(parts.find((p) => p.id === pid).variant, 'R55C4 (carbon rims)');
});

test('S-3: a rejected request leaves the job untouched', async () => {
  const id = await readyGearingJob();
  const sent = t.sendQuote(id, {}).active_estimate;
  t.recordCustomerResponse(sent.id, sent.version, 'approve');
  const before = JSON.stringify(t.getJobContext(id));
  await assert.rejects(t.updateConfirmedComponents(id, { crankset: { partId: 'FC-R7000-5034' }, shifters: { label: '  ' } }), (e) => e.code === 'empty_component');
  assert.equal(JSON.stringify(t.getJobContext(id)), before);
});

test('S-4: after using an AI alternative the original pick is offered back, with each card showing its own sources', async () => {
  store.reset();
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: 'Brakes squeal and the pads look worn. Replace pads.' });
  await t.updateConfirmedComponents(id, { brake_caliper: { label: 'BR-R7000' } });
  const v = await t.updateConfirmedComponents(id, { rim_material: { label: 'Aluminum' } });
  const orig = v.job.requirements[0];
  const after = t.savePartSelection(id, { requirementId: orig.id, partId: 'AI-KS-DR2B' }, v.job.configuration.version);
  const req = after.job.requirements[0];
  assert.ok(req.alternatives.some((a) => a.partId === orig.current_part_id));
  assert.equal(req.reason, orig.altMeta['AI-KS-DR2B'].reason);
  assert.deepEqual(req.evidence_ids, orig.altMeta['AI-KS-DR2B'].evidence_ids);
  assert.ok(!req.checks.some((c) => /BR-R7000/.test(c.detail) && /C-201/.test(c.detail)));
  const back = t.savePartSelection(id, { requirementId: orig.id, partId: orig.current_part_id }, v.job.configuration.version);
  assert.equal(back.job.selections[orig.id].partId, orig.current_part_id);
  assert.equal(back.job.requirements[0].reason, orig.reason);
});

test('S-5: an edited text that quotes a different total is refused', async () => {
  const id = await readyGearingJob();
  const total = t.getJobContext(id).preview.totals.total_cents;
  assert.throws(() => t.sendQuote(id, { message: 'Hi Maya, total $99.00 incl. tax.' }), (e) => e.code === 'message_total_mismatch');
  assert.equal(t.getJobContext(id).estimates.length, 0);
  const ok = t.sendQuote(id, { message: `Hi Maya, total $${(total / 100).toFixed(2)} incl. tax.` });
  assert.equal(ok.job.status, 'quote_sent');
});

test('S-6: required parts cannot be skipped and unknown statuses are refused', async () => {
  const { id, cfg } = await fullPlanJob();
  assert.throws(() => t.savePartSelection(id, { requirementId: 'cassette', status: 'excluded' }, cfg), (e) => e.code === 'required');
  assert.throws(() => t.savePartSelection(id, { requirementId: 'chain', status: 'bogus' }, cfg), (e) => e.code === 'bad_status');
  assert.equal(t.getJobContext(id).job.selections.cassette.status, 'selected');
});

// ---- Second set of regressions ----

test('J-1: on a fresh seed a carbon-rim result gets its own id, no shop price or stock, and the aluminum job is unaffected', async () => {
  const { normalizeAiResearch } = await import('../server/modules/ai_research.js');
  const s = store.reset();
  assert.ok(!s.catalog['AI-R55C4'], 'seed has no catalog entry for the shop SKU');
  const job = { id: 'WO-T', configuration: { version: 1, components: {} }, constraints: {}, request: { extraction: {} } };
  for (const shop_part_id of [undefined, 'AI-R55C4']) {
    const raw = {
      status: 'ready',
      requirements: [{ id: 'brake_pads', slot: 'brake_pads', title: 'Brake pads', kind: 'required', qty: 2, part: { brand: 'Shimano', name: 'R55C4 inserts', variant: 'R55C4 (carbon rims)', mpn: 'R55C4', shop_part_id }, reason: 'carbon', fit_checks: [{ detail: 'fits', source_ids: ['s1'] }], source_ids: ['s1'] }],
      sources: [{ id: 's1', url: 'https://productinfo.shimano.com/en/compatibility/C-201', claim: 'R55C4 for carbon rim' }],
    };
    const { result, parts } = normalizeAiResearch({ job, run: { mode: 'live', raw }, catalog: s.catalog, aliases: s.aliases, shopIds: new Set(Object.keys(s.priceList)) });
    const pid = result.requirements_ai[0].partId;
    assert.ok(!(pid in s.priceList), `${pid} must not be a shop product`);
    assert.equal((parts.find((p) => p.id === pid) || store.load().catalog[pid])?.variant, 'R55C4 (carbon rims)');
    // Simulate finish() storing it, as a live run would.
    store.mutate((st) => { for (const p of parts) if (!st.catalog[p.id]) st.catalog[p.id] = { ...p, retailPrice: st.priceList[p.id] ?? null }; });
  }
  assert.ok(!store.load().catalog['AI-R55C4'], 'shop SKU never relabelled');
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: 'Brakes squeal and the pads look worn. Replace pads.' });
  const v = await t.updateConfirmedComponents(id, { brake_caliper: { label: 'BR-R7000' }, rim_material: { label: 'Aluminum' } });
  const q = v.job.requirements[0];
  assert.equal(q.current_part_id, 'AI-R55C4');
  assert.match(q.part.variant, /aluminum/);
});

test('J-2: send after changing back to approved content keeps the approval and texts nothing', async () => {
  const id = await readyGearingJob();
  const e1 = t.sendQuote(id, {}).active_estimate;
  t.recordCustomerResponse(e1.id, e1.version, 'approve');
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 0.75 }]);
  t.createOrUpdateDraftEstimate(id);
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 0.25 }]);
  const inboxBefore = t.getInbox().messages.length;
  const r = t.sendQuote(id, {});
  assert.equal(r.result.already_sent, true);
  assert.equal(r.job.status, 'approved');
  assert.equal(r.job.approval?.valid, true);
  assert.equal(r.estimates.length, 1);
  assert.equal(t.getInbox().messages.length, inboxBefore);

  // A later declined version means the old approval no longer stands: a draft
  // matching v1 is sent as a new version, not skipped.
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 0.75 }]);
  const e2 = t.sendQuote(id, {}).active_estimate;
  t.recordCustomerResponse(e2.id, e2.version, 'decline');
  t.updateLabor(id, [{ id: 'labor-cassette', hours: 0.25 }]);
  t.createOrUpdateDraftEstimate(id);
  const again = t.sendQuote(id, {});
  assert.equal(again.job.status, 'quote_sent');
  assert.equal(again.active_estimate.version, 3);
});

test('J-3: a part that needs a supplier inquiry is never described as in stock', async () => {
  store.reset();
  store.mutate((s) => {
    s.inventory = s.inventory.filter((i) => i.partId !== 'AI-R55C4');
    s.offers = s.offers.filter((o) => o.partId !== 'AI-R55C4');
  });
  const id = t.createJob({}).job.id;
  await t.describeJob(id, { text: 'Brakes squeal and the pads look worn. Replace pads.' });
  const v = await t.updateConfirmedComponents(id, { brake_caliper: { label: 'BR-R7000' }, rim_material: { label: 'Aluminum' } });
  const req = v.job.requirements[0];
  assert.equal(req.sourcing.recommended.type, 'inquiry');
  const sel = t.savePartSelection(id, { requirementId: req.id }, v.job.configuration.version);
  assert.doesNotMatch(sel.draft_message, /in stock/i);
  assert.match(sel.draft_message, /confirming parts availability/);
  const sent = t.sendQuote(id, {});
  assert.doesNotMatch(sent.active_estimate.message, /in stock/i);
});

test('J-4: editing hours on work already on the order keeps it in the title and customer text', async () => {
  store.reset();
  await t.describeJob('WO-1044', { text: 'Brakes squeal and the pads look worn. Replace pads.' });
  const v = await t.updateConfirmedComponents('WO-1044', { brake_caliper: { label: 'BR-R7000' }, rim_material: { label: 'Aluminum' } });
  t.savePartSelection('WO-1044', { requirementId: v.job.requirements[0].id }, v.job.configuration.version);
  const after = t.updateLabor('WO-1044', [{ id: 'labor-existing-tuneup', hours: 1.5 }]);
  const line = after.job.labor.find((l) => l.id === 'labor-existing-tuneup');
  assert.equal(line.source, 'existing');
  assert.equal(line.edited, true);
  assert.equal(line.hours, 1.5);
  assert.match(after.job.summary, /^Tune-up, in progress \+ /);
  assert.match(after.draft_message, /standard tune-up already booked/);
  assert.ok(after.preview.lines.some((l) => l.id === 'labor-existing-tuneup' && l.amount_cents === 15000));
});
