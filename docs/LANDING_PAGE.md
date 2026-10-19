# Rundoo for Bike Shops: landing page

A one-page launch concept for bike-shop owners, separate from the mechanic app. Goal: book a demo.

- Route: `/bike-shops` (the app stays at `/`, `/service/:id`, `/approve/:token`)
- Source: `web/bike-shops/` (`index.html`, `main.jsx`, `landing.css`, `config.js`)
- Images: `web/public/bike-shops/` (real captures of the app, see below)
- Video script: [DEMO_VIDEO_SCRIPT.md](DEMO_VIDEO_SCRIPT.md); draft captions: `web/public/bike-shops/demo.vtt`

```bash
npm run build && npm start
```

Then open http://localhost:3000/bike-shops. In dev (`npm run dev`) it is at http://localhost:5173/bike-shops/.

## Editable links

Set these in `web/bike-shops/config.js`, or as build-time variables (they need a rebuild):

| Setting | Variable | Empty means |
|---|---|---|
| `bookingUrl` | `VITE_BOOKING_URL` | Every "Book a demo" scrolls to the on-page request form |
| `videoUrl` | `VITE_DEMO_VIDEO_URL` | Defaults to `/bike-shops/demo.mp4` (the recorded walkthrough). Set to `''` for the screenshot hero with "See how it works" |
| `captionsUrl` | `VITE_DEMO_CAPTIONS_URL` | No caption track |
| `videoPoster` | `VITE_DEMO_POSTER` | `/bike-shops/demo-poster.jpg` (frame at 0:35 of the recording) |
| `appUrl` | `VITE_APP_URL` | Footer link goes to `/` |

With a booking URL set, all "Book a demo" buttons open it in a new tab and the form is hidden.

## Walkthrough video (in the hero)

**Current video:** `web/public/bike-shops/demo.mp4`, the Screen Studio recording (77 s, WO-1051, recommended 11-34 path, approved at $391.96), transcoded from HEVC to H.264/AAC 1080p with faststart (about 10 MB) so it plays in every browser. No captions yet: the recording follows a different path than the draft `demo.vtt`, so that file is not attached. Transcribe the voiceover and set `VITE_DEMO_CAPTIONS_URL` to add them.

The Screen Studio walkthrough plays in the hero, in place of the screenshot. "Watch the workflow" scrolls to it and starts playback (a user click, so sound is fine). It never autoplays.

1. Record following [DEMO_VIDEO_SCRIPT.md](DEMO_VIDEO_SCRIPT.md).
2. Export MP4 (1080p is plenty) to `web/public/bike-shops/demo.mp4`, or host it anywhere that serves the file directly.
3. Retime `demo.vtt` to the recording.
4. Build with `VITE_DEMO_VIDEO_URL=/bike-shops/demo.mp4 VITE_DEMO_CAPTIONS_URL=/bike-shops/demo.vtt`.

A file URL (`.mp4`, `.webm`, `.mov`, `.m4v`) gets the native player: browser controls (keyboard accessible), `playsinline` for iOS, captions track, poster (`videoPoster`). YouTube and Vimeo links are converted to embed URLs; any other URL is placed in an iframe as given, so use the provider's embed URL. A Screen Studio share page may not allow embedding, so the MP4 route is recommended.

Until a URL is set, the hero shows the app screenshot with the approved-quote phone, the secondary button reads "See how it works" (scrolls to the four steps), and the footer has no walkthrough link. Nothing on the page claims a recording exists.

Tested with a throwaway clip: player renders in the hero with controls and captions, no autoplay, "Watch the workflow" starts it, phone overlay hidden.

## Fictional and example content (replace before a real launch)

- **Testimonials are fictional**, written as sample content: Renata Ilić (Spoke & Spindle), Marcus Bell (Eastside Wheelhouse), Dana Okafor (Northline Cycle Co.). Names, shops and text wordmarks are invented. They are not real people or shops. Replace with real, approved quotes.
- **Suppliers are fictional**: Coastal Bike Supply and Northern Parts Co. come from the app's synthetic data (`data/fixtures/commercial.json`), as do all stock counts, prices and arrival times on the page. No real distributor is named as a partner.
- **The shop, customer and quote** (Demo Cycle Works, Maya Chen, $212.78) are the app's seed data.
- **Demo request form** (when no booking URL is set): validates and shows a confirmation, but nothing is sent or stored. The confirmation says nothing is scheduled. Connect a booking URL or form backend before real use.
- **Bike-shop capabilities are a proposed extension of Rundoo**, presented as a launch concept. The footer says so in one line.

## Product visuals

All screenshots are captures of the running app walking WO-1042 (request, cage question, recommendation, Other options, in-stock 11-30T, chain, quote, send, approve). For the marketing captures only, the app's "Prototype · simulated data" badge, the "Simulated customer phone" label and toasts were hidden with an injected stylesheet. The app itself is unchanged. The phone renders the app's customer view, which is a preview, not a real SMS.

