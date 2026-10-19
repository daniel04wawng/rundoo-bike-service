// Validates and normalizes AI research output (live or replay) into the same
// research.v1 / requirement shapes the rules engine produces. The model's
// output is treated as untrusted data:
//   - fields are clamped to schema and length limits
//   - a source only counts if its URL is https on a manufacturer domain
//   - a requirement or alternative with no valid source is "uncited": shown
//     for checking, never selectable
import crypto from 'node:crypto';
import { MANUFACTURER_DOMAINS } from '../adapters/research_llm.js';

const str = (v, n = 160) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const arr = (v, n = 12) => (Array.isArray(v) ? v.slice(0, n) : []);
const slug = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function allowedSource(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return MANUFACTURER_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Builds research.v1 from a raw AI result. Returns the result plus catalog and
// evidence records to upsert, so the caller can store them in state.
// Coarse part family from a name, used only to reject alternatives that are
// clearly a different kind of part (e.g. a derailleur offered for a cassette).
const FAMILIES = [
  ['cassette', /\bCS-|cassette|sprocket/i],
  ['chain', /\bCN-|chain\b/i],
  ['rear_derailleur', /\bRD-|derailleur/i],
  ['brake_pads', /pad|shoe|insert|R55C/i],
  ['crankset', /\bFC-|crank/i],
  ['tire', /tyre|tire/i],
];
export function partFamily(p) {
  const text = `${p?.name || ''} ${p?.variant || ''} ${p?.mpn || ''}`;
  return FAMILIES.find(([, re]) => re.test(text))?.[0] || null;
}

const keyOf = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Resolve a researched part onto the shop's catalog by exact alias (part
// number or exact designation). No fuzzy matching: R55C4 must never match
// R55C4-A. A code that only repeats the start of a differently qualified
// designation (mpn "R55C4" for "R55C4 (carbon rims)") is a family code, not a
// product, so it never resolves on its own.
export function resolveAlias(p, aliases = {}) {
  const designations = [p?.variant, p?.brand && p?.variant ? `${p.brand} ${p.variant}` : null].filter(Boolean).map(keyOf);
  const mpn = keyOf(p?.mpn);
  const familyCode = mpn && designations.some((d) => d !== mpn && d.startsWith(mpn));
  for (const [id, names] of Object.entries(aliases)) {
    const keys = names.map(keyOf);
    if (designations.some((d) => keys.includes(d))) return id;
    if (mpn && !familyCode && keys.includes(mpn)) return id;
  }
  return null;
}

export function normalizeAiResearch({ job, run, catalog, aliases = {}, shopIds = new Set() }) {
  const base = {
    schema: 'research.v1',
    engine: 'ai',
    mode: run.mode,
    fixture_id: run.fixture_id || null,
    provenance: run.provenance || null,
    fallback_reason: run.fallback_reason || null,
    job_id: job.id,
    configuration_version: job.configuration.version,
    goal: job.constraints?.goalType || 'unknown',
    observed: job.request?.extraction?.observed_conditions || [],
    inferred: [],
    evidence: [],
    options: [],
    questions: [],
    requirements: [],
  };
  const raw = run.raw;
  if (!raw || typeof raw !== 'object') {
    return {
      result: { ...base, status: 'not_found', not_found: { kind: 'no_research', reason: run.error || 'No research result.', next_steps: ['Draft supplier question'] } },
      parts: [],
      evidence: [],
    };
  }

  // Sources: keep only valid manufacturer URLs, under stable ids.
  const evidence = [];
  const sourceMap = {};
  for (const src of arr(raw.sources, 20)) {
    const url = str(src?.url, 300);
    if (!allowedSource(url)) continue;
    const id = `ai-${crypto.createHash('sha1').update(url + str(src.claim, 300)).digest('hex').slice(0, 10)}`;
    sourceMap[str(src.id, 20)] = id;
    evidence.push({ id, title: str(src.title, 120) || new URL(url).hostname, url, claim: str(src.claim, 300), retrieved: str(src.retrieved, 20) || null, origin: run.mode === 'live' ? 'ai_live' : 'ai_replay' });
  }
  const cite = (ids) => arr(ids, 8).map((x) => sourceMap[str(x, 20)]).filter(Boolean);

  const parts = [];
  const partFor = (p, slot) => {
    if (!p || !str(p.variant || p.name)) return null;
    const mpn = str(p.mpn, 60);
    // Reuse a verified catalog part when the model names one we already have.
    const existing = Object.values(catalog).find((c) => c && c.slot && !c.unverified && (c.variant === p.variant || (mpn && c.id === mpn)));
    if (existing) return existing.id;
    // A shop part id named by the model wins, but only if it really is in the
    // shop's catalog; otherwise fall back to exact aliases, then a new id.
    // The shop id must name the same product (same rules as aliases).
    const shopId = str(p.shop_part_id, 60);
    const shopNames = shopId && shopIds.has(shopId) ? [...(aliases[shopId] || []), catalog[shopId]?.variant].filter(Boolean) : [];
    const shopMatch = shopNames.length && resolveAlias(p, { [shopId]: shopNames }) ? shopId : null;
    // A new id never reuses one held by a different product, and never a shop
    // product id: those are only reached by a designation or alias match, so an
    // unresolved part can't pick up a shop product's price or stock.
    const variant = str(p.variant, 80) || str(p.name, 80);
    const taken = (x) => shopIds.has(x) || x in aliases || [catalog[x], parts.find((q) => q.id === x)].some((q) => q && keyOf(q.variant) !== keyOf(variant));
    let fresh = `AI-${slug(mpn || `${p.brand} ${p.variant || p.name}`)}`;
    if (taken(fresh)) fresh = `AI-${slug(`${p.brand} ${variant}`)}`;
    for (let n = 2; taken(fresh) && n < 20; n += 1) fresh = `AI-${slug(`${p.brand} ${variant}`)}-${n}`;
    const id = shopMatch || resolveAlias(p, aliases) || fresh;
    if (!catalog[id] && !parts.some((x) => x.id === id)) {
      parts.push({
        id,
        slot: str(slot, 40) || 'other',
        brand: str(p.brand, 40),
        name: str(p.name, 80) || str(p.variant, 80),
        variant: str(p.variant, 80) || str(p.name, 80),
        mpn,
        customerLabel: (str(p.customer_label, 60) || str(p.name, 60) || str(p.variant, 60)).toLowerCase(),
        aiSourced: true,
        specs: {},
      });
    }
    return id;
  };

  const requirements = [];
  for (const r of arr(raw.requirements, 8)) {
    const slot = str(r.slot, 40) || str(r.id, 40);
    const partId = partFor(r.part, slot);
    if (!partId) continue;
    const reqEvidence = cite(r.source_ids);
    const checks = arr(r.fit_checks, 6).map((c) => {
      const ev = cite(c.source_ids);
      return { rule: 'cited_fit', pass: ev.length > 0, detail: str(c.detail, 200), evidence_ids: ev };
    });
    const cited = reqEvidence.length > 0 && checks.some((c) => c.pass);
    const alternatives = [];
    const altMeta = {};
    const mainFamily = partFamily(r.part);
    for (const a of arr(r.alternatives, 5)) {
      const fam = partFamily(a.part);
      if (mainFamily && fam && fam !== mainFamily) continue; // different kind of part
      const aid = partFor(a.part, slot);
      const ev = cite(a.source_ids);
      if (!aid || aid === partId || !ev.length) continue; // uncited alternatives are dropped
      alternatives.push(aid);
      altMeta[aid] = { reason: str(a.reason, 120), tags: arr(a.tags, 4).map((t) => str(t, 20)), dependency: str(a.dependency, 160) || null, evidence_ids: ev };
    }
    const kind = ['required', 'recommended', 'suggested'].includes(r.kind) ? r.kind : 'required';
    requirements.push({
      id: slug(r.id || slot).toLowerCase().replace(/-/g, '_') || `req_${requirements.length + 1}`,
      slot,
      title: str(r.title, 40) || slot,
      kind,
      qty: Number.isInteger(r.qty) && r.qty > 0 && r.qty <= 10 ? r.qty : 1,
      partId,
      reason: str(r.reason, 120),
      checks: checks.length ? checks : [{ rule: 'cited_fit', pass: false, detail: 'No manufacturer source found', evidence_ids: [] }],
      evidence_ids: reqEvidence,
      citation: cited ? 'cited' : 'uncited',
      alternatives,
      altMeta,
      // Uncited parts can always be skipped so the mechanic is never stuck.
      skippable: kind !== 'required' || !cited,
      engine: 'ai',
    });
  }

  const status = ['ready', 'needs_info', 'not_found'].includes(raw.status) ? raw.status : 'not_found';
  const questions = arr(raw.questions, 6)
    .map((q, i) => ({
      id: `q-ai-${i}`,
      slot: slug(q.slot).toLowerCase().replace(/-/g, '_') || `detail_${i}`,
      text: str(q.text, 140),
      hint: str(q.hint, 140),
      // A suggestion is a pre-fill, never a confirmation; it needs a stated basis.
      suggestion: str(q.suggestion_basis, 80) ? str(q.suggestion, 80) || null : null,
      suggestion_basis: str(q.suggestion, 80) ? str(q.suggestion_basis, 80) || null : null,
      // Chips are for fixed-set answers only; model-code-like options are dropped.
      options: arr(q.options, 4).map((o) => str(o, 30)).filter((o) => o && !/^(other|unknown|not sure)$/i.test(o) && !/variant|[A-Z]{2}-?[A-Z]?\d{3,}/.test(o)),
      input: 'text',
      blocking: true,
      status: 'needs_confirmation',
    }))
    .filter((q) => q.text);

  const result = {
    ...base,
    status: status === 'ready' && !requirements.length ? 'not_found' : status,
    summary: str(raw.summary, 200),
    questions: status === 'needs_info' ? questions : [],
    requirements_ai: requirements,
    inferred: arr(raw.inferred, 6).map((x) => str(x, 200)).filter(Boolean),
    evidence,
    not_found:
      status === 'not_found' || (status === 'ready' && !requirements.length)
        ? { kind: 'no_research', reason: str(raw.not_found?.reason, 160) || 'No manufacturer-supported answer found.', next_steps: arr(raw.not_found?.next_steps, 4).map((x) => str(x, 60)) }
        : undefined,
  };
  return { result, parts, evidence };
}

// What the model (or matcher) sees about the job. No customer contact data.
export function aiInput(job, bike) {
  const components = {};
  for (const [slot, c] of Object.entries(job.configuration.components)) {
    components[slot] = { label: c.label || null, status: c.status, source: c.source || null };
  }
  return {
    request_text: job.request?.text || '',
    goal_type: job.constraints?.goalType || 'unknown',
    goal_summary: job.constraints?.goalSummary || '',
    budget: job.constraints?.budget ?? null,
    deadline_days: job.constraints?.deadlineDays ?? null,
    observed_conditions: job.constraints?.observed || [],
    bike_id: bike?.id || null,
    bike: bike?.label || null,
    components,
  };
}
