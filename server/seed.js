// Synthetic seed state. Technical specs and evidence come from
// data/catalog/*.json (manufacturer-cited). Customers, stock, prices,
// suppliers and offers are SYNTHETIC and labelled as such.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

export function buildSeedState() {
  const components = read('data/catalog/components.json');
  const evidence = read('data/catalog/evidence.json');
  const commercial = read('data/fixtures/commercial.json');
  const people = read('data/fixtures/customers.json');

  const catalog = {};
  for (const p of components.parts) {
    catalog[p.id] = { ...p, retailPrice: commercial.retailPrices[p.id] ?? 0 };
  }
  catalog._choices = components.choices;

  const ev = {};
  for (const e of evidence.items) ev[e.id] = e;

  const state = {
    meta: { seed_version: 1, createdAt: new Date().toISOString(), synthetic: true },
    shop: commercial.shop,
    customers: people.customers,
    bikes: people.bikes,
    catalog,
    priceList: commercial.retailPrices,
    aliases: commercial.aliases || {},
    evidence: ev,
    inventory: commercial.inventory,
    offers: commercial.offers,
    jobs: {},
    estimates: {},
    inbox: [],
    idempotency: {},
    counters: { job: people.nextJobNumber },
  };

  for (const seed of people.jobs) {
    const customer = state.customers.find((c) => c.id === seed.customerId);
    const bike = state.bikes.find((b) => b.id === seed.bikeId);
    const job = blankJob(seed.id, customer, bike, seed.title);
    job.createdAt = seed.createdAt;
    job.updatedAt = seed.createdAt;
    job.labor = (seed.existingLabor || []).map((l) => ({ ...l, rate: commercial.shop.laborRate, source: 'existing', included: true }));
    state.jobs[seed.id] = job;
  }
  return state;
}

export function blankJob(id, customer, bike, title) {
  const components = {};
  for (const [slot, rec] of Object.entries(bike?.recordedComponents || {})) {
    components[slot] = { ...rec, status: rec.partId || (rec.label && !rec.familyHint) ? 'candidate' : 'unknown', source: 'bike_record' };
  }
  return {
    id,
    customerId: customer.id,
    bikeId: bike?.id || null,
    title: title || 'Repair / custom job',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft',
    stage: 'describe',
    request: null,
    constraints: null,
    configuration: { version: 1, components },
    research: null,
    plan: null,
    requirements: [],
    selections: {},
    rejected: [],
    labor: [],
    existingLines: [],
    estimates: [],
    approval: null,
    inquiries: [],
    toolLog: [],
  };
}
