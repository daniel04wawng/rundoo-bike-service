// Plain HTML view of analytics.summary() for /analytics?key=...
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const table = (rows, empty = 'None yet') =>
  rows.length
    ? `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join('')}</table>`
    : `<p class="muted">${empty}</p>`;

const stat = (label, value) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export function renderStats(s) {
  const L = s.landing;
  const A = s.app;
  const leads = L.demo_requests.length
    ? `<table><tr><th>When</th><th>Name</th><th>Shop</th><th>Email</th><th>Size</th><th>POS</th></tr>${L.demo_requests
        .slice()
        .reverse()
        .map((d) => `<tr><td>${esc(new Date(d.ts).toLocaleString())}</td><td>${esc(d.name)}</td><td>${esc(d.shop)}</td><td>${esc(d.email)}</td><td>${esc(d.size)}</td><td>${esc(d.pos)}</td></tr>`)
        .join('')}</table>`
    : '<p class="muted">None yet</p>';
  const requests = A.requests_described.length
    ? `<ul>${A.requests_described.slice().reverse().map((r) => `<li><span class="muted">${esc(new Date(r.ts).toLocaleString())} · ${esc(r.job)}</span><br>${esc(r.text)}</li>`).join('')}</ul>`
    : '<p class="muted">None yet</p>';
  const recent = s.recent
    .map((e) => `<tr><td class="muted">${esc(new Date(e.ts).toLocaleString())}</td><td>${esc(e.source)}</td><td>${esc(e.type)}</td><td class="muted">${esc(JSON.stringify(e.props || {}))}</td></tr>`)
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usage · Rundoo for Bike Shops</title>
<style>
:root{--ink:#171412;--body:#4b443f;--muted:#6b625c;--line:#efe2dd;--accent:#3431d8;--warm:#fbf5f3}
*{box-sizing:border-box}body{margin:0;background:var(--warm);color:var(--body);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}h1{color:var(--ink);font-size:26px;margin:0 0 4px}h2{color:var(--ink);font-size:18px;margin:32px 0 12px}
.muted{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:26px;color:var(--ink)}.stat span{font-size:13px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
.card h3{margin:0 0 8px;font-size:15px;color:var(--ink)}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);border-top:0}.n{text-align:right;font-variant-numeric:tabular-nums}ul{margin:0;padding-left:18px}li{margin:6px 0}
</style></head><body><main>
<h1>Usage</h1>
<p class="muted">${s.since ? `Since ${esc(new Date(s.since).toLocaleString())}` : 'No events yet'} · ${esc(s.total_events)} events · Reload the page to refresh</p>

<h2>Landing page</h2>
<div class="stats">${stat('Visits', L.visits)}${stat('Unique visitors', L.unique_visitors)}${stat('Video plays', L.video_plays)}${stat('Demo requests', L.demo_requests.length)}</div>
<h2>Demo requests</h2><div class="card">${leads}</div>
<div class="grid" style="margin-top:16px">
<div class="card"><h3>Button clicks</h3>${table(L.cta_clicks)}</div>
<div class="card"><h3>Video watched to</h3>${table(L.video_progress)}</div>
<div class="card"><h3>Sections reached</h3>${table(L.sections_reached)}</div>
<div class="card"><h3>Where visitors came from</h3>${table(L.referrers)}</div>
<div class="card"><h3>Devices</h3>${table(L.devices)}</div>
<div class="card"><h3>FAQ opened</h3>${table(L.faq_opens)}</div>
<div class="card"><h3>Workflow steps viewed</h3>${table(L.step_tabs)}</div>
<div class="card"><h3>Lightspeed sources opened</h3>${table(L.source_clicks)}</div>
</div>

<h2>Demo app</h2>
<div class="stats">${stat('App opens', A.opens)}${stat('Jobs described', A.jobs_described)}${stat('Parts chosen', A.parts_selected)}${stat('Quotes sent', A.quotes_sent)}${stat('Demo resets', A.demo_resets)}</div>
<div class="grid" style="margin-top:16px">
<div class="card"><h3>Customer responses</h3>${table(A.customer_responses)}</div>
<div class="card"><h3>Jobs people described</h3>${requests}</div>
</div>

<h2>Recent activity</h2>
<div class="card"><table>${recent || '<tr><td class="muted">None yet</td></tr>'}</table></div>
</main></body></html>`;
}
