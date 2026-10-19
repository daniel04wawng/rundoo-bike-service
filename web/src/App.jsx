import React, { useEffect, useState, useCallback } from 'react';
import { api, money } from './api.js';
import JobPage from './JobPage.jsx';
import CustomerView from './CustomerView.jsx';

export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((p) => {
    window.history.pushState({}, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);
  return [path, go];
}

export const STATUS = {
  draft: ['Draft', 'neutral'],
  quote_sent: ['Waiting on customer', 'info'],
  approved: ['Approved', 'ok'],
  declined: ['Declined', 'err'],
  changed_after_approval: ['Changed since approval', 'warn'],
  in_progress: ['In progress', 'info'],
};

export function StatusChip({ status }) {
  const [label, tone] = STATUS[status] || [status, 'neutral'];
  return <span className={`chip ${tone}`}>{label}</span>;
}

export default function App() {
  const [path, go] = useRoute();
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.bootstrap().then(setBoot).catch((e) => setError(e.message));
  }, []);

  const approve = path.match(/^\/approve\/([\w-]+)/);
  if (approve) return <CustomerView token={approve[1]} standalone />;

  if (error) return <div style={{ padding: 24 }}>Could not load: {error}</div>;
  if (!boot) return <div style={{ padding: 24 }}><span className="spinner" /></div>;

  const job = path.match(/^\/service\/(WO-\d+)/);
  return (
    <Shell go={go} mode={boot.extraction_mode} researchMode={boot.research_mode} crumbs={job ? ['Service', job[1]] : ['Service']}>
      {job ? <JobPage key={job[1]} id={job[1]} boot={boot} go={go} /> : <WorkOrders boot={boot} go={go} />}
    </Shell>
  );
}

// Modest generic POS navigation. Only Service is part of this prototype.
const NAV = [
  ['Sales', '▤'],
  ['Service', '⚙', true],
  ['Customers', '◯'],
  ['Products', '◻'],
  ['Purchasing', '▦'],
  ['Reports', '≡'],
];

function Shell({ children, go, crumbs, mode, researchMode }) {
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span className="brand-word">Rundoo</span>
        </div>
        {NAV.map(([label, ico, live]) => (
          <button
            key={label}
            className={`nav-item ${live ? 'on' : 'dim'}`}
            onClick={live ? () => go('/') : undefined}
            aria-disabled={!live}
            title={live ? undefined : 'Not part of this prototype'}
          >
            <span className="ico">{ico}</span>
            {label}
          </button>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c}>
                {i > 0 && ' / '}
                {i === crumbs.length - 1 ? <b>{c}</b> : <a href="/" onClick={(e) => { e.preventDefault(); go('/'); }}>{c}</a>}
              </span>
            ))}
          </div>
          <div className="spacer" />
          <span className="demo-chip" title="Synthetic customers, stock, suppliers and messages. Nothing is ordered, sent or charged. AI research is live (Claude + manufacturer web search) or recorded replay, per server config.">Prototype · simulated data · {researchMode === 'live' ? 'live AI research' : 'recorded AI research'}</span>
          <div className="store-chip"><b>Demo Cycle Works</b>Vancouver</div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function WorkOrders({ boot, go }) {
  const [jobs, setJobs] = useState(boot.jobs);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    api.jobs().then((r) => setJobs(r.jobs));
  }, []);
  return (
    <>
      <div className="page-head">
        <h1>Service</h1>
        <div className="grow" />
        <button className="btn primary lg" onClick={() => setPicking(true)}>+ New repair / custom job</button>
      </div>
      <div className="subtabs"><span className="on">Work orders</span><span>Appointments</span><span>Bikes</span></div>
      <div className="card table-card">
        <table className="grid">
          <thead>
            <tr><th>Work order</th><th>Customer</th><th>Bike</th><th>Job</th><th>Status</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="click" onClick={() => go(`/service/${j.id}`)}>
                <td><a href={`/service/${j.id}`} onClick={(e) => e.preventDefault()}>{j.id}</a></td>
                <td>{j.customer}</td>
                <td className="muted">{j.bike}</td>
                <td>{j.summary}</td>
                <td><StatusChip status={j.status} /></td>
                <td className="num">{j.total_cents ? money(j.total_cents) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {picking && <NewJob boot={boot} go={go} onClose={() => setPicking(false)} />}
    </>
  );
}

function NewJob({ boot, go, onClose }) {
  // Fresh list each time the dialog opens, so customers added earlier appear.
  const [people, setPeople] = useState({ customers: boot.customers, bikes: boot.bikes });
  useEffect(() => {
    api.customers().then(setPeople).catch(() => {});
  }, []);
  const [customerId, setCustomerId] = useState(boot.customers[0].id); // 'new' = new customer
  const [bikeId, setBikeId] = useState(null); // 'new' = new bike
  const [cust, setCust] = useState({ name: '', phone: '' });
  const [bikeLabel, setBikeLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const newCustomer = customerId === 'new';
  const bikes = newCustomer ? [] : people.bikes.filter((b) => b.customerId === customerId);
  useEffect(() => {
    setBikeId(newCustomer ? 'new' : people.bikes.find((b) => b.customerId === customerId)?.id || 'new');
  }, [customerId, people.bikes, newCustomer]);
  const newBike = bikeId === 'new';
  const valid = (!newCustomer || cust.name.trim().length >= 2) && (!newBike || bikeLabel.trim().length >= 2);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createJob({
        ...(newCustomer ? { newCustomer: { name: cust.name, phone: cust.phone } } : { customerId }),
        ...(newBike ? { newBike: { label: bikeLabel } } : { bikeId }),
      });
      go(`/service/${r.job.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New repair or custom job">
        <h2 style={{ fontSize: 18 }}>New repair / custom job</h2>
        <div style={{ marginTop: 14 }} className="muted small">Customer</div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {people.customers.map((c) => (
            <button key={c.id} className={`btn ${customerId === c.id ? 'primary' : ''}`} onClick={() => setCustomerId(c.id)}>{c.name}</button>
          ))}
          <button className={`btn ${newCustomer ? 'primary' : 'ghost'}`} onClick={() => setCustomerId('new')}>+ New customer</button>
        </div>
        {newCustomer && (
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input type="text" autoFocus value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder="Customer name" aria-label="Customer name" style={{ flex: '1 1 180px' }} />
            <input type="text" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} placeholder="Mobile (for quote texts)" aria-label="Customer mobile" style={{ flex: '1 1 160px' }} />
          </div>
        )}
        <div style={{ marginTop: 14 }} className="muted small">{newCustomer ? 'Bike' : 'Bike on file'}</div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {bikes.map((b) => (
            <button key={b.id} className={`btn ${bikeId === b.id ? 'primary' : ''}`} onClick={() => setBikeId(b.id)}>{b.label}</button>
          ))}
          {!newCustomer && <button className={`btn ${newBike ? 'primary' : 'ghost'}`} onClick={() => setBikeId('new')}>+ New bike</button>}
        </div>
        {newBike && (
          <>
            <input type="text" autoFocus={!newCustomer} value={bikeLabel} onChange={(e) => setBikeLabel(e.target.value)} placeholder="Make, model and type, e.g. Trek Domane AL 2 road bike" aria-label="Bike" style={{ marginTop: 8 }} />
            <div className="small muted" style={{ marginTop: 4 }}>No parts on record yet. Research will ask for what the job needs.</div>
          </>
        )}
        {error && <div className="note warn" style={{ marginTop: 10 }}>{error}</div>}
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !valid} onClick={start}>Start job</button>
        </div>
      </div>
    </div>
  );
}
