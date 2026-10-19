// Persistent JSON state store, one file per EVAL_RUN_ID.
// Structured state is authoritative: the UI and any LLM adapter read from it,
// and only explicit API actions write to it.
import fs from 'node:fs';
import path from 'node:path';
import { buildSeedState } from './seed.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function runId() {
  return (process.env.EVAL_RUN_ID || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function runDir() {
  const base = path.resolve(ROOT, process.env.DATA_DIR || 'data/runs');
  return path.join(base, runId());
}

function statePath() {
  return path.join(runDir(), 'state.json');
}

let cache = null;

export function load() {
  if (cache) return cache;
  const p = statePath();
  if (fs.existsSync(p)) {
    cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else {
    cache = buildSeedState();
    persist();
  }
  return cache;
}

function persist() {
  fs.mkdirSync(runDir(), { recursive: true });
  const p = statePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, p);
}

// Synchronous read-modify-write. Node is single threaded, so a mutation
// callback cannot interleave with another request. A callback that throws
// (a rejected request) leaves the state exactly as it was.
export function mutate(fn) {
  const state = load();
  const before = structuredClone(state);
  let result;
  try {
    result = fn(state);
  } catch (err) {
    cache = before;
    throw err;
  }
  persist();
  return result;
}

export function reset() {
  cache = buildSeedState();
  persist();
  const outputs = path.join(runDir(), 'outputs.jsonl');
  if (fs.existsSync(outputs)) fs.rmSync(outputs);
  return cache;
}

// Append-only capture of structured stage outputs, for offline evaluation.
export function captureOutput(record) {
  fs.mkdirSync(runDir(), { recursive: true });
  const line = JSON.stringify({ run_id: runId(), at: new Date().toISOString(), ...record });
  fs.appendFileSync(path.join(runDir(), 'outputs.jsonl'), line + '\n');
}
