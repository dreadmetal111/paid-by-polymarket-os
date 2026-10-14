#!/usr/bin/env python3
"""
Paid by Polymarket Alert Worker.

This service fetches the public Paid by Polymarket live markets API, stores
market snapshots in SQLite, compares the latest snapshot with prior snapshots,
creates alert records, optionally sends those alerts to Discord, and exposes
small local Flask endpoints for status and recent alerts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import signal
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request


SERVICE_NAME = "pbp-alert-worker"
DEFAULT_MARKETS_URL = "https://paid-by-polymarket-os.onrender.com/api/liveMarkets"
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = BASE_DIR / "alert-worker.env"
RENDER_DELIVERY_SCHEMA_VERSION = 2
RENDER_EVENT_ID_PATTERN = re.compile(r"^pbp_[a-f0-9]{40}$")
RENDER_FINGERPRINT_PATTERN = re.compile(r"^[a-f0-9]{64}$")
STRICT_UTC_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$")
ECMASCRIPT_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003"
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
ECMASCRIPT_WHITESPACE_PATTERN = re.compile(f"[{re.escape(ECMASCRIPT_WHITESPACE)}]+")


def load_env_file() -> Path:
    env_path = Path(os.environ.get("PBP_ENV_FILE", str(DEFAULT_ENV_FILE))).expanduser()
    if env_path.exists():
        load_dotenv(env_path, override=False)
    return env_path


ENV_FILE = load_env_file()


def utc_datetime_now() -> datetime:
    return datetime.now(timezone.utc)


def format_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_now() -> str:
    return format_utc(utc_datetime_now())


def utc_minutes_ago(minutes: int) -> str:
    value = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip()


def env_int(name: str, default: int) -> int:
    value = env_str(name, "")
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        logging.warning("Invalid integer for %s; using %s", name, default)
        return default


def env_float(name: str, default: float) -> float:
    value = env_str(name, "")
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        logging.warning("Invalid number for %s; using %s", name, default)
        return default


def env_int_any(names: tuple[str, ...], default: int) -> int:
    for name in names:
        value = env_str(name, "")
        if not value:
            continue
        try:
            return int(value)
        except ValueError:
            logging.warning("Invalid integer for %s; using %s", name, default)
            return default
    return default


def env_float_any(names: tuple[str, ...], default: float) -> float:
    for name in names:
        value = env_str(name, "")
        if not value:
            continue
        try:
            return float(value)
        except ValueError:
            logging.warning("Invalid number for %s; using %s", name, default)
            return default
    return default


def env_bool(name: str, default: bool) -> bool:
    value = env_str(name, "")
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "y", "on"}


def env_path(name: str, default: str) -> Path:
    value = env_str(name, default)
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return BASE_DIR / path


@dataclass(frozen=True)
class Settings:
    markets_url: str
    db_path: Path
    host: str
    port: int
    fetch_interval_seconds: int
    request_timeout_seconds: int
    discord_webhook_url: str
    discord_enabled: bool
    discord_username: str
    discord_avatar_url: str
    max_discord_alerts_per_cycle: int
    max_public_alerts_per_cycle: int
    render_alert_ingest_url: str
    alert_ingest_secret: str
    public_alert_retry_enabled: bool
    public_alert_retry_max_attempts: int
    public_alert_retry_ttl_seconds: int
    public_alert_retry_initial_backoff_seconds: int
    public_alert_retry_max_backoff_seconds: int
    public_alert_retry_future_skew_seconds: int
    alert_cooldown_minutes: int
    alert_on_first_run: bool
    alert_min_volume: float
    alert_min_liquidity: float
    min_new_market_volume_24h: float
    probability_move_points: float
    volume_spike_multiplier: float
    volume_spike_min_change: float
    liquidity_spike_multiplier: float
    liquidity_spike_min_change: float
    log_level: str


def build_settings() -> Settings:
    return Settings(
        markets_url=env_str("PBP_MARKETS_URL", DEFAULT_MARKETS_URL),
        db_path=env_path("PBP_DATABASE_PATH", "pbp-alert-worker.sqlite3"),
        host=env_str("PBP_HOST", "0.0.0.0"),
        port=env_int("PBP_PORT", 5090),
        fetch_interval_seconds=max(30, env_int("PBP_FETCH_INTERVAL_SECONDS", 180)),
        request_timeout_seconds=max(5, env_int("PBP_REQUEST_TIMEOUT_SECONDS", 20)),
        discord_webhook_url=env_str("DISCORD_WEBHOOK_URL", ""),
        discord_enabled=env_bool("PBP_DISCORD_ENABLED", True),
        discord_username=env_str("PBP_DISCORD_USERNAME", "PBP Alerts"),
        discord_avatar_url=env_str("PBP_DISCORD_AVATAR_URL", ""),
        max_discord_alerts_per_cycle=max(1, env_int("PBP_MAX_DISCORD_ALERTS_PER_CYCLE", 10)),
        max_public_alerts_per_cycle=min(
            50, max(1, env_int("PBP_ALERT_MAX_PUBLIC_ALERTS_PER_CYCLE", 5))
        ),
        render_alert_ingest_url=env_str("PBP_RENDER_ALERT_INGEST_URL", ""),
        alert_ingest_secret=env_str("PBP_ALERT_INGEST_SECRET", ""),
        public_alert_retry_enabled=env_bool("PBP_ALERT_DELIVERY_V2_ENABLED", False),
        public_alert_retry_max_attempts=min(
            10, max(1, env_int("PBP_ALERT_RETRY_MAX_ATTEMPTS", 5))
        ),
        public_alert_retry_ttl_seconds=min(
            900, max(60, env_int("PBP_ALERT_RETRY_TTL_SECONDS", 900))
        ),
        public_alert_retry_initial_backoff_seconds=min(
            300, max(5, env_int("PBP_ALERT_RETRY_INITIAL_BACKOFF_SECONDS", 30))
        ),
        public_alert_retry_max_backoff_seconds=min(
            300, max(5, env_int("PBP_ALERT_RETRY_MAX_BACKOFF_SECONDS", 300))
        ),
        public_alert_retry_future_skew_seconds=min(
            60, max(0, env_int("PBP_ALERT_RETRY_FUTURE_SKEW_SECONDS", 60))
        ),
        alert_cooldown_minutes=max(
            1,
            env_int_any(("PBP_ALERT_MARKET_COOLDOWN_MINUTES", "PBP_ALERT_COOLDOWN_MINUTES"), 60),
        ),
        alert_on_first_run=env_bool("PBP_ALERT_ON_FIRST_RUN", False),
        alert_min_volume=max(0.0, env_float("PBP_ALERT_MIN_VOLUME", 50000.0)),
        alert_min_liquidity=max(0.0, env_float("PBP_ALERT_MIN_LIQUIDITY", 10000.0)),
        min_new_market_volume_24h=max(0.0, env_float("PBP_MIN_NEW_MARKET_VOLUME_24H", 100000.0)),
        probability_move_points=max(
            0.1,
            env_float_any(("PBP_ALERT_MIN_PROB_MOVE_PCT", "PBP_PROBABILITY_MOVE_POINTS"), 5.0),
        ),
        volume_spike_multiplier=max(1.0, env_float("PBP_VOLUME_SPIKE_MULTIPLIER", 2.0)),
        volume_spike_min_change=max(0.0, env_float("PBP_VOLUME_SPIKE_MIN_CHANGE", 25000.0)),
        liquidity_spike_multiplier=max(1.0, env_float("PBP_LIQUIDITY_SPIKE_MULTIPLIER", 1.5)),
        liquidity_spike_min_change=max(0.0, env_float("PBP_LIQUIDITY_SPIKE_MIN_CHANGE", 25000.0)),
        log_level=env_str("PBP_LOG_LEVEL", "INFO").upper(),
    )


SETTINGS = build_settings()


def configure_logging(settings: Settings) -> None:
    level = getattr(logging, settings.log_level, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
    logging.Formatter.converter = time.gmtime


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clean_string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def first_value(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return None


def to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number else None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        multiplier = 1.0
        if text.endswith("%"):
            multiplier = 0.01
            text = text[:-1]
        text = text.replace("$", "").replace(",", "").strip()
        try:
            return float(text) * multiplier
        except ValueError:
            return None
    return None


def normalize_probability(value: Any) -> float | None:
    number = to_float(value)
    if number is None:
        return None
    if abs(number) > 1.5 and abs(number) <= 100:
        number = number / 100
    return round(clamp(number, 0.0, 1.0), 4)


def first_number(mapping: dict[str, Any], *keys: str, default: float = 0.0) -> float:
    value = first_value(mapping, *keys)
    number = to_float(value)
    return number if number is not None else default


def first_probability(mapping: dict[str, Any], *keys: str) -> float | None:
    value = first_value(mapping, *keys)
    return normalize_probability(value)


def parse_jsonish_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return [part.strip() for part in text.split(",") if part.strip()]
    return []


def market_url_from(raw: dict[str, Any], slug: str, market_id: str) -> str:
    direct_url = clean_string(first_value(raw, "url", "marketUrl", "link"))
    if direct_url:
        return direct_url
    event_slug = ""
    events = raw.get("events")
    if isinstance(events, list) and events and isinstance(events[0], dict):
        event_slug = clean_string(events[0].get("slug"))
    slug_value = event_slug or slug or market_id
    if slug_value:
        return f"https://polymarket.com/event/{slug_value}"
    return "https://polymarket.com/"


def infer_outcome_prices(raw: dict[str, Any]) -> tuple[float | None, float | None]:
    outcomes = [clean_string(item).lower() for item in parse_jsonish_list(raw.get("outcomes"))]
    prices = [normalize_probability(item) for item in parse_jsonish_list(raw.get("outcomePrices"))]
    yes_price = None
    no_price = None

    if prices:
        yes_index = outcomes.index("yes") if "yes" in outcomes else 0
        if 0 <= yes_index < len(prices):
            yes_price = prices[yes_index]

        if "no" in outcomes:
            no_index = outcomes.index("no")
            if 0 <= no_index < len(prices):
                no_price = prices[no_index]
        elif len(prices) > 1:
            no_price = prices[1]

    return yes_price, no_price


def stable_market_id(question: str, url: str, slug: str) -> str:
    source = f"{question}|{url}|{slug}".encode("utf-8")
    return hashlib.sha256(source).hexdigest()[:24]


def normalize_market(raw: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    question = clean_string(
        first_value(raw, "question", "title", "name"),
        "Untitled market",
    )
    slug = clean_string(first_value(raw, "slug", "eventSlug"))
    market_id = clean_string(first_value(raw, "id", "marketId", "conditionId", "condition_id", "clobTokenId"))
    url = market_url_from(raw, slug, market_id)
    if not market_id:
        market_id = stable_market_id(question, url, slug)

    inferred_yes, inferred_no = infer_outcome_prices(raw)
    yes_price = first_probability(raw, "yesPriceLive", "yesPrice", "midpoint", "lastTradePrice")
    no_price = first_probability(raw, "noPriceLive", "noPrice")
    if yes_price is None:
        yes_price = inferred_yes
    if no_price is None:
        no_price = inferred_no
    if no_price is None and yes_price is not None:
        no_price = round(clamp(1.0 - yes_price, 0.0, 1.0), 4)
    if yes_price is None and no_price is not None:
        yes_price = round(clamp(1.0 - no_price, 0.0, 1.0), 4)

    return {
        "market_id": market_id,
        "question": question,
        "slug": slug,
        "url": url,
        "category": clean_string(first_value(raw, "category", "categoryName"), "Unknown"),
        "yes_price": yes_price,
        "no_price": no_price,
        "volume": max(0.0, first_number(raw, "volume", "volumeNum", "volumeClob")),
        "volume24hr": max(0.0, first_number(raw, "volume24hr", "volume24hrClob")),
        "liquidity": max(0.0, first_number(raw, "liquidity", "liquidityNum", "liquidityClob")),
        "last_updated": clean_string(first_value(raw, "lastUpdated", "updatedAt", "createdAt")),
        "raw": raw,
    }


def json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def connect_db(settings: Settings) -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def db_connection(settings: Settings) -> Any:
    conn = connect_db(settings)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(settings: Settings) -> None:
    with db_connection(settings) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fetched_at TEXT NOT NULL,
                source_url TEXT NOT NULL,
                market_count INTEGER NOT NULL,
                raw_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS market_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
                market_id TEXT NOT NULL,
                question TEXT NOT NULL,
                slug TEXT,
                url TEXT,
                category TEXT,
                yes_price REAL,
                no_price REAL,
                volume REAL NOT NULL DEFAULT 0,
                volume24hr REAL NOT NULL DEFAULT 0,
                liquidity REAL NOT NULL DEFAULT 0,
                last_updated TEXT,
                raw_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_snapshot
                ON market_snapshots (market_id, snapshot_id);

            CREATE INDEX IF NOT EXISTS idx_market_snapshots_snapshot_id
                ON market_snapshots (snapshot_id);

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_key TEXT NOT NULL UNIQUE,
                alert_type TEXT NOT NULL,
                market_id TEXT NOT NULL,
                question TEXT NOT NULL,
                url TEXT,
                severity TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                quality_score REAL,
                quality_label TEXT NOT NULL DEFAULT 'medium',
                suppressed_reason TEXT,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                sent_to_discord INTEGER NOT NULL DEFAULT 0,
                sent_at TEXT,
                discord_error TEXT,
                sent_to_render INTEGER NOT NULL DEFAULT 0,
                render_sent_at TEXT,
                render_status TEXT,
                render_protocol_version INTEGER,
                render_event_id TEXT,
                render_payload_fingerprint TEXT,
                render_source_event_at TEXT,
                render_expires_at TEXT,
                render_attempt_count INTEGER NOT NULL DEFAULT 0,
                render_last_attempt_at TEXT,
                render_next_attempt_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_created_at
                ON alerts (created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_alerts_type_market_created
                ON alerts (alert_type, market_id, created_at DESC);
            """
        )
        ensure_alert_render_columns(conn)
        ensure_alert_quality_columns(conn)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_alerts_render_pending
                ON alerts (sent_to_render, render_status, created_at)
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_render_event_id
                ON alerts (render_event_id)
                WHERE render_event_id IS NOT NULL
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_alerts_render_v2_due
                ON alerts (render_protocol_version, sent_to_render, render_next_attempt_at, created_at)
            """
        )


def sqlite_column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)


def ensure_sqlite_column(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    if sqlite_column_exists(conn, table_name, column_name):
        return
    conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


def ensure_alert_render_columns(conn: sqlite3.Connection) -> None:
    ensure_sqlite_column(conn, "alerts", "sent_to_render", "INTEGER NOT NULL DEFAULT 0")
    ensure_sqlite_column(conn, "alerts", "render_sent_at", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_status", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_protocol_version", "INTEGER")
    ensure_sqlite_column(conn, "alerts", "render_event_id", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_payload_fingerprint", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_source_event_at", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_expires_at", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_attempt_count", "INTEGER NOT NULL DEFAULT 0")
    ensure_sqlite_column(conn, "alerts", "render_last_attempt_at", "TEXT")
    ensure_sqlite_column(conn, "alerts", "render_next_attempt_at", "TEXT")


def ensure_alert_quality_columns(conn: sqlite3.Connection) -> None:
    ensure_sqlite_column(conn, "alerts", "quality_score", "REAL")
    ensure_sqlite_column(conn, "alerts", "quality_label", "TEXT NOT NULL DEFAULT 'medium'")
    ensure_sqlite_column(conn, "alerts", "suppressed_reason", "TEXT")


def fetch_live_markets(settings: Settings) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    headers = {
        "Accept": "application/json",
        "User-Agent": f"{SERVICE_NAME}/1.0",
    }
    response = requests.get(
        settings.markets_url,
        headers=headers,
        timeout=settings.request_timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()

    if isinstance(payload, dict):
        raw_markets = payload.get("markets", [])
    elif isinstance(payload, list):
        raw_markets = payload
        payload = {"ok": True, "markets": raw_markets}
    else:
        raise ValueError("liveMarkets returned an unsupported JSON shape")

    if not isinstance(raw_markets, list):
        raise ValueError("liveMarkets payload does not contain a markets list")

    markets = []
    for raw_market in raw_markets:
        market = normalize_market(raw_market)
        if market and market["market_id"] and market["question"]:
            markets.append(market)

    return payload, markets


def save_snapshot(
    conn: sqlite3.Connection,
    settings: Settings,
    payload: dict[str, Any],
    markets: list[dict[str, Any]],
) -> int:
    fetched_at = utc_now()
    cursor = conn.execute(
        """
        INSERT INTO snapshots (fetched_at, source_url, market_count, raw_json)
        VALUES (?, ?, ?, ?)
        """,
        (fetched_at, settings.markets_url, len(markets), json_dumps(payload)),
    )
    snapshot_id = int(cursor.lastrowid)

    for market in markets:
        conn.execute(
            """
            INSERT INTO market_snapshots (
                snapshot_id, market_id, question, slug, url, category,
                yes_price, no_price, volume, volume24hr, liquidity,
                last_updated, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot_id,
                market["market_id"],
                market["question"],
                market["slug"],
                market["url"],
                market["category"],
                market["yes_price"],
                market["no_price"],
                market["volume"],
                market["volume24hr"],
                market["liquidity"],
                market["last_updated"],
                json_dumps(market["raw"]),
            ),
        )

    return snapshot_id


