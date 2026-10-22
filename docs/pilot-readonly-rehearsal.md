# Owner read-only discovery rehearsal

Status: source-only rehearsal. Owner-only until a separate pilot-admission decision. This does not edit or supersede the PR7 gate sheet, admit participants, change production, or establish customer value.

## Owner run guide

1. Have the coordinator use the repository’s existing approved local preview process. Open `/pilot.html` on that same local origin. Confirm the header says “Owner-only · not admitted.” Do not use production for this rehearsal.
2. Complete the three on-page tasks without another person coaching: filter one interesting market by the category actually shown and return to All; open its details, compare probability and activity, explain why it stood out, then close it; read a saved alert and explain why it was saved while distinguishing Alert time from Last successful check.
3. Use Refresh once. If either source fails, confirm only that source reports the failure and any retained results are labeled last-known. Do not interpret an API timestamp as universal freshness or worker health.
4. Record only the deidentified scorecard below. Do not paste names, contact details, or raw personal feedback into this public document, an issue, or chat. Any actual personal feedback belongs in separately approved private handling.

The probability shown is a price-derived implied YES probability, not model confidence. Movement is shown in percentage points. The 24-hour volume field uses only reported 24-hour volume; lifetime volume is never substituted. Volume and liquidity are feed activity figures; none of these values are a recommendation, a forecast guarantee, ranking-performance evidence, or a promise of returns.

## Three-task manual scorecard

Use one row per person with a random participant code. For this owner rehearsal, use only `OWNER-01`. “Completed” means without coaching; note partial completion plainly.

| Participant code | Task 1: category filter + All (complete/time) | Task 2: detail comparison + close (complete/time) | Task 3: alert reason + time distinction (complete/time) | Confusion observed | What helped | Would return for discovery? |
|---|---|---|---|---|---|---|
| OWNER-01 |  |  |  |  |  | Yes / Maybe / No + brief reason |

Do not convert this table into empirical results unless a rehearsal actually occurred. The page sends no feedback, analytics, beacons, forms, or tracking; scorekeeping is manual and must follow the approved handling boundary.

## Proposed future 5-person / 7-day decision rule

This is a proposal for review, not admission. Start the seven-day clock only after explicit PR7 participant admission and approved private feedback handling. Cap the pilot at five admitted people.

Proceed to a narrowly scoped next review only if, by day 7:

- at least 4 of 5 independently complete Tasks 1 and 2 and describe the displayed probability as market-price-derived rather than forecast confidence;
- at least 4 of 5 independently complete Task 3, using the displayed saved reason and keeping Alert time distinct from Last successful check;
- at least 3 of 5 say they would return specifically to discover or understand markets; and
- no participant reasonably believes this page enables trading, guarantees returns, proves universal freshness, or reports worker health.

Otherwise stop expansion and revise or retire the rehearsal based on the deidentified task evidence. Completion time and confusion notes diagnose usability; they are not profit evidence or customer-value proof.

## Boundaries and pending decisions

- The standalone page limits only its own controls. It does not secure, disable, or make claims about existing server routes or the homepage.
- It performs one load and user-requested refreshes against only same-origin `GET /api/liveMarkets` and `GET /api/alerts/recent`. There is no polling or automatic retry.
- It does not provide accounts, membership, forms, submissions, notifications, wallets, paper/live trading previews, external links, browser storage, cookies, analytics, exports, clipboard actions, or worker controls.
- Invalid, missing, or future data timestamps are shown as unavailable; Last successful check records only a successful browser response validation.
- Empty saved alerts mean no stored public alerts were returned. The page does not insert examples that could be mistaken for real records.
- Release procedure, recovery proof, and availability expectations remain unresolved. Explicit participant admission and feedback handling remain pending under PR7. Production remains unchanged.

Display bounds: the first 60 returned markets are shown, with an explicit shown/returned count when capped. Category filters reflect that shown sample, not every market. Detail views close when a market refresh settles and identify retained or in-flight data when opened from last-known results.
