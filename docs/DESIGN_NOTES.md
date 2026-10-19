# Design notes: bike-service parts research

Status: working prototype of a **proposed** native Rundoo extension. Not a shipped Rundoo feature. Customers, stock, prices, suppliers and messages are synthetic.

## 1. Sources read before building (2026-10-18)

Rundoo public pages are product evidence, not an API or design spec. Visual fidelity was not verified pixel for pixel.

| Source | What we took from it |
|---|---|
| rundoo.ai/product, /product/pos-web-app | One connected platform; browser POS; "Quotes, held drafts, will-calls, and special orders in one flow". So the estimate lives on the work order, not in a separate app. |
| rundoo.ai/dooey | Dooey is "the AI built into every Rundoo screen" (renamed from Rundoo AI, July 2026). We show a small Dooey mark on the research panel only; no chat transcript. |
| rundoo.ai/product/manage-pricing-purchasing | Vendor comparison, POs, receiving, vendor catalogs; "each purchase order goes to a single vendor". We show supplier cost vs customer price separately and never place orders. |
| rundoo.ai/product/improve-customer-satisfaction | Customer records, texting. Basis for the simulated customer text + approval link. |
| rundoo.ai/insights/rundoo-aaa-framework | Analyze, Act, Automate; agents produce drafts a human approves. Basis for "drafting is automatic, sending needs a click". |
| Rundoo primers (Mar 29 and Apr 26, 2026, substack) | Scheduled agents (Daily Summary, Orders, Reports), touchscreen Category Search, Catalog preview. Our interactive flow extends that philosophy; it is not an existing feature. |
| rundoo.ai/industries/paint, /lumber, /lumber/units-of-measure | Industry data (formula, units, Item Sets) carried on the sale and customer record through quote and fulfillment. We carry confirmed components, evidence and the approved build plan on the work order the same way. |
| rundoo.ai/partners | Named partners are hardware/paint/lumber co-ops and vendors. No bike suppliers are listed, so all bike suppliers here are simulated and unnamed-brand. |
| Lightspeed R-Series work orders article | Mechanic-familiar terms: work order, labor lines, statuses (Open, Estimate, Waiting, Finished), special-order lines, print/send quote. Used for vocabulary only. |
| Shimano productinfo + bike.shimano.com + DM-RARD001-04; KMC X11 page | All technical compatibility facts. See section 4. |

Visual design: deliberately **not** a copy of Rundoo's POS. The shell is a modest generic POS frame (Sales, Service, Customers, Products, Purchasing, Reports; only Service is live). The palette (cobalt accent on warm neutrals) and type (Manrope + IBM Plex Sans) are loosely inspired by the public rundoo.ai site so the extension feels at home, but layout and components are our own. Effort went into the workflow, not visual fidelity.

## 2. Interaction decisions

- **Guided stages, one page.** Describe job -> Review recommendations -> Confirm quote -> Send for approval -> Track response. A step indicator shows progress; stages are reachable backward without losing decisions.
- **One request, then short actions.** The mechanic types one sentence. Extraction proposes goal, budget, deadline, bike value and any observed conditions. Nothing is auto-confirmed.
- **Bike record is a candidate, not truth.** Components from the record show "from bike record" and need Confirm (one-click "Confirm all on file"). The single missing identifier on the happy path (derailleur cage SS vs GS) is asked as a direct question with the exact choices plus "Not listed" and "Needs inspection".
- **Recommendation row.** Exact variant, customer price, availability, one short reason, then `Use this / Other options / Check further`, with `Why it fits` expanding checks and source links. Optional rows also show `Skip`.
- **Alternatives preserve compatibility.** Filters: Lower cost, Sooner, Shop stock, Other brand. Cassette alternatives are other compatible upgrade options; choosing one re-runs the dependency check and adds or removes the derailleur/spacer rows, with a toast saying what changed.
- **Auto-advance.** The last affirmative decision moves straight to the quote. No redundant Next.
- **Single send action.** "Send quote · $X" confirms the price and sends the text to the simulated phone in one action. Message editing is optional (Edit link), not a mandatory preview screen.
- **Neutral status labels only:** Needs confirmation, Needs inspection, Selected/Confirmed, Not found, Skipped, Waiting on customer, Approved, Declined, Changed since approval. No traces, prompts, scores or token counts in the mechanic UI.
- **Short notes, not gates.** Over-budget, misses-deadline and quote-over-half-of-stated-bike-value show as one-line mechanic notes. No appraisal, no automatic rejection, no e-bike/brand gates.

## 3. Architecture and tradeoffs

