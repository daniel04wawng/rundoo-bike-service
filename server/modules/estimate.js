// Deterministic estimate math. All money is integer cents internally.
// Customer price comes from the shop price list (catalog.retailPrice), never
// from supplier cost. Tax treatment is a single demo fixture rate applied to
// parts and labor; see shop.taxLabel.
import crypto from 'node:crypto';

export const cents = (dollars) => Math.round(Number(dollars) * 100);
export const dollars = (c) => Math.round(c) / 100;

export function laborLines(job, shop) {
  return job.labor
    .filter((l) => l.included !== false)
    .map((l) => {
      const hours = Number(l.hours);
      const rate = l.rate ?? shop.laborRate;
      return {
        type: 'labor',
        id: l.id,
        label: l.label,
        hours,
        rate,
        source: l.source,
        amount_cents: Math.round(hours * cents(rate)),
      };
    });
}

export function partLines(job, catalog) {
  return Object.values(job.selections)
    .filter((s) => s.status === 'selected' && s.partId)
    .map((s) => {
      const part = catalog[s.partId];
      const qty = s.qty || 1;
      return {
        type: 'part',
        requirementId: s.requirementId,
        partId: part.id,
        label: part.name,
        variant: part.variant,
        qty,
        unit_price_cents: cents(s.customPrice ?? part.retailPrice),
        amount_cents: qty * cents(s.customPrice ?? part.retailPrice),
        sourcing: s.sourcing ? { type: s.sourcing.type, eta_days: s.sourcing.eta_days, label: s.sourcing.label, offerId: s.sourcing.offerId || null } : null,
      };
    });
}

export function computeTotals(lines, shop) {
  const parts = lines.filter((l) => l.type === 'part').reduce((a, l) => a + l.amount_cents, 0);
  const labor = lines.filter((l) => l.type === 'labor').reduce((a, l) => a + l.amount_cents, 0);
  const subtotal = parts + labor;
  const tax = Math.round(subtotal * shop.taxRate);
  return {
    currency: shop.currency,
    parts_cents: parts,
    labor_cents: labor,
    subtotal_cents: subtotal,
    tax_cents: tax,
    tax_rate: shop.taxRate,
    tax_label: shop.taxLabel,
    total_cents: subtotal + tax,
  };
}

export function preview(job, shop, catalog) {
  const lines = [...partLines(job, catalog), ...laborLines(job, shop)];
  return { lines, totals: computeTotals(lines, shop) };
}

// Content hash used to detect whether an approved/sent estimate still matches
// the work order. Any change to lines or totals changes the hash.
export function contentHash(lines, totals) {
  const body = JSON.stringify({
    lines: lines.map((l) => [l.type, l.partId || l.id, l.qty || l.hours, l.amount_cents]),
    total: totals.total_cents,
  });
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

export function fmt(c, currency = 'CAD') {
  const v = (c / 100).toLocaleString('en-CA', { style: 'currency', currency });
  return v.replace('CA$', '$');
}
