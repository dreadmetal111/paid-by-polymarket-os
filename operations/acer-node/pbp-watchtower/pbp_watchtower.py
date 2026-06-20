from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone, timedelta
import json
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error

PBP_HOME_URL = os.environ.get("PBP_HOME_URL", "https://paid-by-polymarket-os.onrender.com/")
PBP_MARKETS_URL = os.environ.get("PBP_MARKETS_URL", "https://paid-by-polymarket-os.onrender.com/api/liveMarkets")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()

HOST = "0.0.0.0"
PORT = int(os.environ.get("PBP_WATCHTOWER_PORT", "5080"))
CHECK_INTERVAL_SECONDS = int(os.environ.get("CHECK_INTERVAL_SECONDS", "300"))
DAILY_REPORT_HOUR_UTC = int(os.environ.get("DAILY_REPORT_HOUR_UTC", "21"))

DB_PATH = os.environ.get("PBP_WATCHTOWER_DB", "pbp_watchtower.db")
STATE_PATH = os.environ.get("PBP_WATCHTOWER_STATE", "last_status.txt")
DAILY_REPORT_STATE_PATH = os.environ.get("DAILY_REPORT_STATE_PATH", "last_daily_report_date.txt")
TASK_LOG_PATH = os.environ.get("TASK_LOG_PATH", "tasks.json")

latest_lock = threading.Lock()

