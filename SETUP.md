# Setup and architecture

Prototype of a proposed bike-service research-to-work-order workflow inside Rundoo (a native extension, not a separate chatbot or POS). Synthetic customers, stock, prices, suppliers and messages. Nothing is ordered, texted or charged.

## What the prototype does

Guided stages on one work order: **Describe job -> Review recommendations -> Confirm quote -> Send for approval -> Track response**.

Parts research has two engines behind one interface (`server/orchestrator.js`):

| Engine | When | How |
|---|---|---|
| Cited rules | Easier-gearing job on a verified Shimano 105 R7000 drivetrain | Deterministic rules over `data/catalog/components.json`, every spec cited in `data/catalog/evidence.json`. Instant. |
| AI research | Any other job type or bike (brakes, unknown drivetrains, tubeless, ...) | `RESEARCH_MODE=replay` (default): recorded results in `fixtures/ai_research/` (hand-authored from checked sources, labelled as such). `RESEARCH_MODE=live`: Claude with manufacturer-only web search, the shop catalog as a tool, then a background source check. |

Live AI research pipeline (`server/adapters/research_llm.js`, validation in `server/modules/ai_research.js`):

1. **Saved-answer cache**: exact match on model + job type + normalized confirmed parts (not the note wording). Repeat jobs are instant.
2. **Intake** (`INTAKE_MODEL`, Haiku 5.5, ~2-3 s): asks every part-deciding identifier in one round. Questions come pre-filled with a suggestion only when the bike record or note supports it (basis shown), plus quick-pick chips for fixed-set answers (e.g. Aluminum / Carbon). Nothing is confirmed until the mechanic presses Continue.
3. **Research** (`RESEARCH_MODEL`, Sonnet 5.5, low effort, streaming): web search limited to manufacturer domains, plus `search_shop_catalog` (price, available stock, supplier ETA) so picks link to shop part ids. Goal first; stock is offered as an alternative. Runs in the background; the UI shows a live activity feed (steps, each search and the pages it found, shop-stock checks, summarized reasoning, timer).
4. **Validation**: only https sources on manufacturer domains count; a part with no valid source is "Needs checking" and can only be skipped; alternatives of a different part type are dropped.
5. **Source check** (background, ~8-40 s after results show): each part's cited page is fetched with citations on, and the API-extracted page quote must contain the part's model code and exact size. Badges: Source confirmed (quote under "Why it fits"), Couldn't confirm (check before ordering), or Source checked by hand (replay).

Every AI pick still shows "Needs confirmation" until the mechanic clicks **Use this**.

## Runtime

- Node.js 22.13.1 (engines `>=20.11 <23`), npm 11.12.1
- Pinned in `package.json` + `package-lock.json`: express 4.21.2, react 18.3.1, react-dom 18.3.1, @anthropic-ai/sdk 0.135.0, vite 5.4.11, @vitejs/plugin-react 4.3.4
- No database or containers. State is one JSON file per run.

## Install, build, start

```bash
npm ci
```

```bash
npm run build
```

```bash
PORT=3000 EVAL_RUN_ID=local-1 npm start
```

Open http://localhost:3000. `npm start`, `npm run dev` and `npm run fixture` load `.env` if present. Dev mode with hot reload (API on `PORT`, UI on `WEB_PORT`, default 5173):

```bash
PORT=3000 WEB_PORT=5173 EVAL_RUN_ID=dev npm run dev
```

`GET /api/health` reports `research_mode` (`replay` or `live`). The top bar shows "recorded AI research" or "live AI research".

## Environment variables (names only; see `.env.example`)

- Runs: `PORT`, `EVAL_RUN_ID`, `DATA_DIR`, `ALLOW_RESET`, `WEB_PORT` / `API_PORT` (dev only)
- Modes: `EXTRACTION_MODE` (`replay` default; live request parsing is implemented but not exercised), `RESEARCH_MODE` (`replay` default, or `live`)
- Live AI (server-side only): `ANTHROPIC_API_KEY`, `RESEARCH_MODEL` (default `claude-sonnet-5-5`), `INTAKE_MODEL` (default `claude-haiku-5-5`), `VERIFY_MODEL` (default `claude-sonnet-5-5`), `RESEARCH_EFFORT` (default `low`), `ANTHROPIC_MODEL` (extraction), `RESEARCH_CACHE_DIR` (default `data/cache/research`), `RESEARCH_CACHE_TTL_DAYS` (default 30)

