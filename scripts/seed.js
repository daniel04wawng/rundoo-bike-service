// Seed or reset the state for the current EVAL_RUN_ID (default: "default").
import { reset, runDir, runId } from '../server/store.js';

reset();
console.log(`seeded run "${runId()}" at ${runDir()}`);