latest_status = {
    "service": "pbp-watchtower",
    "version": "1.2-daily-report-task-log",
    "status": "starting",
    "last_check_utc": None,
    "discord_alerts_configured": bool(DISCORD_WEBHOOK_URL),
    "home": None,
    "live_markets": None,
    "warnings": ["Initial check has not completed yet."]
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def utc_date():
    return datetime.now(timezone.utc).date().isoformat()


def set_latest(status_obj):
    global latest_status
    with latest_lock:
        latest_status = status_obj


def get_latest():
    with latest_lock:
        return dict(latest_status)


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checked_at_utc TEXT NOT NULL,
            overall_status TEXT NOT NULL,
            home_ok INTEGER NOT NULL,
            home_status_code INTEGER,
            home_latency_ms INTEGER,
            markets_ok INTEGER NOT NULL,
            markets_status_code INTEGER,
            markets_latency_ms INTEGER,
            market_count INTEGER,
            warnings TEXT
        )
    """)
    conn.commit()
    conn.close()


def fetch_url(url, timeout=20):
    start = time.time()

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PBP-Watchtower/1.2"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            latency_ms = int((time.time() - start) * 1000)
            status_code = response.getcode()

            parsed = None
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = None

            return {
                "ok": 200 <= status_code < 400,
                "status_code": status_code,
                "latency_ms": latency_ms,
                "json": parsed,
                "error": None
            }

    except urllib.error.HTTPError as e:
        latency_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "status_code": e.code,
            "latency_ms": latency_ms,
            "json": None,
            "error": str(e)
        }

    except Exception as e:
        latency_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": latency_ms,
            "json": None,
            "error": str(e)
        }


def extract_market_count(data):
    if isinstance(data, list):
        return len(data)

    if isinstance(data, dict):
        if isinstance(data.get("count"), int):
            return data["count"]

        for key in ["markets", "data", "results"]:
            value = data.get(key)
            if isinstance(value, list):
                return len(value)

    return None


def read_text_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


def write_text_file(path, value):
    with open(path, "w", encoding="utf-8") as f:
        f.write(value)


def load_tasks():
    try:
        with open(TASK_LOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []


def save_tasks(tasks):
    with open(TASK_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2)


def create_degraded_task(warnings, market_count, home, markets):
    tasks = load_tasks()
    signature = "|".join(warnings) if warnings else "degraded-unknown"

    for task in tasks:
        if task.get("status") == "open" and task.get("signature") == signature:
            task["last_seen_utc"] = utc_now()
            task["occurrence_count"] = int(task.get("occurrence_count", 1)) + 1
            save_tasks(tasks)
            return

    task_id = "pbp-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    priority = "high" if not markets.get("ok") else "medium"

    tasks.append({
        "id": task_id,
        "title": "Investigate PBP degraded status",
        "status": "open",
        "priority": priority,
        "source": "pbp-watchtower",
        "signature": signature,
        "created_at_utc": utc_now(),
        "last_seen_utc": utc_now(),
        "occurrence_count": 1,
        "warnings": warnings,
        "market_count": market_count,
        "home": {
            "ok": home.get("ok"),
            "status_code": home.get("status_code"),
            "latency_ms": home.get("latency_ms"),
            "error": home.get("error")
        },
        "live_markets": {
            "ok": markets.get("ok"),
            "status_code": markets.get("status_code"),
            "latency_ms": markets.get("latency_ms"),
            "error": markets.get("error")
        }
    })

    save_tasks(tasks)


def send_discord_alert(title, description, color):
    if not DISCORD_WEBHOOK_URL:
        print("Discord webhook not configured.", flush=True)
        return False

    payload = {
        "username": "PBP Watchtower",
        "embeds": [
            {
                "title": title,
                "description": description,
                "color": color,
                "timestamp": utc_now(),
                "footer": {"text": "acer-node • PBP Watchtower v1.2"}
            }
        ]
    }

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        DISCORD_WEBHOOK_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "House-of-Markets-Watchtower/1.0",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            print(f"Discord alert sent: HTTP {response.getcode()}", flush=True)
            return 200 <= response.getcode() < 300
    except Exception as e:
        print(f"Discord alert failed: {e}", flush=True)
        return False


def build_alert_text(status, warnings, market_count, home, markets):
    warning_text = "\n".join(f"- {w}" for w in warnings) if warnings else "None"

    return (
        f"**Status:** `{status.upper()}`\n"
        f"**Homepage:** `{home.get('status_code')}` in `{home.get('latency_ms')}ms`\n"
        f"**Live Markets:** `{markets.get('status_code')}` in `{markets.get('latency_ms')}ms`\n"
        f"**Market Count:** `{market_count}`\n"
        f"**Warnings:**\n{warning_text}"
    )


def maybe_status_alert(status, warnings, market_count, home, markets):
    previous = read_text_file(STATE_PATH)

    if not previous:
        write_text_file(STATE_PATH, status)
        if status != "ok":
            create_degraded_task(warnings, market_count, home, markets)
            send_discord_alert(
                "⚠️ PBP Watchtower started DEGRADED",
                build_alert_text(status, warnings, market_count, home, markets),
                16753920
            )
        return

    if previous != status:
        if status == "ok":
            send_discord_alert(
                "✅ PBP Watchtower recovered",
                build_alert_text(status, warnings, market_count, home, markets),
                5763719
            )
        else:
            create_degraded_task(warnings, market_count, home, markets)
            send_discord_alert(
                "⚠️ PBP Watchtower degraded",
                build_alert_text(status, warnings, market_count, home, markets),
                16753920
            )

        write_text_file(STATE_PATH, status)


def generate_report(hours=24):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        SELECT
            COUNT(*),
            SUM(CASE WHEN overall_status = 'ok' THEN 1 ELSE 0 END),
            AVG(home_latency_ms),
            AVG(markets_latency_ms),
            MIN(market_count),
            MAX(market_count),
            AVG(market_count)
        FROM checks
        WHERE checked_at_utc >= ?
    """, (since_iso,))

    row = cur.fetchone()
    conn.close()

    total_checks = row[0] or 0
    ok_checks = row[1] or 0
    uptime_percent = round((ok_checks / total_checks) * 100, 2) if total_checks else 0

    tasks = load_tasks()
    open_tasks = [t for t in tasks if t.get("status") == "open"]

    latest = get_latest()

    return {
        "service": "pbp-watchtower",
        "version": "1.2-daily-report-task-log",
        "generated_at_utc": utc_now(),
        "window_hours": hours,
        "current_status": latest.get("status"),
        "total_checks": total_checks,
        "ok_checks": ok_checks,
        "degraded_checks": total_checks - ok_checks,
        "uptime_percent": uptime_percent,
        "avg_home_latency_ms": round(row[2], 2) if row[2] is not None else None,
        "avg_markets_latency_ms": round(row[3], 2) if row[3] is not None else None,
        "min_market_count": row[4],
        "max_market_count": row[5],
        "avg_market_count": round(row[6], 2) if row[6] is not None else None,
        "open_tasks": len(open_tasks),
        "latest": latest
    }


def format_daily_report(report):
    return (
        f"**Current Status:** `{str(report.get('current_status')).upper()}`\n"
        f"**Checks:** `{report.get('total_checks')}` total / `{report.get('ok_checks')}` OK / `{report.get('degraded_checks')}` degraded\n"
        f"**Uptime:** `{report.get('uptime_percent')}%`\n"
        f"**Avg Homepage Latency:** `{report.get('avg_home_latency_ms')}ms`\n"
        f"**Avg Markets Latency:** `{report.get('avg_markets_latency_ms')}ms`\n"
        f"**Market Count Range:** `{report.get('min_market_count')}` → `{report.get('max_market_count')}`\n"
        f"**Avg Market Count:** `{report.get('avg_market_count')}`\n"
        f"**Open Tasks:** `{report.get('open_tasks')}`\n"
        f"**Generated:** `{report.get('generated_at_utc')}`"
    )


