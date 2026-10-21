# Pilot Readiness Gate - 2026-10-21

## Current status

| Gate | Status | Operator meaning |
| --- | --- | --- |
| Deployment and V2 activation | **Verified** | Production remains on reviewed release `dcd228b05f65704a78ef7e0192400d3c5b583c2c`; the receiver and worker flags are on as previously recorded. |
| Natural V2 delivery | **Verified, bounded** | Natural background-worker receipts, durable rows, and public-card projections were correlated for the observed matching rows. This proves that the route delivered naturally; it is not universal or exactly-once proof for future events. |
| Public read-only experience | **Verified, bounded** | The current public API/card rendering and the recorded desktop/mobile read-only journeys passed within the limits below. Write journeys, physical-device touch behavior, onboarding, classification accuracy, and customer value remain unproved. |
| Release, recovery, and availability controls | **Pending** | GitHub reports no enforced branch rules, statuses, or check runs for the released head at the recorded observation. The owner must still decide acceptable enforced/manual release controls and assess exact-head review, rollback compatibility, recovery, and compute readiness. |
| Customer pilot | **NOT CLEARED** | Do not recruit, onboard, or admit pilot participants until the remaining gates are evidenced and an authorized owner explicitly approves pilot admission. |

This is the current operator gate sheet. The [public beta launch checklist](public-beta-launch-checklist.md) and [admin operations checklist](admin-ops-checklist.md) retain useful historical evidence and routines, but their earlier `Go`, QA, count, and milestone statements are not current pilot clearance. This sheet authorizes no outreach, paid action, trading, production change, or release approval. Bounded read-only prototype review may continue within existing authorization.

## Evidence recorded by Commander

The following facts were supplied by Commander. This documentation-only gate update is based on PR7 head `4623acd5043f903f6cf540227f21e706c2fdead0`; that documentation head is distinct from the unchanged production source release below. This update did not rerun application, worker, deployment, Supabase, or browser tests. Reviewed pre-release tests remain historical evidence rather than a fresh test run.

### 1. Deployment and activation - verified

