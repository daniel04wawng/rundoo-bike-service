// Headless fixture runner (for automated checks and evals).
//   EVAL_RUN_ID=eval-1 node scripts/run-fixture.js fixtures/requests/happy-path.json
// Each step calls one orchestrator tool. "$job" / "$estimate" / "$version"
// are replaced with values from earlier steps. Output: JSON lines with the
// structured result of every step (also captured in data/runs/<id>/outputs.jsonl).
import fs from 'node:fs';
import * as tools from '../server/orchestrator.js';
import { reset, runId } from '../server/store.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-fixture.js <fixture.json> [--no-reset]');
  process.exit(2);
}
const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!process.argv.includes('--no-reset')) reset();

const ctx = {};
const sub = (v) => {
  if (typeof v === 'string' && /^\$\w+$/.test(v)) return ctx[v.slice(1)];
  if (typeof v === 'string' && v.includes('$')) return v.replace(/\$(\w+)/g, (m, k) => (k in ctx ? ctx[k] : m));
  if (Array.isArray(v)) return v.map(sub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
  return v;
};

let failed = 0;
for (const [i, step] of fixture.steps.entries()) {
  const fn = tools[step.tool];
  if (!fn) throw new Error(`unknown tool ${step.tool}`);
  let out;
  try {
    out = await fn(...sub(step.args || []));
  } catch (err) {
    out = { error: err.code || 'error', status: err.status, message: err.message };
  }
  if (out?.job) {
    ctx.job = out.job.id;
    ctx.config_version = out.job.configuration.version;
  }
  if (out?.active_estimate) {
    ctx.estimate = out.active_estimate.id;
    ctx.version = out.active_estimate.version;
  }
  const check = step.expect ? evaluate(step.expect, out) : null;
  if (check && !check.pass) failed++;
  console.log(JSON.stringify({ run_id: runId(), fixture: fixture.name, step: i, tool: step.tool, check, output: compact(out) }));
}
console.error(`${fixture.name}: ${fixture.steps.length} steps, ${failed} expectation failures`);
process.exit(failed ? 1 : 0);

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function evaluate(expect, out) {
  const fails = [];
  for (const [path, want] of Object.entries(expect)) {
    const got = get(out, path);
    const ok = typeof want === 'object' && want !== null && 'contains' in want ? JSON.stringify(got ?? '').includes(want.contains) : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails.push({ path, want, got });
  }
  return { pass: fails.length === 0, fails };
}
function compact(out) {
  if (!out?.job) return out;
  const { job, preview, active_estimate, ready_to_quote, draft_message, result } = out;
  return {
    job: { id: job.id, status: job.status, stage: job.stage, configuration_version: job.configuration.version, research_status: job.research?.status, questions: job.research?.questions?.map((q) => q.slot), plan: job.plan, requirements: job.requirements.map((r) => ({ id: r.id, part: r.current_part_id, selection: r.selection?.status || null, sourcing: r.sourcing?.recommended?.type })), notes: job.notes, approval: job.approval },
    totals: preview.totals,
    active_estimate: active_estimate && { id: active_estimate.id, version: active_estimate.version, status: active_estimate.status, total_cents: active_estimate.totals.total_cents },
    ready_to_quote,
    draft_message,
    result,
  };
}