def get_previous_market_snapshot(
    conn: sqlite3.Connection,
    market_id: str,
    snapshot_id: int,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT *
        FROM market_snapshots
        WHERE market_id = ?
          AND snapshot_id < ?
        ORDER BY snapshot_id DESC
        LIMIT 1
        """,
        (market_id, snapshot_id),
    ).fetchone()


def prior_snapshots_exist(conn: sqlite3.Connection, snapshot_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM snapshots WHERE id < ? LIMIT 1",
        (snapshot_id,),
    ).fetchone()
    return row is not None


def recent_alert_exists(
    conn: sqlite3.Connection,
    alert_type: str,
    market_id: str,
    cooldown_minutes: int,
) -> bool:
    cutoff = utc_minutes_ago(cooldown_minutes)
    row = conn.execute(
        """
        SELECT 1
        FROM alerts
        WHERE alert_type = ?
          AND market_id = ?
          AND created_at >= ?
        LIMIT 1
        """,
        (alert_type, market_id, cutoff),
    ).fetchone()
    return row is not None


def money(value: float | int | None) -> str:
    number = float(value or 0)
    if number >= 1_000_000:
        return f"${number / 1_000_000:.1f}M"
    if number >= 1_000:
        return f"${number / 1_000:.1f}K"
    return f"${number:,.0f}"


def probability(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def points(value: float) -> str:
    return f"{value * 100:+.1f} pts"


def point_count(value: float) -> str:
    return f"{abs(value) * 100:.1f}-point"


def join_reason_parts(parts: list[str]) -> str:
    safe_parts = [part for part in parts if part]
    if not safe_parts:
        return ""
    if len(safe_parts) == 1:
        return safe_parts[0]
    return "; ".join(safe_parts)


def build_new_high_volume_reason(active_volume: float, current_liquidity: float) -> str:
    return (
        f"This market crossed the high-volume threshold with {money(active_volume)} "
        f"in volume and {money(current_liquidity)} in liquidity."
    )


def build_probability_movement_reason(
    previous_price: float,
    current_price: float,
    delta: float,
    activity_context: str,
) -> str:
    return (
        f"Probability moved from {probability(previous_price)} to {probability(current_price)}, "
        f"a {point_count(delta)} shift since the last snapshot while {activity_context}."
    )


def build_volume_liquidity_spike_reason(
    volume_spike: bool,
    liquidity_spike: bool,
    previous_volume: float,
    current_volume: float,
    previous_liquidity: float,
    current_liquidity: float,
) -> str:
    parts = []
    if volume_spike:
        parts.append(
            f"Volume jumped from {money(previous_volume)} to {money(current_volume)}"
        )
    if liquidity_spike:
        parts.append(
            f"liquidity rose from {money(previous_liquidity)} to {money(current_liquidity)}"
        )

    return f"{join_reason_parts(parts)}, signaling a sharp increase in market activity."


def severity_for_volume(volume24hr: float) -> str:
    if volume24hr >= 500_000:
        return "high"
    if volume24hr >= 100_000:
        return "medium"
    return "low"


def severity_for_probability_move(abs_delta: float) -> str:
    if abs_delta >= 0.12:
        return "high"
    if abs_delta >= 0.08:
        return "medium"
    return "low"


def quality_from_score(score: float) -> tuple[float, str]:
    safe_score = round(clamp(score, 0.0, 100.0), 1)
    if safe_score >= 80:
        return safe_score, "high"
    if safe_score >= 50:
        return safe_score, "medium"
    return safe_score, "low"


def active_market_volume(market: sqlite3.Row) -> float:
    return float(market["volume24hr"] or market["volume"] or 0)


def quality_for_new_high_volume(
    settings: Settings,
    active_volume: float,
    current_liquidity: float,
) -> tuple[float, str]:
    score = 35.0
    if active_volume >= settings.min_new_market_volume_24h:
        score += 25.0
    if active_volume >= 500_000:
        score += 25.0
    elif active_volume >= 250_000:
        score += 12.0
    if current_liquidity >= settings.alert_min_liquidity:
        score += 15.0
    return quality_from_score(score)


def probability_movement_passes_quality_gate(
    settings: Settings,
    abs_delta: float,
    current_volume: float,
    current_liquidity: float,
) -> bool:
    threshold = max(settings.probability_move_points / 100, 0.001)
    has_volume = current_volume >= settings.alert_min_volume
    has_liquidity = current_liquidity >= settings.alert_min_liquidity
    clearly_sharp_move = abs_delta >= max(threshold * 2, 0.12)
    return (has_volume and has_liquidity) or (clearly_sharp_move and (has_volume or has_liquidity))


def quality_for_probability_movement(
    settings: Settings,
    abs_delta: float,
    current_volume: float,
    current_liquidity: float,
) -> tuple[float, str]:
    threshold = max(settings.probability_move_points / 100, 0.001)
    score = 15.0 + min(30.0, (abs_delta / threshold) * 12.0)
    if current_volume >= settings.alert_min_volume:
        score += 25.0
    elif current_volume >= settings.alert_min_volume * 0.5:
        score += 10.0
    if current_liquidity >= settings.alert_min_liquidity:
        score += 20.0
    elif current_liquidity >= settings.alert_min_liquidity * 0.5:
        score += 8.0
    return quality_from_score(score)


def quality_for_volume_liquidity_spike(
    settings: Settings,
    volume_spike: bool,
    liquidity_spike: bool,
    current_volume: float,
    previous_volume: float,
    current_liquidity: float,
    previous_liquidity: float,
) -> tuple[float, str]:
    score = 35.0
    volume_change = max(0.0, current_volume - previous_volume)
    liquidity_change = max(0.0, current_liquidity - previous_liquidity)

    if volume_spike:
        score += 25.0
        if current_volume >= settings.alert_min_volume:
            score += 10.0
        if volume_change >= settings.volume_spike_min_change * 2:
            score += 10.0

    if liquidity_spike:
        score += 20.0
        if current_liquidity >= settings.alert_min_liquidity:
            score += 10.0
        if liquidity_change >= settings.liquidity_spike_min_change * 2:
            score += 5.0

    return quality_from_score(score)


def quality_is_dispatchable(label: Any) -> bool:
    return clean_string(label, "medium").lower() in {"medium", "high"}


def spike_detected(current: float, previous: float, multiplier: float, min_change: float) -> bool:
    if current <= 0:
        return False
    change = current - previous
    if change < min_change:
        return False
    if previous <= 0:
        return current >= min_change
    return current >= previous * multiplier


def insert_alert(
    conn: sqlite3.Connection,
    settings: Settings,
    alert_key: str,
    alert_type: str,
    market: sqlite3.Row,
    severity: str,
    title: str,
    message: str,
    details: dict[str, Any],
    quality_score: float | None = None,
    quality_label: str = "medium",
    suppressed_reason: str = "",
) -> dict[str, Any] | None:
    safe_quality_label = clean_string(quality_label, "medium").lower()
    if not quality_is_dispatchable(safe_quality_label) and safe_quality_label != "low":
        safe_quality_label = "medium"
    details = dict(details)
    details.setdefault("quality_score", quality_score)
    details.setdefault("quality_label", safe_quality_label)

    created_at = utc_now()
    render_protocol: dict[str, Any] = {
        "version": None,
        "event_id": None,
        "fingerprint": None,
        "source_event_at": None,
        "expires_at": None,
        "status": None,
    }
    if settings.public_alert_retry_enabled:
        render_protocol = build_render_delivery_identity(
            settings=settings,
            alert_key=alert_key,
            alert_type=alert_type,
            question=market["question"],
            message=message,
            severity=severity,
            created_at=created_at,
        )

    cursor = conn.execute(
        """
        INSERT OR IGNORE INTO alerts (
            alert_key, alert_type, market_id, question, url,
            severity, title, message, quality_score, quality_label,
            suppressed_reason, details_json, created_at,
            render_protocol_version, render_event_id,
            render_payload_fingerprint, render_source_event_at,
            render_expires_at, render_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            alert_key,
            alert_type,
            market["market_id"],
            market["question"],
            market["url"],
            severity,
            title,
            message,
            quality_score,
            safe_quality_label,
            suppressed_reason,
            json_dumps(details),
            created_at,
            render_protocol["version"],
            render_protocol["event_id"],
            render_protocol["fingerprint"],
            render_protocol["source_event_at"],
            render_protocol["expires_at"],
            render_protocol["status"],
        ),
    )
    if cursor.rowcount == 0:
        return None
    row = conn.execute(
        "SELECT * FROM alerts WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return alert_from_row(row) if row else None


def create_new_high_volume_alert(
    conn: sqlite3.Connection,
    settings: Settings,
    market: sqlite3.Row,
) -> dict[str, Any] | None:
    active_volume = active_market_volume(market)
    if active_volume < settings.min_new_market_volume_24h:
        return None

    current_liquidity = float(market["liquidity"] or 0)
    quality_score, quality_label = quality_for_new_high_volume(settings, active_volume, current_liquidity)
    if not quality_is_dispatchable(quality_label):
        logging.info("Suppressed low-quality new high-volume market alert.")
        return None

    title = "New high-volume market"
    message = build_new_high_volume_reason(active_volume, current_liquidity)
    details = {
        "current_volume": active_volume,
        "current_volume24hr": market["volume24hr"],
        "current_liquidity": current_liquidity,
        "current_yes_price": market["yes_price"],
        "threshold_volume24hr": settings.min_new_market_volume_24h,
        "threshold_liquidity": settings.alert_min_liquidity,
    }
    return insert_alert(
        conn,
        settings=settings,
        alert_key=f"new_high_volume:{market['market_id']}",
        alert_type="new_high_volume",
        market=market,
        severity=severity_for_volume(active_volume),
        title=title,
        message=message,
        details=details,
        quality_score=quality_score,
        quality_label=quality_label,
    )


def create_probability_movement_alert(
    conn: sqlite3.Connection,
    settings: Settings,
    snapshot_id: int,
    market: sqlite3.Row,
    previous: sqlite3.Row,
) -> dict[str, Any] | None:
    current_price = market["yes_price"]
    previous_price = previous["yes_price"]
    if current_price is None or previous_price is None:
        return None

    delta = float(current_price) - float(previous_price)
    threshold = settings.probability_move_points / 100
    if abs(delta) < threshold:
        return None
    if recent_alert_exists(conn, "probability_movement", market["market_id"], settings.alert_cooldown_minutes):
        return None

    current_volume = active_market_volume(market)
    current_liquidity = float(market["liquidity"] or 0)
    if not probability_movement_passes_quality_gate(
        settings,
        abs(delta),
        current_volume,
        current_liquidity,
    ):
        logging.info("Suppressed low-quality probability movement alert.")
        return None

    quality_score, quality_label = quality_for_probability_movement(
        settings,
        abs(delta),
        current_volume,
        current_liquidity,
    )
    if not quality_is_dispatchable(quality_label):
        logging.info("Suppressed low-quality probability movement alert.")
        return None

    if current_volume >= settings.alert_min_volume and current_liquidity >= settings.alert_min_liquidity:
        activity_context = "volume and liquidity stayed above the alert thresholds"
    else:
        activity_context = "market activity was strong enough for the alert threshold"
    title = f"Probability moved {points(delta)}"
    message = build_probability_movement_reason(
        previous_price,
        current_price,
        delta,
        activity_context,
    )
    details = {
        "previous_snapshot_id": previous["snapshot_id"],
        "current_snapshot_id": snapshot_id,
        "previous_yes_price": previous_price,
        "current_yes_price": current_price,
        "delta": round(delta, 4),
        "threshold_points": settings.probability_move_points,
        "current_volume": current_volume,
        "current_volume24hr": market["volume24hr"],
        "current_liquidity": current_liquidity,
        "threshold_volume": settings.alert_min_volume,
        "threshold_liquidity": settings.alert_min_liquidity,
    }
    return insert_alert(
        conn,
        settings=settings,
        alert_key=f"probability_movement:{market['market_id']}:{snapshot_id}",
        alert_type="probability_movement",
        market=market,
        severity=severity_for_probability_move(abs(delta)),
        title=title,
        message=message,
        details=details,
        quality_score=quality_score,
        quality_label=quality_label,
    )


def create_volume_liquidity_spike_alert(
    conn: sqlite3.Connection,
    settings: Settings,
    snapshot_id: int,
    market: sqlite3.Row,
    previous: sqlite3.Row,
) -> dict[str, Any] | None:
    current_volume = float(market["volume24hr"] or market["volume"] or 0)
    previous_volume = float(previous["volume24hr"] or previous["volume"] or 0)
    current_liquidity = float(market["liquidity"] or 0)
    previous_liquidity = float(previous["liquidity"] or 0)

    volume_spike = spike_detected(
        current_volume,
        previous_volume,
        settings.volume_spike_multiplier,
        settings.volume_spike_min_change,
    )
    liquidity_spike = spike_detected(
        current_liquidity,
        previous_liquidity,
        settings.liquidity_spike_multiplier,
        settings.liquidity_spike_min_change,
    )
    if not volume_spike and not liquidity_spike:
        return None
    if recent_alert_exists(conn, "volume_liquidity_spike", market["market_id"], settings.alert_cooldown_minutes):
        return None

    quality_score, quality_label = quality_for_volume_liquidity_spike(
        settings,
        volume_spike,
        liquidity_spike,
        current_volume,
        previous_volume,
        current_liquidity,
        previous_liquidity,
    )
    if not quality_is_dispatchable(quality_label):
        logging.info("Suppressed low-quality volume/liquidity spike alert.")
        return None

    title = "Volume/liquidity spike"
    message = build_volume_liquidity_spike_reason(
        volume_spike,
        liquidity_spike,
        previous_volume,
        current_volume,
        previous_liquidity,
        current_liquidity,
    )
    details = {
        "previous_snapshot_id": previous["snapshot_id"],
        "current_snapshot_id": snapshot_id,
        "previous_volume": previous_volume,
        "current_volume": current_volume,
        "volume_change": round(current_volume - previous_volume, 2),
        "volume_spike": volume_spike,
        "previous_liquidity": previous_liquidity,
        "current_liquidity": current_liquidity,
        "liquidity_change": round(current_liquidity - previous_liquidity, 2),
        "liquidity_spike": liquidity_spike,
        "current_yes_price": market["yes_price"],
        "threshold_volume": settings.alert_min_volume,
        "threshold_liquidity": settings.alert_min_liquidity,
    }
    severity = "high" if current_volume >= 500_000 or current_liquidity >= 500_000 else "medium"
    return insert_alert(
        conn,
        settings=settings,
        alert_key=f"volume_liquidity_spike:{market['market_id']}:{snapshot_id}",
        alert_type="volume_liquidity_spike",
        market=market,
        severity=severity,
        title=title,
        message=message,
        details=details,
        quality_score=quality_score,
        quality_label=quality_label,
    )


def generate_alerts_for_snapshot(
    conn: sqlite3.Connection,
    settings: Settings,
    snapshot_id: int,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    has_prior_snapshot = prior_snapshots_exist(conn, snapshot_id)
    current_markets = conn.execute(
        """
        SELECT *
        FROM market_snapshots
        WHERE snapshot_id = ?
        ORDER BY volume24hr DESC, volume DESC
        """,
        (snapshot_id,),
    ).fetchall()

    for market in current_markets:
        previous = get_previous_market_snapshot(conn, market["market_id"], snapshot_id)
        if previous is None:
            if has_prior_snapshot or settings.alert_on_first_run:
                alert = create_new_high_volume_alert(conn, settings, market)
                if alert:
                    alerts.append(alert)
            continue

        movement_alert = create_probability_movement_alert(conn, settings, snapshot_id, market, previous)
        if movement_alert:
            alerts.append(movement_alert)

        spike_alert = create_volume_liquidity_spike_alert(conn, settings, snapshot_id, market, previous)
        if spike_alert:
            alerts.append(spike_alert)

    return alerts


def alert_from_row(row: sqlite3.Row) -> dict[str, Any]:
    alert = dict(row)
    try:
        alert["details"] = json.loads(alert.pop("details_json") or "{}")
    except json.JSONDecodeError:
        alert["details"] = {}
    alert["sent_to_discord"] = bool(alert["sent_to_discord"])
    if "sent_to_render" in alert:
        alert["sent_to_render"] = bool(alert["sent_to_render"])
    return alert


def discord_color(severity: str) -> int:
    if severity == "high":
        return 0xE5484D
    if severity == "medium":
        return 0xF5A524
    return 0x3B82F6


def trim_discord(value: Any, limit: int) -> str:
    text = clean_string(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def redact_public_signal_text(value: Any, *, collapse_whitespace: bool = True) -> str:
    text = clean_string(value) if collapse_whitespace else ("" if value is None else str(value))
    text = re.sub(
        r"\b(?:PBP_ADMIN_SECRET|PBP_ALERT_INGEST_SECRET|SUPABASE_SERVICE_ROLE_KEY|DISCORD_WEBHOOK_URL|WEBHOOK_URL)\s*[:=]\s*[\"']?[^\"'\s]+[\"']?",
        "[redacted-secret]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b",
        "[redacted-token]",
        text,
    )
    text = re.sub(r"https?://\S+", "[redacted-url]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        "[redacted-email]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:10|127)\.(?:\d{1,3}\.){2}\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b|\b169\.254\.\d{1,3}\.\d{1,3}\b",
        "[redacted-ip]",
        text,
    )
    text = re.sub(r"\blocalhost(?::\d{2,5})?\b", "[redacted-host]", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip() if collapse_whitespace else text


def sanitize_public_signal_text(value: Any, limit: int, default: str = "") -> str:
    text = redact_public_signal_text(value)
    if not text:
        text = default
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def well_formed_unicode_scalars(value: str) -> str:
    result: list[str] = []
    index = 0
    while index < len(value):
        codepoint = ord(value[index])
        if 0xD800 <= codepoint <= 0xDBFF:
            if index + 1 < len(value):
                low = ord(value[index + 1])
                if 0xDC00 <= low <= 0xDFFF:
                    result.append(chr(0x10000 + ((codepoint - 0xD800) << 10) + low - 0xDC00))
                    index += 2
                    continue
            result.append("\ufffd")
        elif 0xDC00 <= codepoint <= 0xDFFF:
            result.append("\ufffd")
        else:
            result.append(value[index])
        index += 1
    return "".join(result)


def utf16_code_unit_length(value: str) -> int:
    return sum(2 if ord(character) > 0xFFFF else 1 for character in value)


def sanitize_public_signal_text_v2(value: Any, limit: int, default: str = "") -> str:
    text = well_formed_unicode_scalars(
        redact_public_signal_text(value, collapse_whitespace=False)
    )
    text = ECMASCRIPT_WHITESPACE_PATTERN.sub(" ", text).strip(ECMASCRIPT_WHITESPACE)
    if not text:
        text = well_formed_unicode_scalars(default)
    if utf16_code_unit_length(text) <= limit:
        return text
    suffix = "..."
    prefix_budget = limit - len(suffix)
    prefix: list[str] = []
    prefix_units = 0
    for character in text:
        character_units = 2 if ord(character) > 0xFFFF else 1
        if prefix_units + character_units > prefix_budget:
            break
        prefix.append(character)
        prefix_units += character_units
    return "".join(prefix).rstrip(" ") + suffix


def normalize_public_signal_token(value: Any, limit: int, default: str) -> str:
    text = sanitize_public_signal_text(value, limit, default).lower()
    text = re.sub(r"[^a-z0-9_-]+", "_", text).strip("_")
    return text[:limit] or default


def normalize_public_signal_token_v2(value: Any, limit: int, default: str) -> str:
    text = sanitize_public_signal_text_v2(value, limit, default).lower()
    text = re.sub(r"[^a-z0-9_-]+", "_", text).strip("_")
    return text[:limit] or default


def render_alert_bridge_configured(settings: Settings) -> bool:
    return bool(settings.render_alert_ingest_url and settings.alert_ingest_secret)


def build_render_alert_payload(alert: dict[str, Any]) -> dict[str, str]:
    return {
        "alertType": normalize_public_signal_token(alert.get("alert_type"), 80, "alert_signal"),
        "marketQuestion": sanitize_public_signal_text(alert.get("question"), 280, "Untitled market"),
        "reason": sanitize_public_signal_text(alert.get("message") or alert.get("title"), 400, "Alert triggered."),
        "severity": normalize_public_signal_token(alert.get("severity"), 40, "low"),
        "source": "acer-alert-worker",
    }


def build_canonical_render_public_fields_v2(alert: dict[str, Any]) -> dict[str, str]:
    return {
        "alertType": normalize_public_signal_token_v2(alert.get("alert_type"), 80, "alert_signal"),
        "marketQuestion": sanitize_public_signal_text_v2(alert.get("question"), 280, "Untitled market"),
        "reason": sanitize_public_signal_text_v2(
            alert.get("message") or alert.get("title"), 400, "Alert triggered."
        ),
        "severity": normalize_public_signal_token_v2(alert.get("severity"), 40, "low"),
        "source": "acer-alert-worker",
    }


def parse_strict_utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or not STRICT_UTC_PATTERN.fullmatch(value):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        return None
    return parsed.astimezone(timezone.utc)


def canonical_render_delivery_payload(payload: dict[str, Any]) -> str:
    canonical = {
        "alertType": payload["alertType"],
        "eventId": payload["eventId"],
        "expiresAt": payload["expiresAt"],
        "marketQuestion": payload["marketQuestion"],
        "reason": payload["reason"],
        "schemaVersion": payload["schemaVersion"],
        "severity": payload["severity"],
        "source": payload["source"],
        "sourceEventAt": payload["sourceEventAt"],
    }
    return json.dumps(canonical, ensure_ascii=False, separators=(",", ":"))


def fingerprint_render_delivery_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_render_delivery_payload(payload).encode("utf-8")).hexdigest()


def render_delivery_payload_has_valid_contract(payload: dict[str, Any]) -> bool:
    bounded_fields = (
        ("alertType", 80),
        ("marketQuestion", 280),
        ("reason", 400),
        ("severity", 40),
        ("source", 120),
    )
    for field, limit in bounded_fields:
        value = payload.get(field)
        if (
            not isinstance(value, str)
            or not value
            or value != value.strip()
            or utf16_code_unit_length(value) > limit
            or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
            or any(0xD800 <= ord(character) <= 0xDFFF for character in value)
        ):
            return False
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", payload["alertType"]):
        return False
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", payload["severity"]):
        return False
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", payload["source"]):
        return False
    if payload.get("schemaVersion") != RENDER_DELIVERY_SCHEMA_VERSION:
        return False
    if not isinstance(payload.get("eventId"), str) or not RENDER_EVENT_ID_PATTERN.fullmatch(payload["eventId"]):
        return False
    source_time = parse_strict_utc(payload.get("sourceEventAt"))
    expires_time = parse_strict_utc(payload.get("expiresAt"))
    if (
        source_time is None
        or expires_time is None
        or expires_time <= source_time
        or expires_time - source_time > timedelta(minutes=15)
    ):
        return False
    fingerprint = payload.get("fingerprint")
    return (
        isinstance(fingerprint, str)
        and RENDER_FINGERPRINT_PATTERN.fullmatch(fingerprint) is not None
        and fingerprint_render_delivery_payload(payload) == fingerprint
    )


def build_render_delivery_identity(
    settings: Settings,
    alert_key: str,
    alert_type: str,
    question: Any,
    message: Any,
    severity: str,
    created_at: str,
) -> dict[str, Any]:
    source_time = parse_strict_utc(created_at)
    if source_time is None:
        raise ValueError("Cannot enroll alert delivery with an invalid UTC source timestamp")

    event_seed = f"{alert_key}\n{created_at}".encode("utf-8")
    event_id = f"pbp_{hashlib.sha256(event_seed).hexdigest()[:40]}"
    expires_at = format_utc(source_time + timedelta(seconds=settings.public_alert_retry_ttl_seconds))
    payload: dict[str, Any] = {
        **build_canonical_render_public_fields_v2(
            {
                "alert_type": alert_type,
                "question": question,
                "message": message,
                "severity": severity,
            }
        ),
        "schemaVersion": RENDER_DELIVERY_SCHEMA_VERSION,
        "eventId": event_id,
        "sourceEventAt": created_at,
        "expiresAt": expires_at,
    }
    payload["fingerprint"] = fingerprint_render_delivery_payload(payload)
    if not render_delivery_payload_has_valid_contract(payload):
        raise ValueError("Cannot enroll alert delivery with a noncanonical V2 payload")
    return {
        "version": RENDER_DELIVERY_SCHEMA_VERSION,
        "event_id": event_id,
        "fingerprint": payload["fingerprint"],
        "source_event_at": created_at,
        "expires_at": expires_at,
        "status": "pending",
    }


def build_render_alert_payload_v2(alert: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        **build_canonical_render_public_fields_v2(alert),
        "schemaVersion": alert.get("render_protocol_version"),
        "eventId": alert.get("render_event_id"),
        "sourceEventAt": alert.get("render_source_event_at"),
        "expiresAt": alert.get("render_expires_at"),
        "fingerprint": alert.get("render_payload_fingerprint"),
    }
    return payload


def build_discord_payload(settings: Settings, alert: dict[str, Any]) -> dict[str, Any]:
    details = alert.get("details") or {}
    fields = [
        {"name": "Type", "value": alert["alert_type"].replace("_", " "), "inline": True},
        {"name": "Severity", "value": alert["severity"], "inline": True},
    ]
    quality_label = clean_string(alert.get("quality_label"))
    if quality_label:
        fields.append({"name": "Quality", "value": quality_label, "inline": True})

    current_yes = details.get("current_yes_price")
    if current_yes is not None:
        fields.append({"name": "YES", "value": probability(current_yes), "inline": True})

    current_volume = details.get("current_volume") or details.get("current_volume24hr")
    if current_volume is not None:
        fields.append({"name": "Volume", "value": money(current_volume), "inline": True})

    current_liquidity = details.get("current_liquidity")
    if current_liquidity is not None:
        fields.append({"name": "Liquidity", "value": money(current_liquidity), "inline": True})

    embed = {
        "title": trim_discord(alert["title"], 256),
        "description": trim_discord(alert["message"], 4096),
        "color": discord_color(alert["severity"]),
        "fields": fields[:10],
        "timestamp": alert["created_at"],
    }
    if alert.get("url"):
        embed["url"] = alert["url"]

    payload = {
        "username": settings.discord_username,
        "content": trim_discord(f"PBP Alert: {alert['title']}", 1900),
        "embeds": [embed],
    }
    if settings.discord_avatar_url:
        payload["avatar_url"] = settings.discord_avatar_url
    return payload


def send_discord_alert(settings: Settings, alert: dict[str, Any]) -> None:
    payload = build_discord_payload(settings, alert)
    response = requests.post(
        settings.discord_webhook_url,
        json=payload,
        timeout=settings.request_timeout_seconds,
    )
    if response.status_code not in {200, 204}:
        safe_body = trim_discord(response.text, 500)
        raise RuntimeError(f"Discord returned HTTP {response.status_code}: {safe_body}")


def send_render_alert_signal(settings: Settings, alert: dict[str, Any]) -> None:
    payload = build_render_alert_payload(alert)
    response = requests.post(
        settings.render_alert_ingest_url,
        json=payload,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {settings.alert_ingest_secret}",
            "User-Agent": f"{SERVICE_NAME}/1.0",
        },
        timeout=min(settings.request_timeout_seconds, 10),
    )
    if response.status_code not in {200, 201, 202, 204}:
        safe_body = sanitize_public_signal_text(response.text, 300, "no response body")
        raise RuntimeError(f"Render ingest returned HTTP {response.status_code}: {safe_body}")


def validate_render_delivery_attempt(
    alert: dict[str, Any], settings: Settings, now: datetime
) -> tuple[str, dict[str, Any] | None]:
    if alert.get("render_protocol_version") != RENDER_DELIVERY_SCHEMA_VERSION:
        return "invalid_protocol", None

    event_id = alert.get("render_event_id")
    fingerprint = alert.get("render_payload_fingerprint")
    if not isinstance(event_id, str) or not RENDER_EVENT_ID_PATTERN.fullmatch(event_id):
        return "invalid_payload", None
    if not isinstance(fingerprint, str) or not RENDER_FINGERPRINT_PATTERN.fullmatch(fingerprint):
        return "invalid_payload", None

    source_time = parse_strict_utc(alert.get("render_source_event_at"))
    expires_time = parse_strict_utc(alert.get("render_expires_at"))
    if source_time is None or expires_time is None:
        return "invalid_timestamp", None
    if expires_time <= source_time or expires_time - source_time > timedelta(minutes=15):
        return "invalid_expiry", None
    if source_time > now + timedelta(seconds=settings.public_alert_retry_future_skew_seconds):
        return "future_timestamp", None
    if now >= expires_time:
        return "expired", None

    attempt_count = alert.get("render_attempt_count")
    if not isinstance(attempt_count, int) or attempt_count < 0:
        return "invalid_attempt_state", None
    if attempt_count >= settings.public_alert_retry_max_attempts:
        return "exhausted", None

    last_attempt = alert.get("render_last_attempt_at")
    if last_attempt:
        last_attempt_time = parse_strict_utc(last_attempt)
        if last_attempt_time is None:
            return "invalid_timestamp", None
        if now < last_attempt_time:
            return "not_due", None

    next_attempt = alert.get("render_next_attempt_at")
    if next_attempt:
        next_attempt_time = parse_strict_utc(next_attempt)
        if next_attempt_time is None:
            return "invalid_timestamp", None
        if now < next_attempt_time:
            return "not_due", None

    payload = build_render_alert_payload_v2(alert)
    if not render_delivery_payload_has_valid_contract(payload):
        return "invalid_payload", None
    return "ready", payload


def render_retry_delay_seconds(settings: Settings, attempt_number: int) -> int:
    exponent = max(0, attempt_number - 1)
    return min(
        settings.public_alert_retry_max_backoff_seconds,
        settings.public_alert_retry_initial_backoff_seconds * (2**exponent),
    )


def send_render_alert_signal_v2(
    settings: Settings,
    payload: dict[str, Any],
    post: Any = requests.post,
) -> str:
    try:
        response = post(
            settings.render_alert_ingest_url,
            json=payload,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {settings.alert_ingest_secret}",
                "User-Agent": f"{SERVICE_NAME}/2.0",
            },
            timeout=min(settings.request_timeout_seconds, 10),
        )
    except requests.RequestException:
        return "retryable"
    except Exception:
        return "retryable"

    try:
        status_code = int(getattr(response, "status_code", 0) or 0)
    except (TypeError, ValueError):
        return "retryable"
    if 200 <= status_code <= 299:
        try:
            acknowledgement = response.json()
        except Exception:
            return "retryable"
        if (
            isinstance(acknowledgement, dict)
            and acknowledgement.get("ok") is True
            and acknowledgement.get("protocolVersion") == RENDER_DELIVERY_SCHEMA_VERSION
            and acknowledgement.get("status") in {"created", "duplicate"}
            and acknowledgement.get("eventId") == payload["eventId"]
        ):
            return "acknowledged"
        return "retryable"

    if status_code in {408, 429} or 500 <= status_code <= 599 or status_code <= 0:
        return "retryable"
    return f"permanent_http_{status_code}"


