# Demo video script: Rundoo for Bike Shops (about 60 seconds)

One job, start to finish: request, recommendation, alternative, sourcing, estimate, approval. Every step below is a real click in the app on WO-1042.

**Before recording**

- Reset the run (`npm run reset`, or `POST /api/dev/reset`) so WO-1042 starts as a draft.
- Record at 1440×900. Use Screen Studio zoom to follow the cursor; crop out the top bar badge or keep it, but don't call the phone a real text in on-screen titles.
- The phone in the app is a preview of the customer's text and approval page. The voiceover describes the product behavior, not a live SMS.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 to 0:06 | Service work orders list. | Rundoo is the bike shop POS that runs the whole store. Parts research, stock checks and quotes run themselves. Here's a custom job. |
| 0:06 to 0:12 | Click **WO-1042**. Click the **Easier climbing, $250** sample, then **Find parts**. | Maya wants easier gears for a hilly tour. About two-fifty, in three weeks. Type it in and hit Find parts. |
| 0:12 to 0:18 | Click **Confirm all on file**. On the cage question, click **RD-R7000-SS**. | Rundoo pulls what's on the bike and asks the one thing it can't know. Short cage. |
| 0:18 to 0:25 | Recommended parts appear. On Cassette, open **Why it fits**. | It recommends an 11-34 cassette, a GS derailleur and a spacer, with the reason and Shimano's specs. |
| 0:25 to 0:34 | Cassette: **Other options**, then **Shop stock**. Click **Use this** on the 11-30T. Toast confirms the derailleur and spacer are no longer needed. | That cassette has to be ordered. The 11-30 is already on your shelf and works with her derailleur. Pick it, and the extra parts drop off. |
| 0:34 to 0:40 | Chain: **Use this**. The quote opens with parts, labor and $212.78. | Add the chain. Labor fills in at your shop rate. No catalogs, no supplier sites. |
| 0:40 to 0:46 | Click **Send quote · $212.78**. The phone shows the itemized quote. | Send it. Maya gets the itemized quote by text. |
| 0:46 to 0:53 | In the phone, click **Approve**. Work order shows **Approved**. | She taps approve, and it's on the work order. Pull the parts and get back to the bike. |
| 0:53 to 1:00 | End card: Rundoo for Bike Shops. Book a demo. | Rundoo for Bike Shops. Less time at the screen, more time on the bike. |

Word count: about 140 words, about 55 to 60 seconds at a natural pace. To cut to 45 seconds, drop the "Why it fits" beat (0:18 to 0:25).

**Captions:** a draft WebVTT file with these lines is at `web/public/bike-shops/demo.vtt`. Retime it to the final recording, then set `VITE_DEMO_CAPTIONS_URL=/bike-shops/demo.vtt`.