What the page shows matches what the app does: the cage question is the "essential missing detail"; Other options filters are Lower cost, Sooner, Shop stock and Other brand; choosing the 11-30T removes the derailleur and spacer; committed stock is excluded from "available"; Decline leads to a revised quote (v2); Check further can draft a supplier question (not sent).

## Claims and sources

**About the product (backed by the app):**

| Page claim | Where it comes from |
|---|---|
| Compatible parts with a short reason and sources | Recommended parts + "Why it fits" (Shimano charts in `data/catalog/evidence.json`; AI research cites manufacturer pages) |
| Asks for essential details only | Cage question / AI intake questions on `needs_info` |
| Shop stock vs supplier price and arrival | `server/modules/sourcing.js`, synthetic offers |
| Alternatives update dependent parts | Toast and removed rows after choosing CS-R7000 11-30T |
| Text approval updates the job | Phone view, Approve/Decline, status on WO |
| Not measured | No time-saved, margin or revenue numbers anywhere on the page |

**About Rundoo (rundoo.ai, checked October 2026):** POS, inventory, purchasing with vendor catalogs and purchase orders, customer records, payments and Dooey are listed on https://rundoo.ai/product/ and https://rundoo.ai/dooey/. Rundoo has no bike industry page today.

**About Lightspeed (official pages, checked October 2026):**

| Page claim | Source |
|---|---|
| Built-in bike work orders | https://www.lightspeedhq.com/pos/retail/bike-shop/ |
| Work orders with labor and parts lines, statuses, due dates | https://retail-support.lightspeedhq.com/hc/en-us/articles/229131428-Creating-and-completing-work-orders |
| Bike distributor catalogs (QBP, J&B, Hawley, BTI and others), POs, live stock checks for some vendors | https://retail-support.lightspeedhq.com/hc/en-us/articles/228840347-About-bicycle-integrations |
| Special orders tied to purchase orders | https://retail-support.lightspeedhq.com/hc/en-us/articles/229130588-Creating-a-special-order |
| Lightspeed AI (Jan 2026) | https://www.lightspeedhq.com/news/lightspeed-commerce-launches-lightspeed-ai-a-new-ai-powered-intelligence-layer-for-retail-and-hospitality/ |
| AI purchase-order prep, opt-in beta (Oct 2026) | https://www.lightspeedhq.com/news/lightspeed-ai-expands-from-insights-to-action-with-new-agentic-capabilities-for-retail/ |

The comparison frames the difference as who does the legwork on a custom job: on Lightspeed the team researches fit, checks stock, searches distributor catalogs, builds the work order and follows up; on Rundoo the AI does those steps and the mechanic reviews. The Lightspeed steps cite its docs where a step maps to a documented feature. Deliberately not claimed: that Lightspeed lacks AI (it has Lightspeed AI), can't manage repairs, can't text customers, or costs more. Native work-order texting could not be confirmed either way (Lightspeed lists third-party texting integrations), so the page doesn't mention it. Other competitors (Ascend, Square, Shopify) get no specific claims; the page offers a side-by-side demo instead.

## Partners to pursue (internal, not on the page as partners)

None of these have been contacted. The page describes one supplier state throughout: supplier checks run against the vendor catalogs a shop keeps in Rundoo purchasing (price and lead time per vendor); direct bike-distributor connections with live stock are roadmap. The hero, step 3, the Inventory and suppliers section, the comparison and the FAQ all use "supplier catalogs" wording to match.

- **Bike distributors (sourcing):** QBP, J&B Importers, Hawley, BTI. Lightspeed's help center shows these already offer POS catalog and PO integrations, so shops will expect them. For Canadian shops (the demo's CAD/Vancouver setting), check Canadian distributors' B2B portals too.
- **Brand B2B (sourcing):** Specialized, Trek, Giant dealer portals, for brand-locked parts.
- **Manufacturer technical documentation (fit):** Shimano (compatibility charts and dealer manuals, already cited by the app), SRAM, Campagnolo, plus brake, tire and wheel makers. This is public documentation; a data partnership would add structured specs and update notices.
- **Bike spec data (what is on the bike):** a stock-build database would pre-fill components from make, model and year, cutting the "confirm what is on the bike" step.
- **Messaging:** an SMS provider for real customer texts (the app only simulates them).

## What was verified

- `/bike-shops` and `/bike-shops/` serve the page; `/`, `/service/WO-1042`, `/approve/:token` and the API still serve the app.
- `npm test`: 19/19 pass. The full WO-1042 flow (request to approval) was re-run headlessly after the change.
- Step tabs work with mouse and arrow/Home/End keys; FAQ uses native `<details>`; "Book a demo" scrolls to and focuses the form; validation flags empty name and bad email; confirmation renders; no console errors; all images load.
- No horizontal scroll at 390 px or 1440 px. Reduced motion disables smooth scroll and animation.
- Config: with a video file URL the page renders a native player with captions and no autoplay; a YouTube link becomes an embed; with a booking URL, CTAs link out and the form is hidden.
