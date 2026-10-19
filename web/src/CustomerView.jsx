import React, { useEffect, useState } from 'react';
import { api, money } from './api.js';

// What the customer sees from the (simulated) text message link.
export default function CustomerView({ token, standalone, onResponded }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.approval(token).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [token]);

  const respond = async (response) => {
    setBusy(true);
    try {
      await api.respond(token, response);
      await load();
      onResponded?.(response);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const body = !data ? (
    err ? <div className="approve-card">{err}</div> : <div className="approve-card"><span className="spinner" /></div>
  ) : (
    <div className="approve-card">
      <div className="small muted">{data.shop.name} · Quote v{data.estimate.version}</div>
      <div style={{ fontWeight: 600, margin: '4px 0 8px' }}>{data.bike}</div>
      <table className="lines">
        <tbody>
          {data.estimate.lines.map((l, i) => (
            <tr key={i}><td>{l.label.charAt(0).toUpperCase() + l.label.slice(1)}</td><td className="num">{money(l.amount_cents)}</td></tr>
          ))}
          <tr><td className="sub">Tax ({data.estimate.totals.tax_label})</td><td className="num sub">{money(data.estimate.totals.tax_cents)}</td></tr>
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="grow">Total</span>
        <span className="tot">{money(data.estimate.totals.total_cents)}</span>
      </div>
      {err && <div className="small" style={{ color: 'var(--err)', marginTop: 6 }}>{err}</div>}
      {data.estimate.status === 'sent' ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn grow" disabled={busy} onClick={() => respond('decline')}>Decline</button>
          <button className="btn primary grow" disabled={busy} onClick={() => respond('approve')}>Approve</button>
        </div>
      ) : (
        <div style={{ marginTop: 12, textAlign: 'center' }} className={`chip ${data.estimate.status === 'approved' ? 'ok' : data.estimate.status === 'declined' ? 'err' : 'neutral'}`}>
          {{ approved: 'You approved this quote', declined: 'You declined this quote', superseded: 'Replaced by a newer quote', outdated: 'The shop is updating this quote' }[data.estimate.status] || data.estimate.status}
        </div>
      )}
    </div>
  );

  if (!standalone) return body;
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16, background: '#f2f2f7' }}>
      <div style={{ width: 'min(380px, 100%)' }}>
        <div className="sim-label" style={{ marginBottom: 8 }}>Simulated customer view · no real message was sent</div>
        {data?.estimate.message && <div className="bubble" style={{ marginBottom: 10 }}>{data.estimate.message}</div>}
        {body}
      </div>
    </div>
  );
}
