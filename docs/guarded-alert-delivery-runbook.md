# Guarded Alert Delivery V2 Runbook

This change adds bounded retry only for genuine alerts created after worker-side
activation. It does not change detection thresholds, quality filtering,
cooldowns, first-run baseline behavior, Discord delivery, or the public alert
shape. Historical failed alerts must never be reset, enrolled, or replayed. The
recorded pre-activation worker baseline stays in the private operator receipt; historical failed rows
must retain NULL V2 identity fields and remain unenrolled.

## Defaults and invariants

- Render admission: `PBP_ALERT_INGEST_V2_ENABLED=false` by default.
- Acer enrollment: `PBP_ALERT_DELIVERY_V2_ENABLED=false` by default.
- Default lifetime: 900 seconds from the original source event time.
- Default attempt cap: 5.
- Default retry schedule: 30, 60, 120, 240, then at most 300 seconds.
- Per-cycle public-delivery budget: 5 by default and hard-capped at 50.
- Each receiver storage request, including its response body read, has a
  five-second deadline (hard-capped at ten seconds internally).
- HTTP 408, 429, 5xx, transport ambiguity, and invalid/missing success
  acknowledgements are retryable. Other 4xx responses are permanent.
- Every retry reuses the persisted event ID, source time, expiry, canonical
  payload, and fingerprint. Attempt state is committed before network I/O.
- Canonical V2 `marketQuestion` and `reason` text uses the existing public-feed
  limits of 280 and 400 UTF-16 code units. Truncation reserves three code units
  for the ASCII `...` suffix and keeps only complete Unicode scalars, so stored
  V2 text is already safe for the unchanged legacy public projection.
- Supabase's full nullable unique index is the durable concurrency/redeploy
  boundary. PostgreSQL still permits multiple legacy `NULL` values. The receiver
  uses `on_conflict=event_id` with `resolution=ignore-duplicates`; it never
  merges or updates a stored payload. An ignored insert is acknowledged only
  after a bounded lookup confirms the complete stored public payload, protocol, source/expiry times, event ID, and fingerprint.
- V2 never falls back to legacy JSON/file storage when Supabase or its new schema
  is unavailable. Public recent-alert rows still contain only the existing five
  public fields, with `createdAt` sourced from the original event time.

## Receiver-first release

1. Keep both activation flags `false`. Back up and record the current Render and
   Acer configuration without copying secret values into tickets or logs.
2. Review and run `docs/alert-delivery-v2-supabase.sql` in the existing Supabase
   project. Do not modify existing rows. Verify all five nullable columns (`event_id`, `source_event_at`, `expires_at`, `payload_fingerprint`, `protocol_version`) and
   `alert_signals_event_id_full_uidx` exists as a full (non-partial) unique index;
   confirm legacy row counts and values are unchanged. Before receiver admission,
   exercise a transaction-scoped test insert using the `event_id` conflict target
   and roll it back. A `42P10` or schema-cache error means the receiver must stay
   disabled until the index/schema is corrected.
3. Deploy the Render receiver code with `PBP_ALERT_INGEST_V2_ENABLED=false`.
   Confirm existing legacy ingest and `GET /api/alerts/recent` remain healthy.
4. Set only Render `PBP_ALERT_INGEST_V2_ENABLED=true` and redeploy Render. Confirm
   its Supabase URL, service-role key, alert table, and ingest secret are present.
   If the schema is missing, V2 must return `schema_unavailable` and must not use
   legacy/file storage.
5. Install the reviewed worker script in the existing Acer installation; both tracked source copies must match. Leave the
   worker flag off for one normal cycle and confirm snapshot detection, Discord,
   health endpoints, and legacy bridge behavior are unchanged.
6. Set Acer `PBP_ALERT_DELIVERY_V2_ENABLED=true` and restart only the alert worker.
   Do not run a manual worker cycle or replay any row. The next natural cycle may
   enroll only newly generated alerts.
7. Observe at least one natural cycle. Check only aggregate/state metadata: new
   V2 rows should move through `pending`, `retry_wait`, or `sent`; attempt counts
   must not exceed the configured cap; expired rows must not send. Never log or
   expose bearer secrets, HTTP bodies, event IDs, or fingerprints publicly.

## Rollback

1. Set Acer `PBP_ALERT_DELIVERY_V2_ENABLED=false` first and restart only the alert
   worker. This stops new V2 enrollment and pauses unsent V2 rows without making
   any legacy failed row eligible.
2. Leave the Render receiver admitted for at least the 15-minute maximum lifetime
   so any already in-flight request can be deduplicated safely. Do not clear
   `render_status`, attempt counters, IDs, timestamps, or fingerprints.
3. After the lifetime has elapsed, set Render
   `PBP_ALERT_INGEST_V2_ENABLED=false` and redeploy Render if receiver rollback is
   required. Legacy ingest remains available.
4. Revert application/worker source only through the normal reviewed deployment
   process. Keep the additive nullable columns and unique index in place; dropping
   them is unnecessary and would remove the durable deduplication record.
5. If reactivation is later approved, repeat the receiver-first order. Existing
   expired/exhausted/permanent V2 rows stay terminal; do not backfill or replay
   them.

## Review queries (read-only examples)

Use aggregate queries only and keep results out of public logs:

```sql
select protocol_version, count(*)
from public.alert_signals
group by protocol_version
order by protocol_version nulls first;

select count(*) as duplicate_event_ids
from (
  select event_id
  from public.alert_signals
  where event_id is not null
  group by event_id
  having count(*) > 1
) duplicates;

select
  index_class.relname as index_name,
  indexes.indisunique,
  indexes.indpred is null as is_full_index,
  pg_get_indexdef(indexes.indexrelid) as index_definition
from pg_index indexes
join pg_class index_class on index_class.oid = indexes.indexrelid
join pg_namespace index_namespace on index_namespace.oid = index_class.relnamespace
where indexes.indrelid = 'public.alert_signals'::regclass
  and index_namespace.nspname = 'public'
  and index_class.relname = 'alert_signals_event_id_full_uidx';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.alert_signals'::regclass
  and conname = 'alert_signals_v2_columns_check';
```