Without a key (or with `RESEARCH_MODE=replay`) everything runs on recorded data and is fully deterministic.

## Separate runs

Each run keeps its own state under its `EVAL_RUN_ID`. To run several copies side by side, give each its own `EVAL_RUN_ID`, port, env file and (optionally) `DATA_DIR` / `RESEARCH_CACHE_DIR`. A git worktree is not a security boundary:

```bash
PORT=3201 EVAL_RUN_ID=run-a npm start
```

```bash
PORT=3202 EVAL_RUN_ID=run-b DATA_DIR=/tmp/bike-run-b RESEARCH_CACHE_DIR=/tmp/bike-run-b-cache npm start
```

State: `<DATA_DIR>/<EVAL_RUN_ID>/state.json`. Structured outputs: `<DATA_DIR>/<EVAL_RUN_ID>/outputs.jsonl`. Delete the cache dir to force fresh live research.

## Seed / reset

```bash
EVAL_RUN_ID=local-1 npm run reset
```

Or `POST /api/dev/reset` on a running server. Seeds: `data/catalog/*.json` (cited specs) and `data/fixtures/*.json` (synthetic shop, price list, aliases, stock, supplier offers, customers, bikes, jobs).

## Tests

```bash
npm test
```

All tests are deterministic (replay): unit tests for rules, sourcing, totals, extraction, citation validation, alias matching and alternative filtering, every fixture in `fixtures/requests/` run headlessly, and `test/regressions.test.js` (one check per defect found in earlier code reviews, plus a second review pass (labor kept in sync with parts, carbon vs aluminum pads, rejected requests leave state untouched, AI alternatives switch back with their own sources, edited text must match the total, required parts cannot be skipped) and a third pass (carbon result on a fresh seed, send after returning to approved content, inquiry parts never called in stock, edited existing work keeps its place in the title and text). One fixture by hand:

```bash
EVAL_RUN_ID=fx-1 node scripts/run-fixture.js fixtures/requests/happy-path.json
```

Fixtures: `happy-path.json` (rules, with one real alternative), `blocked-missing-info.json`, `decline-revise.json`, `ai-brake-pads.json`, `ai-unknown-bike-sora.json`. Recorded outputs: `fixtures/replay/happy-path.outputs.jsonl`.

## End-to-end workflow check (live or replay)

```bash
node --env-file-if-exists=.env scripts/e2e-workflow.js
```

Starts its own server on port 3301 (`E2E_PORT`) with a fresh run id and drives the HTTP API as the UI does for four scenarios: rules gearing, AI brake pads, AI unknown bike, and an AI open job left for inspection. Checks: isolated new job, one question round, cited parts with reasons under 15 words, stock/supplier/inquiry availability, the main pick matches the hand-verified answer, source check result, alternative with dependency recheck, stale-version rejection, deterministic totals, labor source, idempotent send, decline then v2, old version not approvable, approval on the same job, change-after-approval invalidation. Last live run (2026-10-19): 98 checks, 0 failed. Live runs cost a few cents.

## Walkthrough

Rules engine (instant, about 2 minutes):

1. Open `/`. Click **WO-1042** (Maya Chen, road bike 105 R7000), or **+ New repair / custom job** and Start job.
2. Click the **Easier climbing, $250** sample, then **Find parts**.
3. Click **Confirm all on file**, then answer the cage question with **RD-R7000-SS**.
4. Recommended: CS-HG800-11 11-34T + RD-R7000-GS + 1.85 mm spacer + chain. Open **Why it fits** for checks and Shimano sources.
5. Cassette **Other options** -> **Shop stock** -> **Use this** on CS-R7000 11-30T. Toast: derailleur and spacer no longer needed.
6. **Use this** on the chain; the quote opens automatically. **Send quote · $212.78**.
7. Click **Approve** in the simulated phone. Job shows Approved, quote v1.

AI research, brake job: WO-1042, sample **Brake pads**, **Find parts**. Both questions arrive pre-filled (BR-R7000 from the levers on file, Aluminum from the wheelset on file); press **Continue**. Expect Shimano R55C4 inserts x2, in stock, with "Source confirmed" in live mode. Answer **Carbon** instead to see a fresh live run.

AI research, unknown bike: WO-1043, sample **Unknown drivetrain**. Answer `Shimano FC-R3000, 50-34`, `RD-R3000-SS`, `9-speed, 11-28`, `ST-R3000, 9-speed` (and freehub `Shimano HG, 9-speed` if asked). Expect CS-HG400-9 11-32T, the largest cog RD-R3000-SS allows.

Blocked case: WO-1043, answer the derailleur with **Not listed / other** (replay) -> Not found with next steps and a draft supplier question (not sent).

Decline / revise: WO-1044 (Priya, existing tune-up on the work order). Send a quote, **Decline** in the phone, revise, **Send revised quote** (v2).

Revise after sending or approval: on an approved job click **Add work or revise** (or **Change quote** while waiting on the customer). Any change marks the earlier quote outdated or the approval as changed, and **Send revised quote** sends a new version. Sending with no changes sends nothing and returns to tracking.

## Routes

UI: `/` (work orders), `/service/:id` (workspace), `/approve/:token` (simulated customer view).
API: `docs/MOCK_ADAPTERS.md`. Developer-only: `GET /api/dev/jobs/:id/report` (tool log incl. AI inputs, rejected decisions, estimate versions), `POST /api/dev/reset`, `GET /api/health`.

## Mock / live boundaries

Researched: rules specs (`data/catalog/evidence.json`); live AI results cite manufacturer pages and are source-checked; replay AI fixtures are hand-authored from sources checked 2026-10-19. Simulated: customers, bikes, stock, prices, aliases, suppliers, offers, labor rates, tax rate, texts, approvals. Details: `docs/MOCK_ADAPTERS.md`.

## Output schemas

`extraction.v1`, `research.v1` (rules or AI, see `engine`), `sourcing.v1`, `estimate.v1`, `customer_message.v1`, `source_check.v1`, raw `ai_research.v1` (before validation). All in `docs/MOCK_ADAPTERS.md`.

## Railway (do not deploy without instruction)

`railway.json`: build `npm run build` (Railway installs dependencies itself; running `npm ci` again fails with EBUSY on its cache mount), start `npm start`, health check `/api/health`. Set `EVAL_RUN_ID`, `RESEARCH_MODE`, `ALLOW_RESET=false` for shared demos, and `ANTHROPIC_API_KEY` only for live mode. Attach a volume and point `DATA_DIR` and `RESEARCH_CACHE_DIR` at it to keep state and saved answers across deploys. Research runs in the background, so no request holds open for the full research time.

## Known limitations

- Live research quality varies run to run. One live run invented "CS-HG50-9 11-32T"; the source check flags such parts as "Couldn't confirm", and mechanic confirmation is still required. The source check cannot fetch JavaScript-rendered or blocked pages, so some correct parts show "Couldn't confirm".
- Live time to recommendations: about 11-27 s typical, up to about 50 s when the model runs extra searches (2026-10-19, Sonnet 5.5). Source check adds 8-40 s in the background. Repeats are instant from cache.
- In replay mode only the recorded scenarios have AI answers (brake pads on BR-R7000, SORA R3000 easier gearing); anything else is Not found with next steps.
- Parts the shop catalog doesn't carry show "Ask supplier" and need a mechanic-entered price.
- Spacer inclusion with CS-HG800-11 is unverified, so that row is skippable. The chain row is recommended, not required (Shimano requires re-sizing, not replacement).
- Request parsing runs on the deterministic parser; its live mode was not exercised.
- JSON file store: single process, not for concurrent multi-user use. Photo identification and real PO creation are not implemented.
- The POS shell is generic by design, not a copy of Rundoo's app; only Service is functional. Landing-page assets under `web/public/bike-shops/` are a separate deliverable in progress, not part of this prototype.
