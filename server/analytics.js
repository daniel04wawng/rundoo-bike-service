// First-party usage tracking for the landing page and the app.
// Events append to <ANALYTICS_DIR>/events.jsonl (default: <DATA_DIR>/analytics)
// and are echoed to stdout as one "[track]" line each, so they also show up in
// the host's logs. No cookies, no IP addresses. Demo requests (the landing
// page form) are leads, so their fields are kept.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function dir() {
  if (process.env.ANALYTICS_DIR) return path.resolve(ROOT, process.env.ANALYTICS_DIR);
  return path.join(path.resolve(ROOT, process.env.DATA_DIR || 'data/runs'), 'analytics');
}
const file = () => path.join(dir(), 'events.jsonl');

export const enabled = () => process.env.ANALYTICS !== 'off';

// Events the browser may send. Anything else is dropped.
const CLIENT_EVENTS = new Set([
  'page_view', 'section_view', 'cta_click', 'video_play', 'video_progress',
  'step_tab', 'faq_open', 'source_click', 'demo_request',
]);
const LEAD_FIELDS = ['name', 'shop', 'email', 'size', 'pos'];

const clip = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined);

function clean(props = {}) {
  const out = {};
  for (const [k, v] of Object.entries(props || {}).slice(0, 20)) {
    const c = clip(v);
    if (c !== undefined && /^[a-z_]{1,32}$/.test(k)) out[k] = c;
  }
  return out;
}

function device(ua = '') {
  return /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
}

export function record(evt) {
  if (!enabled()) return;
  const row = { ts: new Date().toISOString(), ...evt };
  console.log('[track]', JSON.stringify(row));
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(file(), JSON.stringify(row) + '\n');
  } catch (err) {
    console.error('[track] write failed', err.message);
  }
}

// POST /api/track from the landing page.
export function trackFromClient(req) {
  const b = req.body || {};
  if (!CLIENT_EVENTS.has(b.type)) return { ok: false };
  const props = clean(b.props);
  if (b.type === 'demo_request') {
    for (const f of LEAD_FIELDS) if (b.props?.[f] != null) props[f] = clip(String(b.props[f]), 160);
  }
  record({ source: 'landing', type: b.type, sid: clip(b.sid, 40), page: clip(b.page, 80), device: device(req.get('user-agent')), props });
  return { ok: true };
}

// App usage, recorded server-side from the API calls the app already makes.
const APP_ROUTES = [
  ['GET', /^\/api\/bootstrap$/, 'app_open'],
  ['POST', /^\/api\/jobs$/, 'job_created'],
  ['POST', /^\/api\/customers$/, 'customer_created'],
  ['POST', /^\/api\/jobs\/[^/]+\/describe$/, 'job_described'],
  ['POST', /^\/api\/jobs\/[^/]+\/components$/, 'components_confirmed'],
  ['POST', /^\/api\/jobs\/[^/]+\/research$/, 'research_run'],
  ['POST', /^\/api\/jobs\/[^/]+\/selection$/, 'part_selected'],
  ['POST', /^\/api\/jobs\/[^/]+\/labor$/, 'labor_changed'],
  ['POST', /^\/api\/jobs\/[^/]+\/inquiry$/, 'supplier_question_drafted'],
  ['POST', /^\/api\/jobs\/[^/]+\/send$/, 'quote_sent'],
  ['POST', /^\/api\/estimates\/[^/]+\/send$/, 'quote_sent'],
  ['POST', /^\/api\/estimates\/[^/]+\/response$/, 'customer_response'],
  ['POST', /^\/api\/approve\/[^/]+$/, 'customer_response'],
  ['POST', /^\/api\/dev\/reset$/, 'demo_reset'],
];

export function appUsageMiddleware(req, res, next) {
  const hit = APP_ROUTES.find(([m, re]) => m === req.method && re.test(req.path));
  if (!hit) return next();
  res.on('finish', () => {
    const props = { status: res.statusCode };
    const job = req.path.match(/^\/api\/jobs\/([^/]+)/);
    if (job) props.job = clip(job[1], 20);
    if (hit[2] === 'customer_response') props.response = clip(req.body?.response, 20);
    if (hit[2] === 'job_described') props.text = clip(req.body?.text || req.body?.description, 200);
    record({ source: 'app', type: hit[2], device: device(req.get('user-agent')), props });
  });
  next();
}

// ---------- Reading ----------
// Landing sections in page order, with readable names.
const SECTIONS = [
  ['top', 'Hero'], ['why-h', 'Why Rundoo'], ['how', 'How it works'], ['sourcing', 'Inventory and suppliers'],
  ['compare', 'Lightspeed comparison'], ['proof-h', 'Testimonials'], ['faq', 'FAQ'], ['book', 'Book a demo form'],
];

export function readEvents() {
  try {
    return fs.readFileSync(file(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function summary() {
  const ev = readEvents();
  const count = (pred) => ev.filter(pred).length;
  const by = (pred, key) => {
    const m = {};
    for (const e of ev.filter(pred)) {
      const k = key(e) ?? 'unknown';
      m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const landing = (t) => (e) => e.source === 'landing' && e.type === t;
  const app = (t) => (e) => e.source === 'app' && e.type === t && (e.props?.status ?? 200) < 400;
  return {
    since: ev[0]?.ts || null,
    total_events: ev.length,
    landing: {
      visits: count(landing('page_view')),
      unique_visitors: new Set(ev.filter((e) => e.source === 'landing' && e.sid).map((e) => e.sid)).size,
      devices: by(landing('page_view'), (e) => e.device),
      referrers: by(landing('page_view'), (e) => e.props?.utm_source || e.props?.referrer || 'direct'),
      video_plays: count(landing('video_play')),
      video_progress: by(landing('video_progress'), (e) => `${e.props?.percent}%`),
      cta_clicks: by(landing('cta_click'), (e) => `${e.props?.cta} (${e.props?.where})`),
      sections_reached: SECTIONS.map(([id, name]) => [name, count((e) => landing('section_view')(e) && e.props?.section === id)]),
      step_tabs: by(landing('step_tab'), (e) => e.props?.step),
      faq_opens: by(landing('faq_open'), (e) => e.props?.question),
      source_clicks: by(landing('source_click'), (e) => e.props?.label),
      demo_requests: ev.filter(landing('demo_request')).map((e) => ({ ts: e.ts, ...e.props })),
    },
    app: {
      opens: count(app('app_open')),
      jobs_created: count(app('job_created')),
      jobs_described: count(app('job_described')),
      research_runs: count(app('research_run')),
      parts_selected: count(app('part_selected')),
      quotes_sent: count(app('quote_sent')),
      customer_responses: by(app('customer_response'), (e) => e.props?.response),
      demo_resets: count(app('demo_reset')),
      requests_described: ev.filter(app('job_described')).slice(-20).map((e) => ({ ts: e.ts, job: e.props?.job, text: e.props?.text })),
    },
    recent: ev.slice(-50).reverse(),
  };
}
