# Bike service parts research for a retail POS

**Stop spending your bench time on parts research.** Type one sentence about the job and the AI does the legwork for you:

- **Figures out what fits** the customer's bike, using the manufacturer's own spec pages and compatibility charts, and shows you the source.
- **Looks up your inventory** for parts you have on the shelf, and **checks your supplier catalogs** for price and expected arrival on the rest.
- **Builds the work order and quote** with labor and tax, so nothing gets retyped.
- **Texts the customer** for approval and records the answer on the same work order.

You review and confirm. It does the research.

Example: "Customer wants easier climbing gears for a hilly tour in 3 weeks, budget $250." A few seconds later the mechanic is asked one thing it can't know (which rear derailleur cage is fitted). Then it comes back with an 11-30 cassette that's in stock and works with the current derailleur, or an easier 11-34 setup that needs a different derailleur and a 3-day order, each priced, with the reason it fits and a link to the Shimano page that says so.

Supplier checks use the supplier catalogs (price and lead time per vendor) held in the POS; direct distributor connections with live stock are not built yet.

Built as a proposed extension for [Rundoo](https://rundoo.ai), a browser POS for independent retailers. Customers, stock, prices, suppliers and messages in this repo are synthetic sample data. Nothing is ordered, texted or charged.

## Why it is faster and better

Custom repair and upgrade jobs are slow because one person has to be a researcher, a buyer and a clerk at once. For a job like "easier climbing gears" the steps today are roughly:

| Step | Today, by hand | With this |
|---|---|---|
| Know what is on the bike | Inspect, then search old notes | Bike record pre-fills it; the AI asks only for the identifiers it actually needs (e.g. derailleur cage, rim material), with suggested answers |
| Work out what fits | Read compatibility charts, spec sheets and dealer-manual PDFs; do capacity math by hand | AI researches manufacturer sources, shows each pick with the reason it fits and the page it came from |
| Trust the answer | Double-check yourself | A second step fetches each cited page and confirms the exact part and size appear there; anything it can't confirm is flagged |
| Find it | Check shop stock, then distributor sites or phone calls for price and ETA | AI searches the shop's inventory and the supplier catalogs in the POS while it researches; each part shows in stock, order with expected arrival, or ask supplier |
| Choose | Weigh options from memory | Alternatives filtered by lower cost, sooner, shop stock or other brand; picking one rechecks what else the plan needs |
| Quote | Retype parts, add labor and tax | Work order, labor from the shop rate card and tax are built from the selections, no retyping |
| Approval | Text or call, then remember the answer | One click texts the quote; the customer approves or declines from a link and the answer is recorded on the same work order, with versions |

Nothing in this repo claims a measured time saving. The point is the number of tools and lookups the mechanic no longer has to do, and that every recommendation shows its source.

## How it works

- **Describe the job.** One sentence; budget, deadline and anything the mechanic observed are pulled out automatically.
- **Answer only what blocks the answer.** Questions come pre-filled when the bike record supports a suggestion. Nothing is confirmed until the mechanic says so.
- **Research.** Two engines:
  - *Cited rules* for drivetrains with curated, manufacturer-cited specs (instant, deterministic).
  - *AI research* for everything else (Claude with web search limited to manufacturer domains, plus a tool that searches the shop's own catalog for price, stock and supplier ETA). Progress is shown live: each search, the pages found, the stock checks and a summary of the reasoning.
- **Source check.** In the background, each AI-recommended part's cited page is fetched and the quoted page text must contain that exact part and size. Parts are marked Source confirmed or Couldn't confirm.
- **Quote, send, track.** Deterministic totals, one-click send to the customer, approve/decline recorded with estimate versions; any later change invalidates the approval.

Speed: questions arrive in about 2-3 seconds, AI recommendations typically in 11-27 seconds, and repeat jobs for the same parts are instant from a saved-answer cache.

## Quick start

```bash
npm ci && npm run build && npm start
```

Open http://localhost:3000. Without an API key everything runs on recorded research and is fully deterministic. For live AI research, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY` and `RESEARCH_MODE=live`.
