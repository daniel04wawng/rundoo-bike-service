// One orchestrator with explicit stages. Each exported function is a named
// tool with a structured result. Structured state in the store is the source
// of truth; LLM output is only ever a proposal that the mechanic confirms.
import crypto from 'node:crypto';
import { load, mutate, captureOutput, runId } from './store.js';
import { extract } from './modules/extraction.js';
import { research, requirementsFor, useRules } from './modules/research.js';
import { normalizeAiResearch, aiInput } from './modules/ai_research.js';
import { runAiResearch, researchMode, verifySources } from './adapters/research_llm.js';
import { bestSource, availability } from './modules/sourcing.js';
import { preview, contentHash, fmt } from './modules/estimate.js';
import { draftCustomerMessage } from './modules/message.js';
import { blankJob } from './seed.js';

const now = () => new Date().toISOString();

function fail(status, code, message, details) {
  throw Object.assign(new Error(message), { status, code, details });
}

const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

// Idempotency keys only replay within the same tool and job/estimate, so a
// reused key can never return another job's result.
const scopedKey = (scope, key) => (key ? `${scope}:${String(key).slice(0, 120)}` : null);

const NOT_OPEN = {
  approved: 'Already approved.',
  declined: 'You declined this quote. The shop will follow up with any changes.',
  outdated: 'This quote was updated by the shop. A new version will be sent.',
};

// A job that already had work on it keeps its title; new work is added to it.
function jobSummary(job) {
  const goal = job.constraints?.goalSummary ? cap(job.constraints.goalSummary) : null;
  const hasExisting = (job.labor || []).some((l) => l.source === 'existing') || (job.existingLines || []).length > 0;
  if (hasExisting && goal) return `${job.title} + ${goal.charAt(0).toLowerCase()}${goal.slice(1)}`;
  return goal || job.title || 'New job';
}

function getJob(state, id) {
  const job = state.jobs[id];
  if (!job) fail(404, 'job_not_found', `No work order ${id}`);
  return job;
}

function log(job, tool, input, output) {
  job.toolLog.push({ tool, at: now(), input, output });
  if (job.toolLog.length > 200) job.toolLog.splice(0, job.toolLog.length - 200);
}

// ---------- Read models ----------

export function bootstrap() {
  const s = load();
  return {
    run_id: runId(),
    shop: s.shop,
    customers: s.customers,
    bikes: s.bikes,
    catalog: publicCatalog(s),
    jobs: listJobs().jobs,
    extraction_mode: process.env.EXTRACTION_MODE === 'live' && process.env.ANTHROPIC_API_KEY ? 'live' : 'replay',
    research_mode: researchMode(),
  };
}

function publicCatalog(s) {
  const out = {};
  for (const [id, p] of Object.entries(s.catalog)) {
    if (id.startsWith('_')) continue;
    out[id] = { id, brand: p.brand, name: p.name, variant: p.variant, slot: p.slot, retailPrice: p.retailPrice, customerLabel: p.customerLabel, evidenceIds: p.evidenceIds || [], specs: p.specs, unverified: !!p.unverified };
  }
  return out;
}

export function listJobs() {
  const s = load();
  const jobs = Object.values(s.jobs)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((j) => {
      const c = s.customers.find((x) => x.id === j.customerId);
      const b = s.bikes.find((x) => x.id === j.bikeId);
      const p = preview(j, s.shop, s.catalog);
      return {
        id: j.id,
        customer: c?.name,
        bike: b?.label,
        status: j.status,
        stage: j.stage,
        summary: jobSummary(j),
        total_cents: p.totals.total_cents,
        updatedAt: j.updatedAt,
        dueText: j.dueText || '',
      };
    });
  return { jobs };
}

export function getJobContext(jobId) {
  const s = load();
  const job = getJob(s, jobId);
  return view(s, job);
}

// Everything the mechanic UI needs, derived from state. No internal traces.
function view(s, job) {
  const customer = s.customers.find((c) => c.id === job.customerId);
  const bike = s.bikes.find((b) => b.id === job.bikeId);
  const p = preview(job, s.shop, s.catalog);
  const estimates = job.estimates.map((id) => s.estimates[id]).map(publicEstimate);
  const active = estimates[estimates.length - 1] || null;
  const reqs = job.requirements || [];
  return {
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      title: job.title,
      summary: jobSummary(job),
      request: job.request ? { text: job.request.text, extraction: job.request.extraction } : null,
      constraints: job.constraints,
      configuration: job.configuration,
      research: job.research ? summarizeResearch(job.research) : null,
      plan: job.plan,
      requirements: reqs.map((r) => decorateRequirement(s, job, r)),
      selections: job.selections,
      labor: job.labor,
      existing_lines: job.existingLines || [],
      approval: job.approval,
      notes: notesFor(s, job, p),
      inquiries: job.inquiries || [],
      updatedAt: job.updatedAt,
    },
    customer,
    bike,
    preview: p,
    estimates,
    active_estimate: active,
    ready_to_quote: readyToQuote(job),
    draft_message: p.lines.length ? draftCustomerMessage({ job, customer, bike, estimate: p, shop: s.shop, catalog: s.catalog }) : null,
  };
}

function publicEstimate(e) {
  if (!e) return null;
  const { token, ...rest } = e;
  return { ...rest, approval_link: `/approve/${token}` };
}

function summarizeResearch(r) {
  return {
    engine: r.engine || 'rules',
    mode: r.mode || null,
    fixture_id: r.fixture_id || null,
    provenance: r.provenance || null,
    summary: r.summary || null,
    cached: !!r.cached,
    timings: r.timings || null,
    activity: r.activity || [],
    thinking: r.thinking || null,
    verification: r.verification || null,
    startedAt: r.startedAt || null,
    status: r.status,
    configuration_version: r.configuration_version,
    stale: r.stale || false,
    questions: r.questions,
    baseline: r.baseline,
    options: r.options,
    recommended_option_id: r.recommended_option_id,
    not_found: r.not_found,
    observed: r.observed,
    inferred: r.inferred,
    evidence: r.evidence,
  };
}

function notesFor(s, job, p) {
  const notes = [];
  const c = job.constraints || {};
  if (c.budget != null && p.totals.total_cents > c.budget * 100) {
    notes.push({ kind: 'budget', text: `${fmt(p.totals.total_cents - c.budget * 100)} over the customer's ${fmt(c.budget * 100)} budget.` });
  }
  if (c.bikeValue != null && p.totals.total_cents > c.bikeValue * 100 * 0.5) {
    notes.push({ kind: 'economics', text: `Quote is over half the customer-stated bike value (${fmt(c.bikeValue * 100)}). Worth a word with the customer.` });
  }
  const late = (job.requirements || []).filter((r) => {
    const sel = job.selections[r.id];
    return sel?.status === 'selected' && c.deadlineDays != null && sel.sourcing?.eta_days != null && sel.sourcing.eta_days > c.deadlineDays;
  });
  if (late.length) notes.push({ kind: 'timing', text: `${late.map((r) => r.title).join(', ')} may arrive after ${c.deadlineText}.` });
  return notes;
}