def maybe_daily_report():
    now = datetime.now(timezone.utc)

    if now.hour < DAILY_REPORT_HOUR_UTC:
        return

    today = utc_date()
    last_sent = read_text_file(DAILY_REPORT_STATE_PATH)

    if last_sent == today:
        return

    report = generate_report(hours=24)
    sent = send_discord_alert(
        "📊 PBP Watchtower Daily Report",
        format_daily_report(report),
        3447003
    )

    if sent:
        write_text_file(DAILY_REPORT_STATE_PATH, today)


def save_check_to_db(checked_at, status, home, markets, market_count, warnings):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO checks (
            checked_at_utc,
            overall_status,
            home_ok,
            home_status_code,
            home_latency_ms,
            markets_ok,
            markets_status_code,
            markets_latency_ms,
            market_count,
            warnings
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        checked_at,
        status,
        1 if home["ok"] else 0,
        home["status_code"],
        home["latency_ms"],
        1 if markets["ok"] else 0,
        markets["status_code"],
        markets["latency_ms"],
        market_count,
        json.dumps(warnings)
    ))
    conn.commit()
    conn.close()


def run_check():
    checked_at = utc_now()
    warnings = []

    home = fetch_url(PBP_HOME_URL)
    markets = fetch_url(PBP_MARKETS_URL)
    market_count = extract_market_count(markets.get("json"))

    if not home["ok"]:
        warnings.append(f"Homepage check failed: {home.get('error') or home.get('status_code')}")

    if not markets["ok"]:
        warnings.append(f"Live markets check failed: {markets.get('error') or markets.get('status_code')}")

    if markets["ok"] and market_count is None:
        warnings.append("Live markets responded, but market count could not be detected.")

    if market_count is not None and market_count < 20:
        warnings.append(f"Market count is unusually low: {market_count}")

    status = "ok" if not warnings else "degraded"

    status_obj = {
        "service": "pbp-watchtower",
        "version": "1.2-daily-report-task-log",
        "status": status,
        "last_check_utc": checked_at,
        "pbp_home_url": PBP_HOME_URL,
        "pbp_markets_url": PBP_MARKETS_URL,
        "discord_alerts_configured": bool(DISCORD_WEBHOOK_URL),
        "daily_report_hour_utc": DAILY_REPORT_HOUR_UTC,
        "home": {
            "ok": home["ok"],
            "status_code": home["status_code"],
            "latency_ms": home["latency_ms"],
            "error": home["error"]
        },
        "live_markets": {
            "ok": markets["ok"],
            "status_code": markets["status_code"],
            "latency_ms": markets["latency_ms"],
            "market_count": market_count,
            "error": markets["error"]
        },
        "warnings": warnings
    }

    set_latest(status_obj)
    save_check_to_db(checked_at, status, home, markets, market_count, warnings)
    maybe_status_alert(status, warnings, market_count, home, markets)
    maybe_daily_report()

    print(json.dumps(status_obj, indent=2), flush=True)


def watch_loop():
    while True:
        try:
            run_check()
        except Exception as e:
            error_status = {
                "service": "pbp-watchtower",
                "version": "1.2-daily-report-task-log",
                "status": "error",
                "last_check_utc": utc_now(),
                "discord_alerts_configured": bool(DISCORD_WEBHOOK_URL),
                "warnings": [f"Watch loop error: {e}"]
            }
            set_latest(error_status)
            print(json.dumps(error_status, indent=2), flush=True)

        time.sleep(CHECK_INTERVAL_SECONDS)


class StatusHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/report":
            response = generate_report(hours=24)
        elif path == "/tasks":
            response = {
                "service": "pbp-watchtower",
                "version": "1.2-daily-report-task-log",
                "tasks": load_tasks()
            }
        else:
            response = get_latest()

        body = json.dumps(response, indent=2).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()

        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def log_message(self, fmt, *args):
        print("[%s] %s" % (utc_now(), fmt % args), flush=True)


if __name__ == "__main__":
    print("Starting PBP Watchtower v1.2...", flush=True)
    print(f"Status API: http://{HOST}:{PORT}", flush=True)
    print(f"Discord alerts configured: {bool(DISCORD_WEBHOOK_URL)}", flush=True)
    print(f"Daily report hour UTC: {DAILY_REPORT_HOUR_UTC}", flush=True)

    init_db()

    thread = threading.Thread(target=watch_loop, daemon=True)
    thread.start()

    server = ThreadingHTTPServer((HOST, PORT), StatusHandler)
    server.serve_forever()
