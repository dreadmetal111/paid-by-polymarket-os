from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "pbp-alert-worker" / "pbp_alert_worker.py"


def forbidden_external_request(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("External requests are forbidden in offline tests")


fake_requests = types.ModuleType("requests")
fake_requests.RequestException = Exception
fake_requests.Timeout = TimeoutError
fake_requests.get = forbidden_external_request
fake_requests.post = forbidden_external_request

fake_dotenv = types.ModuleType("dotenv")


def forbidden_env_load(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("Private env-file loading is forbidden in offline tests")


fake_dotenv.load_dotenv = forbidden_env_load


class FakeFlask:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def get(self, *_args: object, **_kwargs: object):
        return lambda function: function


fake_flask = types.ModuleType("flask")
fake_flask.Flask = FakeFlask
fake_flask.jsonify = lambda value: value
fake_flask.request = SimpleNamespace(args={})


def load_worker():
    synthetic_modules = {
        "requests": fake_requests,
        "dotenv": fake_dotenv,
        "flask": fake_flask,
    }
    synthetic_environment = {
        "PBP_ENV_FILE": str(ROOT / "tests" / "nonexistent-offline-test.env"),
    }
    with patch.dict(os.environ, synthetic_environment, clear=True), patch.dict(
        sys.modules, synthetic_modules
    ):
        spec = importlib.util.spec_from_file_location(
            "pbp_alert_worker_boundary_fixture", WORKER_PATH
        )
        assert spec and spec.loader
        worker = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = worker
        spec.loader.exec_module(worker)
    return worker


def main() -> None:
    worker = load_worker()
    source_event_at = "2026-10-14T01:05:00Z"
    alert = {
        "alert_type": "probability_movement",
        "question": "a" + "\U0001f680" * 279,
        "message": "a" + "\U0001f680" * 399,
        "severity": "high",
    }
    identity = worker.build_render_delivery_identity(
        settings=SimpleNamespace(public_alert_retry_ttl_seconds=900),
        alert_key="probability_movement:unicode-boundary:7",
        alert_type=alert["alert_type"],
        question=alert["question"],
        message=alert["message"],
        severity=alert["severity"],
        created_at=source_event_at,
    )
    payload = worker.build_render_alert_payload_v2(
        {
            **alert,
            "render_protocol_version": identity["version"],
            "render_event_id": identity["event_id"],
            "render_payload_fingerprint": identity["fingerprint"],
            "render_source_event_at": identity["source_event_at"],
            "render_expires_at": identity["expires_at"],
        }
    )
    assert worker.render_delivery_payload_has_valid_contract(payload)
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
