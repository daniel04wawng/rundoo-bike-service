import React, { useEffect, useMemo, useState } from 'react';
import { api, money, price as priceFmt } from './api.js';
import { StatusChip } from './App.jsx';
import CustomerView from './CustomerView.jsx';

const STEPS = [
  ['describe', 'Describe job'],
  ['review', 'Review recommendations'],
  ['quote', 'Confirm quote'],
  ['sent', 'Send for approval'],
  ['track', 'Track response'],
];

const SLOT_LABEL = { crankset: 'Crankset', rear_derailleur: 'Rear derailleur', cassette: 'Cassette', shifters: 'Shifters', chain: 'Chain', freehub: 'Freehub body' };

const REQ_LABEL = { rear_derailleur: 'rear derailleur', spacer: 'cassette spacer', chain: 'chain', cassette: 'cassette' };

const SAMPLES = [
  ['Easier climbing, $250', 'Customer wants easier climbing gears for a hilly tour in 3 weeks. Budget around $250.'],
  ['Unknown drivetrain', 'Wants easier gears on an older road bike, not sure what is on it. Bike is worth about $300.'],
  ['Brake pads', 'Brakes squeal and the pads look worn. Replace pads.'],
];

export default function JobPage({ id, boot, go }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const catalog = boot.catalog;

  useEffect(() => {
    api.job(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  // Live AI research runs in the background; poll until it settles.
  const checking = data?.job?.research?.status === 'checking';
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(() => api.job(id).then(setData).catch(() => {}), 1200);
    return () => clearInterval(t);
  }, [checking, id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const act = async (fn, msg) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r?.job) setData(r);
      if (msg) setToast(typeof msg === 'function' ? msg(r) : msg);
      return r;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="card panel">{error}</div>;
  if (!data) return <span className="spinner" />;

  const { job, customer, bike, preview } = data;
  const stage = job.stage;
  const stepIndex = stage === 'track' ? (job.status === 'quote_sent' ? 3 : 4) : STEPS.findIndex((s) => s[0] === stage);

  const goStage = (s) => act(() => api.stage(job.id, s));

  return (
    <>
      <div className="card wo-head">
        <div style={{ minWidth: 220 }}>
          <div className="title"><h1>{job.id}</h1><StatusChip status={job.status} /></div>
          <div className="muted small" style={{ marginTop: 2 }}>{job.summary || job.title}</div>
        </div>
        <div className="facts">
          <div><span>Customer</span>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</div>
          <div><span>Bike</span>{bike?.label}</div>
          {job.constraints?.budget != null && <div><span>Budget</span>{priceFmt(job.constraints.budget)}</div>}
          {job.constraints?.deadlineText && <div><span>Needed</span>{job.constraints.deadlineText}</div>}
        </div>
      </div>

      <nav className="steps" aria-label="Job steps">
        {STEPS.map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && <span className="step-sep" />}
            <button
              className={`step ${i < stepIndex ? 'done' : ''} ${i === stepIndex ? 'on' : ''}`}
              disabled={busy || !canJump(key, job, data) || i === stepIndex}
              onClick={() => goStage(key)}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              <span className="dot">{i < stepIndex ? '✓' : i + 1}</span>
              {label}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {error && <div className="note warn" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="workspace">
        <div>
          {stage === 'describe' && <Describe job={job} bike={bike} catalog={catalog} busy={busy} onSubmit={(text) => act(() => api.describe(job.id, text))} />}
          {stage === 'review' && <Review data={data} catalog={catalog} busy={busy} act={act} />}
          {stage === 'quote' && <Quote data={data} busy={busy} act={act} />}
          {stage === 'track' && <Track data={data} go={go} act={act} />}
          {(stage === 'review' || stage === 'quote') && (
            // Tablet only (CSS): keeps the total and next action in view while the panel sits below.
            <div className="mini-total">
              <div><span className="small muted">Customer total</span><div className="total">{money(preview.totals.total_cents)}</div></div>
              <div className="grow"><NextAction data={data} busy={busy} act={act} compact /></div>
            </div>
          )}
        </div>
        <aside>
          {stage === 'track' && data.active_estimate ? (
            <Phone data={data} onResponded={() => api.job(job.id).then(setData)} />
          ) : (
            <OrderPanel data={data}><NextAction data={data} busy={busy} act={act} /></OrderPanel>
          )}
        </aside>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function canJump(key, job, data) {
  if (key === 'describe') return job.status === 'draft' || job.status === 'declined';
  if (key === 'review') return !!job.research && ['draft', 'declined', 'changed_after_approval', 'approved', 'quote_sent'].includes(job.status);
  if (key === 'quote') return data.ready_to_quote.ready && job.status !== 'quote_sent';
  if (key === 'track') return data.estimates.some((e) => e.status !== 'draft');
  return false;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = (slot) => cap(String(slot).replace(/_/g, ' '));

// ---------------- Describe ----------------
function Describe({ job, bike, busy, onSubmit }) {
  const [text, setText] = useState(job.request?.text || '');
  const onFile = Object.entries(job.configuration.components);
  return (
    <div className="card panel">
      <div className="panel-head"><span className="dooey-dot">✦</span><h2>What are we working on?</h2></div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Bike, the work, customer goal, budget or deadline"
        aria-label="Job description"
      />
      <div className="row wrap" style={{ marginTop: 8 }}>
        <span className="small muted">Try:</span>
        {SAMPLES.map(([label, sample]) => (
          <button key={label} className="btn sm" onClick={() => setText(sample)}>{label}</button>
        ))}
      </div>
      {onFile.length > 0 && (
        <div className="small muted" style={{ marginTop: 12 }}>
          On file for {bike?.label}: {onFile.map(([slot, c]) => c.label || `${SLOT_LABEL[slot]} unknown`).join(' · ')}
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <div className="grow" />
        <button className="btn primary lg" disabled={busy || !text.trim()} onClick={() => onSubmit(text)}>
          {busy ? <span className="spinner" /> : 'Find parts'}
        </button>
      </div>
    </div>
  );
}

// ---------------- Review ----------------
function Review({ data, catalog, busy, act }) {
  const { job } = data;
  const r = job.research;
  const [editing, setEditing] = useState(false);
  const comps = job.configuration.components;
  const ruleQs = (r?.questions || []).filter((q) => q.input !== 'text');
  const aiQs = (r?.questions || []).filter((q) => q.input === 'text');
  const unconfirmed = Object.entries(comps).filter(([slot]) => ruleQs.some((q) => q.slot === slot));

  const confirm = (updates, msg) => act(() => api.components(job.id, updates), msg);

  if (!r) return <div className="card panel">Describe the job first.</div>;

  const candidates = unconfirmed.filter(([, c]) => c.partId && c.status === 'candidate');
  return (
    <>
      {r.engine === 'ai' && <ResearchActivity r={r} />}

      {r.status === 'needs_info' && aiQs.length > 0 && !editing && (
        <div className="card panel">
          <div className="panel-head">
            <span className="dooey-dot">✦</span>
            <h2 className="grow">Need a few details from the bike</h2>
          </div>
          {r.summary && <div className="small muted" style={{ marginTop: -4, marginBottom: 10 }}>{r.summary}</div>}
          {aiQs.some((q) => comps[q.slot]?.status === 'needs_inspection') && (
            <div className="note warn" style={{ marginBottom: 10 }}>Marked for inspection. Fill these in after checking the bike; nothing is recommended until then.</div>
          )}
          <AiQuestions key={aiQs.map((q) => q.id + q.slot).join()} qs={aiQs} comps={comps} busy={busy} confirm={confirm} />
        </div>
      )}

      {((r.status === 'needs_info' && unconfirmed.length > 0) || editing) && (
        <div className="card panel">
          <div className="panel-head">
            <span className="dooey-dot">✦</span>
            <h2 className="grow">{editing ? 'Components on the bike' : 'Confirm what is on the bike'}</h2>
            {!editing && candidates.length > 1 && (
              <button className="btn sm" disabled={busy} onClick={() => confirm(Object.fromEntries(candidates.map(([slot, c]) => [slot, { partId: c.partId, status: 'confirmed' }])))}>
                Confirm all on file
              </button>
            )}
            {editing && <button className="btn sm" onClick={() => setEditing(false)}>Done</button>}
          </div>
          <div className="small muted" style={{ marginTop: -4, marginBottom: 10 }}>Bike record is a starting point. Check the bike.</div>
          <div className="checklist">
            {(editing ? Object.entries(comps) : unconfirmed).map(([slot, c]) => (
              <ComponentRow key={slot} slot={slot} c={c} question={r.questions?.find((q) => q.slot === slot)} catalog={catalog} busy={busy} confirm={confirm} />
            ))}
          </div>
        </div>
      )}

      {!['needs_info', 'checking'].includes(r.status) && !editing && Object.values(comps).some((c) => c.status === 'confirmed') && (
        <div className="small muted row wrap" style={{ marginBottom: 10 }}>
          <span>Confirmed: {Object.entries(comps).filter(([, c]) => c.status === 'confirmed').map(([, c]) => c.label).join(' · ')}</span>
          <button className="link" onClick={() => setEditing(true)}>Change</button>
        </div>
      )}

      {r.status === 'not_found' && <NotFound job={job} r={r} act={act} busy={busy} onEdit={() => setEditing(true)} />}

      {r.status === 'ready' && (
        <div className="card panel">
          <div className="panel-head">
            <span className="dooey-dot">✦</span>
            <h2 className="grow">Recommended parts</h2>
            {r.baseline?.label && <span className="small muted">Low gear now {r.baseline.label}</span>}
          </div>
          <div className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>
            {r.engine === 'ai'
              ? <>AI research{r.mode === 'replay' ? ' (recorded)' : r.cached ? ' (saved answer, instant)' : r.timings?.total_ms ? ` (${Math.round(r.timings.total_ms / 1000)}s)` : ''}. Every pick cites a manufacturer page. Confirm before using.</>
              : <>Checked against manufacturer specs.</>}
          </div>
          {job.constraints?.observed?.length > 0 && (
            <div className="note" style={{ marginBottom: 10 }}>
              You noted: {job.constraints.observed.join('; ')}. Not used to diagnose parts.
            </div>
          )}
          {r.engine === 'ai' && r.inferred?.length > 0 && (
            <details className="note" style={{ marginBottom: 10 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>Also worth knowing ({r.inferred.length})</summary>
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {r.inferred.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </details>
          )}
          <div className="req-list">
            {job.requirements.map((req) => (
              <Requirement key={req.id + req.current_part_id} req={req} job={job} catalog={catalog} busy={busy} act={act} data={data} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const secs = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

// Result of the background source check for one part.
function SourceBadge({ v, partId }) {
  const it = v?.items?.[partId];
  if (!it) return null;
  if (it.status === 'checking') return <div className="src-badge checking"><span className="spinner sm" /> Checking source…</div>;
  if (it.status === 'confirmed') return <div className="src-badge ok">✓ Source confirmed</div>;
  if (it.status === 'confirmed_by_hand') return <div className="src-badge ok">✓ Source checked by hand (recorded)</div>;
  return <div className="src-badge warn">Couldn't confirm on the maker's page. Check before ordering.</div>;
}

// Live research activity, collapsible. Running: animated dots + timer,
// expanded so the mechanic sees searches, sources and reasoning arrive.
// Finished: one summary line that can be expanded later.
function ResearchActivity({ r }) {
  const running = r.status === 'checking';
  const [open, setOpen] = useState(running);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!running) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const t = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  const activity = r.activity || [];
  if (!running && !activity.length) return null;
  const searches = activity.filter((a) => a.kind === 'search');
  const sources = new Set(searches.flatMap((a) => (a.results || []).map((x) => x.url)));
  const elapsed = running
    ? Math.round((tick - Date.parse(r.startedAt || new Date().toISOString())) / 1000)
    : r.timings?.total_ms != null ? Math.round(r.timings.total_ms / 1000) : null;
  const current = [...activity].reverse().find((a) => a.status === 'running');
  const title = running
    ? current?.kind === 'search' ? 'Searching manufacturer sites' : current?.label || 'Researching parts'
    : r.cached ? 'Used a saved answer' : r.mode === 'replay' ? 'Used recorded research' : r.status === 'needs_info' ? 'Checked what we need' : 'Researched parts';
  const meta = [elapsed != null && !r.cached ? `${elapsed}s` : null, searches.length ? `${searches.length} ${searches.length === 1 ? 'search' : 'searches'}` : null, sources.size ? `${sources.size} sources` : null].filter(Boolean).join(' · ');
  return (
    <div className={`activity ${running ? 'running' : ''}`}>
      <button className="activity-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {running ? <span className="dots" aria-hidden="true"><i /><i /><i /><i /></span> : <span className="tick">✓</span>}
        <span className="activity-title">{title}</span>
        <span className="activity-meta">{meta}</span>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
      </button>
      {open && (
        <div className="activity-body">
          {activity.map((a) => (
            <div key={a.key} className={`activity-row ${a.status}`}>
              <span className="row-icon">{a.status === 'running' ? <span className="spinner sm" /> : '✓'}</span>
              <div className="grow">
                <div>{a.kind === 'search' ? <>Searched <span className="q">“{a.label}”</span></> : a.kind === 'shop' ? <>Checked shop stock for <span className="q">“{a.label}”</span></> : a.label}</div>
                {a.kind === 'shop' && (
                  <div className="results">
                    {a.results?.length ? a.results.map((x) => <span key={x.title} className="small">{x.title} <span className="muted">{x.detail}</span></span>) : <span className="small muted">Not carried by the shop</span>}
                  </div>
                )}
                {a.kind !== 'shop' && a.results?.length > 0 && (
                  <div className="results">
                    {a.results.map((x) => (
                      <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.url}>{x.title || host(x.url)} <span className="muted">{host(x.url)}</span></a>
                    ))}
                  </div>
                )}
              </div>
              <span className="row-time mono">{a.endedAt && secs(a.startedAt, a.endedAt) > 0 ? `${secs(a.startedAt, a.endedAt)}s` : ''}</span>
            </div>
          ))}
          {r.thinking && (
            <div className="thinking">
              <span className="small muted">{running ? 'Thinking' : 'Reasoning summary'}</span>
              <div>{r.thinking}</div>
            </div>
          )}
          {running && !activity.length && <div className="small muted">Starting…</div>}
        </div>
      )}
    </div>
  );
}

// All open questions in one form with a single Continue, so research runs
// once with every answer instead of once per answer.
function AiQuestions({ qs, comps, busy, confirm }) {
  // Pre-fill with the suggestion (if it has a basis); the mechanic can keep,
  // edit or replace it. Nothing is confirmed until Continue.
  const [vals, setVals] = useState(() => Object.fromEntries(qs.map((q) => [q.slot, comps[q.slot]?.status === 'confirmed' ? comps[q.slot].label || '' : q.suggestion || ''])));
  const [inspect, setInspect] = useState({});
  const ready = qs.every((q) => inspect[q.slot] || (vals[q.slot] || '').trim());
  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    confirm(Object.fromEntries(qs.map((q) => [q.slot, inspect[q.slot] ? { label: (vals[q.slot] || '').trim() || null, status: 'needs_inspection' } : { label: vals[q.slot].trim(), status: 'confirmed' }])));
  };
  return (
    <form className="checklist" onSubmit={submit}>
      {qs.map((q, i) => (
        <div key={q.id} className={inspect[q.slot] ? 'check-item' : 'question'}>
          <div className="row wrap" style={{ width: '100%' }}>
            <div className="grow">
              <div className="label">{q.text}</div>
              {q.hint && <div className="val muted">{q.hint}</div>}
            </div>
            {inspect[q.slot] && <span className="chip warn">Needs inspection</span>}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input type="text" autoFocus={i === 0} value={vals[q.slot] || ''} disabled={inspect[q.slot]} onChange={(e) => setVals({ ...vals, [q.slot]: e.target.value })} onFocus={(e) => e.target.select()} placeholder="What you see on the bike" aria-label={q.text} style={{ maxWidth: 320 }} />
            {q.options?.map((o) => (
              <button type="button" key={o} disabled={inspect[q.slot]} className={`btn sm ${vals[q.slot] === o ? 'primary' : ''}`} onClick={() => setVals({ ...vals, [q.slot]: o })}>{o}</button>
            ))}
            <button type="button" className="btn sm ghost" onClick={() => setInspect({ ...inspect, [q.slot]: !inspect[q.slot] })}>{inspect[q.slot] ? 'Undo' : 'Needs inspection'}</button>
          </div>
          {q.suggestion && !inspect[q.slot] && (
            <div className="small muted" style={{ marginTop: 4 }}>
              {vals[q.slot] === q.suggestion ? <>Suggested ({q.suggestion_basis.charAt(0).toLowerCase() + q.suggestion_basis.slice(1)}). Check the bike and edit if different.</> : <>Suggested: <button type="button" className="link" onClick={() => setVals({ ...vals, [q.slot]: q.suggestion })}>{q.suggestion}</button> ({q.suggestion_basis})</>}
            </div>
          )}
        </div>
      ))}
      <div className="row">
        <div className="grow small muted">{qs.length > 1 ? 'Answer all, then continue.' : ''}</div>
        <button className="btn primary" disabled={busy || !ready}>Continue</button>
      </div>
    </form>
  );
}

function ComponentRow({ slot, c, question, catalog, busy, confirm }) {
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState(c.label || '');
  const options = question?.options?.length ? question.options : Object.values(catalog).filter((p) => p.slot === slot && !p.unverified).map((p) => ({ value: p.id, label: p.variant }));
  // A confirmed typed answer (no catalog part) is corrected by typing, not by picking a catalog part.
  if (!options.length || (c.status === 'confirmed' && c.label && !c.partId)) {
    return (
      <div className="check-item">
        <div className="grow">
          <div className="label">{SLOT_LABEL[slot] || humanize(slot)}</div>
          <form className="row wrap" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) confirm({ [slot]: { label: text.trim(), status: 'confirmed' } }); }}>
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} aria-label={humanize(slot)} style={{ maxWidth: 320 }} />
            <button className="btn sm" disabled={busy || !text.trim() || text.trim() === c.label}>Save</button>
          </form>
        </div>
      </div>
    );
  }
  const status = c.status === 'confirmed' ? ['Selected', 'ok'] : c.status === 'needs_inspection' ? ['Needs inspection', 'warn'] : ['Needs confirmation', 'warn'];
  const label = slot === 'rear_derailleur' && !c.partId ? 'Rear derailleur cage' : SLOT_LABEL[slot];
  return (
    <div className={question && !c.partId ? 'question' : 'check-item'}>
      <div className="row wrap" style={{ width: '100%' }}>
        <div className="grow">
          <div className="label">{question && !c.partId ? question.text : label}</div>
          <div className="val">{c.partId ? <>{c.label}{c.status === 'candidate' && <span className="muted"> · from bike record</span>}</> : <span className="muted">{question?.hint}</span>}</div>
        </div>
        <span className={`chip ${status[1]}`}>{c.status === 'confirmed' ? 'Confirmed' : status[0]}</span>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        {c.partId && c.status !== 'confirmed' && !changing && (
          <button className="btn sm primary" disabled={busy} onClick={() => confirm({ [slot]: { partId: c.partId, status: 'confirmed' } })}>Confirm</button>
        )}
        {(!c.partId || changing) && options.map((o) => (
          <button key={o.value} className="btn sm" disabled={busy} onClick={() => { setChanging(false); confirm({ [slot]: { partId: o.value, status: 'confirmed' } }); }}>{o.label}</button>
        ))}
        {c.partId && !changing && <button className="btn sm" disabled={busy} onClick={() => setChanging(true)}>Change</button>}
        {c.status !== 'needs_inspection' && (
          <button className="btn sm ghost" disabled={busy} onClick={() => confirm({ [slot]: { partId: c.partId ?? null, status: 'needs_inspection' } })}>Needs inspection</button>
        )}
      </div>
    </div>
  );
}

function NotFound({ job, r, act, busy, onEdit }) {
  const inq = job.inquiries[job.inquiries.length - 1];
  return (
    <div className="card panel">
      <div className="panel-head"><span className="chip err">Not found</span><h2>{r.not_found?.reason}</h2></div>
      {r.not_found?.kind === 'no_research' ? (
        <>
          <div className="small muted">Nothing was guessed. Pick a next step:</div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="btn" onClick={onEdit}>Check the components</button>
            <button className="btn" disabled={busy} onClick={() => act(() => api.stage(job.id, 'describe'))}>Edit job description</button>
            <button className="btn" disabled={busy} onClick={() => act(() => api.inquiry(job.id, null), 'Supplier question drafted (not sent)')}>Draft supplier question</button>
          </div>
          {inq && (
            <div className="note" style={{ marginTop: 12 }}>
              <div className="small muted">Draft supplier question · not sent</div>
              <div style={{ marginTop: 4 }}>{inq.text}</div>
            </div>
          )}
        </>
      ) : r.not_found?.kind === 'goal' ? (
        <>
          <div className="small muted">{r.not_found.detail}</div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.stage(job.id, 'describe'))}>Edit job description</button>
          </div>
        </>
      ) : (
      <>
      <div className="small muted">Nothing was guessed. Pick a next step:</div>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onEdit}>Enter exact model codes</button>
        <button className="btn" onClick={onEdit}>Try another configuration</button>
        <button className="btn" disabled={busy} onClick={() => act(() => api.inquiry(job.id, null), 'Supplier question drafted (not sent)')}>Draft supplier question</button>
      </div>
      {inq && (
        <div className="note" style={{ marginTop: 12 }}>
          <div className="small muted">Draft supplier question · not sent</div>
          <div style={{ marginTop: 4 }}>{inq.text}</div>
          <button className="link" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(inq.text)}>Copy</button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

const FILTERS = [
  ['lower_cost', 'Lower cost'],
  ['sooner', 'Sooner'],
  ['shop_stock', 'Shop stock'],
  ['other_brand', 'Other brand'],
];

function Availability({ src }) {
  if (!src) return null;
  const r = src.recommended || src;
  const cls = r.type === 'stock' ? 'stock' : r.type === 'supplier' ? 'supplier' : 'inquiry';
  return <div className={`avail ${cls}`}>{r.label}</div>;
}

function Requirement({ req, job, catalog, busy, act, data }) {
  const [open, setOpen] = useState(null); // 'why' | 'options' | 'check'
  const [filter, setFilter] = useState(null);
  const wasReady = React.useRef(data.ready_to_quote.ready);
  const sel = req.selection;
  const [price, setPrice] = useState('');
  const [altPrice, setAltPrice] = useState({});
  const uncited = req.citation === 'uncited';
  const needsPrice = req.part?.needsPrice && sel?.status !== 'selected';
  const status = !sel ? (uncited ? ['Needs checking', 'warn'] : req.sourcing?.recommended?.type === 'inquiry' ? ['Ask supplier', 'warn'] : ['Needs confirmation', 'neutral'])
    : sel.status === 'selected' ? ['Selected', 'ok'] : sel.status === 'needs_inspection' ? ['Needs inspection', 'warn'] : ['Skipped', 'neutral'];
  const toggle = (k) => setOpen(open === k ? null : k);
  const choose = (partId, extra = {}) =>
    act(
      () => api.select(job.id, { requirementId: req.id, partId, ...extra }, job.configuration.version),
      (r) => {
        const ch = r?.result?.dependency_changes || [];
        const names = (t) => ch.filter((c) => c.type === t).map((c) => REQ_LABEL[c.requirementId] || c.requirementId).join(' and ');
        if (ch.some((c) => c.type === 'removed')) return `Rechecked. No longer needed: ${names('removed')}.`;
        if (ch.some((c) => c.type === 'added')) return `Rechecked. Added: ${names('added')}.`;
        return extra.status === 'needs_inspection' ? 'Marked for inspection' : extra.status === 'excluded' ? 'Skipped' : 'Added to work order';
      },
    ).then((r) => {
      setOpen(null);
      // Last decision made: advance straight to the quote.
      if (r?.ready_to_quote?.ready && r.job.stage === 'review' && !wasReady.current) act(() => api.stage(job.id, 'quote'));
    });

  const alts = req.alternatives.filter((a) => !filter || a.tags.includes(filter));
  const evidence = useMemo(() => {
    const ids = new Set([...(req.part?.evidenceIds || []), ...req.checks.flatMap((c) => c.evidence_ids)]);
    return (job.research.evidence || []).filter((e) => ids.has(e.id));
  }, [req, job.research.evidence]);

  return (
    <div className={`req ${sel?.status === 'selected' ? 'selected' : ''}`}>
      <div className="req-top">
        <div className="grow">
          <div className="req-kind">{req.title}{req.dependencyOf && <span style={{ textTransform: 'none', letterSpacing: 0 }}> · needed for new cassette</span>}</div>
          <div className="req-name">{req.part.brand} {req.part.variant}</div>
          <div className="req-reason">{req.reason}</div>
          <SourceBadge v={job.research.verification} partId={req.current_part_id} />
          <Availability src={req.sourcing} />
        </div>
        <div className="req-price">
          <b>{req.part.retailPrice == null ? 'Price needed' : `${req.qty > 1 ? `${req.qty} × ` : ''}${priceFmt(req.part.retailPrice)}`}</b>
          <div style={{ marginTop: 6 }}><span className={`chip ${status[1]}`}>{status[0]}</span></div>
        </div>
      </div>
      <div className="req-actions">
        {needsPrice && !uncited && (
          <input type="number" min="0" step="0.01" placeholder={req.qty > 1 ? 'Customer price $ each' : 'Customer price $'} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={req.qty > 1 ? 'Customer price per unit' : 'Customer price'} style={{ width: 150, padding: '4px 8px' }} />
        )}
        {sel?.status !== 'selected' && !uncited && (
          <button className="btn primary sm" disabled={busy || (needsPrice && !(Number(price) > 0))} onClick={() => choose(req.current_part_id, needsPrice ? { price: Number(price) } : {})}>Use this</button>
        )}
        {req.skippable && sel?.status !== 'excluded' && <button className="btn sm" disabled={busy} onClick={() => choose(req.current_part_id, { status: 'excluded' })}>Skip</button>}
        {req.alternatives.length > 0 && <button className={`btn sm ${open === 'options' ? 'on' : ''}`} onClick={() => toggle('options')}>Other options ({req.alternatives.length})</button>}
        <button className="btn sm" onClick={() => toggle('check')}>Check further</button>
        <button className="link" onClick={() => toggle('why')}>Why it fits</button>
      </div>

      {open === 'why' && (
        <div className="drawer">
          <ul>
            {req.checks.map((c, i) => (
              <li key={i}><span style={{ color: c.pass ? 'var(--ok)' : 'var(--err)' }}>{c.pass ? '✓' : '✕'}</span> {c.detail}</li>
            ))}
          </ul>
          {(job.research.verification?.items?.[req.current_part_id]?.quotes || []).map((q, i) => (
            <div key={i} className="quote">
              <span className="small muted">From the page{q.url ? <> (<a href={q.url} target="_blank" rel="noreferrer">{host(q.url)}</a>)</> : ''}:</span>
              <div>“{q.text}”</div>
            </div>
          ))}
          {evidence.length > 0 && (
            <div className="evidence-src muted">
              Sources: {evidence.map((e, i) => (
                <span key={e.id}>{i > 0 && ' · '}<a href={e.url} target="_blank" rel="noreferrer">{e.title}</a></span>
              ))}
            </div>
          )}
        </div>
      )}

      {open === 'options' && (
        <div className="drawer">
          <div className="alt-filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`btn sm ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? null : k)}>{label}</button>
            ))}
          </div>
          {alts.length === 0 && <div className="small muted">No compatible option matches that filter.</div>}
          {alts.map((a) => (
            <div className="alt" key={a.partId}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{a.brand} {a.variant}</div>
                <div className="small">{a.reason}</div>
                <SourceBadge v={job.research.verification} partId={a.partId} />
                <Availability src={a.sourcing} />
                {a.dependency && <div className="dep">{a.dependency.text}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <b>{a.retailPrice == null ? 'Price needed' : `${req.qty > 1 ? `${req.qty} × ` : ''}${priceFmt(a.retailPrice)}`}</b>
                {a.retailPrice == null && (
                  <input type="number" min="0" step="0.01" placeholder={req.qty > 1 ? '$ each' : '$'} value={altPrice[a.partId] || ''} onChange={(e) => setAltPrice({ ...altPrice, [a.partId]: e.target.value })} aria-label={req.qty > 1 ? 'Customer price per unit' : 'Customer price'} style={{ width: 90, padding: '3px 6px', marginTop: 4 }} />
                )}
                <div style={{ marginTop: 6 }}>
                  <button className="btn sm primary" disabled={busy || (a.retailPrice == null && !(Number(altPrice[a.partId]) > 0))} onClick={() => choose(a.partId, a.retailPrice == null ? { price: Number(altPrice[a.partId]) } : {})}>Use this</button>
                </div>
              </div>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>{req.engine === 'ai' ? 'Each option cites a manufacturer page.' : 'All options rechecked against the confirmed components.'}</div>
        </div>
      )}

      {open === 'check' && (
        <div className="drawer">
          <div className="small">Compatibility checks</div>
          <ul>
            {req.checks.map((c, i) => (
              <li key={i}><span style={{ color: c.pass ? 'var(--ok)' : 'var(--err)' }}>{c.pass ? '✓' : '✕'}</span> {c.detail}</li>
            ))}
          </ul>
          {req.sourcing?.options?.length > 0 && (
            <>
              <div className="small" style={{ marginTop: 6 }}>Sourcing</div>
              <ul>
                {req.sourcing.stock && <li>Shop: {req.sourcing.stock.on_hand} on hand, {req.sourcing.stock.committed} committed, {req.sourcing.stock.available} available</li>}
                {req.sourcing.options.filter((o) => o.type === 'supplier').map((o) => (
                  <li key={o.offerId}>{o.supplierName}: cost {money(o.cost_cents)} + ship {money(o.shipping_cents)} · {o.eta_days} days{!o.meets_deadline ? ' · misses deadline' : ''}</li>
                ))}
              </ul>
            </>
          )}
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={busy} onClick={() => choose(req.current_part_id, { status: 'needs_inspection' })}>Needs inspection</button>
            <button className="btn sm" disabled={busy} onClick={() => act(() => api.inquiry(job.id, req.id), 'Supplier question drafted (not sent)')}>Draft supplier question</button>
          </div>
          {job.inquiries.filter((q) => q.requirementId === req.id).slice(-1).map((q) => (
            <div key={q.id} className="note" style={{ marginTop: 8 }}><div className="small muted">Draft · not sent</div>{q.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Quote ----------------
// Same rule as the server: a dollar amount in the text must include the total.
function mentionsWrongTotal(text, totalCents) {
  const amounts = String(text).match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || [];
  return amounts.length > 0 && !amounts.some((a) => Math.abs(Number(a.replace(/[$,\s]/g, '')) - totalCents / 100) < 0.005);
}

function Quote({ data, busy, act }) {
  const { job, preview } = data;
  const [editMsg, setEditMsg] = useState(false);
  const [msg, setMsg] = useState(data.draft_message || '');
  useEffect(() => { if (!editMsg) setMsg(data.draft_message || ''); }, [data.draft_message, editMsg]);
  const labor = job.labor;
  const setHours = (id, hours) => act(() => api.labor(job.id, [{ id, hours }]));
  const toggle = (id, included) => act(() => api.labor(job.id, [{ id, included }]));

  return (
    <div className="card panel">
      <div className="panel-head">
        <h2 className="grow">Quote for {data.customer.name.split(' ')[0]}</h2>
        {job.status === 'declined' && <span className="chip err">Declined · revise and resend</span>}
        {job.status === 'changed_after_approval' && <span className="chip warn">Changed since approval</span>}
      </div>
      <table className="grid quote-table">
        <thead><tr><th>Item</th><th>Source</th><th className="num">Qty / hrs</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {preview.lines.filter((l) => l.type === 'part').map((l) => (
            <tr key={l.partId}>
              <td><div style={{ fontWeight: 500 }}>{l.label}</div><div className="small muted">{l.variant}</div></td>
              <td className="small">{l.sourcing?.label}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{money(l.amount_cents)}</td>
            </tr>
          ))}
          {labor.map((l) => (
            <tr key={l.id} style={{ opacity: l.included === false ? 0.5 : 1 }}>
              <td><div style={{ fontWeight: 500 }}>{l.label}</div><div className="small muted">Labor · ${l.rate}/hr{l.source === 'mechanic' || l.edited ? ' · edited' : ''}</div></td>
              <td className="small"><label className="row"><input type="checkbox" checked={l.included !== false} onChange={(e) => toggle(l.id, e.target.checked)} /> Include</label></td>
              <td className="num"><HoursInput value={l.hours} onCommit={(h) => setHours(l.id, h)} disabled={busy} /></td>
              <td className="num">{money(Math.round(l.hours * l.rate * 100) * (l.included === false ? 0 : 1))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddLabor busy={busy} onAdd={(label, hours) => act(() => api.labor(job.id, [{ label, hours }]), 'Labor added')} />
      <div className="totals" style={{ maxWidth: 320, marginLeft: 'auto' }}>
        <div><span>Parts</span><span>{money(preview.totals.parts_cents)}</span></div>
        <div><span>Labor</span><span>{money(preview.totals.labor_cents)}</span></div>
        <div><span>Tax · {preview.totals.tax_label}</span><span>{money(preview.totals.tax_cents)}</span></div>
        <div className="grand"><span>Total</span><span>{money(preview.totals.total_cents)}</span></div>
      </div>
      <Notes notes={job.notes} />
      <div style={{ marginTop: 14 }}>
        <div className="row"><span className="small muted grow">Text to {data.customer.name.split(' ')[0]} (simulated)</span><button className="link" onClick={() => setEditMsg(!editMsg)}>{editMsg ? 'Use suggested text' : 'Edit'}</button></div>
        {editMsg ? (
          <>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message to customer" style={{ marginTop: 6 }} />
            {mentionsWrongTotal(msg, preview.totals.total_cents) && (
              <div className="note warn" role="alert" style={{ marginTop: 6 }}>The text gives a different price than the total ({money(preview.totals.total_cents)}). Update it, or use the suggested text.</div>
            )}
          </>
        ) : (
          <div className="note" style={{ marginTop: 6 }}>{data.draft_message}</div>
        )}
      </div>
      <QuoteSendHook msg={editMsg ? msg : null} />
    </div>
  );
}

// Lets the sticky action bar read the edited message without lifting state.
let pendingMessage = null;
function QuoteSendHook({ msg }) {
  pendingMessage = msg;
  return null;
}

function AddLabor({ busy, onAdd }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState('0.25');
  if (!open) return <button className="link" style={{ margin: '8px 0' }} onClick={() => setOpen(true)}>+ Add labor</button>;
  return (
    <form className="row wrap" style={{ margin: '8px 0' }} onSubmit={(e) => { e.preventDefault(); if (label.trim() && Number(hours) > 0) { onAdd(label.trim(), Number(hours)); setOpen(false); setLabel(''); } }}>
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Labor, e.g. Toe-in and brake adjust" aria-label="Labor description" style={{ maxWidth: 280 }} autoFocus />
      <input type="number" step="0.25" min="0.25" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours" style={{ width: 80 }} />
      <span className="small muted">hrs at shop rate</span>
      <button className="btn sm primary" disabled={busy || !label.trim()}>Add</button>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function HoursInput({ value, onCommit, disabled }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      type="number"
      step="0.25"
      min="0"
      value={v}
      disabled={disabled}
      aria-label="Labor hours"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => Number(v) !== value && onCommit(Number(v))}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function Notes({ notes }) {
  if (!notes?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      {notes.map((n, i) => <div key={i} className="note warn">{n.text}</div>)}
    </div>
  );
}

// ---------------- Track ----------------
function Track({ data, go, act }) {
  const { job, customer } = data;
  const est = data.active_estimate;
  const first = customer.name.split(' ')[0];
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="card panel">
      {job.status === 'quote_sent' && (
        <>
          <div className="panel-head"><span className="chip info">Waiting on customer</span></div>
          <h2 style={{ fontSize: 18 }}>Quote v{est.version} sent to {first}</h2>
          <div className="muted" style={{ marginTop: 4 }}>{money(est.totals.total_cents)} · texted {time(est.sentAt)} (simulated)</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => act(() => api.stage(job.id, 'review'))}>Change quote</button>
          <div className="small muted" style={{ marginTop: 6 }}>Any change replaces the sent quote; you send a new version.</div>
        </>
      )}
      {job.status === 'approved' && (
        <>
          <div className="panel-head"><span className="chip ok">Approved</span></div>
          <h2 style={{ fontSize: 20 }}>{first} approved quote v{job.approval.version}</h2>
          <div className="muted" style={{ marginTop: 4 }}>{money(job.approval.total_cents)} · {time(job.approval.at)} · recorded on {job.id}</div>
          <div className="note" style={{ marginTop: 12 }}>
            {est.lines.some((l) => l.type === 'part' && !['stock', 'supplier'].includes(l.sourcing?.type))
              ? 'Next: confirm availability with the supplier for parts marked “Ask supplier”, then book bench time. Nothing has been ordered or charged.'
              : est.lines.some((l) => l.sourcing?.type === 'supplier')
                ? 'Next: create the purchase order for parts marked “Order from”, then book bench time. Nothing has been ordered or charged.'
                : 'Next: pull parts from stock and book bench time. Stock is not reserved yet; nothing has been charged.'}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => act(() => api.stage(job.id, 'review'))}>Add work or revise</button>
          <div className="small muted" style={{ marginTop: 6 }}>Any change needs the customer's approval again.</div>
        </>
      )}
      {job.status === 'declined' && (
        <>
          <div className="panel-head"><span className="chip err">Declined</span></div>
          <h2 style={{ fontSize: 18 }}>{first} declined quote v{est.version}</h2>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => act(() => api.stage(job.id, 'review'))}>Revise quote</button>
        </>
      )}
      {job.status === 'changed_after_approval' && (
        <>
          <div className="panel-head"><span className="chip warn">Changed since approval</span></div>
          <div>The work order no longer matches approved v{job.approval?.version}. Send a new version.</div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => act(() => api.stage(job.id, 'quote'))}>Review new quote</button>
        </>
      )}
      <button className="btn" style={{ marginTop: 14 }} onClick={() => go('/')}>Back to work orders</button>
      {data.estimates.length > 1 && (
        <div className="small muted" style={{ marginTop: 14 }}>
          History: {data.estimates.map((e) => `v${e.version} ${e.status}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function Phone({ data, onResponded }) {
  const est = data.active_estimate;
  const token = est.approval_link.split('/').pop();
  const msgs = data.estimates.filter((e) => e.message);
  return (
    <div>
      <div className="sim-label" style={{ marginBottom: 8 }}>Simulated customer phone · no real SMS</div>
      <div className="phone">
        <div className="phone-screen">
          <div className="phone-head"><b>Demo Cycle Works</b>Text message</div>
          <div className="phone-body">
            {msgs.map((e) => <div key={e.id} className="bubble">{e.message}</div>)}
            <CustomerView key={token + est.status} token={token} onResponded={onResponded} />
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <a className="small" href={est.approval_link} target="_blank" rel="noreferrer">Open customer view</a>
      </div>
    </div>
  );
}

// ---------------- Right panel ----------------
function OrderPanel({ data, children }) {
  const { preview, job } = data;
  return (
    <div className="card panel" style={{ position: 'sticky', top: 0 }}>
      <div className="panel-head"><h2 className="grow">Work order</h2><span className="small muted">{preview.lines.length} {preview.lines.length === 1 ? "line" : "lines"}</span></div>
      {preview.lines.length === 0 ? (
        <div className="small muted">Parts and labor appear here as you decide.</div>
      ) : (
        <table className="lines">
          <tbody>
            {preview.lines.map((l) => (
              <tr key={l.partId || l.id}>
                <td>{l.label}{l.type === 'part' && <div className="sub">{l.variant}</div>}{l.type === 'labor' && <div className="sub">{l.hours} h</div>}</td>
                <td className="num">{money(l.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="totals">
        <div><span>Subtotal</span><span>{money(preview.totals.subtotal_cents)}</span></div>
        <div><span>Tax</span><span>{money(preview.totals.tax_cents)}</span></div>
        <div className="grand"><span>Customer total</span><span>{money(preview.totals.total_cents)}</span></div>
      </div>
      {job.stage === 'review' && <Notes notes={job.notes} />}
      {children}
    </div>
  );
}

// Primary next action lives in the Work order panel, under the total,
// so it never covers the parts list.
function NextAction({ data, busy, act, compact }) {
  const { job, preview } = data;
  const total = money(preview.totals.total_cents);
  if (job.stage === 'review') {
    if (job.research?.status !== 'ready') return null;
    const undecided = (job.requirements || []).filter((r) => !r.selection).length;
    const ready = data.ready_to_quote.ready;
    return (
      <div className="next-action">
        <button className="btn primary lg block" disabled={busy || !ready} onClick={() => act(() => api.stage(job.id, 'quote'))}>Review quote</button>
        {!compact && <div className="small muted center">{ready ? 'All parts decided' : `${undecided} left to decide`}</div>}
      </div>
    );
  }
  if (job.stage === 'quote') {
    return (
      <div className="next-action">
        <button className="btn primary lg block" disabled={busy || !data.ready_to_quote.ready} onClick={() => act(() => api.send(job.id, pendingMessage || undefined), (r) => (r?.result?.already_sent ? 'No changes. The customer already has this quote.' : 'Quote sent to simulated customer phone'))}>
          {data.estimates.length ? 'Send revised quote' : 'Send quote'} · {total}
        </button>
        {!compact && <button className="btn ghost block" onClick={() => act(() => api.stage(job.id, 'review'))}>← Back to parts</button>}
      </div>
    );
  }
  return null;
}
