import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

for (const f of fs.readdirSync('fixtures/requests').filter((x) => x.endsWith('.json'))) {
  test(`fixture ${f} meets all expectations`, () => {
    const env = { ...process.env, EVAL_RUN_ID: `test-${f.replace('.json', '')}`, EXTRACTION_MODE: 'replay', RESEARCH_MODE: 'replay' };
    // Exits non-zero on any failed expectation.
    const out = execFileSync(process.execPath, ['scripts/run-fixture.js', `fixtures/requests/${f}`], { env, encoding: 'utf8' });
    assert.ok(out.trim().split('\n').length > 0);
  });
}
