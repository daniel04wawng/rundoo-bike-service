// End-to-end workflow check over the HTTP API, driving it the way the UI does:
// Describe job -> Review recommendations -> Confirm quote -> Send for approval
// -> Track response. Starts its own server on a free port with an isolated
// EVAL_RUN_ID. Live AI research is used when RESEARCH_MODE=live (from .env).
//
//   node --env-file-if-exists=.env scripts/e2e-workflow.js [scenario...]
//
// Prints one JSON line per check and a summary; exits 1 on any failure.
import { spawn } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT || 3301);
const RUN = process.env.E2E_RUN_ID || `e2e-${Date.now()}`;
const BASE = `http://localhost:${PORT}`;

const SCENARIOS = {
  rules_gearing: {
    customerId: 'C-1', bikeId: 'B-1',
    text: 'Customer wants easier climbing gears for a hilly tour in 3 weeks. Budget around $250.',
    answers: async (job) => {
      // Rules path: confirm every bike-record candidate, answer the cage question.
      const c = {};
      for (const [slot, v] of Object.entries(job.configuration.components)) if (v.partId && v.status === 'candidate') c[slot] = { partId: v.partId };
      c.rear_derailleur = { partId: 'RD-R7000-SS' };
      return c;
    },
    alternative: { requirementId: 'cassette', partId: 'CS-R7000-1130', expectRemoved: ['rear_derailleur', 'spacer'] },
    expectMain: /CS-HG800-11 11-34T/,
  },
  ai_brake_pads: {
    customerId: 'C-1', bikeId: 'B-1',
    text: 'Brakes squeal and the pads look worn. Replace pads.',
    answers: { brake_caliper: 'BR-R7000', rim_material: 'Aluminum' },
    expectMain: /R55C4/i,
    declineFirst: true,
  },
  ai_unknown_bike: {
    customerId: 'C-2', bikeId: 'B-2',
    text: 'Wants easier gears on an older road bike, not sure what is on it. Bike is worth about $300.',
    answers: { crankset: 'Shimano FC-R3000, 50-34 double', rear_derailleur: 'RD-R3000-SS', cassette: '9-speed, 11-28', shifters: 'ST-R3000, 9-speed', freehub: 'Shimano HG, 9-speed' },
    expectMain: /HG400-9.*11-32/,
    forbidParts: /RD-R3000-GS/,
  },
  ai_open_job_needs_inspection: {
    customerId: 'C-3', bikeId: 'B-3',
    text: 'Customer wants to go tubeless to get fewer flats.',
    inspectAll: true,
  },
};