function decorateRequirement(s, job, r) {
  const sel = job.selections[r.id];
  const partId = sel?.partId || r.partId;
  const part = s.catalog[partId];
  const src = sourceFor(s, job, part, r.qty);
  const alternatives = alternativesFor(s, job, r, partId, src);
  // AI research: when an alternative is in use, show its own reason and sources.
  const meta = r.engine === 'ai' && partId !== r.partId ? r.altMeta?.[partId] : null;
  const shown = meta
    ? { reason: meta.reason, evidence_ids: meta.evidence_ids || [], checks: [{ rule: 'cited_fit', pass: (meta.evidence_ids || []).length > 0, detail: meta.dependency ? `${meta.reason} ${meta.dependency}` : meta.reason, evidence_ids: meta.evidence_ids || [] }] }
    : {};
  return {
    ...r,
    ...shown,
    current_part_id: partId,
    part: part && { id: part.id, brand: part.brand, name: part.name, variant: part.variant, retailPrice: sel?.customPrice ?? part.retailPrice ?? null, needsPrice: part.retailPrice == null, evidenceIds: part.evidenceIds?.length ? part.evidenceIds : shown.evidence_ids || r.evidence_ids || [] },
    sourcing: src,
    selection: sel || null,
    alternatives,
  };
}

// qty is the requirement quantity: stock only counts if it covers all units.
function sourceFor(s, job, part, qty = 1) {
  if (!part) return null;
  return bestSource({
    part,
    qty: qty || 1,
    inventory: s.inventory,
    offers: s.offers,
    locationId: s.shop.locationId,
    deadlineDays: job.constraints?.deadlineDays ?? null,
  });
}

// Alternatives preserve compatibility: cassette alternatives are other
// compatible options (with their dependency changes); chain alternatives are
// other verified chains of the same speed.
function alternativesFor(s, job, r, currentPartId, currentSrc) {
  const cur = s.catalog[currentPartId];
  const curEta = currentSrc?.recommended?.eta_days ?? 99;
  const ids = r.id === 'cassette' && r.engine !== 'ai'
    ? (job.research?.options || []).filter((o) => o.compatible).map((o) => o.cassettePartId)
    : r.id === 'chain' && r.engine !== 'ai'
      ? job.research?.chain_candidates || []
      : r.engine === 'ai' && r.citation === 'cited'
        ? [r.partId, ...(r.alternatives || [])] // the original pick stays one click away
        : r.alternatives || [];
  const currentOpt = (job.research?.options || []).find((o) => o.cassettePartId === (r.id === 'cassette' ? currentPartId : job.selections.cassette?.partId));
  return ids
    .filter((id) => id !== currentPartId)
    .map((id) => {
      const p = s.catalog[id];
      const src = sourceFor(s, job, p, r.qty);
      const eta = src.recommended.eta_days ?? 99;
      const tags = [];
      if (p.retailPrice != null && cur.retailPrice != null && p.retailPrice < cur.retailPrice) tags.push('lower_cost');
      if (eta < curEta) tags.push('sooner');
      if (src.recommended.type === 'stock') tags.push('shop_stock');
      if (p.brand !== cur.brand) tags.push('other_brand');
      const meta = r.engine === 'ai' && id === r.partId ? { reason: r.reason } : r.altMeta?.[id];
      for (const t of meta?.tags || []) if (!tags.includes(t) && ['lower_cost', 'sooner', 'shop_stock', 'other_brand'].includes(t)) tags.push(t);
      let dependency = meta?.dependency ? { effect: 'note', text: meta.dependency } : null;
      let reason = meta?.reason || p.shortReason || '';
      if (r.id === 'cassette' && r.engine !== 'ai') {
        const opt = job.research.options.find((o) => o.cassettePartId === id);
        reason = `Low gear ${opt.low_gear}, about ${opt.pct_easier}% easier than now.`;
        const removes = [];
        const adds = [];
        for (const key of ['rearDerailleurPartId', 'spacerPartId']) {
          const had = currentOpt?.[key];
          const needs = opt[key];
          if (had && !needs) removes.push(s.catalog[had].variant);
          if (!had && needs) adds.push(s.catalog[needs].variant);
        }
        const parts = [];
        if (removes.length) parts.push(`${!opt.rearDerailleurPartId && currentOpt?.rearDerailleurPartId ? 'Works with the current derailleur. ' : ''}Removes ${removes.join(' and ')}.`);
        if (adds.length) parts.push(`Also needs ${adds.join(' and ')}.`);
        if (parts.length) dependency = { effect: adds.length ? 'adds' : 'removes', removes, adds, text: parts.join(' ') };
      }
      return { partId: id, brand: p.brand, name: p.name, variant: p.variant, retailPrice: p.retailPrice, tags, sourcing: src.recommended, reason, dependency, rechecked: true };
    });
}

function readyToQuote(job) {
  const blockers = [];
  if (!job.research || job.research.status !== 'ready') blockers.push('Research not ready');
  if (!(job.requirements || []).length && job.research?.status === 'ready') blockers.push('Nothing to quote');
  if (job.research?.stale) blockers.push('Recheck needed after component change');
  for (const r of job.requirements || []) {
    const sel = job.selections[r.id];
    if (!sel) blockers.push(`${r.title}: not decided`);
    else if (sel.status === 'needs_inspection') blockers.push(`${r.title}: needs inspection`);
  }
  return { ready: blockers.length === 0, blockers };
}

// ---------- Tools ----------

const nextId = (list, prefix) => `${prefix}-${1 + Math.max(0, ...list.map((x) => Number(String(x.id).split('-')[1]) || 0))}`;

function addCustomer(s, { name, phone } = {}) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 60) fail(400, 'bad_customer_name', 'Enter the customer name (2 to 60 characters).');
  const ph = String(phone || '').trim();
  if (ph && !/^[0-9+()\-.\s]{7,20}$/.test(ph)) fail(400, 'bad_phone', 'Phone can only contain digits, spaces and + ( ) - .');
  const customer = { id: nextId(s.customers, 'C'), name: n, phone: ph || null, createdAt: now() };
  s.customers.push(customer);
  return customer;
}

