from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "pbp-alert-worker" / "pbp_alert_worker.py"
MIRROR_WORKER_PATH = ROOT / "operations" / "acer-node" / "pbp-alert-worker" / "pbp_alert_worker.py"

fake_requests = types.ModuleType("requests")


class FakeRequestException(Exception):
    pass


class FakeTimeout(FakeRequestException):
    pass


def forbidden_external_request(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("External requests are forbidden in offline tests")


fake_requests.RequestException = FakeRequestException
fake_requests.Timeout = FakeTimeout
fake_requests.get = forbidden_external_request
fake_requests.post = forbidden_external_request

fake_dotenv = types.ModuleType("dotenv")


def forbidden_env_load(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("Private env-file loading is forbidden in offline tests")


fake_dotenv.load_dotenv = forbidden_env_load

fake_flask = types.ModuleType("flask")


class FakeFlask:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def get(self, *_args: object, **_kwargs: object):
        return lambda function: function

    def run(self, *_args: object, **_kwargs: object) -> None:
        raise AssertionError("The Flask server must not run in offline tests")


fake_flask.Flask = FakeFlask
fake_flask.jsonify = lambda value: value
fake_flask.request = types.SimpleNamespace(args={})

# Import with a completely synthetic environment and scoped dependency modules.
# Both mappings are restored immediately afterwards so collection cannot leak test
# state into the rest of the Python suite.
synthetic_environment = {
    "PBP_ENV_FILE": str(ROOT / "tests" / "nonexistent-offline-test.env"),
}
synthetic_modules = {
    "requests": fake_requests,
    "dotenv": fake_dotenv,
    "flask": fake_flask,
}
with patch.dict(os.environ, synthetic_environment, clear=True), patch.dict(
    sys.modules, synthetic_modules
):
    spec = importlib.util.spec_from_file_location("pbp_alert_worker_under_test", WORKER_PATH)
    worker = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = worker
    spec.loader.exec_module(worker)


UTC = timezone.utc
SOURCE_TIME = datetime(2026, 10, 14, 1, 5, 0, tzinfo=UTC)


class FakeResponse:
    def __init__(self, status_code: int, body: object | None = None):
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class SupabaseConstraintSemanticsTests(unittest.TestCase):
    def test_null_partial_wrong_version_and_timestamp_mismatch_fail_check(self) -> None:
        sql = (ROOT / "docs" / "alert-delivery-v2-supabase.sql").read_text(encoding="utf-8")
        for column in (
            "protocol_version",
            "event_id",
            "source_event_at",
            "expires_at",
            "payload_fingerprint",
        ):
            self.assertIn(f"{column} is not null", sql.lower())
        self.assertIn("expires_at <= source_event_at + interval '15 minutes'", sql.lower())

        # SQLite follows the same CHECK rule at issue here: UNKNOWN passes. This
        # in-memory equivalent proves the explicit guards make incomplete V2 rows
        # FALSE rather than UNKNOWN without executing any PostgreSQL DDL.
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute(
            """
            CREATE TABLE guarded_rows (
                created_at TEXT NOT NULL,
                protocol_version INTEGER,
                event_id TEXT,
                source_event_at TEXT,
                expires_at TEXT,
                payload_fingerprint TEXT,
                CHECK (
                    (
                        protocol_version IS NULL
                        AND event_id IS NULL
                        AND source_event_at IS NULL
                        AND expires_at IS NULL
                        AND payload_fingerprint IS NULL
                    )
                    OR
                    (
                        protocol_version IS NOT NULL
                        AND protocol_version = 2
                        AND event_id IS NOT NULL
                        AND source_event_at IS NOT NULL
                        AND expires_at IS NOT NULL
                        AND payload_fingerprint IS NOT NULL
                        AND created_at = source_event_at
                    )
                )
            )
            """
        )
        valid_time = "2026-10-14T01:05:00Z"
        valid_id = f"pbp_{'a' * 40}"
        valid_fingerprint = "b" * 64
        conn.execute("INSERT INTO guarded_rows (created_at) VALUES (?)", (valid_time,))
        conn.execute(
            """
            INSERT INTO guarded_rows VALUES (?, 2, ?, ?, ?, ?)
            """,
            (valid_time, valid_id, valid_time, "2026-10-14T01:20:00Z", valid_fingerprint),
        )
        invalid_rows = (
            (valid_time, 2, None, valid_time, "2026-10-14T01:20:00Z", valid_fingerprint),
            (valid_time, 2, valid_id, None, "2026-10-14T01:20:00Z", valid_fingerprint),
            (valid_time, 2, valid_id, valid_time, None, valid_fingerprint),
            (valid_time, 2, valid_id, valid_time, "2026-10-14T01:20:00Z", None),
            (valid_time, 3, valid_id, valid_time, "2026-10-14T01:20:00Z", valid_fingerprint),
            (valid_time, None, valid_id, None, None, None),
            ("2026-10-14T01:06:00Z", 2, valid_id, valid_time, "2026-10-14T01:20:00Z", valid_fingerprint),
        )
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO guarded_rows VALUES (?, ?, ?, ?, ?, ?)", row)


class AlertDeliveryRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = Path(self.temp_dir.name) / "worker.sqlite3"
        self.settings = replace(
            worker.SETTINGS,
            db_path=self.db_path,
            render_alert_ingest_url="https://render.invalid/api/internal/alerts",
            alert_ingest_secret="synthetic-test-secret",
            public_alert_retry_enabled=True,
            public_alert_retry_max_attempts=5,
            public_alert_retry_ttl_seconds=900,
            public_alert_retry_initial_backoff_seconds=30,
            public_alert_retry_max_backoff_seconds=300,
            public_alert_retry_future_skew_seconds=60,
            max_public_alerts_per_cycle=5,
        )
        worker.init_db(self.settings)

    def connect(self):
        return worker.db_connection(self.settings)

    def insert_v2_alert(
        self,
        *,
        alert_key: str = "probability_movement:market-1:7",
        source_time: datetime = SOURCE_TIME,
        status: str = "pending",
        attempt_count: int = 0,
    ) -> dict[str, object]:
        created_at = worker.format_utc(source_time)
        identity = worker.build_render_delivery_identity(
            settings=self.settings,
            alert_key=alert_key,
            alert_type="probability_movement",
            question="Will the example happen?",
            message="Probability moved by 8 points.",
            severity="high",
            created_at=created_at,
        )
        identity["status"] = status
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO alerts (
                    alert_key, alert_type, market_id, question, severity, title,
                    message, quality_label, details_json, created_at,
                    render_protocol_version, render_event_id,
                    render_payload_fingerprint, render_source_event_at,
                    render_expires_at, render_status, render_attempt_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    alert_key,
                    "probability_movement",
                    "market-1",
                    "Will the example happen?",
                    "high",
                    "Probability movement",
                    "Probability moved by 8 points.",
                    "high",
                    "{}",
                    created_at,
                    identity["version"],
                    identity["event_id"],
                    identity["fingerprint"],
                    identity["source_event_at"],
                    identity["expires_at"],
                    identity["status"],
                    attempt_count,
                ),
            )
        return identity

    def row(self) -> sqlite3.Row:
        with self.connect() as conn:
            return conn.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT 1").fetchone()

    @staticmethod
    def acknowledgement(payload: dict[str, object], status: str = "created") -> FakeResponse:
        return FakeResponse(
            201 if status == "created" else 200,
            {
                "ok": True,
                "protocolVersion": 2,
                "status": status,
                "eventId": payload["eventId"],
            },
        )

    def test_transient_500_then_success_reuses_identity_and_honors_backoff(self) -> None:
        identity = self.insert_v2_alert()
        payloads: list[dict[str, object]] = []
        responses = [FakeResponse(500), None]

        def post(_url: str, *, json: dict[str, object], **_kwargs: object) -> FakeResponse:
            payloads.append(json)
            response = responses.pop(0)
            return response or self.acknowledgement(json)

        with self.connect() as conn:
            self.assertEqual(
                worker.dispatch_pending_render_alerts(conn, self.settings, now=SOURCE_TIME, post=post),
                0,
            )
        first = self.row()
        self.assertEqual(first["render_attempt_count"], 1)
        self.assertEqual(first["render_status"], "retry_wait")
        self.assertEqual(first["render_next_attempt_at"], "2026-10-14T01:05:30Z")

        with self.connect() as conn:
            self.assertEqual(
                worker.dispatch_pending_render_alerts(
                    conn, self.settings, now=SOURCE_TIME + timedelta(seconds=29), post=post
                ),
                0,
            )
        self.assertEqual(len(payloads), 1)

        # Reopen the database to prove attempts, backoff, and identity survive restart.
        with self.connect() as conn:
            self.assertEqual(
                worker.dispatch_pending_render_alerts(
                    conn, self.settings, now=SOURCE_TIME + timedelta(seconds=30), post=post
                ),
                1,
            )
        final = self.row()
        self.assertEqual(final["render_status"], "sent")
        self.assertEqual(final["render_attempt_count"], 2)
        self.assertEqual(payloads[0], payloads[1])
        self.assertEqual(payloads[0]["eventId"], identity["event_id"])

    def test_timeout_after_commit_retries_to_duplicate_ack(self) -> None:
        self.insert_v2_alert()
        payloads: list[dict[str, object]] = []

        def timeout_post(_url: str, *, json: dict[str, object], **_kwargs: object) -> FakeResponse:
            payloads.append(json)
            raise FakeTimeout("synthetic timeout after receiver commit")

        with self.connect() as conn:
            worker.dispatch_pending_render_alerts(conn, self.settings, now=SOURCE_TIME, post=timeout_post)

        def duplicate_post(_url: str, *, json: dict[str, object], **_kwargs: object) -> FakeResponse:
            payloads.append(json)
            return self.acknowledgement(json, "duplicate")

        with self.connect() as conn:
            sent = worker.dispatch_pending_render_alerts(
                conn, self.settings, now=SOURCE_TIME + timedelta(seconds=30), post=duplicate_post
            )
        self.assertEqual(sent, 1)
        self.assertEqual(payloads[0], payloads[1])
        self.assertEqual(self.row()["render_status"], "sent")

    def test_429_retries_but_401_and_403_are_permanent(self) -> None:
        for status_code in (429, 401, 403):
            with self.subTest(status_code=status_code):
                with self.connect() as conn:
                    conn.execute("DELETE FROM alerts")
                self.insert_v2_alert()
                with self.connect() as conn:
                    worker.dispatch_pending_render_alerts(
                        conn,
                        self.settings,
                        now=SOURCE_TIME,
                        post=lambda *_args, code=status_code, **_kwargs: FakeResponse(code),
                    )
                row = self.row()
                expected = "retry_wait" if status_code == 429 else f"permanent_http_{status_code}"
                self.assertEqual(row["render_status"], expected)
                self.assertEqual(row["render_attempt_count"], 1)

    def test_generic_2xx_or_html_without_exact_acknowledgement_retries(self) -> None:
        for response in (FakeResponse(204), FakeResponse(200, ValueError("synthetic HTML"))):
            with self.subTest(status_code=response.status_code):
                with self.connect() as conn:
                    conn.execute("DELETE FROM alerts")
                self.insert_v2_alert()
                with self.connect() as conn:
                    worker.dispatch_pending_render_alerts(
                        conn,
                        self.settings,
                        now=SOURCE_TIME,
                        post=lambda *_args, value=response, **_kwargs: value,
                    )
                self.assertEqual(self.row()["render_status"], "retry_wait")

    def test_expired_malformed_future_and_clock_rollback_never_send(self) -> None:
        cases = (
            (SOURCE_TIME + timedelta(minutes=15), "expired", None),
            (SOURCE_TIME, "invalid_timestamp", ("render_source_event_at", "not-a-time")),
            (SOURCE_TIME - timedelta(minutes=2), "future_timestamp", None),
        )
        for now, expected, corruption in cases:
            with self.subTest(expected=expected):
                with self.connect() as conn:
                    conn.execute("DELETE FROM alerts")
                self.insert_v2_alert()
                if corruption:
                    with self.connect() as conn:
                        conn.execute(f"UPDATE alerts SET {corruption[0]} = ?", (corruption[1],))
                calls = []
                with self.connect() as conn:
                    worker.dispatch_pending_render_alerts(
                        conn, self.settings, now=now, post=lambda *args, **kwargs: calls.append((args, kwargs))
                    )
                self.assertEqual(calls, [])
                self.assertEqual(self.row()["render_status"], expected)

        with self.connect() as conn:
            conn.execute("DELETE FROM alerts")
        self.insert_v2_alert()
        with self.connect() as conn:
            conn.execute(
                "UPDATE alerts SET render_status='retry_wait', render_attempt_count=1, "
                "render_last_attempt_at='2026-10-14T01:06:00Z', "
                "render_next_attempt_at='2026-10-14T01:06:30Z'"
            )
        calls = []
        with self.connect() as conn:
            worker.dispatch_pending_render_alerts(
                conn, self.settings, now=SOURCE_TIME, post=lambda *args, **kwargs: calls.append((args, kwargs))
            )
        self.assertEqual(calls, [])
        self.assertEqual(self.row()["render_attempt_count"], 1)

    def test_invalid_payload_never_sends_and_attempt_cap_is_terminal(self) -> None:
        self.insert_v2_alert()
        with self.connect() as conn:
            conn.execute("UPDATE alerts SET render_payload_fingerprint = ?", ("f" * 64,))
        calls = []
        with self.connect() as conn:
            worker.dispatch_pending_render_alerts(
                conn, self.settings, now=SOURCE_TIME, post=lambda *args, **kwargs: calls.append((args, kwargs))
            )
        self.assertEqual(calls, [])
        self.assertEqual(self.row()["render_status"], "invalid_payload")

        with self.connect() as conn:
            conn.execute("DELETE FROM alerts")
        capped = replace(self.settings, public_alert_retry_max_attempts=2)
        self.insert_v2_alert()
        for seconds in (0, 30):
            with self.connect() as conn:
                worker.dispatch_pending_render_alerts(
                    conn,
                    capped,
                    now=SOURCE_TIME + timedelta(seconds=seconds),
                    post=lambda *_args, **_kwargs: FakeResponse(500),
                )
        row = self.row()
        self.assertEqual(row["render_attempt_count"], 2)
        self.assertEqual(row["render_status"], "exhausted")
        self.assertIsNone(row["render_next_attempt_at"])

    def test_due_work_is_not_starved_and_expiry_is_rechecked_before_each_send(self) -> None:
        for index in range(5):
            self.insert_v2_alert(
                alert_key=f"probability_movement:not-due-{index}:7",
                status="retry_wait",
                attempt_count=1,
            )
            with self.connect() as conn:
                conn.execute(
                    """
                    UPDATE alerts
                    SET render_last_attempt_at = '2026-10-14T01:05:00Z',
                        render_next_attempt_at = '2026-10-14T01:10:00Z'
                    WHERE alert_key = ?
                    """,
                    (f"probability_movement:not-due-{index}:7",),
                )
        due_identity = self.insert_v2_alert(alert_key="probability_movement:due:7")
        posts: list[dict[str, object]] = []

        def acknowledge(_url: str, *, json: dict[str, object], **_kwargs: object) -> FakeResponse:
            posts.append(json)
            return self.acknowledgement(json)

        with self.connect() as conn:
            sent = worker.dispatch_pending_render_alerts(
                conn, self.settings, now=SOURCE_TIME, post=acknowledge
            )
        self.assertEqual(sent, 1)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["eventId"], due_identity["event_id"])

        with self.connect() as conn:
            conn.execute("DELETE FROM alerts")
        self.insert_v2_alert(alert_key="probability_movement:first:7")
        self.insert_v2_alert(alert_key="probability_movement:near-expiry:7")
        clock_values = iter((SOURCE_TIME, SOURCE_TIME, SOURCE_TIME + timedelta(minutes=15)))
        posts.clear()
        with self.connect() as conn:
            sent = worker.dispatch_pending_render_alerts(
                conn,
                self.settings,
                clock=lambda: next(clock_values),
                post=acknowledge,
            )
            statuses = [
                row["render_status"]
                for row in conn.execute("SELECT render_status FROM alerts ORDER BY id").fetchall()
            ]
        self.assertEqual(sent, 1)
        self.assertEqual(len(posts), 1)
        self.assertEqual(statuses, ["sent", "expired"])

    def test_legacy_failed_row_is_unchanged_and_never_enrolled_or_replayed(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO alerts (
                    alert_key, alert_type, market_id, question, severity, title,
                    message, quality_label, details_json, created_at, render_status
                ) VALUES ('legacy:1', 'legacy', 'market-legacy', 'Legacy?', 'low',
                    'Legacy', 'Legacy failure', 'medium', '{}', ?, 'failed')
                """,
                (worker.format_utc(SOURCE_TIME - timedelta(days=30)),),
            )
        worker.init_db(self.settings)
        calls = []
        with self.connect() as conn:
            worker.dispatch_pending_render_alerts(
                conn, self.settings, now=SOURCE_TIME, post=lambda *args, **kwargs: calls.append((args, kwargs))
            )
            row = conn.execute("SELECT * FROM alerts WHERE alert_key='legacy:1'").fetchone()
        self.assertEqual(calls, [])
        self.assertEqual(row["render_status"], "failed")
        self.assertIsNone(row["render_protocol_version"])
        self.assertIsNone(row["render_event_id"])
        self.assertEqual(row["render_attempt_count"], 0)

    def test_activation_off_pauses_v2_while_legacy_blank_delivery_stays_compatible(self) -> None:
        self.insert_v2_alert()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO alerts (
                    alert_key, alert_type, market_id, question, severity, title,
                    message, quality_label, details_json, created_at
                ) VALUES (
                    'legacy:blank', 'legacy', 'legacy-market', 'Legacy?', 'low',
                    'Legacy', 'Legacy pending', 'medium', '{}', '2026-10-14T01:04:00Z'
                )
                """
            )
        disabled = replace(self.settings, public_alert_retry_enabled=False)
        legacy_calls: list[int] = []
        original_sender = worker.send_render_alert_signal
        worker.send_render_alert_signal = lambda *_args: legacy_calls.append(1)
        self.addCleanup(setattr, worker, "send_render_alert_signal", original_sender)
        with self.connect() as conn:
            sent = worker.dispatch_pending_render_alerts(conn, disabled, now=SOURCE_TIME)
            rows = {
                row["alert_key"]: row
                for row in conn.execute("SELECT * FROM alerts ORDER BY id").fetchall()
            }
        self.assertEqual(sent, 1)
        self.assertEqual(legacy_calls, [1])
        self.assertEqual(rows["legacy:blank"]["render_status"], "sent")
        self.assertEqual(rows["probability_movement:market-1:7"]["render_status"], "pending")
        self.assertEqual(rows["probability_movement:market-1:7"]["render_attempt_count"], 0)

    def test_additive_sqlite_migration_preserves_a_pre_v2_failed_row(self) -> None:
        legacy_path = Path(self.temp_dir.name) / "legacy.sqlite3"
        legacy_settings = replace(self.settings, db_path=legacy_path)
        conn = sqlite3.connect(legacy_path)
        try:
            conn.executescript(
                """
                CREATE TABLE alerts (
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
                    render_status TEXT
                );
                INSERT INTO alerts (
                    alert_key, alert_type, market_id, question, severity, title,
                    message, details_json, created_at, render_status
                ) VALUES (
                    'legacy:pre-v2', 'legacy', 'legacy-market', 'Legacy?', 'low',
                    'Legacy', 'Legacy failure', '{}', '2026-08-07T00:00:00Z', 'failed'
                );
                """
            )
            conn.commit()
        finally:
            conn.close()

        worker.init_db(legacy_settings)
        with worker.db_connection(legacy_settings) as migrated:
            row = migrated.execute(
                "SELECT * FROM alerts WHERE alert_key='legacy:pre-v2'"
            ).fetchone()
        self.assertEqual(row["render_status"], "failed")
        self.assertEqual(row["created_at"], "2026-08-07T00:00:00Z")
        self.assertIsNone(row["render_protocol_version"])
        self.assertIsNone(row["render_event_id"])
        self.assertIsNone(row["render_payload_fingerprint"])
        self.assertEqual(row["render_attempt_count"], 0)

    def test_detection_discord_and_public_sanitization_contracts_remain_intact(self) -> None:
        self.assertTrue(worker.spike_detected(200, 100, 2.0, 50))
        self.assertFalse(worker.spike_detected(149, 100, 2.0, 50))
        self.assertTrue(worker.quality_is_dispatchable("medium"))
        self.assertFalse(worker.quality_is_dispatchable("low"))
        alert = {
            "alert_type": "probability_movement",
            "question": "Will example happen?",
            "message": "PBP_ALERT_INGEST_SECRET=do-not-leak https://private.invalid",
            "title": "Movement",
            "severity": "high",
            "quality_label": "high",
            "details": {},
            "created_at": worker.format_utc(SOURCE_TIME),
            "url": "https://polymarket.com/example",
        }
        discord = worker.build_discord_payload(self.settings, alert)
        self.assertEqual(discord["embeds"][0]["timestamp"], alert["created_at"])
        public = worker.build_render_alert_payload(alert)
        self.assertNotIn("do-not-leak", public["reason"])
        self.assertNotIn("private.invalid", public["reason"])

    def test_cross_language_unicode_canonical_fingerprint_fixture(self) -> None:
        sanitized = worker.build_render_alert_payload(
            {
                "alert_type": "probability_movement",
                "question": "Will “café” win?\nSoon",
                "message": 'Line "one"\nLine café',
                "severity": "high",
            }
        )
        self.assertEqual(sanitized["marketQuestion"], "Will “café” win? Soon")
        self.assertEqual(sanitized["reason"], 'Line "one" Line café')
        payload = {
            "alertType": "probability_movement",
            "eventId": f"pbp_{'d' * 40}",
            "expiresAt": "2026-10-14T01:20:00Z",
            "marketQuestion": "Will “café” win? Soon",
            "reason": 'Line "one" Line café',
            "schemaVersion": 2,
            "severity": "high",
            "source": "acer-alert-worker",
            "sourceEventAt": "2026-10-14T01:05:00Z",
        }
        self.assertEqual(
            worker.fingerprint_render_delivery_payload(payload),
            "12d0ee6c295a4e6c63a611ac560eab2a919a786cf6e040f546dae4602927d1d5",
        )

    def test_v2_escaped_unicode_and_quotes_cross_language_fingerprint(self) -> None:
        payload = {
            "alertType": "probability_movement",
            "eventId": f"pbp_{'e' * 40}",
            "expiresAt": "2026-10-14T01:20:00Z",
            "marketQuestion": 'Will "caf\u00e9" \U0001f680 win?',
            "reason": 'Path \\ archive and \u201cquoted\u201d \U0001f680',
            "schemaVersion": 2,
            "severity": "high",
            "source": "acer-alert-worker",
            "sourceEventAt": "2026-10-14T01:05:00Z",
        }
        self.assertEqual(
            worker.fingerprint_render_delivery_payload(payload),
            "d8ca986a372a986422898ca7105e25224118dde907255094bcf14b03d34b57cd",
        )

    def test_v2_public_text_budget_reserves_suffix_in_utf16_code_units(self) -> None:
        for field, input_key, limit in (
            ("marketQuestion", "question", 280),
            ("reason", "message", 400),
        ):
            exact_values = (
                "x" * limit,
                "\U0001f680" * (limit // 2),
                "x" * (limit - 2) + "\U0001f680",
            )
            one_over_values = (
                "x" * (limit + 1),
                "\U0001f680" * (limit // 2) + "x",
                "x" * (limit - 1) + "\U0001f680",
            )
            for value in exact_values:
                alert = {
                    "alert_type": "probability_movement",
                    "question": "Question",
                    "message": "Reason",
                    "severity": "high",
                }
                with self.subTest(field=field, value=value[-4:], boundary="exact"):
                    alert[input_key] = value
                    result = worker.build_canonical_render_public_fields_v2(alert)[field]
                    self.assertEqual(worker.utf16_code_unit_length(result), limit)
                    self.assertFalse(result.endswith("..."))

            for value in one_over_values:
                alert = {
                    "alert_type": "probability_movement",
                    "question": "Question",
                    "message": "Reason",
                    "severity": "high",
                }
                with self.subTest(field=field, value=value[-4:], boundary="one-over"):
                    alert[input_key] = value
                    result = worker.build_canonical_render_public_fields_v2(alert)[field]
                    self.assertLessEqual(worker.utf16_code_unit_length(result), limit)
                    self.assertTrue(result.endswith("..."))

            boundary_input = "a" + "\U0001f680" * (limit - 1)
            alert = {
                "alert_type": "probability_movement",
                "question": "Question",
                "message": "Reason",
                "severity": "high",
                input_key: boundary_input,
            }
            boundary_result = worker.build_canonical_render_public_fields_v2(alert)[field]
            expected = "a" + "\U0001f680" * ((limit - 4) // 2) + "..."
            self.assertEqual(boundary_result, expected)
            self.assertEqual(worker.utf16_code_unit_length(boundary_result), limit)
            self.assertFalse(any(0xD800 <= ord(char) <= 0xDFFF for char in boundary_result))

        canonical = worker.build_canonical_render_public_fields_v2({
            "alert_type": "probability_movement",
            "question": "safe\ud800text",
            "message": "safe\udc00text",
            "severity": "high",
        })
        self.assertEqual(canonical["marketQuestion"], "safe\ufffdtext")
        self.assertEqual(canonical["reason"], "safe\ufffdtext")
        self.assertFalse(any(0xD800 <= ord(value) <= 0xDFFF for value in canonical["marketQuestion"]))
        self.assertEqual(
            worker.sanitize_public_signal_text_v2("left\ufeffright", 280),
            "left right",
        )
        self.assertEqual(
            worker.sanitize_public_signal_text_v2("Short caf\u00e9 \U0001f680", 280),
            "Short caf\u00e9 \U0001f680",
        )

    def test_v2_contract_rejects_raw_oversize_but_builder_enrolls_canonical_text(self) -> None:
        source_event_at = worker.format_utc(SOURCE_TIME)
        raw_payload = {
            "alertType": "probability_movement",
            "eventId": f"pbp_{'a' * 40}",
            "expiresAt": worker.format_utc(SOURCE_TIME + timedelta(minutes=15)),
            "marketQuestion": "a" + "\U0001f680" * 279,
            "reason": "a" + "\U0001f680" * 399,
            "schemaVersion": 2,
            "severity": "high",
            "source": "acer-alert-worker",
            "sourceEventAt": source_event_at,
        }
        raw_payload["fingerprint"] = worker.fingerprint_render_delivery_payload(raw_payload)
        self.assertFalse(worker.render_delivery_payload_has_valid_contract(raw_payload))

        identity = worker.build_render_delivery_identity(
            settings=self.settings,
            alert_key="probability_movement:unicode-boundary:7",
            alert_type=raw_payload["alertType"],
            question=raw_payload["marketQuestion"],
            message=raw_payload["reason"],
            severity=raw_payload["severity"],
            created_at=source_event_at,
        )
        prepared = worker.build_render_alert_payload_v2({
            "alert_type": raw_payload["alertType"],
            "question": raw_payload["marketQuestion"],
            "message": raw_payload["reason"],
            "severity": raw_payload["severity"],
            "render_protocol_version": identity["version"],
            "render_event_id": identity["event_id"],
            "render_payload_fingerprint": identity["fingerprint"],
            "render_source_event_at": identity["source_event_at"],
            "render_expires_at": identity["expires_at"],
        })
        self.assertTrue(worker.render_delivery_payload_has_valid_contract(prepared))
        self.assertEqual(prepared["marketQuestion"], "a" + "\U0001f680" * 138 + "...")
        self.assertEqual(prepared["reason"], "a" + "\U0001f680" * 198 + "...")

    def test_v2_identity_is_validated_before_enrollment(self) -> None:
        with patch.object(worker, "fingerprint_render_delivery_payload", return_value="not-a-fingerprint"):
            with self.assertRaisesRegex(ValueError, "noncanonical V2 payload"):
                worker.build_render_delivery_identity(
                    settings=self.settings,
                    alert_key="probability_movement:invalid:7",
                    alert_type="probability_movement",
                    question="Question",
                    message="Reason",
                    severity="high",
                    created_at=worker.format_utc(SOURCE_TIME),
                )

    def test_settings_default_disabled_and_future_skew_clamped_to_receiver_bound(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PBP_ENV_FILE": str(ROOT / "tests" / "nonexistent-offline-test.env"),
                "PBP_ALERT_RETRY_FUTURE_SKEW_SECONDS": "999",
            },
            clear=True,
        ):
            settings = worker.build_settings()
        self.assertFalse(settings.public_alert_retry_enabled)
        self.assertEqual(settings.public_alert_retry_future_skew_seconds, 60)

    def test_worker_copies_are_byte_equivalent(self) -> None:
        self.assertEqual(
            hashlib.sha256(WORKER_PATH.read_bytes()).digest(),
            hashlib.sha256(MIRROR_WORKER_PATH.read_bytes()).digest(),
        )


if __name__ == "__main__":
    unittest.main()
