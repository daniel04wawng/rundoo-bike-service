// Stage 1: turn the mechanic's one-line request into structured job fields.
// Two interchangeable implementations behind one output schema:
//   - rules: deterministic parser (default, used for replay and evals)
//   - live:  Claude structured output via server-side adapter (only when
//            EXTRACTION_MODE=live and credentials exist); falls back to rules
// The output is a PROPOSAL. Nothing here confirms components or approves work.
import { liveExtract } from '../adapters/llm.js';

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'budget', 'deadline', 'bike_value', 'mentioned_components', 'observed_conditions', 'customer_notes'],
  properties: {
    goal: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'summary'],
      properties: {
        type: { type: 'string', enum: ['easier_gearing', 'brake_service', 'other', 'unknown'] },
        summary: { type: 'string', description: 'Short customer goal, under 8 words, lower case' },
      },
    },
    budget: { type: ['number', 'null'], description: 'Customer budget in shop currency, or null' },
    deadline: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['text', 'days'],
      properties: { text: { type: 'string' }, days: { type: ['integer', 'null'] } },
    },
    bike_value: { type: ['number', 'null'], description: 'Customer-stated bike value, or null' },
    mentioned_components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'text'],
        properties: {
          slot: { type: 'string', enum: ['crankset', 'rear_derailleur', 'cassette', 'shifters', 'chain', 'groupset', 'wheel', 'other'] },
          text: { type: 'string' },
        },
      },
    },
    observed_conditions: { type: 'array', items: { type: 'string' }, description: 'Conditions the mechanic says they observed. Never infer.' },
    customer_notes: { type: 'array', items: { type: 'string' } },
  },
};

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function rulesExtract(text) {
  const t = ` ${text.toLowerCase()} `;
  const goal = /easier|climb|hill|lower gear|low gear|granny|spin|steep/.test(t)
    ? { type: 'easier_gearing', summary: 'easier climbing gears' }
    : /brake|pads?\b|squeal|stopping/.test(t)
      ? { type: 'brake_service', summary: 'new brake pads' }
      : t.trim().split(/\s+/).length >= 3
      ? { type: 'other', summary: text.trim().slice(0, 48).toLowerCase() }
      : { type: 'unknown', summary: '' };

  const money = (re) => {
    const m = t.match(re);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const budget =
    money(/budget[^$\d]{0,20}\$?\s?(\d[\d,]*(?:\.\d+)?)/) ??
    money(/(?:under|max(?:imum)?|up to|no more than|keep it to|spend)\s+\$\s?(\d[\d,]*(?:\.\d+)?)/) ??
    money(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(?:budget|max|or less)/);
  const bike_value =
    money(/(?:worth|valued at|value(?:d)? (?:is )?)\s*(?:about |around |roughly |maybe )?\$?\s?(\d[\d,]*)/) ??
    money(/bike (?:is )?(?:only )?worth\s*\$?\s?(\d[\d,]*)/);

  let deadline = null;
  const dm = t.match(/(?:in|within|by)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week)s?/);
  if (dm) {
    const n = WORD_NUM[dm[1]] ?? Number(dm[1]);
    // Business days approximation: 5 per week.
    deadline = { text: dm[0].trim(), days: dm[2] === 'week' ? n * 5 : n };
  } else {
    const wm = t.match(/(next week|this weekend|next weekend|tomorrow)/);
    if (wm) deadline = { text: wm[1], days: { tomorrow: 1, 'this weekend': 3, 'next weekend': 8, 'next week': 5 }[wm[1]] };
  }

  const mentioned = [];
  const add = (slot, re) => {
    const m = text.match(re);
    if (m) mentioned.push({ slot, text: m[0].trim() });
  };
  add('groupset', /\b(105|ultegra|tiagra|sora|claris|grx|dura[- ]ace|deore|slx|xt|apex|rival|force)\b(\s*r?\d{4})?/i);
  add('rear_derailleur', /\bRD-[A-Z0-9-]+\b|\b(?:short|medium|long)[- ]cage\b/i);
  add('cassette', /\b1[0-3]\s?[-–]\s?(2[3-9]|3[0-9]|4[0-9]|5[0-2])\s?t?\b/i);
  add('crankset', /\b(?:5[0-3]|4[6-8])\s?\/\s?(3[0-9])\b|\bcompact\b|\bsemi[- ]compact\b/i);
  add('shifters', /\b(\d{1,2})[- ]speed\b/i);

  const observed = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+|,\s+(?=chain|cassette|it |the )/i)) {
    if (/\b(worn|stretched|skipping|skips|rust|rusty|noisy|grinding|bent|cracked|frayed)\b/i.test(sentence)) {
      observed.push(sentence.trim().replace(/[.;]$/, ''));
    }
  }
  const notes = [];
  if (/tour|trip|event|race|gran fondo|ride/.test(t)) {
    const m = text.match(/[^.]*\b(tour|trip|event|race|gran fondo)\b[^.]*/i);
    if (m) notes.push(m[0].trim());
  }

  return {
    goal,
    budget,
    deadline,
    bike_value,
    mentioned_components: mentioned,
    observed_conditions: observed,
    customer_notes: notes,
  };
}

export async function extract(text, { mode = process.env.EXTRACTION_MODE || 'replay' } = {}) {
  if (mode === 'live') {
    try {
      const out = await liveExtract(text, EXTRACTION_SCHEMA);
      if (out) return { schema: 'extraction.v1', mode: 'live', ...sanitize(out) };
    } catch (err) {
      return { schema: 'extraction.v1', mode: 'replay', fallback_reason: `live extraction failed: ${err.message}`, ...rulesExtract(text) };
    }
  }
  return { schema: 'extraction.v1', mode: 'replay', ...rulesExtract(text) };
}

// Clamp model output to the schema shape; never trust free-form fields.
function sanitize(o) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    goal: { type: ['easier_gearing', 'brake_service', 'other', 'unknown'].includes(o.goal?.type) ? o.goal.type : 'unknown', summary: String(o.goal?.summary || '').slice(0, 60) },
    budget: num(o.budget),
    deadline: o.deadline && typeof o.deadline.text === 'string' ? { text: o.deadline.text.slice(0, 40), days: Number.isInteger(o.deadline.days) ? o.deadline.days : null } : null,
    bike_value: num(o.bike_value),
    mentioned_components: (o.mentioned_components || []).slice(0, 10).map((c) => ({ slot: String(c.slot), text: String(c.text).slice(0, 60) })),
    observed_conditions: (o.observed_conditions || []).slice(0, 6).map((s) => String(s).slice(0, 120)),
    customer_notes: (o.customer_notes || []).slice(0, 6).map((s) => String(s).slice(0, 120)),
  };
}