def dispatch_pending_alerts(conn: sqlite3.Connection, settings: Settings) -> int:
    if not settings.discord_enabled:
        logging.info("Discord dispatch is disabled by PBP_DISCORD_ENABLED=false")
        return 0
    if not settings.discord_webhook_url:
        logging.info("Discord webhook is not configured; alerts will remain in SQLite")
        return 0

    rows = conn.execute(
        """
        SELECT *
        FROM alerts
        WHERE sent_to_discord = 0
          AND COALESCE(quality_label, 'medium') IN ('medium', 'high')
        ORDER BY created_at ASC
        LIMIT ?
        """,
        (settings.max_discord_alerts_per_cycle,),
    ).fetchall()

    sent_count = 0
    for row in rows:
        alert = alert_from_row(row)
        try:
            send_discord_alert(settings, alert)
        except Exception as exc:
            logging.warning("Could not send alert %s to Discord: %s", alert["id"], exc)
            conn.execute(
                "UPDATE alerts SET discord_error = ? WHERE id = ?",
                (str(exc), alert["id"]),
            )
            continue

        conn.execute(
            """
            UPDATE alerts
            SET sent_to_discord = 1,
                sent_at = ?,
                discord_error = NULL
            WHERE id = ?
            """,
            (utc_now(), alert["id"]),
        )
        sent_count += 1

    return sent_count


