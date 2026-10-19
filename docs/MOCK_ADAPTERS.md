# Tools, adapters and mock/live boundaries

Every tool is an exported function in `server/orchestrator.js` with an HTTP route in `server/index.js`. The headless runner `scripts/run-fixture.js` calls the same functions.

## Mock / live boundary

| Concern | Implementation | Real or simulated |
|---|---|---|
| Request extraction | `modules/extraction.js`: `replay` = deterministic rules parser (default); `live` = Claude structured output via `adapters/llm.js` when `EXTRACTION_MODE=live` and `ANTHROPIC_API_KEY` is set server-side. Live failures fall back to replay and record `fallback_reason`. | Replay is deterministic. Live is real model output, clamped to schema. UI chip shows `replay` or `live parsing`. |
| Compatibility research | `modules/research.js` rules over `data/catalog/components.json` + `evidence.json` | **Researched**: specs quoted from Shimano/KMC sources (see evidence.json). Rules, not an LLM. |
| AI research (any other job or bike) | `adapters/research_llm.js` + `modules/ai_research.js`. Routing: `useRules()` in `modules/research.js` sends easier-gearing jobs on verified catalog drivetrains to the rules; everything else goes here. `RESEARCH_MODE=replay` (default) picks a recorded result from `fixtures/ai_research/*.json` by a deterministic matcher; `live` calls Claude with web search limited to manufacturer domains. | Replay fixtures are **hand-authored** from manufacturer sources checked 2026-10-19 (each file states its provenance); they are not recorded model output. Live mode is implemented but **not yet exercised** (account had no API credit). All output is validated: only https URLs on manufacturer domains count as sources; uncited parts can't be selected; uncited alternatives are dropped. |
| Inventory | `data/fixtures/commercial.json` `inventory` | Simulated |
| Supplier offers | `data/fixtures/commercial.json` `offers` ("Coastal Bike Supply", "Northern Parts Co.") | Simulated. Not real vendors or prices. |
| Pricing, labor, tax | `commercial.json` `shop` (CAD, $100/h, 12% demo tax on parts + labor) | Simulated fixture |
| Customer text + approval | `state.inbox`, `/approve/:token` | Simulated. No SMS is sent. |
| Supplier inquiry | Draft stored on job | Draft only, never sent |
| Purchase orders, payments | Not implemented | Nothing ordered or charged |

## Tools

| Tool | Route | Input | Output |
|---|---|---|---|
| `getJobContext(job_id)` | `GET /api/jobs/:id` | | Job view (below) |
| `createJob({customerId, bikeId})` | `POST /api/jobs` | | Job view (fresh isolated state) |
| `describeJob(job_id, {text})` | `POST /api/jobs/:id/describe` | free text | Job view; captures `extraction.v1`, `research.v1` |
| `updateConfirmedComponents(job_id, components, evidence)` | `POST /api/jobs/:id/components` | `{slot: {partId, status: confirmed|needs_inspection}}` | Job view; bumps `configuration.version`, reruns research |
| `researchCompatibility(job_id, configuration_version, constraints)` | `POST /api/jobs/:id/research` | 409 if version is stale | Job view |
| `getAvailableInventory(part_ids, location_id)` | `GET /api/inventory?part_ids=` | | `inventory.v1` `{items:[{on_hand, committed, available}], reserves_stock:false}` |
| `getSupplierOffers(part_ids)` | `GET /api/supplier-offers?part_ids=` | | `supplier_offers.v1` `{simulated:true, offers}` |
| `savePartSelection(job_id, selection, configuration_version)` | `POST /api/jobs/:id/selection` | `{requirementId, partId?, status: selected|excluded|needs_inspection}` | Job view + `result.dependency_changes`; 409 stale config, 422 incompatible, 400 `bad_status`, 422 `required` when skipping a part that is not skippable |
| `updateLabor(job_id, labor)` | `POST /api/jobs/:id/labor` | `[{id, hours?, included?}]` or `{label, hours}` to add | Job view; 400 `bad_hours` if an edit is outside 0-40 h or a new line is outside (0, 40] h (nothing is applied) |
| `createOrUpdateDraftEstimate(job_id, version, idempotency_key)` | `POST /api/jobs/:id/estimate` | | `estimate.v1` |
| `sendQuote(job_id, {message?, idempotency_key})` | `POST /api/jobs/:id/send` | Confirms price + sends in one action | Job view; captures `estimate.v1`, `customer_message.v1`. If the customer already has identical content (the open sent quote, or the approval that still stands), nothing is sent and any unsent draft is dropped: `result.already_sent: true`, stage returns to `track`. 422 `message_total_mismatch` if an edited text names a dollar amount but not the quote total |
| `sendApprovalRequest(estimate_id, approved_message, idempotency_key)` | `POST /api/estimates/:id/send` | Lower-level send of a draft | `{estimate}`; 409 `stale_draft` if the work order changed since the draft was built (refresh it with `POST /api/jobs/:id/estimate`) |
| `recordCustomerResponse(estimate_id, estimate_version, response)` | `POST /api/estimates/:id/response` | `approve|decline`; 409 `version_mismatch` if version not current; 409 `not_open` if the quote is not open or the work order no longer matches it | `{estimate, job_status}` |
| `draftSupplierInquiry(job_id, {requirementId?})` | `POST /api/jobs/:id/inquiry` | | Job view with `inquiries[]` (draft, simulated) |
| customer view | `GET/POST /api/approve/:token` | | Simulated customer approval |
| developer report | `GET /api/dev/jobs/:id/report` | | Full job incl. `toolLog`, `rejected`, all estimate versions. Not linked from UI. |
| reset | `POST /api/dev/reset` | | Reseeds current run (disable with `ALLOW_RESET=false`) |

