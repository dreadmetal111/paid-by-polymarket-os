# Pilot Readiness Gate — 2026-10-21

## Current status

| Gate | Status | Meaning |
| --- | --- | --- |
| Deployment and activation | **Complete** | The reviewed receiver and worker changes are deployed, and both V2 activation flags are on. |
| Fresh natural V2 durable delivery | **Pending** | Post-activation cycles have been quiet. No genuinely new natural V2 alert has yet supplied the end-to-end receipt, durable Supabase row, and dashboard proof. |
| Customer pilot | **Not cleared** | Customer participation is a separate gate. Do not recruit or onboard pilot users from the deployment status alone. |

This is the current operator gate sheet. The [public beta launch checklist](public-beta-launch-checklist.md) and [admin operations checklist](admin-ops-checklist.md) retain useful historical evidence and routines, but their earlier `Go`, QA, count, and milestone statements are not current pilot clearance.

## Evidence recorded by Commander

The following facts were supplied by Commander. This documentation correction did not rerun application, worker, deployment, Supabase, or browser tests.

### 1. Deployment and activation — complete

- PR [#5](https://github.com/dreadmetal111/paid-by-polymarket-os/pull/5) was merged from approved source head `5848e3b1e1f7e065b0f05f874fa6a634fe20b794` as squash commit `3566029d4eca30e4fc15c03e0283461f63388665`. PR [#6](https://github.com/dreadmetal111/paid-by-polymarket-os/pull/6) was merged from approved source head `2cb4c497baf1a3108f4d650f6b704e1e30249ca9` as squash/current-main commit `dcd228b05f65704a78ef7e0192400d3c5b583c2c`.
- The receiver deployment was live with the saved `PBP_ALERT_INGEST_V2_ENABLED=true` setting.
- The worker matched reviewed SHA-256 `dd25f1f12ba622710eb1eb44e5a94cb5f2b5c00b1f783725625d18920ca2f8b5` and had `PBP_ALERT_DELIVERY_V2_ENABLED=true` from 09:53:18 UTC.
- Before release, the native Node suite passed 130 tests and received independent review. A natural cycle with the worker flag off also passed. These are pre-release/historical evidence, not tests performed for this documentation update.

### 2. Fresh natural V2 durable delivery — pending

- Six post-activation background cycles through 10:11:06 UTC succeeded while processing 200 markets, with no errors and no alerts.
- At that observation, local delivery metadata had 0 V2 records, and metadata for 842 historical failed records was unchanged.
- The 10:11:09 UTC Supabase aggregate was 1,134 total alert rows and 0 V2 rows.
- Public GET checks recorded at 09:56:06 UTC returned HTTP 200 for `/`, `/app.js`, `/api/liveMarkets`, and `/api/alerts/recent`.
- The served frontend matched reviewed SHA-256 `41c9f4c6afa0e010a8bf278d73e24168bcbd4fe6ca4441cd0a3bce9e28805957`. The public recent-alert response contained five stored alerts using the five-field public shape.
- Those results show availability and a reviewed frontend, but **do not prove an actual protected V2 ingest or durable V2 delivery**.
- The separate hourly snapshot capture ran naturally from 10:03:44 to 10:03:47 UTC and exited successfully. At 10:15:05 UTC, Supabase showed the latest capture at 10:03:45.221 UTC, 75 rows for the 10:00 UTC bucket, and 1,800 rows across 24 hourly buckets in the preceding 24 hours. This establishes recent scheduled persistence, not full market coverage, data quality, or V2 alert delivery.

The delivery gate closes only after one genuinely new, naturally triggered V2 alert provides all of the following:

- a V2 delivery receipt from the normal background worker path;
- exactly one corresponding durable Supabase row; and
- the corresponding saved alert visible on the dashboard through the public projection.

Wait through normal quiet cycles. Do not create proof with manual cycles, synthetic published signals, backlog replay, or detection-threshold loosening.

### 3. Customer pilot — not cleared

After the fresh natural V2 delivery gate closes, clear the customer pilot separately. Reverify any journey that the pilot will rely on, including forms and mobile behavior. The recorded checks do not cover complete onboarding, form submissions, mobile usability, filtering accuracy, or customer value.

A bounded live read-only discovery journey passed at 10:14 UTC: load the homepage, select Sports, return to All, open a visible market detail drawer, and close it. All nine network requests were GET; no writes were attempted or allowed. This is interaction evidence only, not full customer-pilot clearance.

Assessments of backups, recovery, deployment controls, availability, and compute capacity remain pending. The workspace remains on Hobby with Free compute; no purchase or migration is authorized or implied. The local worker database was 80.56 GB, with 14.26 GB free on the host filesystem. This is a capacity finding only. It does not authorize storage cleanup or a retention change.

The existing manual five-participant, seven-day pilot remains a **plan**. It is not evidence of recruited users, completed participation, revenue, profitable demand, or buy-ready demand.

## Operator decision

- Continue normal observation under the [guarded alert delivery runbook](guarded-alert-delivery-runbook.md).
- Keep the customer pilot closed until both the natural V2 proof gate and the separate customer-pilot checks above are complete.
- Record future proof with approved aggregate UTC timestamps, counts, and verification hashes. Keep secret values, private physical paths, host addresses, process IDs, account identifiers, database project references, private report dumps, and customer data out of tracked documentation.