def dispatch_pending_render_alerts(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    now: datetime | None = None,
    clock: Any = utc_datetime_now,
    post: Any = requests.post,
) -> int:
    if not render_alert_bridge_configured(settings):
        logging.info("Render alert ingest is not configured; skipping public alert bridge")
        return 0

    def current_time() -> datetime:
        value = now if now is not None else clock()
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("Guarded alert delivery clock must return a UTC datetime")
        return value.astimezone(timezone.utc).replace(microsecond=0)

    selection_now = current_time()
    selection_now_text = format_utc(selection_now)
    candidate_limit = min(500, max(50, settings.max_public_alerts_per_cycle * 20))
    rows = conn.execute(
        """
        SELECT *
        FROM alerts
        WHERE sent_to_render = 0
          AND COALESCE(quality_label, 'medium') IN ('medium', 'high')
          AND (
            (render_protocol_version IS NULL AND COALESCE(render_status, '') = '')
            OR
            (? = 1 AND render_protocol_version = 2
              AND render_status IN ('pending', 'retry_wait'))
          )
        ORDER BY
          CASE
            WHEN render_protocol_version = 2
              AND (render_next_attempt_at IS NULL OR render_next_attempt_at <= ?)
              AND render_expires_at > ? THEN 0
            WHEN render_protocol_version IS NULL THEN 1
            WHEN render_protocol_version = 2
              AND (render_next_attempt_at IS NULL OR render_next_attempt_at <= ?) THEN 2
            ELSE 3
          END,
          created_at ASC
        LIMIT ?
        """,
        (
            1 if settings.public_alert_retry_enabled else 0,
            selection_now_text,
            selection_now_text,
            selection_now_text,
            candidate_limit,
        ),
    ).fetchall()

    sent_count = 0
    network_attempts = 0
    for row in rows:
        alert = alert_from_row(row)
        if alert.get("render_protocol_version") == RENDER_DELIVERY_SCHEMA_VERSION:
            attempt_now = current_time()
            validation, payload = validate_render_delivery_attempt(alert, settings, attempt_now)
            if validation == "not_due":
                continue
            if validation != "ready" or payload is None:
                conn.execute(
                    "UPDATE alerts SET render_status = ?, render_next_attempt_at = NULL WHERE id = ?",
                    (validation, alert["id"]),
                )
                continue
            if network_attempts >= settings.max_public_alerts_per_cycle:
                break

            attempt_number = int(alert["render_attempt_count"] or 0) + 1
            attempted_at = format_utc(attempt_now)
            retry_at = attempt_now + timedelta(
                seconds=render_retry_delay_seconds(settings, attempt_number)
            )
            conn.execute(
                """
                UPDATE alerts
                SET render_attempt_count = ?,
                    render_last_attempt_at = ?,
                    render_next_attempt_at = ?,
                    render_status = 'retry_wait'
                WHERE id = ?
                """,
                (attempt_number, attempted_at, format_utc(retry_at), alert["id"]),
            )
            # Persist the attempt before the network call. A crash or timeout can then
            # only cause a bounded retry of the same durable event identity.
            conn.commit()

            network_attempts += 1
            outcome = send_render_alert_signal_v2(settings, payload, post=post)
            if outcome == "acknowledged":
                conn.execute(
                    """
                    UPDATE alerts
                    SET sent_to_render = 1,
                        render_sent_at = ?,
                        render_status = 'sent',
                        render_next_attempt_at = NULL
                    WHERE id = ?
                    """,
                    (attempted_at, alert["id"]),
                )
                logging.info("Acknowledged guarded alert %s from Render ingest", alert["id"])
                sent_count += 1
                continue

            if outcome == "retryable":
                terminal_status = "retry_wait"
                if attempt_number >= settings.public_alert_retry_max_attempts:
                    terminal_status = "exhausted"
                elif retry_at >= parse_strict_utc(alert["render_expires_at"]):
                    terminal_status = "expired"
                conn.execute(
                    """
                    UPDATE alerts
                    SET render_status = ?,
                        render_next_attempt_at = CASE WHEN ? = 'retry_wait'
                          THEN render_next_attempt_at ELSE NULL END
                    WHERE id = ?
                    """,
                    (terminal_status, terminal_status, alert["id"]),
                )
                logging.warning(
                    "Guarded alert %s was not acknowledged; state=%s attempt=%s",
                    alert["id"],
                    terminal_status,
                    attempt_number,
                )
                continue

            conn.execute(
                """
                UPDATE alerts
                SET render_status = ?, render_next_attempt_at = NULL
                WHERE id = ?
                """,
                (outcome, alert["id"]),
            )
            logging.warning(
                "Guarded alert %s was permanently rejected; state=%s",
                alert["id"],
                outcome,
            )
            continue

        if network_attempts >= settings.max_public_alerts_per_cycle:
            break
        network_attempts += 1
        try:
            send_render_alert_signal(settings, alert)
        except Exception as exc:
            safe_error = sanitize_public_signal_text(str(exc), 300, "Render ingest failed")
            logging.warning("Could not send alert %s to Render ingest: %s", alert["id"], safe_error)
            conn.execute(
                """
                UPDATE alerts
                SET sent_to_render = 0,
                    render_status = ?
                WHERE id = ?
                """,
                ("failed", alert["id"]),
            )
            continue

        sent_at = utc_now()
        conn.execute(
            """
            UPDATE alerts
            SET sent_to_render = 1,
                render_sent_at = ?,
                render_status = 'sent'
            WHERE id = ?
            """,
            (sent_at, alert["id"]),
        )
        logging.info("Sent alert %s to Render ingest", alert["id"])
        sent_count += 1

    return sent_count