// A new bike starts with no component record. Research then asks the
// mechanic for whatever identifiers the job needs, exactly as for any bike.
function addBike(s, customerId, { label } = {}) {
  const l = String(label || '').trim().replace(/\s+/g, ' ');
  if (l.length < 2 || l.length > 80) fail(400, 'bad_bike', 'Describe the bike (2 to 80 characters), e.g. "Trek Domane AL 2 road bike".');
  const bike = { id: nextId(s.bikes, 'B'), customerId, label: l, recordedComponents: {}, createdAt: now() };
  s.bikes.push(bike);
  return bike;
}

export function listCustomers() {
  const s = load();
  return { customers: s.customers, bikes: s.bikes };
}

export function createCustomer(body) {
  return mutate((s) => ({ customer: addCustomer(s, body) }));
}

export function createBike(customerId, body) {
  return mutate((s) => {
    if (!s.customers.some((c) => c.id === customerId)) fail(404, 'customer_not_found', 'No such customer');
    return { bike: addBike(s, customerId, body) };
  });
}

// Start a job for an existing or new customer and bike in one step, so a
// rejected input never leaves a half-created customer behind.
export function createJob({ customerId, bikeId, newCustomer, newBike, fromJobId } = {}) {
  return mutate((s) => {
    let customer = newCustomer ? addCustomer(s, newCustomer) : s.customers.find((c) => c.id === customerId);
    if (!customer && customerId) fail(404, 'customer_not_found', 'No such customer');
    customer = customer || s.customers[0];
    let bike = newBike ? addBike(s, customer.id, newBike) : s.bikes.find((b) => b.id === bikeId && b.customerId === customer.id);
    if (!bike && !newBike) bike = s.bikes.find((b) => b.customerId === customer.id);
    if (!bike) fail(400, 'bike_required', 'Add the bike for this customer.');
    const n = s.counters.job++;
    const id = `WO-${n}`;
    const job = newJob(s, { id, customer, bike });
    s.jobs[id] = job;
    log(job, 'create_job', { customerId: customer.id, bikeId: bike.id, newCustomer: !!newCustomer, newBike: !!newBike, fromJobId }, { id });
    return view(s, job);
  });
}

export function newJob(s, { id, customer, bike, title }) {
  return blankJob(id, customer, bike, title);
}

export async function describeJob(jobId, { text }, opts = {}) {
  if (!text || !String(text).trim()) fail(400, 'empty_request', 'Describe the job first.');
  const extraction = await extract(String(text).slice(0, 2000));
  return withResearch(jobId, (s, job) => {
    job.request = { text: String(text).slice(0, 2000), extraction, at: now() };
    job.constraints = {
      goalType: extraction.goal.type,
      goalSummary: extraction.goal.summary,
      budget: extraction.budget,
      deadlineDays: extraction.deadline?.days ?? null,
      deadlineText: extraction.deadline?.text ?? null,
      bikeValue: extraction.bike_value,
      observed: extraction.observed_conditions,
    };
    // Mentioned components only become hints; they never auto-confirm.
    for (const m of extraction.mentioned_components) {
      const c = job.configuration.components[m.slot];
      if (c) c.mentioned = m.text;
    }
    job.stage = 'review';
    job.updatedAt = now();
    log(job, 'extract_request', { text }, extraction);
    captureOutput({ stage: 'extraction', job_id: job.id, output: extraction });
  }, opts);
}

// Components are confirmed either as a verified catalog part (partId) or, for
// AI research, as the identifier the mechanic read off the bike (label).
export async function updateConfirmedComponents(jobId, components = {}, evidence = null, opts = {}) {
  return withResearch(jobId, (s, job) => {
    if (job.status === 'approved') job.status = 'changed_after_approval';
    let changed = false;
    for (const [slot, upd] of Object.entries(components)) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(slot)) fail(400, 'bad_slot', `Bad component slot ${slot}`);
      const cur = job.configuration.components[slot] || {};
      const partId = upd.partId !== undefined ? upd.partId : upd.label !== undefined ? null : cur.partId;
      if (partId && !s.catalog[partId]) fail(400, 'unknown_part', `Unknown part ${partId}`);
      const label = partId ? s.catalog[partId].variant : upd.label !== undefined ? (upd.label == null ? null : String(upd.label).trim().slice(0, 80) || null) : cur.label;
      const status = upd.status || 'confirmed';
      if (status === 'confirmed' && !partId && !label) fail(400, 'empty_component', 'Enter what is fitted.');
      if (cur.partId !== partId || cur.status !== status || cur.label !== label) changed = true;
      job.configuration.components[slot] = {
        ...cur,
        partId: partId || null,
        label,
        status,
        source: status === 'confirmed' ? 'mechanic' : cur.source,
        evidence: evidence || cur.evidence || null,
        confirmedAt: status === 'confirmed' ? now() : cur.confirmedAt,
      };
    }
    if (changed) {
      job.configuration.version += 1;
      if (job.research) job.research.stale = true;
    }
    job.updatedAt = now();
    log(job, 'update_confirmed_components', { components, evidence }, { configuration_version: job.configuration.version, changed });
  }, opts);
}

export async function researchCompatibility(jobId, configurationVersion, constraints = {}, opts = {}) {
  return withResearch(jobId, (s, job) => {
    if (configurationVersion != null && configurationVersion !== job.configuration.version) {
      fail(409, 'stale_configuration', `Configuration is at version ${job.configuration.version}`, { current: job.configuration.version });
    }
    if (constraints && Object.keys(constraints).length) job.constraints = { ...job.constraints, ...constraints };
  }, opts);
}