- PR [#5](https://github.com/dreadmetal111/paid-by-polymarket-os/pull/5) was merged from approved source head `5848e3b1e1f7e065b0f05f874fa6a634fe20b794` as squash commit `3566029d4eca30e4fc15c03e0283461f63388665`. PR [#6](https://github.com/dreadmetal111/paid-by-polymarket-os/pull/6) was merged from approved source head `2cb4c497baf1a3108f4d650f6b704e1e30249ca9` as squash/current production release `dcd228b05f65704a78ef7e0192400d3c5b583c2c`.
- The receiver deployment was live with the saved `PBP_ALERT_INGEST_V2_ENABLED=true` setting.
- The worker matched reviewed SHA-256 `dd25f1f12ba622710eb1eb44e5a94cb5f2b5c00b1f783725625d18920ca2f8b5` and had `PBP_ALERT_DELIVERY_V2_ENABLED=true` from 09:53:18 UTC.
- Before release, the native Node suite passed 130 tests and received independent review. A natural cycle with the worker flag off also passed. These are pre-release/historical facts, not tests performed for this documentation update.

### 2. Natural V2 delivery - verified, bounded

The earlier morning observation is retained as historical, bounded evidence:

- Six post-activation background cycles through 10:11:06 UTC succeeded while processing 200 markets, with no errors and no alerts.
- At that observation, local delivery metadata had no V2 records, and metadata for 842 historical failed records was unchanged.
- The 10:11:09 UTC Supabase aggregate contained 1,134 total alert rows and no V2 rows.
- Public GET checks at 09:56:06 UTC returned HTTP 200 for `/`, `/app.js`, `/api/liveMarkets`, and `/api/alerts/recent`; the public response contained five stored alerts in the five-field shape, and the served frontend matched the SHA-256 recorded below.

Those results justified the then-pending natural-delivery status, but they did not prove protected V2 ingest or durable V2 delivery. The later natural correlation supersedes that pending status without erasing the morning evidence.

At 19:20:50 UTC on 2026-10-21, the correlated proof established:

- 13 successful receipts from the normal background worker path, each linked to one durable Supabase row using saved V2 identity, hash, source, and expiry metadata;
- a first natural source event at 12:26:55 UTC, sent at 12:26:56 UTC in one attempt;
- three later, actually observed dashboard public-card row hashes matching both worker V2 fingerprints and durable Supabase rows; and
- four of the five current public API rows matching the chosen durable snapshot. One newly arriving row was explicitly excluded from that comparison.

Source/durable/public proof SHA-256: `aa89f0375d93d7b2605b1e840ab1e9e900a3126cd98fb477b6df0389dae07ff4`.

This closes the existence gate for natural end-to-end V2 delivery for the observed matching rows. It does **not** establish universal delivery, exactly-once behavior across every future event, an error-rate bound, or continuing health. The public five-field response alone exposes neither V2 protocol metadata nor an event ID; the saved private correlation is what established the route. The first 12:26:55 UTC event's historical dashboard display was not observed and must not be claimed retroactively.

### 3. Public projection and actual DOM - verified, bounded

At 19:16:33 UTC on 2026-10-21:

- the public recent-alert API returned HTTP 200 with five rows and only the five public fields;
- three actual rendered cards each matched `alertType`, `marketQuestion`, `reason`, `severity`, and formatted `createdAt`;
- the two latest observed rows had `createdAt` `2026-10-21T19:13:54+00:00`;
- the badge read `Stored alerts loaded`; and
- `Latest alert time` remained neutral and separate from `Last successful check`.

DOM report SHA-256: `807c5274b4cf4a055a3bb47375d7972c82bc9a9e4ae4f3e878fcfe01e6c66d92`. Served frontend SHA-256: `41c9f4c6afa0e010a8bf278d73e24168bcbd4fe6ca4441cd0a3bce9e28805957`.

For reproducible public-row comparison, the canonical hash input is `JSON.stringify` of an object whose property order is `alertType`, `marketQuestion`, `reason`, `severity`, `createdAt`, preserving the exact public values, encoded as UTF-8 with no BOM and no trailing newline. Do not add an event ID or substitute differently named question/reason fields. Keep neutral timestamp wording: a displayed alert time is not a claim of worker health or successful checking.

### 4. Read-only journey evidence - verified, bounded

- The existing 10:14 UTC desktop journey remains valid bounded evidence: load the homepage, select Sports, return to All, open a visible market detail drawer, and close it.
- At 10:29:34-10:29:37 UTC, the 390 by 844 mobile check kept viewport, client, and scroll widths at 390 across All, Sports, return to All, and detail states. Six cards showed explicit Politics labels, six showed Sports labels after filtering, and Politics was visible again on return to All. The drawer width was 390, its close button was within the viewport, and the close handler worked.
- Across the bounded mobile journey, nine GET requests occurred; no writes were attempted or allowed. Mobile report SHA-256: `b515a18f9a89d83f1ba8b3a8d413b0a1fe8a372a1680b10f57b5e348a0f62561`.

The following owner walkthrough is available for an already authorized, bounded read-only review. It does not recruit or onboard participants, clear the pilot, or verify physical-touch, form, or onboarding scope. The cited 2026-10-21 10:14 UTC desktop and 10:29 UTC mobile observations are dated evidence, not fresh tests.

| Public walkthrough | Pass criteria | Stop condition / record |
| --- | --- | --- |
| Open `https://paid-by-polymarket-os.onrender.com/`. | Market cards load, and the saved-alert badge/status distinguish stored retrieval and alert time from check time; this makes no promise of live worker health. | Stop on a missing state or error; record only counts, status, and UTC, then report the issue. |
| Choose a populated category (Sports was tested), confirm rendered card category labels reflect it, then return to All. | The 2026-10-21 10:14 desktop and 10:29 mobile evidence included Sports and return-to-All; the historical six Sports/six Politics counts are a snapshot, not a future contract. A blank or empty category may legitimately return no results. | Stop on a missing populated-category label, failed return, or error; record only counts, status, and UTC, then report the issue. |
| Select a non-action market-card body, inspect the detail drawer, and close it. | The drawer opens and closes, consistent with the dated desktop/mobile evidence. Do not click **Notify me**, **Preview Trade**, **View on Polymarket**, external links, or controls that submit, trade, or track; do not use forms, wallets, login, submission, notification, or outbound tracking. | Stop if safe non-action selection or close is unavailable, or on error; record only status and UTC, then report the issue. |
| Inspect a saved-alert card. | Neutral **Alert time**/**Latest alert time** and **Last successful check** labels are distinct; do not copy raw alert text. Continuing freshness or protocol behavior cannot be inferred from the public projection alone. | Stop if labels are missing or conflated, or on error; record only counts, status, and UTC, then report the issue. |

Do not improvise fixes or make production changes during this walkthrough.

This is DOM geometry and programmatic-interaction evidence, not physical touch-device testing, complete onboarding, upstream market-classification accuracy, or customer-value proof. Forms, submissions, wallet behavior, orders, paper trading, notifications, outbound tracking, and protected admin behavior were deliberately not tested.

### 5. Runtime and market-read evidence - verified, bounded

The read-only Render inspection around 19:40 UTC on 2026-10-21 recorded:

- the service was not suspended and used one Free compute instance;
- production release `dcd228b05f65704a78ef7e0192400d3c5b583c2c` had finished deploying at 09:14:08.549669 UTC;
- auto-deploy was enabled for commit-triggered deploys from `main`, previews were off, and no HTTP health-check path was configured, so the default was a TCP check;
- a bounded event query for that day returned four successful deploy-ended events and zero server-failed, suspended, or restarted events; and
- 13 five-minute samples from 18:30-19:30 UTC had maximum CPU use of `0.0021041534` cores against a `0.15`-core limit and maximum memory use of `96,796,670` bytes against a `536,870,900`-byte limit. HTTP request-count, latency, and instance-count series were empty.

These observations are neither uptime proof nor an SLO or customer-load test. Low sampled load does not prove pilot capacity.

A single warm public `GET /api/liveMarkets` at 19:41:16 UTC returned HTTP 200, `ok=true`, 200 markets, source `gamma`, refresh time 19:41:08.405 UTC, and 438 ms response time. It is not uptime, cold-start, or market-quality proof. Sanitized assessment SHA-256: `b9ec568f97743a9a6a68155686e26298eb65704793dab8ff31cdc103065a09a1`.

### 6. Scheduled persistence and storage - historical, bounded

The separate hourly snapshot capture ran naturally from 10:03:44 to 10:03:47 UTC and exited successfully. At 10:15:05 UTC, Supabase showed the latest capture at 10:03:45.221 UTC, 75 rows for the 10:00 UTC bucket, and 1,800 rows across 24 hourly buckets in the preceding 24 hours. This establishes recent scheduled persistence, not alert delivery, full market coverage, or data quality.

The local worker database size was 80.56 GB; the host filesystem had 14.26 GB free. Those are different measurements and a capacity finding only. No cleanup or retention change is authorized.

## Remaining customer-pilot gates

Complete the following without rebuilding foundations that already have bounded evidence.

### A. Pilot-required end-user journeys

- Define the exact journeys the five-participant pilot will rely on, then verify the still-unproved portions, including form/write behavior and onboarding.
- Obtain explicit authorization before any form submission, write, notification, outbound tracking action, wallet/order behavior, or paper-trade path. Those actions cannot be completed under the current no-write/no-trading boundary.
- Add physical mobile-device testing only if it is required for admission; the current evidence covers DOM geometry and programmatic interactions, not physical touch behavior.
- Record the result without private submissions, customer data, raw alert text, or claims about classification accuracy or customer value that the evidence does not support.

### B. Release and deployment controls

- At `2026-10-21T19:50:39Z`, read-only GitHub metadata reported `main` at released commit `dcd228b05f65704a78ef7e0192400d3c5b583c2c` with `protected=false`, protection disabled, and an explicit `Branch not protected` response from the protection endpoint. The branch-rules query returned zero applicable rules.
- For that released head, GitHub reported zero commit statuses and zero check runs. The aggregate status state was `pending` only because the aggregate was empty; it is not evidence of running CI. These bounded GitHub observations do not establish whether external CI exists or whether manual review occurs.
- The recorded manual exact-head release-approval history remains evidence distinct from enforced branch controls. Before pilot admission, the owner must decide which enforced and/or manual release controls are acceptable, identify release ownership, assess exact-head review and rollback compatibility, and record the resulting policy. Any branch-setting or workflow change requires separate authorization; none is authorized by this milestone.

Sanitized release-control metadata report SHA-256: `4df33d6ec710ead45fa55ad66b713193b5de0b444d2caed129630ea9a5b20ffd`.

### C. Backup and isolated restore proof

- Backup inventory, ownership, access, encryption/retention/storage decisions, an approved isolated restore target, and an actual restore/recovery exercise remain unverified. Do not assert that backups are globally absent.
- The owner must select target recovery point and recovery time objectives, identify an owned backup and approved isolated target, and provide the access, consent, and data authority needed for a database copy/export/restore.
- Then prove restoration to the isolated target without touching production and record sanitized evidence against those objectives.
- The current no-database-copy/no-export/no-actual-restore boundary prevents that exercise today. Synthetic fixtures and application rollback do not prove production-backup recoverability.

### D. Availability and capacity owner decision

- Keep the existing architecture and Hobby workspace unless an authorized owner decides otherwise. The current service still uses Free compute, which is separate from an always-on commitment.
- Before customer pilot admission, the owner must assess and approve suitable always-on compute, durable storage/backups, and deployment controls. No purchase, migration, or production setting change is authorized by this sheet.
- Render's current [Free service documentation](https://render.com/docs/free) states that Free web services sleep after 15 minutes without inbound traffic, may take about one minute to start, and have ephemeral local filesystems; upgrading a workspace plan does not remove Free-instance limits. Render also distinguishes [On Commit from After CI Checks Pass](https://render.com/docs/deploys), and a blank HTTP path uses the default TCP check described in [health checks](https://render.com/docs/health-checks).
- Assess those constraints against the pilot's required availability and recovery objectives. Do not treat the one warm request, the bounded event query, or low-load samples as a substitute for that decision.

## Operator decision and shortest remaining route

1. Accept the bounded data-path, DOM, desktop/mobile geometry, and runtime observations above as completed evidence; do not recreate them unless the pilot requirement changes or freshness is explicitly required.
2. With the needed authorization, complete only the missing pilot-required end-user journeys and any required physical-device check.
3. Obtain the owner's release-control policy decision, including acceptable enforced/manual controls, exact-head review, and rollback compatibility. Separately inventory an owned backup, approve an isolated restore target and data handling, and perform the authorized recovery exercise against owner-set objectives.
4. Obtain the owner's always-on compute, durable-storage/backups, and deployment-control decision.
5. Only after those gates pass, record explicit customer-pilot admission and then run the existing manual five-participant, seven-day pilot.

The manual pilot remains an **unexecuted plan**, not evidence of recruited participants, completed participation, revenue, profitable demand, or buy-ready demand. Continue observation under the [guarded alert delivery runbook](guarded-alert-delivery-runbook.md), using aggregate UTC timestamps, counts, and verification hashes. Keep secret values, private physical paths, host addresses, process IDs, account or service identifiers, database project references, private report dumps, raw alert text, and customer data out of tracked documentation.