Idempotency keys are scoped to the tool and the job (or estimate) they were used with; a key reused elsewhere is a new request. Any rejected request (4xx) leaves state unchanged.

## Structured output schemas (captured to `data/runs/<EVAL_RUN_ID>/outputs.jsonl`)

Each line: `{run_id, at, stage, job_id, output}`. Stages: `extraction`, `research` (rules or AI; see `engine`), `sourcing`, `estimate`, `customer_message`, `customer_response`.

- `extraction.v1`: `{mode: replay|live, fallback_reason?, goal:{type: easier_gearing|other|unknown, summary}, budget, deadline:{text, days}|null, bike_value, mentioned_components:[{slot,text}], observed_conditions:[], customer_notes:[]}`. JSON schema: `EXTRACTION_SCHEMA` in `server/modules/extraction.js`.
- `research.v1`: `{job_id, configuration_version, status: ready|needs_info|not_found, questions:[{slot, text, hint, options:[{value,label}], blocking}], baseline:{label, ratio}, options:[{id, cassettePartId, rearDerailleurPartId, spacerPartId, compatible, low_gear, pct_easier, capacity_needed, checks:[{rule, pass, detail, evidence_ids}], dependencies}], recommended_option_id, chain_candidates, observed:[], inferred:[], evidence:[{id,title,url,version?,retrieved,claim}], not_found?:{reason, missing?, next_steps}}`.
- `sourcing.v1`: `{items:[{requirementId, partId, stock:{on_hand, committed, available}, options:[{type: stock|supplier, offerId?, supplierName?, eta_days, cost_cents?, landed_cents?, shipping_cents?, meets_deadline?}], recommended:{type: stock|supplier|inquiry, label, eta_days}}]}`.
- `estimate.v1`: `{estimate:{id, jobId, version, status: draft|sent|outdated|superseded|approved|declined, lines:[part|labor], totals:{currency, parts_cents, labor_cents, subtotal_cents, tax_cents, tax_rate, tax_label, total_cents}, contentHash, configuration_version, plan_option_id}}`.
- `customer_message.v1`: `{estimate_id, version, body, simulated:true}`.

Compatibility rule ids: `speed_match`, `shifter_family`, `min_low_sprocket`, `max_low_sprocket`, `total_capacity`, `front_difference`, `freehub_fit`, `chain_length`.

## AI research output (`ai_research.v1`, before validation)

`{status: ready|needs_info|not_found, summary, questions:[{slot, text, hint}], requirements:[{id, slot, title, kind: required|recommended|suggested, qty, part:{brand, name, variant, mpn, customer_label}, reason, fit_checks:[{detail, source_ids}], alternatives:[{part, reason, tags, dependency, source_ids}], source_ids}], inferred:[], not_found:{reason, next_steps}, sources:[{id, title, url, claim, retrieved}]}`.

After validation it is stored as `research.v1` with `engine: "ai"`, `mode`, `fixture_id`, `provenance`, `requirements_ai[]` (each with `citation: cited|uncited`) and `evidence[]` (only allowed-domain sources, ids `ai-<hash>`). AI-sourced parts are added to the catalog as `AI-<MPN>`; their price comes from the synthetic price list, otherwise the mechanic must enter a customer price before selecting.

Allowed source domains: shimano.com (incl. bike., productinfo., si.), sram.com, kmcchain.com, swissstop.com, koolstop.com, campagnolo.com.

## Live AI research pipeline and latency

1. **Cache** (`data/cache/research/<key>.json`): exact match on model + job type + normalized component identifiers (not the free-text note). Hit = instant. TTL `RESEARCH_CACHE_TTL_DAYS` (30).
2. **Intake** (`INTAKE_MODEL`, Haiku 5.5, no tools, JSON schema output): asks every blocking identifier in one round, about 2-3 s.
3. **Research** (`RESEARCH_MODEL`, Sonnet 5.5, low effort, streaming, web search limited to manufacturer domains, max 6 searches). Skipped intake when the mechanic has just answered all its questions.
4. **Background + activity feed**: over HTTP, research runs in the background; `job.research.activity[]` (steps, each search with the result titles/URLs) and `job.research.thinking` (summarized reasoning) update as events stream; the UI polls every 1.2 s.

Model choice (2026-10-19, two live runs each on the brake and SORA jobs): Sonnet 5.5 12-27 s and Haiku 5.5 13-21 s both returned the verified answers; Opus 5.5 took 20-37 s. Sonnet 5.5 was chosen for cleaner part naming and the server-side refusal fallback.

## Source check (background, live mode)

After live AI research shows its results, each recommended part and alternative is checked in parallel (`verifySources` in `adapters/research_llm.js`): Claude fetches the part's cited manufacturer pages with `web_fetch` citations on, and the API returns `cited_text` extracted from the fetched page (not model-written). `partConfirmed()` then requires ONE quoted passage that contains the part's model code and, if the part names a size range (e.g. 11-32T), that exact range. Result per part in `job.research.verification.items`: `confirmed` (with the page quote), `unconfirmed` (with reason), or `confirmed_by_hand` for replay fixtures. Captured as `source_check.v1`.

Why: on 2026-10-19 a live run recommended "CS-HG50-9 11-32T" and paraphrased a Shimano page as offering 11-32T; Shimano's spec handbook lists CS-HG50-9 in 11-30T only. The domain-only citation check passed it; the source check marks it "Couldn't confirm". Typical time: 8-40 s, after results are already on screen.

The shop catalog is also a tool for the research model (`search_shop_catalog`): customer price, available stock and supplier ETA, so picks link to shop part ids. The catalog never counts as compatibility evidence.