status_lock = threading.Lock()
cycle_lock = threading.Lock()
stop_event = threading.Event()
worker_status: dict[str, Any] = {
    "service": SERVICE_NAME,
    "started_at": utc_now(),
    "cycle_running": False,
    "cycle_count": 0,
    "last_cycle_reason": None,
    "last_started_at": None,
    "last_success_at": None,
    "last_error_at": None,
    "last_error": None,
    "last_snapshot_id": None,
    "last_market_count": 0,
    "last_alerts_created": 0,
    "last_discord_sent": 0,
    "last_render_sent": 0,
}


def update_status(**values: Any) -> None:
    with status_lock:
        worker_status.update(values)


def get_status() -> dict[str, Any]:
    with status_lock:
        return dict(worker_status)


def run_cycle(settings: Settings, reason: str = "manual") -> dict[str, Any]:
    if not cycle_lock.acquire(blocking=False):
        logging.info("A fetch cycle is already running; skipping %s cycle", reason)
        return {"ok": False, "skipped": True, "reason": "cycle already running"}

    started_at = utc_now()
    update_status(cycle_running=True, last_cycle_reason=reason, last_started_at=started_at)

    try:
        init_db(settings)
        payload, markets = fetch_live_markets(settings)

        with db_connection(settings) as conn:
            snapshot_id = save_snapshot(conn, settings, payload, markets)
            alerts = generate_alerts_for_snapshot(conn, settings, snapshot_id)

        with db_connection(settings) as conn:
            discord_sent = dispatch_pending_alerts(conn, settings)
            render_sent = dispatch_pending_render_alerts(conn, settings)

        summary = {
            "ok": True,
            "snapshot_id": snapshot_id,
            "markets": len(markets),
            "alerts_created": len(alerts),
            "discord_sent": discord_sent,
            "render_sent": render_sent,
        }
        update_status(
            cycle_running=False,
            cycle_count=get_status()["cycle_count"] + 1,
            last_success_at=utc_now(),
            last_error=None,
            last_snapshot_id=snapshot_id,
            last_market_count=len(markets),
            last_alerts_created=len(alerts),
            last_discord_sent=discord_sent,
            last_render_sent=render_sent,
        )
        logging.info(
            "Cycle complete: snapshot=%s markets=%s alerts=%s discord_sent=%s render_sent=%s",
            snapshot_id,
            len(markets),
            len(alerts),
            discord_sent,
            render_sent,
        )
        return summary
    except Exception as exc:
        logging.exception("Cycle failed")
        update_status(
            cycle_running=False,
            last_error_at=utc_now(),
            last_error=str(exc),
        )
        return {"ok": False, "error": str(exc)}
    finally:
        cycle_lock.release()


