-- House of Markets durable hourly market snapshot history.
-- The Render backend writes through the Supabase service role.
-- Browser clients do not receive direct table access.

create table if not exists public.market_snapshots (
  market_id text not null,
  market_question text not null,
  event_title text,
  category text,
  yes_probability numeric(7,4),
  movement numeric(12,4),
  volume numeric(24,4),
  liquidity numeric(24,4),
  source text not null default 'gamma',
  snapshot_hour timestamptz not null,
  captured_at timestamptz not null default now(),

  constraint market_snapshots_pkey
    primary key (market_id, snapshot_hour),
  constraint market_snapshots_yes_probability_check
    check (yes_probability is null or (yes_probability >= 0 and yes_probability <= 100)),
  constraint market_snapshots_volume_check
    check (volume is null or volume >= 0),
  constraint market_snapshots_liquidity_check
    check (liquidity is null or liquidity >= 0)
);

create index if not exists market_snapshots_market_history_idx
  on public.market_snapshots (market_id, snapshot_hour desc);

create index if not exists market_snapshots_snapshot_hour_idx
  on public.market_snapshots (snapshot_hour desc);

create index if not exists market_snapshots_captured_at_idx
  on public.market_snapshots (captured_at desc);

alter table public.market_snapshots enable row level security;

revoke all on table public.market_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.market_snapshots to service_role;

comment on table public.market_snapshots is
  'Durable hourly House of Markets snapshots keyed by market and UTC snapshot hour.';