// Applies a state change, then researches. Rules research runs inside the
// same write. AI research runs outside the write (it can take a while live),
// and its result is applied only if the job has not changed in the meantime.
// Background source check for AI-researched parts (live mode). Replay
// fixtures were checked by hand and are marked as such.
function startSourceCheck(jobId) {
  const plan = mutate((s) => {
    const job = s.jobs[jobId];
    const r = job?.research;
    if (!r || r.engine !== 'ai' || r.status !== 'ready') return null;
    const items = [];
    const seen = new Set();
    const urlsFor = (ids) => [...new Set((ids || []).map((id) => s.evidence[id]?.url).filter(Boolean))].slice(0, 3);
    for (const q of job.requirements) {
      const add = (partId, ids) => {
        if (seen.has(partId) || !s.catalog[partId]) return;
        seen.add(partId);
        const p = s.catalog[partId];
        items.push({ key: partId, brand: p.brand, variant: p.variant, mpn: p.mpn, urls: urlsFor(ids) });
      };
      add(q.partId, [...(q.evidence_ids || []), ...q.checks.flatMap((c) => c.evidence_ids || [])]);
      for (const a of q.alternatives) add(a, q.altMeta?.[a]?.evidence_ids);
    }
    if (r.mode === 'replay') {
      r.verification = { status: 'done', mode: 'replay', items: Object.fromEntries(items.map((i) => [i.key, { status: 'confirmed_by_hand', quotes: [] }])) };
      return null;
    }
    r.verification = { status: 'running', startedAt: now(), items: Object.fromEntries(items.map((i) => [i.key, { status: 'checking' }])) };
    r.activity = [...(r.activity || []), { key: 'verify', kind: 'step', label: 'Checking sources against manufacturer pages', status: 'running', startedAt: now(), endedAt: null }];
    return { items, researchStartedAt: r.startedAt, version: job.configuration.version };
  });
  if (!plan) return Promise.resolve();
  const apply = (results, error) =>
    mutate((s) => {
      const job = s.jobs[jobId];
      const r = job?.research;
      if (!r || r.startedAt !== plan.researchStartedAt || job.configuration.version !== plan.version) return;
      const items = error
        ? Object.fromEntries(plan.items.map((i) => [i.key, { status: 'unconfirmed', reason: 'Source check failed', quotes: [] }]))
        : results;
      r.verification = { status: 'done', startedAt: r.verification?.startedAt, endedAt: now(), items };
      const n = Object.values(items);
      const ok = n.filter((x) => x.status === 'confirmed').length;
      r.activity = (r.activity || []).map((a) => (a.key === 'verify' ? { ...a, status: 'done', endedAt: now(), label: `Checked sources: ${ok} confirmed, ${n.length - ok} couldn't confirm` } : a));
      log(job, 'verify_sources', { parts: plan.items.map((i) => i.key) }, items);
      captureOutput({ stage: 'source_check', job_id: job.id, output: { schema: 'source_check.v1', items } });
    });
  return verifySources(plan.items)
    .then((res) => apply(res))
    .catch((err) => {
      console.error('source check failed', err.message);
      apply(null, err);
    });
}