def background_loop(settings: Settings) -> None:
    logging.info("Background worker started; interval=%ss", settings.fetch_interval_seconds)
    while not stop_event.is_set():
        run_cycle(settings, reason="background")
        stop_event.wait(settings.fetch_interval_seconds)
    logging.info("Background worker stopped")


app = Flask(__name__)


@app.get("/")
def index() -> Any:
    return jsonify(
        {
            "ok": True,
            "service": SERVICE_NAME,
            "description": "Local alert worker for Paid by Polymarket OS.",
            "endpoints": ["/health", "/alerts"],
            "port": SETTINGS.port,
            "discordConfigured": bool(SETTINGS.discord_webhook_url),
            "renderIngestConfigured": render_alert_bridge_configured(SETTINGS),
        }
    )


@app.get("/health")
def health() -> Any:
    db_ok = True
    db_error = None
    snapshot_count = 0
    alert_count = 0

    try:
        init_db(SETTINGS)
        with db_connection(SETTINGS) as conn:
            snapshot_count = int(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0])
            alert_count = int(conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0])
    except Exception as exc:
        db_ok = False
        db_error = str(exc)

    status = get_status()
    ok = db_ok and not status.get("last_error")
    response = {
        "ok": ok,
        "service": SERVICE_NAME,
        "dbOk": db_ok,
        "dbError": db_error,
        "snapshotCount": snapshot_count,
        "alertCount": alert_count,
        "discordConfigured": bool(SETTINGS.discord_webhook_url),
        "renderIngestConfigured": render_alert_bridge_configured(SETTINGS),
        "status": status,
    }
    return jsonify(response), 200 if ok else 503


