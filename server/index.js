// HTTP API + static web app. Each route maps to one named tool in
// server/orchestrator.js so scripts and tests can call the same functions
// headlessly (scripts/run-fixture.js) or over HTTP.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import * as tools from './orchestrator.js';
import { load, reset, runId } from './store.js';
import { liveAvailable } from './adapters/llm.js';
import { researchMode } from './adapters/research_llm.js';
import { appUsageMiddleware, trackFromClient, summary } from './analytics.js';
import { renderStats } from './stats_page.js';

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(appUsageMiddleware);

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.code || 'error', message: err.message, details: err.details });
  }
};

app.get('/api/health', (req, res) =>
  res.json({ ok: true, run_id: runId(), extraction_mode: process.env.EXTRACTION_MODE === 'live' && liveAvailable() ? 'live' : 'replay', research_mode: researchMode() }),
);
app.get('/api/bootstrap', wrap(() => tools.bootstrap()));
app.get('/api/jobs', wrap(() => tools.listJobs()));
app.post('/api/jobs', wrap((req) => tools.createJob(req.body)));
app.get('/api/customers', wrap(() => tools.listCustomers()));
app.post('/api/customers', wrap((req) => tools.createCustomer(req.body)));
app.post('/api/customers/:id/bikes', wrap((req) => tools.createBike(req.params.id, req.body)));
app.get('/api/jobs/:id', wrap((req) => tools.getJobContext(req.params.id)));
app.post('/api/jobs/:id/describe', wrap((req) => tools.describeJob(req.params.id, req.body, { wait: false })));
app.post('/api/jobs/:id/components', wrap((req) => tools.updateConfirmedComponents(req.params.id, req.body.components, req.body.evidence, { wait: false })));
app.post('/api/jobs/:id/research', wrap((req) => tools.researchCompatibility(req.params.id, req.body.configuration_version, req.body.constraints, { wait: false })));
app.post('/api/jobs/:id/selection', wrap((req) => tools.savePartSelection(req.params.id, req.body.selection, req.body.configuration_version)));
app.post('/api/jobs/:id/labor', wrap((req) => tools.updateLabor(req.params.id, req.body.labor)));
app.post('/api/jobs/:id/stage', wrap((req) => tools.setStage(req.params.id, req.body.stage)));
app.post('/api/jobs/:id/inquiry', wrap((req) => tools.draftSupplierInquiry(req.params.id, req.body)));
app.post('/api/jobs/:id/estimate', wrap((req) => tools.createOrUpdateDraftEstimate(req.params.id, req.body.version, req.body.idempotency_key)));
app.post('/api/jobs/:id/send', wrap((req) => tools.sendQuote(req.params.id, req.body)));
app.get('/api/inventory', wrap((req) => tools.getAvailableInventory(String(req.query.part_ids || '').split(',').filter(Boolean), req.query.location_id)));
app.get('/api/supplier-offers', wrap((req) => tools.getSupplierOffers(String(req.query.part_ids || '').split(',').filter(Boolean), {})));
app.post('/api/estimates/:id/send', wrap((req) => tools.sendApprovalRequest(req.params.id, req.body.approved_message, req.body.idempotency_key)));
app.post('/api/estimates/:id/response', wrap((req) => tools.recordCustomerResponse(req.params.id, req.body.estimate_version, req.body.response)));
app.get('/api/inbox', wrap(() => tools.getInbox()));
app.get('/api/approve/:token', wrap((req) => tools.getApprovalView(req.params.token)));
app.post('/api/approve/:token', wrap((req) => tools.respondByToken(req.params.token, req.body.response)));

// Developer-only endpoints (not linked from the mechanic UI).
app.get('/api/dev/jobs/:id/report', wrap((req) => tools.developerReport(req.params.id)));
app.post('/api/dev/reset', wrap(() => {
  if (process.env.ALLOW_RESET === 'false') throw Object.assign(new Error('reset disabled'), { status: 403 });
  reset();
  return { ok: true, run_id: runId() };
}));

// Usage tracking. /api/track takes landing-page events (also as a text/plain
// sendBeacon body). Stats need ANALYTICS_KEY; without it they 404.
app.post('/api/track', express.text({ type: 'text/plain', limit: '8kb' }), (req, res) => {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch { return res.status(400).end(); }
  }
  res.json(trackFromClient(req));
});
const statsAllowed = (req) => process.env.ANALYTICS_KEY && req.query.key === process.env.ANALYTICS_KEY;
app.get('/api/analytics', (req, res) => (statsAllowed(req) ? res.json(summary()) : res.status(404).json({ error: 'not_found' })));
app.get('/analytics', (req, res) => (statsAllowed(req) ? res.type('html').send(renderStats(summary())) : res.status(404).send('Not found')));

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
if (fs.existsSync(dist)) {
  // Landing page is its own build entry; serve it before the app's SPA fallback.
  app.get(/^\/bike-shops\/?$/, (req, res) => res.sendFile(path.join(dist, 'bike-shops', 'index.html')));
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

load();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`bike-service prototype on :${port} (run ${runId()})`));
