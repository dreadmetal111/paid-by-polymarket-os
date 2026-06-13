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


def load_env_file() -> Path:
    env_path = Path(os.environ.get("PBP_ENV_FILE", str(DEFAULT_ENV_FILE))).expanduser()
    if env_path.exists():
        load_dotenv(env_path, override=False)
    return env_path


ENV_FILE = load_env_file()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
    alert_cooldown_minutes: int
    alert_on_first_run: bool
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
        alert_cooldown_minutes=max(1, env_int("PBP_ALERT_COOLDOWN_MINUTES", 60)),
        alert_on_first_run=env_bool("PBP_ALERT_ON_FIRST_RUN", False),
        min_new_market_volume_24h=max(0.0, env_float("PBP_MIN_NEW_MARKET_VOLUME_24H", 100000.0)),
        probability_move_points=max(0.1, env_float("PBP_PROBABILITY_MOVE_POINTS", 5.0)),
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
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                sent_to_discord INTEGER NOT NULL DEFAULT 0,
                sent_at TEXT,
                discord_error TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_created_at
                ON alerts (created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_alerts_type_market_created
                ON alerts (alert_type, market_id, created_at DESC);
            """
        )


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
    alert_key: str,
    alert_type: str,
    market: sqlite3.Row,
    severity: str,
    title: str,
    message: str,
    details: dict[str, Any],
) -> dict[str, Any] | None:
    cursor = conn.execute(
        """
        INSERT OR IGNORE INTO alerts (
            alert_key, alert_type, market_id, question, url,
            severity, title, message, details_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            json_dumps(details),
            utc_now(),
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
    active_volume = float(market["volume24hr"] or market["volume"] or 0)
    if active_volume < settings.min_new_market_volume_24h:
        return None

    title = "New high-volume market"
    message = (
        f"{market['question']} appeared with {money(active_volume)} in volume. "
        f"YES is {probability(market['yes_price'])}; liquidity is {money(market['liquidity'])}."
    )
    details = {
        "current_volume": active_volume,
        "current_volume24hr": market["volume24hr"],
        "current_liquidity": market["liquidity"],
        "current_yes_price": market["yes_price"],
        "threshold_volume24hr": settings.min_new_market_volume_24h,
    }
    return insert_alert(
        conn,
        alert_key=f"new_high_volume:{market['market_id']}",
        alert_type="new_high_volume",
        market=market,
        severity=severity_for_volume(active_volume),
        title=title,
        message=message,
        details=details,
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

    direction = "up" if delta > 0 else "down"
    title = f"Probability moved {points(delta)}"
    message = (
        f"{market['question']} moved {direction} from {probability(previous_price)} "
        f"to {probability(current_price)}."
    )
    details = {
        "previous_snapshot_id": previous["snapshot_id"],
        "current_snapshot_id": snapshot_id,
        "previous_yes_price": previous_price,
        "current_yes_price": current_price,
        "delta": round(delta, 4),
        "threshold_points": settings.probability_move_points,
        "current_volume24hr": market["volume24hr"],
        "current_liquidity": market["liquidity"],
    }
    return insert_alert(
        conn,
        alert_key=f"probability_movement:{market['market_id']}:{snapshot_id}",
        alert_type="probability_movement",
        market=market,
        severity=severity_for_probability_move(abs(delta)),
        title=title,
        message=message,
        details=details,
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

    labels = []
    if volume_spike:
        labels.append(f"volume {money(previous_volume)} -> {money(current_volume)}")
    if liquidity_spike:
        labels.append(f"liquidity {money(previous_liquidity)} -> {money(current_liquidity)}")

    title = "Volume/liquidity spike"
    message = f"{market['question']} has a spike: {', '.join(labels)}."
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
    }
    severity = "high" if current_volume >= 500_000 or current_liquidity >= 500_000 else "medium"
    return insert_alert(
        conn,
        alert_key=f"volume_liquidity_spike:{market['market_id']}:{snapshot_id}",
        alert_type="volume_liquidity_spike",
        market=market,
        severity=severity,
        title=title,
        message=message,
        details=details,
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


def build_discord_payload(settings: Settings, alert: dict[str, Any]) -> dict[str, Any]:
    details = alert.get("details") or {}
    fields = [
        {"name": "Type", "value": alert["alert_type"].replace("_", " "), "inline": True},
        {"name": "Severity", "value": alert["severity"], "inline": True},
    ]

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

        summary = {
            "ok": True,
            "snapshot_id": snapshot_id,
            "markets": len(markets),
            "alerts_created": len(alerts),
            "discord_sent": discord_sent,
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
        )
        logging.info(
            "Cycle complete: snapshot=%s markets=%s alerts=%s discord_sent=%s",
            snapshot_id,
            len(markets),
            len(alerts),
            discord_sent,
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
