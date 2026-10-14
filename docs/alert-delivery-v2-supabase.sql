-- Additive durable identity for guarded alert delivery V2.
-- Run manually against the existing public.alert_signals table only after review.
-- Existing legacy rows remain NULL and are not enrolled or replayed.

begin;

alter table public.alert_signals
  add column if not exists event_id text,
  add column if not exists source_event_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists payload_fingerprint text,
  add column if not exists protocol_version smallint;

create unique index if not exists alert_signals_event_id_full_uidx
  on public.alert_signals (event_id);

create index if not exists alert_signals_source_event_at_idx
  on public.alert_signals (source_event_at desc)
  where source_event_at is not null;

alter table public.alert_signals
  drop constraint if exists alert_signals_v2_columns_check;

alter table public.alert_signals
  add constraint alert_signals_v2_columns_check check (
    (
      protocol_version is null
      and event_id is null
      and source_event_at is null
      and expires_at is null
      and payload_fingerprint is null
    )
    or
    (
      protocol_version is not null
      and protocol_version = 2
      and event_id is not null
      and event_id ~ '^pbp_[0-9a-f]{40}$'
      and source_event_at is not null
      and expires_at is not null
      and expires_at > source_event_at
      and expires_at <= source_event_at + interval '15 minutes'
      and payload_fingerprint is not null
      and payload_fingerprint ~ '^[0-9a-f]{64}$'
      and created_at = source_event_at
    )
  );

comment on column public.alert_signals.event_id is
  'Nullable stable V2 delivery identity; NULL for legacy alert rows.';
comment on column public.alert_signals.source_event_at is
  'Original V2 source event time; public freshness must use this value.';
comment on column public.alert_signals.expires_at is
  'Original V2 delivery expiry; NULL for legacy alert rows.';
comment on column public.alert_signals.payload_fingerprint is
  'SHA-256 of the canonical V2 payload bound to event_id.';
comment on column public.alert_signals.protocol_version is
  'Guarded ingest protocol version; NULL preserves legacy rows.';

commit;
