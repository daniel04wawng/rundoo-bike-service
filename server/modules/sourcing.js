// Sourcing: match an exact part (variant) to shop stock or an eligible
// supplier offer. Stock search never reserves inventory; recommending a
// supplier offer never places an order.
import { cents } from './estimate.js';

// available = on hand - committed (reserved for other open work orders/sales).
export function availability(inventory, partId, locationId) {
  const rec = inventory.find((i) => i.partId === partId && i.locationId === locationId);
  if (!rec) return { partId, locationId, on_hand: 0, committed: 0, available: 0 };
  return { partId, locationId, on_hand: rec.onHand, committed: rec.committed, available: Math.max(0, rec.onHand - rec.committed) };
}

// Landed cost for one unit given shipping and order minimums. If the order
// value is below a supplier's free-shipping minimum, the flat shipping fee is
// added; offers below an order minimum are ineligible for a single-part order.
export function landed(offer, qty = 1) {
  const goods = cents(offer.unitCost) * qty;
  if (offer.minOrderValue && goods < cents(offer.minOrderValue) && !offer.allowBelowMinimum) {
    return { eligible: false, reason: `Below ${offer.supplierName} order minimum`, landed_cents: null };
  }
  const ship = offer.freeShippingOver && goods >= cents(offer.freeShippingOver) ? 0 : cents(offer.shipping || 0);
  return { eligible: true, landed_cents: goods + ship, shipping_cents: ship };
}

export function bestSource({ part, qty = 1, inventory, offers, locationId, deadlineDays }) {
  const stock = availability(inventory, part.id, locationId);
  const partOffers = offers
    .filter((o) => o.partId === part.id && o.currency === 'CAD')
    .map((o) => ({ ...o, ...landed(o, qty) }));
  const eligible = partOffers.filter((o) => o.eligible && o.inStockAtSupplier);
  const options = [];
  if (stock.available >= qty) {
    options.push({ type: 'stock', label: `In stock (${stock.available} available)`, eta_days: 0, stock });
  }
  for (const o of eligible.sort((a, b) => a.landed_cents - b.landed_cents || a.etaDays - b.etaDays)) {
    options.push({
      type: 'supplier',
      offerId: o.id,
      supplierName: o.supplierName,
      label: `Order from ${o.supplierName}, ${o.etaDays} business days`,
      eta_days: o.etaDays,
      cost_cents: cents(o.unitCost) * qty,
      landed_cents: o.landed_cents,
      shipping_cents: o.shipping_cents,
      meets_deadline: deadlineDays == null ? true : o.etaDays <= deadlineDays,
    });
  }
  let recommended = options.find((o) => o.type === 'stock') || options.find((o) => o.type === 'supplier' && o.meets_deadline) || options[0];
  if (!recommended) {
    recommended = {
      type: 'inquiry',
      label: 'Supplier inquiry needed',
      eta_days: null,
      reason: partOffers.length ? partOffers.map((o) => o.reason || 'Out of stock at supplier').join('; ') : 'No catalog offer on file',
    };
  }
  return { partId: part.id, stock, options, recommended, offers_considered: partOffers.length };
}