// search_shop_catalog tool for the research model: the shop's sellable parts
// with customer price, available stock (on hand minus committed) and best
// supplier ETA. Read-only; nothing is reserved or ordered.
export function shopSearch(query) {
  const s = load();
  const terms = String(query || '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const rows = [];
  for (const [id, price] of Object.entries(s.priceList || {})) {
    const p = s.catalog[id] || {};
    const names = [id, p.variant, p.name, p.brand, ...(s.aliases?.[id] || [])].filter(Boolean).join(' ').toUpperCase();
    const score = terms.filter((t) => names.includes(t)).length;
    if (!score) continue;
    const src = bestSource({ part: { id }, inventory: s.inventory, offers: s.offers, locationId: s.shop.locationId, deadlineDays: null });
    rows.push({
      score,
      shop_part_id: id,
      brand: p.brand || null,
      variant: p.variant || (s.aliases?.[id] || []).find((n) => n.includes(' ')) || id,
      also_known_as: (s.aliases?.[id] || []).slice(0, 4),
      speeds: p.specs?.speeds ?? (/(^|[^0-9])9-?SPEED|HG400-9|HG50-9|HG53|HG93|X9$/.test(names) ? 9 : null),
      customer_price: price,
      currency: s.shop.currency,
      availability: src.recommended.label,
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 8).map(({ score, ...r }) => r);
}

// Live research activity feed shown to the mechanic while research runs:
// steps, each web search with what it found, and a summary of the reasoning.
function reduceActivity(list, ev) {
  const at = now();
  const out = list.slice(-40);
  const close = (key) => {
    const row = out.find((r) => r.key === key && r.status === 'running');
    if (row) Object.assign(row, { status: 'done', endedAt: at });
  };
  if (ev.type === 'step') {
    for (const r of out) if (r.kind === 'step' && r.status === 'running' && r.key !== ev.key) Object.assign(r, { status: 'done', endedAt: at });
    if (!out.find((r) => r.key === ev.key)) out.push({ key: ev.key, kind: 'step', label: ev.label, status: ev.done ? 'done' : 'running', startedAt: at, endedAt: ev.done ? at : null });
  } else if (ev.type === 'step_done') {
    close(ev.key);
  } else if (ev.type === 'search') {
    out.push({ key: ev.id, kind: 'search', label: ev.query || 'manufacturer sites', status: 'running', startedAt: at, endedAt: null, results: [] });
  } else if (ev.type === 'shop') {
    out.push({ key: ev.id, kind: 'shop', label: ev.query, status: 'done', startedAt: at, endedAt: at, results: ev.items });
  } else if (ev.type === 'results') {
    const row = out.find((r) => r.key === ev.id);
    if (row) Object.assign(row, { status: 'done', endedAt: at, results: ev.items });
  }
  return out;
}

function closeActivity(list, run) {
  const at = now();
  const out = list.map((r) => (r.status === 'running' ? { ...r, status: 'done', endedAt: at } : r));
  if (run.mode === 'replay') out.push({ key: 'replay', kind: 'step', label: run.fallback_reason ? 'Live research failed; used recorded research' : 'Used recorded research', status: 'done', startedAt: at, endedAt: at });
  return out;
}

// With { wait: false } (the HTTP API) live AI research runs in the background:
// the call returns at once with status "checking" and progress updates land in
// job.research.progress for the UI to poll. Fixtures and tests wait.
async function withResearch(jobId, change, { wait = true } = {}) {
  const pending = mutate((s) => {
    const job = getJob(s, jobId);
    change(s, job);
    if (!job.constraints) return null;
    if (useRules(job, s.catalog)) {
      runResearch(s, job);
      return null;
    }
    const prev = job.research;
    const answeredAll = prev?.engine === 'ai' && prev.status === 'needs_info' && (prev.questions || []).length > 0 &&
      prev.questions.every((q) => ['confirmed', 'needs_inspection'].includes(job.configuration.components[q.slot]?.status));
    job.research = { schema: 'research.v1', engine: 'ai', mode: researchMode(), status: 'checking', startedAt: now(), configuration_version: job.configuration.version, questions: [], options: [], evidence: [], activity: [], thinking: null };
    job.requirements = [];
    return { version: job.configuration.version, text: job.request?.text, skipIntake: answeredAll, input: aiInput(job, s.bikes.find((b) => b.id === job.bikeId)) };
  });
  if (!pending) return getJobContext(jobId);
  const onProgress = (ev) =>
    mutate((s) => {
      const job = s.jobs[jobId];
      if (job?.research?.status !== 'checking' || job.configuration.version !== pending.version) return;
      job.research.activity = reduceActivity(job.research.activity || [], ev);
      if (ev.type === 'thinking') job.research.thinking = ev.text;
    });
  const finish = (run) => mutate((s) => {
    const job = getJob(s, jobId);
    if (job.configuration.version !== pending.version || job.request?.text !== pending.text) {
      log(job, 'research_ai_discarded', { configuration_version: pending.version }, { reason: 'job changed during research' });
      return view(s, job);
    }
    const { result, parts, evidence } = normalizeAiResearch({ job, run, catalog: s.catalog, aliases: s.aliases, shopIds: new Set(Object.keys(s.priceList || {})) });
    for (const p of parts) {
      // Keep the researched name/variant; price and stock come from the shop's own records.
      if (!s.catalog[p.id]) s.catalog[p.id] = { ...p, retailPrice: s.priceList?.[p.id] ?? null };
    }
    for (const e of evidence) s.evidence[e.id] = e;
    log(job, 'research_ai', { input: pending.input, mode: run.mode, fixture_id: run.fixture_id || null }, { status: result.status, requirements: (result.requirements_ai || []).map((r) => ({ id: r.id, partId: r.partId, citation: r.citation })) });
    result.cached = !!run.cached;
    result.timings = run.timings || null;
    result.activity = closeActivity(job.research?.activity || [], run);
    result.thinking = job.research?.thinking || null;
    result.startedAt = job.research?.startedAt || null;
    applyResearch(s, job, result);
    return view(s, job);
  });
  const work = runAiResearch(pending.input, { onProgress, skipIntake: pending.skipIntake, shopSearch: (q) => shopSearch(q) })
    .then(finish)
    .then((v) => {
      // Results are shown now; the source check runs after, in the background.
      // Replay marks sources at once, so return the view that includes them.
      const check = startSourceCheck(jobId);
      return wait || researchMode() !== 'live' ? check.then(() => getJobContext(jobId)) : v;
    });
  if (wait || researchMode() !== 'live') return work;
  work.catch((err) => {
    console.error('background research failed', err);
    mutate((s) => {
      const job = s.jobs[jobId];
      if (job?.research?.status === 'checking') {
        job.research = { ...job.research, status: 'not_found', not_found: { kind: 'no_research', reason: 'Research failed. Try again.', next_steps: [] } };
      }
    });
  });
  return getJobContext(jobId);
}

// Runs research for the current configuration, then reapplies earlier
// decisions that are still valid. Decisions that no longer fit are recorded
// as invalidated rather than silently dropped.
function runResearch(s, job) {
  if (!job.constraints) return;
  applyResearch(s, job, research({ job, catalog: s.catalog, evidence: s.evidence }));
}

// Shared by the rules engine and AI research: store the result, rebuild the
// requirement rows, reapply earlier decisions that are still valid and record
// the ones that are not.
function applyResearch(s, job, result) {
  const prevPlan = job.plan;
  job.research = result;
  log(job, 'research_compatibility', { configuration_version: job.configuration.version, constraints: job.constraints, engine: result.engine }, { status: result.status, options: (result.options || []).map((o) => ({ id: o.id, compatible: o.compatible })) });
  captureOutput({ stage: 'research', job_id: job.id, output: result });
  if (result.status !== 'ready') {
    job.requirements = [];
    // Selected parts depend on research and are dropped. A mechanic's skip is
    // kept; the next ready result rechecks it like any other decision.
    invalidateSelections(job, 'configuration changed', (sel) => sel.status === 'excluded');
    syncLabor(s, job);
    afterChange(s, job);
    return;
  }
  if (result.engine === 'ai') {
    job.plan = { optionId: null, configuration_version: job.configuration.version, chosenBy: 'ai_research' };
    job.requirements = result.requirements_ai;
  } else {
    const keepOpt = prevPlan && (result.options || []).find((o) => o.id === prevPlan.optionId && o.compatible);
    const optionId = keepOpt ? keepOpt.id : result.recommended_option_id;
    job.plan = { optionId, configuration_version: job.configuration.version, chosenBy: keepOpt ? prevPlan.chosenBy : 'recommended' };
    job.requirements = requirementsFor(result, optionId, s.catalog);
  }
  for (const [rid, sel] of Object.entries(job.selections)) {
    const req = job.requirements.find((r) => r.id === rid);
    const allowed = req && (req.partId === sel.partId || req.alternatives.includes(sel.partId) || (rid === 'chain' && (result.chain_candidates || []).includes(sel.partId)));
    if (!req || !allowed) {
      job.rejected.push({ requirementId: rid, partId: sel.partId, at: now(), reason: req ? 'no longer compatible' : 'no longer required' });
      delete job.selections[rid];
    } else {
      sel.configuration_version = job.configuration.version;
      if (result.engine !== 'ai' && rid === 'cassette' && sel.partId !== req.partId) sel.partId = req.partId;
    }
  }
  const sourcing = job.requirements.map((r) => ({ requirementId: r.id, ...sourceFor(s, job, s.catalog[job.selections[r.id]?.partId || r.partId], r.qty) }));
  captureOutput({ stage: 'sourcing', job_id: job.id, configuration_version: job.configuration.version, output: { schema: 'sourcing.v1', items: sourcing } });
  log(job, 'get_available_inventory+get_supplier_offers', { part_ids: sourcing.map((x) => x.partId) }, sourcing.map((x) => ({ partId: x.partId, recommended: x.recommended.type })));
  syncLabor(s, job);
  afterChange(s, job);
}

function invalidateSelections(job, reason, keep = () => false) {
  for (const [rid, sel] of Object.entries(job.selections)) {
    if (keep(sel)) continue;
    job.rejected.push({ requirementId: rid, partId: sel.partId, at: now(), reason });
    delete job.selections[rid];
  }
}

export function savePartSelection(jobId, selection, configurationVersion) {
  return mutate((s) => {
    const job = getJob(s, jobId);
    if (configurationVersion != null && configurationVersion !== job.configuration.version) {
      fail(409, 'stale_configuration', 'Components changed since these recommendations. Recheck first.', { current: job.configuration.version });
    }
    if (!job.research || job.research.status !== 'ready') fail(409, 'research_not_ready', 'Research is not ready.');
    const { requirementId, partId, status = 'selected', price } = selection || {};
    let req = job.requirements.find((r) => r.id === requirementId);
    if (!req) fail(400, 'unknown_requirement', `No requirement ${requirementId}`);
    if (!['selected', 'excluded', 'needs_inspection'].includes(status)) fail(400, 'bad_status', `Unknown status ${status}`);
    if (status === 'excluded' && !req.skippable) fail(422, 'required', `${req.title} is required for this job. Use Needs inspection if it can't be decided yet.`);
    const result = { requirementId, dependency_changes: [] };
    if (status === 'selected' && req.citation === 'uncited' && (!partId || partId === req.partId)) {
      fail(422, 'uncited', 'No manufacturer source supports this part. Check further or ask a supplier.');
    }

    if (job.research.engine !== 'ai' && requirementId === 'cassette' && partId && partId !== req.partId) {
      // Choosing another cassette swaps to that option and rechecks dependencies.
      const opt = job.research.options.find((o) => o.cassettePartId === partId && o.compatible);
      if (!opt) fail(422, 'incompatible', 'That cassette is not compatible with the confirmed components.');
      const before = new Set(job.requirements.map((r) => r.id));
      job.rejected.push({ requirementId, partId: req.partId, at: now(), reason: 'mechanic chose alternative' });
      job.plan = { optionId: opt.id, configuration_version: job.configuration.version, chosenBy: 'mechanic' };
      job.requirements = requirementsFor(job.research, opt.id, s.catalog);
      const after = new Set(job.requirements.map((r) => r.id));
      for (const id of before) if (!after.has(id)) {
        result.dependency_changes.push({ type: 'removed', requirementId: id });
        if (job.selections[id]) {
          job.rejected.push({ requirementId: id, partId: job.selections[id].partId, at: now(), reason: 'dependency removed by cassette change' });
          delete job.selections[id];
        }
      }
      for (const id of after) if (!before.has(id)) result.dependency_changes.push({ type: 'added', requirementId: id });
      req = job.requirements.find((r) => r.id === 'cassette');
    } else if (partId && partId !== req.partId && !req.alternatives.includes(partId)) {
      fail(422, 'incompatible', 'That part is not a verified compatible option.');
    }

    const chosen = partId || req.partId;
    const part = s.catalog[chosen];
    let customPrice = null;
    if (status === 'selected' && part.retailPrice == null) {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0 || p > 10000) fail(422, 'price_required', 'Set a customer price for this part.');
      customPrice = Math.round(p * 100) / 100;
    }
    const src = sourceFor(s, job, part, req.qty);
    const prev = job.selections[requirementId];
    if (prev && prev.partId !== chosen && status === 'selected') {
      job.rejected.push({ requirementId, partId: prev.partId, at: now(), reason: 'replaced' });
    }
    job.selections[requirementId] = {
      requirementId,
      partId: chosen,
      status,
      qty: req.qty || 1,
      customPrice,
      sourcing: status === 'selected' ? { ...src.recommended, partId: chosen } : null,
      configuration_version: job.configuration.version,
      decidedAt: now(),
    };
    if (status === 'excluded') job.rejected.push({ requirementId, partId: chosen, at: now(), reason: 'excluded by mechanic' });
    job.updatedAt = now();
    syncLabor(s, job);
    afterChange(s, job);
    log(job, 'save_part_selection', { selection, configuration_version: configurationVersion }, result);
    return { ...view(s, job), result };
  });
}

// Labor comes from the shop rate card, keyed by the slots being changed.
// Mechanic-edited lines are preserved.
function syncLabor(s, job) {
  const ops = new Set();
  for (const r of job.requirements || []) {
    const sel = job.selections[r.id];
    if (sel?.status === 'selected') ops.add(s.shop.laborOps[r.slot] ? r.slot : null);
  }
  ops.delete(null);
  if (['cassette', 'rear_derailleur', 'chain'].some((x) => ops.has(x))) ops.add('drivetrain_adjust');
  // Rate-card lines exist only while their part is on the job; a mechanic's
  // hours edit or include/exclude choice carries over while it is. Lines
  // that were already on the work order and custom lines are always kept.
  const opIds = new Set(Object.keys(s.shop.laborOps).map((op) => `labor-${op}`));
  const keep = job.labor.filter((l) => !opIds.has(l.id));
  const auto = [...ops].map((op) => {
    const prev = job.labor.find((l) => l.id === `labor-${op}`);
    const def = s.shop.laborOps[op];
    if (prev && prev.source === 'mechanic') return prev;
    return { id: `labor-${op}`, label: def.label, hours: def.hours, rate: s.shop.laborRate, source: 'rate_card', included: prev ? prev.included !== false : true };
  });
  job.labor = [...keep, ...auto];
}

export function updateLabor(jobId, labor = []) {
  return mutate((s) => {
    const job = getJob(s, jobId);
    // Validate every update before changing anything, so a bad entry leaves the job untouched.
    for (const upd of labor) {
      const line = job.labor.find((l) => l.id === upd.id);
      if (line && upd.hours != null) {
        const h = Number(upd.hours);
        if (!Number.isFinite(h) || h < 0 || h > 40) fail(400, 'bad_hours', 'Hours must be between 0 and 40.');
      } else if (!line && upd.label && upd.hours != null) {
        const h = Number(upd.hours);
        if (!Number.isFinite(h) || h <= 0 || h > 40) fail(400, 'bad_hours', 'Hours must be more than 0 and at most 40.');
      }
    }
    for (const upd of labor) {
      const line = job.labor.find((l) => l.id === upd.id);
      if (line) {
        if (upd.hours != null) {
          line.hours = Math.round(Number(upd.hours) * 100) / 100;
          // Work already on the order stays "existing"; the edit is recorded separately.
          if (line.source !== 'existing') line.source = 'mechanic';
          line.edited = true;
        }
        if (upd.included != null) line.included = !!upd.included;
      } else if (upd.label) {
        const h = upd.hours == null ? 0.25 : Number(upd.hours);
        job.labor.push({ id: `labor-custom-${crypto.randomUUID().slice(0, 8)}`, label: String(upd.label).slice(0, 80), hours: Math.round(h * 100) / 100, rate: s.shop.laborRate, source: 'mechanic', included: true });
      }
    }
    job.updatedAt = now();
    afterChange(s, job);
    log(job, 'update_labor', { labor }, { lines: job.labor.length });
    return view(s, job);
  });
}

export function setStage(jobId, stage) {
  if (!['describe', 'review', 'quote', 'track'].includes(stage)) fail(400, 'bad_stage', 'Unknown stage');
  return mutate((s) => {
    const job = getJob(s, jobId);
    if (stage === 'quote' && !readyToQuote(job).ready) fail(409, 'not_ready', 'Finish recommendations first.', readyToQuote(job).blockers);
    job.stage = stage;
    job.updatedAt = now();
    return view(s, job);
  });
}

// After any change: if the job content no longer matches the approved or sent
// estimate, mark it. An approval never silently carries over to new content.
function currentHash(s, job) {
  const p = preview(job, s.shop, s.catalog);
  return contentHash(p.lines, p.totals);
}

function afterChange(s, job) {
  const hash = currentHash(s, job);
  const lastId = job.estimates[job.estimates.length - 1];
  const last = lastId ? s.estimates[lastId] : null;
  if (job.approval && job.approval.contentHash !== hash) {
    job.approval = { ...job.approval, valid: false, invalidatedAt: now() };
    job.status = 'changed_after_approval';
  } else if (job.approval && job.approval.contentHash === hash && job.status === 'changed_after_approval') {
    job.approval = { ...job.approval, valid: true, invalidatedAt: null };
    job.status = 'approved';
  }
  if (last && last.status === 'sent' && last.contentHash !== hash) {
    last.status = 'outdated';
    job.status = 'draft';
  }
}

export function createOrUpdateDraftEstimate(jobId, version, idempotencyKey) {
  return mutate((s) => {
    const key = scopedKey(`estimate:${jobId}`, idempotencyKey);
    if (key && s.idempotency[key]) return s.idempotency[key];
    const job = getJob(s, jobId);
    const est = upsertDraft(s, job, version);
    const out = { schema: 'estimate.v1', estimate: publicEstimate(est) };
    if (key) s.idempotency[key] = out;
    log(job, 'create_or_update_draft_estimate', { version, idempotency_key: idempotencyKey }, { id: est.id, version: est.version, total_cents: est.totals.total_cents });
    captureOutput({ stage: 'estimate', job_id: job.id, output: out });
    return out;
  });
}

function upsertDraft(s, job, version) {
  const ready = readyToQuote(job);
  if (!ready.ready) fail(409, 'not_ready', 'Finish recommendations first.', ready.blockers);
  const p = preview(job, s.shop, s.catalog);
  const hash = contentHash(p.lines, p.totals);
  const lastId = job.estimates[job.estimates.length - 1];
  let est = lastId ? s.estimates[lastId] : null;
  if (version != null && est && version !== est.version && est.status === 'draft') {
    fail(409, 'stale_estimate_version', `Draft is at version ${est.version}`);
  }
  // Content is back to what the customer already has (sent or approved): the
  // unsent draft is dropped so nothing is re-sent and the approval stands.
  if (est && est.status === 'draft') {
    const prior = s.estimates[job.estimates[job.estimates.length - 2]];
    const stands = prior && (prior.status === 'sent' || (prior.status === 'approved' && job.approval?.valid && job.approval.estimateId === prior.id));
    if (stands && prior.contentHash === hash) {
      job.estimates.pop();
      delete s.estimates[est.id];
      est = prior;
    }
  }
  if (est && est.status === 'draft') {
    Object.assign(est, { lines: p.lines, totals: p.totals, contentHash: hash, configuration_version: job.configuration.version, updatedAt: now() });
  } else if (est && ['sent', 'approved'].includes(est.status) && est.contentHash === hash) {
    // Unchanged content: reuse the existing version.
  } else {
    const v = (est?.version || 0) + 1;
    est = {
      id: `${job.id}-E${v}`,
      jobId: job.id,
      version: v,
      status: 'draft',
      lines: p.lines,
      totals: p.totals,
      contentHash: hash,
      configuration_version: job.configuration.version,
      plan_option_id: job.plan?.optionId || null,
      createdAt: now(),
      updatedAt: now(),
      token: crypto.randomBytes(9).toString('base64url'),
      message: null,
      sentAt: null,
      response: null,
    };
    s.estimates[est.id] = est;
    job.estimates.push(est.id);
  }
  return est;
}

// True when the text names a dollar amount but not the actual total.
export function mentionsWrongTotal(text, totalCents) {
  const amounts = String(text).match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || [];
  if (!amounts.length) return false;
  const total = totalCents / 100;
  return !amounts.some((a) => Math.abs(Number(a.replace(/[$,\s]/g, '')) - total) < 0.005);
}

// The single "Send quote" action: confirms the customer price, drafts the
// estimate version and sends the approval message to the SIMULATED inbox.
export function sendQuote(jobId, { message, idempotency_key } = {}) {
  return mutate((s) => {
    const key = scopedKey(`send:${jobId}`, idempotency_key);
    if (key && s.idempotency[key]) return s.idempotency[key];
    const job = getJob(s, jobId);
    const est = upsertDraft(s, job);
    if (est.status === 'sent' || est.status === 'approved') {
      // Nothing changed since the customer got it: nothing to send, back to tracking.
      job.stage = 'track';
      return { ...view(s, job), result: { already_sent: true, estimate_id: est.id } };
    }
    // An edited text must not quote a different price than the estimate.
    const custom = message && String(message).trim();
    if (custom && mentionsWrongTotal(custom, est.totals.total_cents)) {
      fail(422, 'message_total_mismatch', `The text gives a different price than the quote total (${fmt(est.totals.total_cents)}). Update the text first.`);
    }
    captureOutput({ stage: 'estimate', job_id: job.id, output: { schema: 'estimate.v1', estimate: publicEstimate(est) } });
    const customer = s.customers.find((c) => c.id === job.customerId);
    const bike = s.bikes.find((b) => b.id === job.bikeId);
    const text = (message && String(message).trim()) || draftCustomerMessage({ job, customer, bike, estimate: est, shop: s.shop, catalog: s.catalog });
    doSend(s, job, est, text.slice(0, 600));
    const out = { ...view(s, job), result: { estimate_id: est.id, version: est.version } };
    if (key) s.idempotency[key] = out;
    return out;
  });
}

export function draftMessage(jobId) {
  const s = load();
  const job = getJob(s, jobId);
  const p = preview(job, s.shop, s.catalog);
  const customer = s.customers.find((c) => c.id === job.customerId);
  const bike = s.bikes.find((b) => b.id === job.bikeId);
  return draftCustomerMessage({ job, customer, bike, estimate: p, shop: s.shop, catalog: s.catalog });
}

function doSend(s, job, est, text) {
  for (const id of job.estimates) {
    const e = s.estimates[id];
    if (e.id !== est.id && ['sent', 'outdated'].includes(e.status)) e.status = 'superseded';
  }
  est.status = 'sent';
  est.sentAt = now();
  est.message = text;
  const customer = s.customers.find((c) => c.id === job.customerId);
  s.inbox.push({
    id: `msg-${s.inbox.length + 1}`,
    simulated: true,
    to: customer.phone,
    customerId: customer.id,
    jobId: job.id,
    estimateId: est.id,
    version: est.version,
    body: text,
    token: est.token,
    sentAt: est.sentAt,
  });
  job.status = 'quote_sent';
  job.stage = 'track';
  job.approval = null;
  job.updatedAt = now();
  log(job, 'send_approval_request', { estimate_id: est.id, version: est.version }, { simulated: true, to: customer.phone });
  captureOutput({ stage: 'customer_message', job_id: job.id, output: { schema: 'customer_message.v1', estimate_id: est.id, version: est.version, body: text, simulated: true } });
}

export function sendApprovalRequest(estimateId, approvedMessage, idempotencyKey) {
  return mutate((s) => {
    const key = scopedKey(`approval:${estimateId}`, idempotencyKey);
    if (key && s.idempotency[key]) return s.idempotency[key];
    const est = s.estimates[estimateId];
    if (!est) fail(404, 'estimate_not_found', 'No such estimate');
    if (est.status !== 'draft') fail(409, 'not_draft', `Estimate is ${est.status}`);
    if (!approvedMessage) fail(400, 'message_required', 'Approved message text is required.');
    const job = getJob(s, est.jobId);
    // A draft is a snapshot. Never send one that no longer matches the work order.
    if (est.contentHash !== currentHash(s, job)) fail(409, 'stale_draft', 'The work order changed since this draft. Update the draft first.');
    if (mentionsWrongTotal(approvedMessage, est.totals.total_cents)) fail(422, 'message_total_mismatch', `The text gives a different price than the quote total (${fmt(est.totals.total_cents)}).`);
    doSend(s, job, est, String(approvedMessage).slice(0, 600));
    const out = { estimate: publicEstimate(est) };
    if (key) s.idempotency[key] = out;
    return out;
  });
}

export function recordCustomerResponse(estimateId, estimateVersion, response) {
  return mutate((s) => {
    const est = s.estimates[estimateId];
    if (!est) fail(404, 'estimate_not_found', 'No such estimate');
    return respond(s, est, estimateVersion, response);
  });
}

function respond(s, est, version, response) {
  if (!['approve', 'decline'].includes(response)) fail(400, 'bad_response', 'Response must be approve or decline');
  if (version != null && version !== est.version) fail(409, 'version_mismatch', 'This quote version is no longer current.');
  if (est.status !== 'sent') fail(409, 'not_open', NOT_OPEN[est.status] || NOT_OPEN.outdated);
  const job = getJob(s, est.jobId);
  // Approval only counts for the content the work order still has.
  if (response === 'approve' && est.contentHash !== currentHash(s, job)) {
    fail(409, 'not_open', 'This quote was updated by the shop. A new version will be sent.');
  }
  est.response = { response, at: now() };
  if (response === 'approve') {
    est.status = 'approved';
    job.status = 'approved';
    job.stage = 'track';
    job.approval = { estimateId: est.id, version: est.version, at: now(), contentHash: est.contentHash, total_cents: est.totals.total_cents, valid: true };
  } else {
    est.status = 'declined';
    job.status = 'declined';
    job.stage = 'quote';
  }
  job.updatedAt = now();
  log(job, 'record_customer_response', { estimate_id: est.id, version: est.version, response }, { job_status: job.status });
  captureOutput({ stage: 'customer_response', job_id: job.id, output: { estimate_id: est.id, version: est.version, response } });
  return { estimate: publicEstimate(est), job_status: job.status };
}

export function getAvailableInventory(partIds, locationId) {
  const s = load();
  const loc = locationId || s.shop.locationId;
  return { schema: 'inventory.v1', location_id: loc, items: partIds.map((id) => availability(s.inventory, id, loc)), reserves_stock: false };
}

export function getSupplierOffers(partIds) {
  const s = load();
  return { schema: 'supplier_offers.v1', simulated: true, offers: s.offers.filter((o) => partIds.includes(o.partId)) };
}

export function draftSupplierInquiry(jobId, { requirementId, question } = {}) {
  return mutate((s) => {
    const job = getJob(s, jobId);
    const req = (job.requirements || []).find((r) => r.id === requirementId);
    const bike = s.bikes.find((b) => b.id === job.bikeId);
    const LABEL = { crankset: 'Crankset', rear_derailleur: 'Rear derailleur', cassette: 'Cassette', shifters: 'Shifters', freehub: 'Freehub', chain: 'Chain' };
    const known = Object.entries(job.configuration.components)
      .filter(([, v]) => v.status === 'confirmed' && v.label && !(v.partId && s.catalog[v.partId]?.unverified))
      .map(([k, v]) => `${LABEL[k] || cap(k.replace(/_/g, ' '))} ${v.label}`);
    const missing = job.research?.not_found?.missing?.map((k) => (LABEL[k] || k).toLowerCase()) || [];
    const text =
      question ||
      [
        `Customer bike: ${bike?.label || 'not recorded'}. Goal: ${job.constraints?.goalSummary || 'not stated'}.`,
        known.length ? `Confirmed: ${known.join(', ')}.` : 'Drivetrain not yet identified.',
        missing.length ? `The ${missing.join(' and ')} is not in our verified data.` : req ? `Need: ${req.title.toLowerCase()} (${s.catalog[req.partId]?.variant}).` : '',
        'What would you suggest that fits, and what is the ETA?',
      ].filter(Boolean).join(' ');
    const inquiry = { id: `inq-${(job.inquiries || []).length + 1}`, requirementId: requirementId || null, text, status: 'draft', simulated: true, at: now() };
    job.inquiries = [...(job.inquiries || []), inquiry];
    log(job, 'draft_supplier_inquiry', { requirementId }, inquiry);
    return view(s, job);
  });
}

export function getInbox() {
  const s = load();
  return {
    simulated: true,
    messages: s.inbox.map(({ token, ...m }) => ({ ...m, link: `/approve/${token}`, estimate_status: s.estimates[m.estimateId]?.status })),
  };
}

export function getApprovalView(token) {
  const s = load();
  const est = Object.values(s.estimates).find((e) => e.token === token);
  if (!est) fail(404, 'not_found', 'Quote not found');
  const job = s.jobs[est.jobId];
  const customer = s.customers.find((c) => c.id === job.customerId);
  const bike = s.bikes.find((b) => b.id === job.bikeId);
  return {
    shop: { name: s.shop.name, phone: s.shop.phone },
    customer: { first_name: customer.name.split(' ')[0] },
    bike: bike?.label,
    estimate: {
      id: est.id,
      version: est.version,
      status: est.status,
      lines: est.lines.map((l) => ({ label: l.type === 'part' ? s.catalog[l.partId]?.customerLabel || l.label : l.label, amount_cents: l.amount_cents, type: l.type })),
      totals: est.totals,
      message: est.message,
      sentAt: est.sentAt,
    },
    simulated: true,
  };
}

export function respondByToken(token, response) {
  return mutate((s) => {
    const est = Object.values(s.estimates).find((e) => e.token === token);
    if (!est) fail(404, 'not_found', 'Quote not found');
    return respond(s, est, est.version, response);
  });
}

export function developerReport(jobId) {
  const s = load();
  const job = getJob(s, jobId);
  return {
    run_id: runId(),
    job,
    estimates: job.estimates.map((id) => s.estimates[id]),
    inbox: s.inbox.filter((m) => m.jobId === job.id),
  };
}
