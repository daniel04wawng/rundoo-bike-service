// Customer approval message drafting. Deterministic template so the text the
// mechanic sees is exactly what is "sent" to the simulated inbox.
import { fmt } from './estimate.js';

export function draftCustomerMessage({ job, customer, bike, estimate, shop, catalog }) {
  const first = customer.name.split(' ')[0];
  const parts = estimate.lines
    .filter((l) => l.type === 'part')
    .map((l) => catalog[l.partId]?.customerLabel || l.label);
  const existing = estimate.lines
    .filter((l) => l.type === 'labor' && l.source === 'existing')
    .map((l) => l.label.replace(/\s*\(.*\)$/, '').toLowerCase());
  let scope = parts.length ? listJoin(parts) + ', plus install and adjustment' : listJoin(estimate.lines.map((l) => l.label.toLowerCase()));
  if (existing.length) scope += `, on top of the ${listJoin(existing)} already booked`;
  const goal = job.constraints?.goalSummary ? ` for ${job.constraints.goalSummary}` : '';
  // Only say "in stock" when every part is; an inquiry part has no ETA yet.
  const partLines = estimate.lines.filter((l) => l.type === 'part');
  const pending = partLines.some((l) => !['stock', 'supplier'].includes(l.sourcing?.type));
  const etas = partLines.filter((l) => l.sourcing?.type === 'supplier').map((l) => l.sourcing.eta_days || 0);
  const timing = pending
    ? ' We are confirming parts availability and will update you on timing.'
    : etas.length ? ` Parts arrive in about ${Math.max(...etas)} business days.` : partLines.length ? ' Parts are in stock.' : '';
  return (
    `Hi ${first}, it's ${shop.name}. Quote${goal} on your ${bike.label.charAt(0).toLowerCase() + bike.label.slice(1)}: ${scope}. ` +
    `Total ${fmt(estimate.totals.total_cents, shop.currency)} incl. tax.${timing} ` +
    `Tap to approve or decline.`
  );
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}