- **One orchestrator, explicit stages** (`server/orchestrator.js`). Separate modules for extraction, research, sourcing, estimate and message (`server/modules/*`) so evals can test each one.
- **Structured state is authoritative** (`server/store.js`, one JSON file per `EVAL_RUN_ID`). The LLM adapter (optional) only proposes extraction fields, which are clamped to a schema and never write confirmations, selections or approvals.
- **Deterministic compatibility rules over a curated, cited dataset** rather than model judgement. Tradeoff: only the verified R7000 / HG800 / KMC X11 set is supported; everything else returns Not found with next steps. That is the honest behaviour for a prototype.
- **Versioning and invalidation.** Component edits bump `configuration.version`, rerun research, revalidate earlier selections and log dropped ones in `job.rejected`. Every estimate has a content hash; any change after send marks that version `outdated`; any change after approval marks the job `changed_after_approval` and the approval `valid: false`. Resending creates a new estimate version.
- **Idempotency.** `send` and `create_or_update_draft_estimate` accept idempotency keys; the UI sends one per click.
- **JSON file store instead of a database.** Zero native deps, trivial per-run isolation, easy to inspect. Not for concurrent multi-user use.
- **Plain JS + React (Vite)** rather than TypeScript, to keep the build small. Schemas are documented in `docs/MOCK_ADAPTERS.md`.

## 4. Scenario selection and technical verification

The primary scenario is an **illustrative synthetic job**: a road bike with Shimano 105 R7000 2x11 (FC-R7000 50-34T, ST-R7000, CS-R7000 11-28T, HG spline L freehub). Customer wants easier climbing gears, budget about $250, needed in 3 weeks.

Verified combinations (Shimano compatibility information Ver 2.7, Oct. 7, 2026; spec pages read 2026-10-18):

| Option | Derailleur | Cassette | Spacer | Capacity used / available |
|---|---|---|---|---|
| Keep current derailleur | RD-R7000-SS (max 30T, 35T capacity) | CS-R7000 11-30T | none | 35 / 35 (at limit) |
| Middle | RD-R7000-GS (max 34T, 39T capacity) | CS-R7000 11-32T | none | 37 / 39 |
| Easiest (recommended) | RD-R7000-GS | CS-HG800-11 11-34T | 1.85 mm on HG spline L | 39 / 39 (at limit) |

Sources and exact claims are in `data/catalog/evidence.json`. Notes:
- CS-R7000 has no 11-34T; 11-34 is CS-HG800-11 (HG spline M; road 11-speed freehub needs 1.85 mm spacer per chart C-731). Whether the spacer ships in the box is **unverified**, so the spacer row is skippable.
- No single Shimano chart cell names "RD-R7000-GS + 11-34 + FC 50-34"; the pairing follows from C-454, C-254, C-455 plus the capacity arithmetic.
- Chain length must be re-sized for a bigger low cog (DM-RARD001-04 method). A new chain is shop practice, not a Shimano requirement, so the chain row is "recommended" and skippable.
- KMC X11 compatibility is KMC's own claim; Shimano charts do not list third-party chains.
- Prices are synthetic; no official MSRP was found.

## 5. Assumptions (not claimed as shipped Rundoo features)

Bike records, bike compatibility data, bike suppliers, repair/approval workflow, simulated texting and the `/api/*` endpoints are prototype assumptions standing in for Rundoo backend services. No vendor partnerships, measured time savings or revenue effects are claimed.

## 6. AI research (added 2026-10-19)

Why: the cited rules only know one drivetrain, so most real requests came back Not found. AI research covers any job type and bike while keeping the "never invent compatibility" rule.

How trust is kept:
- Rules first: an easier-gearing job on verified catalog parts still uses the deterministic rules.
- AI must cite manufacturer pages. The server validates every source (https, allowlisted manufacturer domain). A part with no valid source is shown as "Needs checking" and cannot be selected; uncited alternatives are dropped.
- Every AI pick shows "Needs confirmation" until the mechanic clicks Use this; sources sit under "Why it fits".
- Missing identifiers are asked as short free-text questions; answers are stored as confirmed components and bump the configuration version, so stale AI results are discarded.
- The model sees no customer contact details. Notes, labels and web pages are passed as data with an instruction to ignore embedded instructions.
- Labor still comes from the shop rate card; prices come from the shop price list, or the mechanic enters one.

Replay fixtures (`fixtures/ai_research/`) are hand-authored from sources checked on 2026-10-19 and say so in their `provenance` field. They are not presented as model output. Notable source facts: bike.shimano.com was down for maintenance (back Oct 21), so Shimano's spec handbook Ver. 2.8, compatibility charts Ver 2.7 and dealer manual DM-RACBR01-03 were used; R55C4 pack size and the full DM-GN0001 chain-length text are unverified.