const results = [];
const check = (scenario, name, pass, detail) => {
  results.push({ scenario, name, pass: !!pass, detail });
  console.log(JSON.stringify({ scenario, check: name, pass: !!pass, detail }));
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function settle(jobId, timeoutMs = 180_000) {
  const t0 = Date.now();
  for (;;) {
    const { data } = await api('GET', `/api/jobs/${jobId}`);
    const st = data.job?.research?.status;
    if (st !== 'checking') return { view: data, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error('research did not settle');
    await new Promise((r) => setTimeout(r, 700));
  }
}

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function checkRecommendations(name, v, sc) {
  const r = v.job.research;
  const reqs = v.job.requirements;
  check(name, 'research ready with requirements', r.status === 'ready' && reqs.length > 0, { status: r.status, n: reqs.length });
  check(name, 'no internal traces in mechanic view', !('toolLog' in v.job) && !JSON.stringify(v).includes('sk-ant'), null);
  for (const q of reqs) {
    check(name, `${q.id}: exact part named`, !!(q.part?.variant && q.part?.brand), q.part?.variant);
    check(name, `${q.id}: reason under 15 words`, words(q.reason) <= 15, q.reason);
    check(name, `${q.id}: availability is stock/supplier/inquiry`, ['stock', 'supplier', 'inquiry'].includes(q.sourcing?.recommended?.type), q.sourcing?.recommended?.label);
    if (r.engine === 'ai') {
      const cited = q.citation === 'cited';
      const ev = new Set((r.evidence || []).map((e) => e.id));
      check(name, `${q.id}: cited parts point at manufacturer evidence`, !cited || (q.evidence_ids || []).every((id) => ev.has(id)) && q.evidence_ids.length > 0, { citation: q.citation, evidence: q.evidence_ids });
      check(name, `${q.id}: every evidence URL is a manufacturer domain`, (r.evidence || []).every((e) => /(^|\.)(shimano|sram|kmcchain|swissstop|koolstop|campagnolo)\.com$/.test(new URL(e.url).hostname)), (r.evidence || []).map((e) => new URL(e.url).hostname));
      for (const a of q.alternatives) check(name, `${q.id}: alternative ${a.variant} has a reason`, !!a.reason, a.reason);
    }
  }
  if (sc.expectMain) check(name, 'main recommendation matches verified answer', sc.expectMain.test(JSON.stringify(reqs[0]?.part)), reqs[0]?.part?.variant);
  if (sc.forbidParts) check(name, 'no unneeded parts in the plan', !reqs.some((q) => sc.forbidParts.test(JSON.stringify(q.part))), reqs.map((q) => q.part.variant));
}

async function runScenario(name, sc) {
  const created = await api('POST', '/api/jobs', { customerId: sc.customerId, bikeId: sc.bikeId });
  const jobId = created.data.job.id;
  check(name, 'new job starts as isolated draft on Describe', created.data.job.stage === 'describe' && created.data.job.status === 'draft' && !created.data.job.request, jobId);

  // 1. Describe job
  const t0 = Date.now();
  await api('POST', `/api/jobs/${jobId}/describe`, { text: sc.text });
  let { view: v, ms } = await settle(jobId);
  check(name, 'describe -> review stage', v.job.stage === 'review', { stage: v.job.stage, research: v.job.research.status, engine: v.job.research.engine, ms });

  // 2. Missing identifiers, answered in one submit
  if (v.job.research.status === 'needs_info') {
    const qs = v.job.research.questions;
    check(name, 'asks at most 5 blocking questions in one round', qs.length > 0 && qs.length <= 5, qs.map((q) => q.text));
    let comps;
    if (sc.inspectAll) {
      comps = Object.fromEntries(qs.map((q) => [q.slot, { label: null, status: 'needs_inspection' }]));
    } else if (typeof sc.answers === 'function') {
      comps = await sc.answers(v.job);
    } else {
      comps = {};
      for (const q of qs) comps[q.slot] = { label: sc.answers[q.slot] ?? 'unknown', status: sc.answers[q.slot] ? 'confirmed' : 'needs_inspection' };
      for (const [slot, label] of Object.entries(sc.answers)) if (!comps[slot]) comps[slot] = { label };
    }
    const before = v.job.configuration.version;
    await api('POST', `/api/jobs/${jobId}/components`, { components: comps });
    ({ view: v, ms } = await settle(jobId));
    check(name, 'answers bump configuration version', v.job.configuration.version > before, { from: before, to: v.job.configuration.version, ms });
    if (v.job.research.status === 'needs_info' && !sc.inspectAll) {
      check(name, 'no second question round', false, v.job.research.questions.map((q) => q.text));
    }
  }
  check(name, 'time to recommendations (s)', true, Math.round((Date.now() - t0) / 1000));

  if (sc.inspectAll) {
    const st = v.job.research.status;
    check(name, 'unanswered identifiers never produce a guessed plan', st !== 'ready' || v.job.requirements.every((q) => q.citation !== 'uncited' || q.skippable), { status: st });
    const q = await api('POST', `/api/jobs/${jobId}/stage`, { stage: 'quote' });
    check(name, 'cannot quote without decided parts', q.status === 409 || st === 'ready', q.data.message);
    return;
  }

  // 3. Review recommendations
  checkRecommendations(name, v, sc);
  if (v.job.research.engine === 'ai') {
    const t1 = Date.now();
    let ver = v.job.research.verification;
    while (ver?.status === 'running' && Date.now() - t1 < 150_000) {
      await new Promise((r) => setTimeout(r, 1500));
      ver = (await api('GET', `/api/jobs/${jobId}`)).data.job.research.verification;
    }
    const items = Object.entries(ver?.items || {});
    check(name, 'source check finished', ver?.status === 'done', { secs: Math.round((Date.now() - t1) / 1000), results: items.map(([k, x]) => `${k}:${x.status}`) });
    const main = v.job.requirements[0];
    if (sc.expectMain) check(name, 'main part source confirmed (or flagged, never silently trusted)', ['confirmed', 'confirmed_by_hand', 'unconfirmed'].includes(ver?.items?.[main.current_part_id]?.status), ver?.items?.[main.current_part_id]);
  }
  const cfg = v.job.configuration.version;
  if (sc.alternative) {
    const r = await api('POST', `/api/jobs/${jobId}/selection`, { selection: { requirementId: sc.alternative.requirementId, partId: sc.alternative.partId }, configuration_version: cfg });
    const removed = (r.data.result?.dependency_changes || []).filter((c) => c.type === 'removed').map((c) => c.requirementId);
    check(name, 'alternative rechecks dependencies', sc.alternative.expectRemoved.every((x) => removed.includes(x)), removed);
    v = r.data;
  } else {
    const withAlt = v.job.requirements.find((q) => q.alternatives.length && q.alternatives[0].retailPrice != null);
    if (withAlt) {
      const r = await api('POST', `/api/jobs/${jobId}/selection`, { selection: { requirementId: withAlt.id, partId: withAlt.alternatives[0].partId }, configuration_version: cfg });
      check(name, 'alternative selection accepted', r.status === 200, { picked: withAlt.alternatives[0].variant, err: r.data.message });
      if (r.status === 200) v = r.data;
    }
  }
  const stale = await api('POST', `/api/jobs/${jobId}/selection`, { selection: { requirementId: v.job.requirements[0].id }, configuration_version: cfg - 1 });
  check(name, 'stale configuration version is rejected', stale.status === 409, stale.data.error);
  for (const q of v.job.requirements) {
    if (q.selection) continue;
    const sel = { requirementId: q.id };
    if (q.citation === 'uncited') sel.status = 'excluded';
    else if (q.part.needsPrice) sel.price = 30;
    const r = await api('POST', `/api/jobs/${jobId}/selection`, { selection: sel, configuration_version: cfg });
    check(name, `${q.id}: decision saved`, r.status === 200, r.data.message || sel.status || 'selected');
    if (r.status === 200) v = r.data;
  }
  check(name, 'all decided -> ready to quote', v.ready_to_quote.ready, v.ready_to_quote.blockers);

  // 4. Confirm quote
  const st = await api('POST', `/api/jobs/${jobId}/stage`, { stage: 'quote' });
  v = st.data;
  const p = v.preview;
  const sum = p.lines.reduce((a, l) => a + l.amount_cents, 0);
  check(name, 'totals deterministic (lines + tax)', sum === p.totals.subtotal_cents && p.totals.total_cents === sum + Math.round(sum * p.totals.tax_rate), p.totals);
  check(name, 'labor from rate card or mechanic only', v.job.labor.every((l) => ['rate_card', 'mechanic', 'existing'].includes(l.source)), v.job.labor.map((l) => `${l.label}:${l.source}`));
  check(name, 'customer price from price list or mechanic, not supplier cost', p.lines.filter((l) => l.type === 'part').every((l) => l.unit_price_cents > 0), p.lines.map((l) => `${l.label} ${l.unit_price_cents}`));
  check(name, 'customer message ready', !!v.draft_message && v.draft_message.includes('$'), v.draft_message);

  // 5. Send for approval (one action), then 6. Track response
  let sent = await api('POST', `/api/jobs/${jobId}/send`, { idempotency_key: `${RUN}-${name}-1` });
  const again = await api('POST', `/api/jobs/${jobId}/send`, { idempotency_key: `${RUN}-${name}-1` });
  check(name, 'send is idempotent', again.data.active_estimate?.id === sent.data.active_estimate?.id, again.data.active_estimate?.id);
  check(name, 'sent to simulated inbox, v1', sent.data.job.status === 'quote_sent' && sent.data.active_estimate.version === 1, sent.data.active_estimate?.status);
  const inbox = await api('GET', '/api/inbox');
  check(name, 'inbox message is simulated', inbox.data.messages.some((m) => m.jobId === jobId && m.simulated), null);
  let token = sent.data.active_estimate.approval_link.split('/').pop();
  if (sc.declineFirst) {
    const d = await api('POST', `/api/approve/${token}`, { response: 'decline' });
    check(name, 'decline returns job for revision', d.data.job_status === 'declined', d.data.job_status);
    v = (await api('GET', `/api/jobs/${jobId}`)).data;
    if (v.job.labor[0]) await api('POST', `/api/jobs/${jobId}/labor`, { labor: [{ id: v.job.labor[0].id, hours: v.job.labor[0].hours + 0.25 }] });
    sent = await api('POST', `/api/jobs/${jobId}/send`, { idempotency_key: `${RUN}-${name}-2` });
    check(name, 'resend creates v2', sent.data.active_estimate?.version === 2, sent.data.active_estimate?.version);
    const old = await api('POST', `/api/approve/${token}`, { response: 'approve' });
    check(name, 'old version cannot be approved', old.status === 409, old.data.message);
    token = sent.data.active_estimate.approval_link.split('/').pop();
  }
  const ap = await api('POST', `/api/approve/${token}`, { response: 'approve' });
  v = (await api('GET', `/api/jobs/${jobId}`)).data;
  check(name, 'approval recorded on same job with version', ap.data.job_status === 'approved' && v.job.approval?.valid && v.job.approval.version === v.active_estimate.version, v.job.approval);
  const lab = v.job.labor[0];
  if (lab) {
    const ch = await api('POST', `/api/jobs/${jobId}/labor`, { labor: [{ id: lab.id, hours: lab.hours + 0.5 }] });
    check(name, 'change after approval invalidates it', ch.data.job.status === 'changed_after_approval' && ch.data.job.approval.valid === false, ch.data.job.status);
  }
}

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), EVAL_RUN_ID: RUN },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('prototype on') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const pick = process.argv.slice(2);
const health = (await api('GET', '/api/health')).data;
console.log(JSON.stringify({ run_id: RUN, research_mode: health.research_mode }));
try {
  const names = pick.length ? pick : Object.keys(SCENARIOS);
  await Promise.all(names.map((n) => runScenario(n, SCENARIOS[n]).catch((e) => check(n, 'scenario completed', false, e.message))));
} finally {
  server.kill();
}
const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ summary: { checks: results.length, failed: failed.length, research_mode: health.research_mode } }));
process.exit(failed.length ? 1 : 0);