@app.get("/alerts")
def alerts() -> Any:
    raw_limit = request.args.get("limit", "50")
    try:
        limit = int(raw_limit)
    except ValueError:
        limit = 50
    limit = max(1, min(limit, 200))

    init_db(SETTINGS)
    with db_connection(SETTINGS) as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM alerts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    alert_items = [alert_from_row(row) for row in rows]
    return jsonify({"ok": True, "count": len(alert_items), "alerts": alert_items})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Paid by Polymarket alert worker")
    parser.add_argument("--init-db", action="store_true", help="create or migrate the SQLite database and exit")
    parser.add_argument("--once", action="store_true", help="run one fetch/alert/Discord cycle and exit")
    parser.add_argument("--host", help="override PBP_HOST for this run")
    parser.add_argument("--port", type=int, help="override PBP_PORT for this run")
    return parser.parse_args()


def install_signal_handlers() -> None:
    def handle_signal(signum: int, _frame: Any) -> None:
        logging.info("Received signal %s; stopping", signum)
        stop_event.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)


def main() -> int:
    global SETTINGS

    args = parse_args()
    if args.host or args.port:
        SETTINGS = replace(
            SETTINGS,
            host=args.host or SETTINGS.host,
            port=args.port or SETTINGS.port,
        )

    configure_logging(SETTINGS)
    logging.info("%s starting", SERVICE_NAME)
    logging.info("Using env file path: %s", ENV_FILE)
    logging.info("Using SQLite database: %s", SETTINGS.db_path)

    if args.init_db:
        init_db(SETTINGS)
        print(f"Initialized database at {SETTINGS.db_path}")
        return 0

    if args.once:
        summary = run_cycle(SETTINGS, reason="once")
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0 if summary.get("ok") else 1

    init_db(SETTINGS)
    install_signal_handlers()
    worker_thread = threading.Thread(target=background_loop, args=(SETTINGS,), daemon=True)
    worker_thread.start()

    app.run(
        host=SETTINGS.host,
        port=SETTINGS.port,
        debug=False,
        use_reloader=False,
    )
    stop_event.set()
    worker_thread.join(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
